const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const sql = require('mssql');
const crypto = require('crypto');

const app = express();
const origenesPermitidos = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'];

const corsOptions = {
    origin: function (origin, callback) {
        // Permitir peticiones sin origen (como aplicaciones móviles o herramientas locales) 
        // o si el origen está dentro de la lista permitida
        if (!origin || origenesPermitidos.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error('Acceso denegado por políticas de seguridad CORS.'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    optionsSuccessStatus: 200
};

// Aplicar la política de CORS configurada
app.use(cors(corsOptions));
// Confianza en proxies (necesario para leer la IP real en despliegues)
app.set('trust proxy', true); 
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public'))); 

const dbConfig = {
    user: 'sa', 
    password: '1234',
    server: 'localhost',
    database: 'CentralMovilDB',
    options: {
        encrypt: false, 
        trustServerCertificate: true
    }
};

const poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then(pool => {
        console.log('✅ Conectado a SQL Server');
        return pool;
    })
    .catch(err => console.log('❌ Error de base de datos: ', err));


// ==========================================
// 1. REGISTRO SEGURO (UNICO EMAIL Y UNICA IP)
// ==========================================
app.post('/api/registro', async (req, res) => {
    const { nombre, email, password, rol } = req.body;
    
    // Extraer la IP real del usuario
    const ipUsuario = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    try {
        let pool = await poolPromise;
        
        // REGLA: Bloquear si el correo o la IP ya existen en el sistema
        const check = await pool.request()
            .input('email', sql.VarChar, email)
            .input('ip', sql.VarChar, ipUsuario)
            .query('SELECT id_usuario FROM Credencial WHERE email = @email OR ip_registro = @ip');
            
        if(check.recordset.length > 0) {
            return res.status(400).send("No puedes registrarte. El correo ya existe o ya hay una cuenta registrada desde tu red (IP).");
        }

        // REGLA: Cifrar la contraseña (HASH)
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Guardar en la base de datos
        await pool.request()
            .input('nombre', sql.VarChar, nombre)
            .input('email', sql.VarChar, email)
            .input('passHash', sql.VarChar, passwordHash)
            .input('rol', sql.VarChar, rol)
            .input('ip', sql.VarChar, ipUsuario)
            .query(`
                INSERT INTO Usuario (nombre) VALUES (@nombre);
                DECLARE @newId INT = SCOPE_IDENTITY();
                INSERT INTO Credencial (username, email, password_hash, rol, id_usuario, ip_registro) 
                VALUES (@email, @email, @passHash, @rol, @newId, @ip);
            `);
        
        res.status(201).send("Registro exitoso");
    } catch (err) {
        console.error("Error en registro:", err);
        res.status(500).send("Error interno: " + err.message);
    }
});

// ==========================================
// 2. LOGIN SEGURO (CON BCRYPT)
// ==========================================
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        let pool = await poolPromise;
        let result = await pool.request()
            .input('email', sql.VarChar, email)
            .query(`
                SELECT c.password_hash, c.rol, u.nombre, u.id_usuario
                FROM Credencial c
                JOIN Usuario u ON c.id_usuario = u.id_usuario
                WHERE c.email = @email OR c.username = @email
            `);

        if (result.recordset.length === 0) {
            return res.status(401).send("Correo o contraseña incorrectos.");
        }

        const usuario = result.recordset[0];

        // Comparar la contraseña escrita con el Hash encriptado de la base de datos
        const contrasenaCoincide = await bcrypt.compare(password, usuario.password_hash);

        if (!contrasenaCoincide) {
            return res.status(401).send("Correo o contraseña incorrectos.");
        }

        res.status(200).json({
            id_usuario: usuario.id_usuario,
            nombre: usuario.nombre,
            rol: usuario.rol
        });

    } catch (err) {
        res.status(500).send("Error en la autenticación.");
    }
});

// ==========================================
// ENDPOINTS DE TERMINALES (CON REGLAS DE NEGOCIO)
// ==========================================

// GET: Leer terminales incluyendo estado de aprobación
app.get('/api/terminales', async (req, res) => {
    try {
        let pool = await poolPromise;
        let result = await pool.request().query(`
            SELECT t.numero_telefono, t.saldo, t.esta_encendido, t.estado_aprobacion, u.nombre 
            FROM Terminal t JOIN Usuario u ON t.id_usuario = u.id_usuario
            ORDER BY u.nombre, t.numero_telefono
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error en la base de datos: " + err.message);
    }
});

// POST: Registrar terminal con límite de 2 líneas
// POST: Registrar terminal con límite de 2 líneas y Bloqueo de Spam
app.post('/api/terminales', async (req, res) => {
    const { numero_telefono, id_usuario } = req.body;
    try {
        let pool = await poolPromise;
        
        // --- NUEVA REGLA ESTRICTA: ¿Tiene líneas pendientes de aprobación? ---
        let checkPendientes = await pool.request()
            .input('id_usuario', sql.Int, id_usuario)
            .query("SELECT COUNT(*) as pendientes FROM Terminal WHERE id_usuario = @id_usuario AND estado_aprobacion = 'Pendiente'");
            
        if (checkPendientes.recordset[0].pendientes > 0) {
            // Si tiene al menos 1 pendiente, bloqueamos la creación desde la raíz (Backend)
            return res.status(400).json({ 
                message: "❌ Solicitud rechazada: Tienes una línea en estado 'Pendiente'. Debes esperar la autorización del administrador antes de solicitar otra." 
            });
        }
        // ---------------------------------------------------------------------

        // Contar cuántas líneas tiene este usuario actualmente
        let conteo = await pool.request()
            .input('id_usuario', sql.Int, id_usuario)
            .query('SELECT COUNT(*) as total_lineas FROM Terminal WHERE id_usuario = @id_usuario');
            
        let total = conteo.recordset[0].total_lineas;
        
        // REGLA DE NEGOCIO: Límite de 2 líneas aprobadas automáticas.
        let estado_aprobacion = total >= 2 ? 'Pendiente' : 'Aprobada';

        await pool.request()
            .input('numero', sql.VarChar, numero_telefono)
            .input('id_usuario', sql.Int, id_usuario)
            .input('estado_aprobacion', sql.VarChar, estado_aprobacion)
            .query(`
                INSERT INTO Terminal (numero_telefono, id_usuario, estado_aprobacion) 
                VALUES (@numero, @id_usuario, @estado_aprobacion)
            `);
        
        let msj = estado_aprobacion === 'Pendiente' 
            ? 'Línea registrada, pero requiere APROBACIÓN del administrador (Límite de 2 líneas superado).' 
            : 'Línea registrada exitosamente.';
            
        res.status(201).json({ message: msj, estado: estado_aprobacion });
    } catch (err) {
        console.error("Error al registrar terminal:", err);
        res.status(500).json({ message: "Error al registrar: " + err.message });
    }
});

// PUT: Aprobar línea pendiente (Solo Admin)
app.put('/api/terminales/aprobar/:numero', async (req, res) => {
    try {
        let pool = await poolPromise;
        await pool.request()
            .input('numero', sql.VarChar, req.params.numero)
            .query(`UPDATE Terminal SET estado_aprobacion = 'Aprobada' WHERE numero_telefono = @numero`);
            
        res.json({ success: true, message: "Línea aprobada correctamente." });
    } catch (err) {
        res.status(500).send("Error al aprobar la línea: " + err.message);
    }
});

// PUT: Actualizar propietario o encender/apagar
app.put('/api/terminales/:numero', async (req, res) => {
    try {
        const pool = await poolPromise;
        const numero = req.params.numero;
        const { estado, id_usuario } = req.body;

        if (id_usuario !== undefined) {
            await pool.request()
                .input('id_usuario', sql.Int, id_usuario)
                .input('numero', sql.VarChar, numero)
                .query('UPDATE Terminal SET id_usuario = @id_usuario WHERE numero_telefono = @numero');
        } else if (estado !== undefined) {
            await pool.request()
                .input('estado', sql.Bit, estado)
                .input('numero', sql.VarChar, numero)
               .query('UPDATE Terminal SET esta_encendido = @estado WHERE numero_telefono = @numero');
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).send("Error de base de datos: " + err.message);
    }
});

// DELETE: Borrar Terminal en cascada
app.delete('/api/terminales/:numero', async (req, res) => {
    try {
        const pool = await poolPromise;
        const numero = req.params.numero;

        await pool.request()
            .input('numero', sql.VarChar, numero)
            .query(`
                DELETE FROM Recarga WHERE numero_telefono = @numero;
                UPDATE Terminal SET numero_desvio = NULL WHERE numero_desvio = @numero;
                UPDATE Terminal SET numero_desvio = NULL WHERE numero_telefono = @numero;
                DELETE FROM Mensaje WHERE numero_origen = @numero OR numero_destino = @numero;
                DELETE FROM Terminal WHERE numero_telefono = @numero;
            `);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});


// ==========================================
// ENDPOINTS DE RECARGAS
// ==========================================
app.get('/api/recargas', async (req, res) => {
    try {
        let pool = await poolPromise;
        let result = await pool.request().query(`
            SELECT TOP 10 id_recarga, monto, fecha_hora, tipo_pago, total_neto, numero_telefono 
            FROM Recarga 
            ORDER BY fecha_hora DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error en la BD.");
    }
});

// ==========================================
// REGISTRO DE RECARGA Y FACTURACIÓN AUTOMÁTICA
// ==========================================
app.post('/api/recargas', async (req, res) => {
    const { numero_telefono, monto, tipo_pago, rfc } = req.body; 
    
    // Generadores de identificadores únicos
   const id_recarga = "REC-" + crypto.randomInt(100000, 999999); 
    
    // Genera un Identificador Único Universal (UUID versión 4) estándar para uso fiscal
    const folio_fiscal = crypto.randomUUID().toUpperCase();
    // Cálculos fiscales (Basado en el 16% de IVA estándar)
    const tasaIva = 0.16;
    const subtotal = monto / (1 + tasaIva);
    const iva = monto - subtotal;
    const rfc_final = rfc ? rfc.toUpperCase() : 'XAXX010101000'; // RFC Genérico si el cliente no lo proporciona

    try {
        let pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            
            // 1. Insertar el registro financiero de la recarga
            await request
                .input('id', sql.VarChar, id_recarga)
                .input('monto', sql.Decimal(10,2), monto)
                .input('tipo', sql.VarChar, tipo_pago)
                .input('num', sql.VarChar, numero_telefono)
                .query(`INSERT INTO Recarga (id_recarga, monto, tipo_pago, total_neto, numero_telefono) 
                        VALUES (@id, @monto, @tipo, @monto, @num)`);
            
            // 2. Actualizar el saldo operativo de la terminal
            await request
                .query(`UPDATE Terminal SET saldo = saldo + @monto WHERE numero_telefono = @num`);
            
            // 3. Generar y timbrar la factura fiscal
            await request
                .input('folio', sql.VarChar, folio_fiscal)
                .input('id_rec', sql.VarChar, id_recarga)
                .input('rfc', sql.VarChar, rfc_final)
                .input('sub', sql.Decimal(10,2), subtotal)
                .input('iva_val', sql.Decimal(10,2), iva)
                .input('tot', sql.Decimal(10,2), monto)
                .query(`INSERT INTO Factura (folio_fiscal, id_recarga, rfc_cliente, subtotal, iva, total) 
                        VALUES (@folio, @id_rec, @rfc, @sub, @iva_val, @tot)`);
            
            await transaction.commit(); 
            res.status(201).json({ 
                message: 'Transacción aprobada y facturada correctamente.', 
                folio_generado: folio_fiscal 
            });

        } catch (err) {
            await transaction.rollback(); 
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Error interno procesando transacción contable: " + err.message });
    }
});

// NUEVO ENDPOINT: Consultar el historial de Facturas
app.get('/api/facturas', async (req, res) => {
    try {
        let pool = await poolPromise;
        let result = await pool.request().query(`
            SELECT f.folio_fiscal, f.rfc_cliente, f.subtotal, f.iva, f.total, f.fecha_emision, r.numero_telefono
            FROM Factura f
            JOIN Recarga r ON f.id_recarga = r.id_recarga
            ORDER BY f.fecha_emision DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: "Error al consultar facturación." });
    }
});

// ==========================================
// ENDPOINTS DE DESVÍOS
// ==========================================
app.get('/api/desvios', async (req, res) => {
    try {
        let pool = await poolPromise;
        let result = await pool.request().query(`
            SELECT numero_telefono AS origen, numero_desvio AS destino, esta_encendido 
            FROM Terminal 
            WHERE numero_desvio IS NOT NULL
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).send("Error al consultar desvíos: " + err.message);
    }
});

app.post('/api/desvios', async (req, res) => {
    const { origen, destino } = req.body;
    
    if (origen === destino) {
        return res.status(400).send("Error: Bucle detectado. No puedes desviar una línea hacia sí misma.");
    }

    try {
        let pool = await poolPromise;
        
        let checkDestino = await pool.request()
            .input('destino', sql.VarChar, destino)
            .query('SELECT numero_telefono FROM Terminal WHERE numero_telefono = @destino');
            
        if (checkDestino.recordset.length === 0) {
            return res.status(404).send("Error: La línea destino no existe en la red.");
        }

        await pool.request()
            .input('origen', sql.VarChar, origen)
            .input('destino', sql.VarChar, destino)
            .query('UPDATE Terminal SET numero_desvio = @destino WHERE numero_telefono = @origen');
            
        res.status(200).send({ message: 'Desvío enrutado correctamente' });
    } catch (err) {
        res.status(500).send("Error interno: " + err.message);
    }
});

app.put('/api/desvios/:origen', async (req, res) => {
    const origen = req.params.origen;
    const { destino } = req.body;

    try {
        const pool = await poolPromise;
        const existeDestino = await pool.request()
            .input('destino', sql.VarChar, destino)
            .query(`SELECT numero_telefono FROM Terminal WHERE numero_telefono = @destino`);

        if (existeDestino.recordset.length === 0) {
            return res.status(404).send('La línea destino no existe.');
        }

        if (origen === destino) {
            return res.status(400).send('No puedes desviar una línea hacia sí misma.');
        }

        await pool.request()
            .input('origen', sql.VarChar, origen)
            .input('destino', sql.VarChar, destino)
            .query(`UPDATE Terminal SET numero_desvio = @destino WHERE numero_telefono = @origen`);

        res.json({ success: true, message: 'Desvío actualizado correctamente' });
    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.delete('/api/desvios/:origen', async (req, res) => {
    const origen = req.params.origen;
    try {
        let pool = await poolPromise;
        await pool.request()
            .input('origen', sql.VarChar, origen)
            .query('UPDATE Terminal SET numero_desvio = NULL WHERE numero_telefono = @origen');
        res.status(200).send({ message: 'Desvío desactivado' });
    } catch (err) {
        res.status(500).send("Error al desactivar: " + err.message);
    }
});


// ==========================================
// ENDPOINTS DE USUARIOS
// ==========================================
app.get('/api/usuarios', async (req, res) => {
    try {
        let pool = await poolPromise;
        let result = await pool.request().query(`
            SELECT u.id_usuario, u.nombre, c.username, ISNULL(c.rol, 'CLIENTE') AS rol
            FROM Usuario u
            LEFT JOIN Credencial c ON u.id_usuario = c.id_usuario
            ORDER BY u.id_usuario DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error al consultar el catálogo de usuarios.");
    }
});

app.post('/api/usuarios', async (req, res) => {
    const { nombre, username, rol } = req.body;
    const defaultHash = "1234"; 

    try {
        let pool = await poolPromise;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            
            let userResult = await request
                .input('nombre', sql.VarChar, nombre)
                .query('INSERT INTO Usuario (nombre) OUTPUT INSERTED.id_usuario VALUES (@nombre)');
            
            const nuevoIdUsuario = userResult.recordset[0].id_usuario;

            await request
                .input('username', sql.VarChar, username)
                .input('hash', sql.VarChar, defaultHash)
                .input('rol', sql.VarChar, rol)
                .input('id_user', sql.Int, nuevoIdUsuario)
                .query(`INSERT INTO Credencial (username, password_hash, rol, id_usuario) 
                        VALUES (@username, @hash, @rol, @id_user)`);

            await transaction.commit();
            res.status(201).send({ message: 'Usuario y credenciales creados con éxito.' });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Error en la transacción de alta: " + err.message);
    }
});

app.post('/api/registro', async (req, res) => {
    const { nombre, username, password, rol } = req.body;
    try {
        let pool = await poolPromise;
        
        const check = await pool.request()
            .input('user', sql.VarChar, username)
            .query('SELECT id_usuario FROM Credencial WHERE username = @user');
            
        if(check.recordset.length > 0) return res.status(400).send("El usuario ya existe.");

        await pool.request()
            .input('nombre', sql.VarChar, nombre)
            .input('user', sql.VarChar, username)
            .input('pass', sql.VarChar, password)
            .input('rol', sql.VarChar, rol)
            .query(`
                INSERT INTO Usuario (nombre) VALUES (@nombre);
                DECLARE @newId INT = SCOPE_IDENTITY();
                INSERT INTO Credencial (username, password_hash, rol, id_usuario) 
                VALUES (@user, @pass, @rol, @newId);
            `);
        
        res.status(201).send("Registro exitoso");
    } catch (err) {
        console.error("Error en registro:", err);
        res.status(500).send("Error crítico: " + err.message);
    }
});


// ==========================================
// ENDPOINTS DE MENSAJERÍA
// ==========================================
app.get('/api/mensajes', async (req, res) => {
    try {
        let pool = await poolPromise;
        let result = await pool.request().query(`
            SELECT id_mensaje, numero_origen, numero_destino, cuerpo, fecha_hora, costo_original, es_desviado 
            FROM Mensaje 
            ORDER BY fecha_hora DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).send("Error al consultar el tráfico de red.");
    }
});

app.post('/api/mensajes', async (req, res) => {
    const { origen, destino, cuerpo } = req.body;
    const id_mensaje = "SMS-" + crypto.randomInt(100000, 999999);
    
    try {
        let pool = await poolPromise;
        
        let checkTerminales = await pool.request()
            .input('origen', sql.VarChar, origen)
            .input('destino', sql.VarChar, destino)
            .query('SELECT numero_telefono, saldo, esta_encendido, numero_desvio FROM Terminal WHERE numero_telefono IN (@origen, @destino)');
        
        let termOrigen = checkTerminales.recordset.find(t => t.numero_telefono === origen);
        let termDestino = checkTerminales.recordset.find(t => t.numero_telefono === destino);

        if (!termOrigen || !termDestino) return res.status(404).send("Error: Origen o destino no existen en la base de datos.");
        if (!termOrigen.esta_encendido) return res.status(400).send("Error: Tu línea origen está apagada.");
        if (!termDestino.esta_encendido) return res.status(400).send("Error: La línea destino está apagada (fuera de servicio).");

        let numeroDestinoFinal = destino;
        let es_desviado = 0;
        let costo_desvio = 0;

        if (termDestino.numero_desvio) {
            numeroDestinoFinal = termDestino.numero_desvio;
            es_desviado = 1;
            costo_desvio = 0.50; 
        }

        let horaActual = new Date().getHours();
        let factor_hora = (horaActual >= 18 && horaActual <= 22) ? 1.5 : 1.0; 
        let costo_base = 1.00;
        let costo_total = (costo_base * factor_hora) + costo_desvio;

        if (termOrigen.saldo < costo_total) {
            return res.status(400).send(`Operación rechazada: Saldo insuficiente. El costo calculado de este SMS es de $${costo_total.toFixed(2)}.`);
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            
            await request
                .input('id', sql.VarChar, id_mensaje)
                .input('cuerpo', sql.VarChar, cuerpo)
                .input('costo', sql.Decimal(10,2), costo_total)
                .input('costo_d', sql.Decimal(10,2), costo_desvio)
                .input('desviado', sql.Bit, es_desviado)
                .input('factor', sql.Decimal(5,2), factor_hora)
                .input('estado', sql.VarChar, 'Entregado')
                .input('origen', sql.VarChar, origen)
                .input('destino', sql.VarChar, numeroDestinoFinal)
                .query(`INSERT INTO Mensaje (id_mensaje, cuerpo, costo_original, costo_desvio, es_desviado, factor_hora, estado_entrega, numero_origen, numero_destino) 
                        VALUES (@id, @cuerpo, @costo, @costo_d, @desviado, @factor, @estado, @origen, @destino)`);
            
            await request
                .input('costo_total', sql.Decimal(10,2), costo_total)
                .input('num_origen', sql.VarChar, origen)
                .query(`UPDATE Terminal SET saldo = saldo - @costo_total WHERE numero_telefono = @num_origen`);
            
            await transaction.commit();
            res.status(201).send({ message: 'Mensaje procesado y entregado', costo: costo_total, destinoFinal: numeroDestinoFinal });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }
    } catch (err) {
        res.status(500).send("Error crítico del servidor: " + err.message);
    }
});

app.put('/api/mensajes/:id', async (req, res) => {
    try {
        const pool = await poolPromise;

        await pool.request()
            .input('id', sql.VarChar, req.params.id)
            .input('cuerpo', sql.VarChar, req.body.cuerpo)
            .query(`
                UPDATE Mensaje
                SET cuerpo = @cuerpo
                WHERE id_mensaje = @id
            `);

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});

app.delete('/api/mensajes/:id', async (req, res) => {
    try {
        const pool = await poolPromise;

        await pool.request()
            .input('id', sql.VarChar, req.params.id)
            .query(`
                DELETE FROM Mensaje
                WHERE id_mensaje = @id
            `);

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).send(err.message);
    }
});


const PORT = 3000;

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`Base de datos conectada con éxito.`);
        console.log(`✅ Servidor de Central Móvil corriendo en http://localhost:${PORT}`);
    });
}

module.exports = app;