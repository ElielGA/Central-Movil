const express = require('express');
const sql = require('mssql');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Sirve los archivos estáticos de la carpeta "public"
app.use(express.static(path.join(__dirname, 'public'))); 

// Configuración de conexión a SQL Server
const dbConfig = {
    user: 'sa', // Cambia por tu usuario de SQL Server (suele ser 'sa')
    password: '1234', // Cambia por tu contraseña real
    server: 'localhost', // O 'localhost\\SQLEXPRESS' dependiendo de tu instalación
    database: 'CentralMovilDB',
    options: {
        encrypt: false, 
        trustServerCertificate: true
    }
};

// ==========================================
// ENDPOINT DE INICIO DE SESIÓN (LOGIN)
// ==========================================
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request()
            .input('username', sql.VarChar, username)
            .query(`
                SELECT c.username, c.password_hash, c.rol, u.nombre, u.id_usuario 
                FROM Credencial c
                JOIN Usuario u ON c.id_usuario = u.id_usuario
                WHERE c.username = @username
            `);

        if (result.recordset.length === 0) {
            return res.status(401).send("Usuario no encontrado.");
        }

        const usuario = result.recordset[0];

        // Validación de credenciales contra la base de datos
        if (password === usuario.password_hash) {
            res.status(200).json({
                id_usuario: usuario.id_usuario,
                nombre: usuario.nombre,
                rol: usuario.rol
            });
        } else {
            res.status(401).send("Contraseña incorrecta.");
        }

    } catch (err) {
        console.error(err);
        res.status(500).send("Error en el servidor de autenticación.");
    }
});

// ==========================================
// ENDPOINTS DE LA API REST (CRUD TERMINALES)
// ==========================================

// GET: Leer todas las terminales
app.get('/api/terminales', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
        let result = await pool.request().query(`
            SELECT t.numero_telefono, t.saldo, t.esta_encendido, u.nombre 
            FROM Terminal t JOIN Usuario u ON t.id_usuario = u.id_usuario
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error en la base de datos: " + err.message);
    }
});

// POST: Registrar nueva terminal
app.post('/api/terminales', async (req, res) => {
    const { numero_telefono, id_usuario } = req.body;
    try {
        let pool = await sql.connect(dbConfig);
        await pool.request()
            .input('numero', sql.VarChar, numero_telefono)
            .input('id_usuario', sql.Int, id_usuario)
            .query('INSERT INTO Terminal (numero_telefono, id_usuario) VALUES (@numero, @id_usuario)');
        
        res.status(201).send({ message: 'Línea registrada exitosamente' });
    } catch (err) {
        console.error("Error al registrar terminal:", err);
        res.status(500).send("Error al registrar: " + err.message);
    }
});

// PUT: Actualizar estado de la terminal (Encender/Apagar)
app.put('/api/terminales/:numero', async (req, res) => {
    const numero = req.params.numero;
    const { estado } = req.body; 
    
    try {
        let pool = await sql.connect(dbConfig);
        await pool.request()
            .input('estado', sql.Bit, estado)
            .input('numero', sql.VarChar, numero)
            .query('UPDATE Terminal SET esta_encendido = @estado WHERE numero_telefono = @numero');
        
        res.status(200).send({ message: 'Estado físico actualizado correctamente' });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error al actualizar estado: " + err.message);
    }
});

// ==========================================
// ENDPOINTS DE LA API REST (CRUD RECARGAS)
// ==========================================

// GET: Leer el historial de recargas
app.get('/api/recargas', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
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
// POST: Procesar una nueva recarga (Transacción Atómica)
app.post('/api/recargas', async (req, res) => {
    const { numero_telefono, monto, tipo_pago } = req.body;
    const id_recarga = "REC-" + Math.floor(Math.random() * 1000000); 

    try {
        let pool = await sql.connect(dbConfig);
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            const request = new sql.Request(transaction);
            
            await request
                .input('id', sql.VarChar, id_recarga)
                .input('monto', sql.Decimal(10,2), monto)
                .input('tipo', sql.VarChar, tipo_pago)
                .input('num', sql.VarChar, numero_telefono)
                .query(`INSERT INTO Recarga (id_recarga, monto, tipo_pago, total_neto, numero_telefono) 
                        VALUES (@id, @monto, @tipo, @monto, @num)`);
            
            await request
                .query(`UPDATE Terminal SET saldo = saldo + @monto WHERE numero_telefono = @num`);
            
            await transaction.commit(); 
            res.status(201).send({ message: 'Recarga exitosa' });

        } catch (err) {
            await transaction.rollback(); 
            throw err;
        }

    } catch (err) {
        console.error(err);
        res.status(500).send("Error al procesar recarga: " + err.message);
    }
});

// ==========================================
// ENDPOINTS DE LA API REST (CRUD DESVÍOS)
// ==========================================

// GET: Leer todos los desvíos activos
app.get('/api/desvios', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
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

// POST: Configurar un nuevo desvío
app.post('/api/desvios', async (req, res) => {
    const { origen, destino } = req.body;
    
    if (origen === destino) {
        return res.status(400).send("Error: Bucle detectado. No puedes desviar una línea hacia sí misma.");
    }

    try {
        let pool = await sql.connect(dbConfig);
        
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

// DELETE: Desactivar un desvío
app.delete('/api/desvios/:origen', async (req, res) => {
    const origen = req.params.origen;
    try {
        let pool = await sql.connect(dbConfig);
        await pool.request()
            .input('origen', sql.VarChar, origen)
            .query('UPDATE Terminal SET numero_desvio = NULL WHERE numero_telefono = @origen');
        res.status(200).send({ message: 'Desvío desactivado' });
    } catch (err) {
        res.status(500).send("Error al desactivar: " + err.message);
    }
});

// ==========================================
// ENDPOINTS DE LA API REST (CRUD USUARIOS / REGISTRO)
// ==========================================

// GET: Leer todos los usuarios
app.get('/api/usuarios', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
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

// POST: Registrar un usuario desde el panel de administración
app.post('/api/usuarios', async (req, res) => {
    const { nombre, username, rol } = req.body;
    const defaultHash = "1234"; 

    try {
        let pool = await sql.connect(dbConfig);
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

// POST: Registro público desvinculado (Evita Deadlocks)
app.post('/api/registro', async (req, res) => {
    const { nombre, username, password, rol } = req.body;
    try {
        let pool = await sql.connect(dbConfig);
        
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
// ENDPOINTS DE LA API REST (CRUD MENSAJERÍA)
// ==========================================

// GET: Ver el tráfico global de mensajes
app.get('/api/mensajes', async (req, res) => {
    try {
        let pool = await sql.connect(dbConfig);
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

// POST: Enviar un nuevo mensaje (Con Lógica de Enrutamiento y Tarificación)
app.post('/api/mensajes', async (req, res) => {
    const { origen, destino, cuerpo } = req.body;
    const id_mensaje = "SMS-" + Math.floor(Math.random() * 1000000);
    
    try {
        let pool = await sql.connect(dbConfig);
        
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

// ==========================================
// LEVANTAR EL SERVIDOR (CONFIGURACIÓN PARA TEST)
// ==========================================
const PORT = 3000;

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`Base de datos conectada con éxito.`);
        console.log(`✅ Servidor de Central Móvil corriendo en http://localhost:${PORT}`);
    });
}

module.exports = app;