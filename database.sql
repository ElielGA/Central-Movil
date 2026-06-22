-- =============================================================================
-- SCRIPT DE CONFIGURACIÓN DE BASE DE DATOS - CENTRAL MÓVIL
-- ESTÁNDAR: SQL SERVER (T-SQL)
-- =============================================================================

-- 1. CREACIÓN DE LA BASE DE DATOS
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'CentralMovilDB')
BEGIN
    CREATE DATABASE CentralMovilDB;
END
GO

USE CentralMovilDB;
GO

-- 2. ELIMINACIÓN DE TABLAS PREVIAS (Garantiza idempotencia en la instalación)
IF OBJECT_ID('dbo.Mensaje', 'U')    IS NOT NULL DROP TABLE dbo.Mensaje;
IF OBJECT_ID('dbo.Recarga', 'U')    IS NOT NULL DROP TABLE dbo.Recarga;
IF OBJECT_ID('dbo.Terminal', 'U')   IS NOT NULL DROP TABLE dbo.Terminal;
IF OBJECT_ID('dbo.Credencial', 'U') IS NOT NULL DROP TABLE dbo.Credencial;
IF OBJECT_ID('dbo.Usuario', 'U')    IS NOT NULL DROP TABLE dbo.Usuario;
GO

-- 3. CREACIÓN DE LA ARQUITECTURA DE TABLAS

-- Capa Maestra: Entidades del Sistema
CREATE TABLE Usuario (
    id_usuario INT IDENTITY(1,1) PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    fecha_registro DATETIME DEFAULT GETDATE()
);

-- Capa de Control de Acceso: Seguridad por Roles (RBAC)
CREATE TABLE Credencial (
    username VARCHAR(50) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(20) NOT NULL DEFAULT 'CLIENTE',
    id_usuario INT NOT NULL,
    CONSTRAINT FK_Credencial_Usuario FOREIGN KEY (id_usuario) 
        REFERENCES Usuario(id_usuario) ON DELETE CASCADE,
    CONSTRAINT CHK_Rol CHECK (rol IN ('ADMINISTRADOR', 'CLIENTE'))
);

-- Capa de Infraestructura: Terminales y Enrutamiento
CREATE TABLE Terminal (
    numero_telefono VARCHAR(15) PRIMARY KEY,
    saldo DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    esta_encendido BIT NOT NULL DEFAULT 1,
    numero_desvio VARCHAR(15) NULL,
    id_usuario INT NOT NULL,
    CONSTRAINT FK_Terminal_Usuario FOREIGN KEY (id_usuario) 
        REFERENCES Usuario(id_usuario),
    CONSTRAINT FK_Terminal_Desvio FOREIGN KEY (numero_desvio) 
        REFERENCES Terminal(numero_telefono),
    CONSTRAINT CHK_Saldo_Minimo CHECK (saldo >= 0.00)
);

-- Capa Transaccional: Bitácora Financiera
CREATE TABLE Recarga (
    id_recarga VARCHAR(20) PRIMARY KEY,
    monto DECIMAL(10,2) NOT NULL,
    fecha_hora DATETIME NOT NULL DEFAULT GETDATE(),
    tipo_pago VARCHAR(50) NOT NULL,
    total_neto DECIMAL(10,2) NOT NULL,
    numero_telefono VARCHAR(15) NOT NULL,
    CONSTRAINT FK_Recarga_Terminal FOREIGN KEY (numero_telefono) 
        REFERENCES Terminal(numero_telefono) ON DELETE CASCADE
);

-- Capa Transaccional: Bitácora de Tráfico de Red (Mensajería)
CREATE TABLE Mensaje (
    id_mensaje VARCHAR(20) PRIMARY KEY,
    cuerpo VARCHAR(500) NOT NULL,
    costo_original DECIMAL(10,2) NOT NULL,
    costo_desvio DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    es_desviado BIT NOT NULL DEFAULT 0,
    factor_hora DECIMAL(5,2) NOT NULL DEFAULT 1.0,
    estado_entrega VARCHAR(30) NOT NULL DEFAULT 'Entregado',
    numero_origen VARCHAR(15) NOT NULL,
    numero_destino VARCHAR(15) NOT NULL,
    fecha_hora DATETIME NOT NULL DEFAULT GETDATE(),
    CONSTRAINT FK_Mensaje_Origen FOREIGN KEY (numero_origen) 
        REFERENCES Terminal(numero_telefono),
    CONSTRAINT FK_Mensaje_Destino FOREIGN KEY (numero_destino) 
        REFERENCES Terminal(numero_telefono)
);
GO

-- 4. INSERCIÓN DE DATOS SEMILLA (Entorno inicial de ejecución)

-- Registro de usuarios de prueba
INSERT INTO Usuario (nombre) VALUES ('Administrador General');
DECLARE @idAdmin INT = SCOPE_IDENTITY();

INSERT INTO Usuario (nombre) VALUES ('Francisco Eliel Guerrero Aguilar');
DECLARE @idUser INT = SCOPE_IDENTITY();

-- Registro de credenciales seguras vinculadas
INSERT INTO Credencial (username, password_hash, rol, id_usuario) 
VALUES ('Admin', '1234', 'ADMINISTRADOR', @idAdmin);

INSERT INTO Credencial (username, password_hash, rol, id_usuario) 
VALUES ('ElielGA', 'cliente1', 'CLIENTE', @idUser);

-- Asignación inicial de infraestructura telefónica
INSERT INTO Terminal (numero_telefono, saldo, esta_encendido, id_usuario)
VALUES ('5512345678', 500.00, 1, @idUser);

INSERT INTO Terminal (numero_telefono, saldo, esta_encendido, id_usuario)
VALUES ('5587654321', 100.00, 1, @idAdmin);
GO

PRINT '==================================================';
PRINT ' Base de datos CentralMovilDB configurada con éxito.';
PRINT '==================================================';
GO