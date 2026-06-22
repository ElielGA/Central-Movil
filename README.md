# Central Movil - Sistema de Gestion de Telecomunicaciones

Central Movil es una plataforma web integral disenada para la administracion de servicios de red movil. Implementa una arquitectura cliente-servidor (RESTful API) que permite la gestion de lineas telefonicas, enrutamiento de desvios, recargas de saldo transaccionales y mensajeria con tarificacion dinamica.

Este proyecto fue desarrollado como demostracion de competencias en Ingenieria de Software, Arquitectura de Bases de Datos y Calidad de Codigo (ISO/IEC 25010).

## Caracteristicas Principales

* Control de Acceso Basado en Roles (RBAC): Separacion estricta de interfaces y permisos entre perfiles ADMINISTRADOR y CLIENTE.
* Aislamiento de Datos (Data Isolation): Los usuarios estandar solo tienen acceso de lectura y escritura a las terminales, mensajes y recargas que les pertenecen explicitamente.
* Transacciones ACID: Los procesos financieros (recargas y cobro de SMS) utilizan transacciones atomicas (BEGIN, COMMIT, ROLLBACK) para garantizar la integridad de los fondos en la base de datos.
* Tarificacion Dinamica: El costo de los mensajes (SMS) se calcula en tiempo real basandose en factores de horario (hora pico) y recargos por re-enrutamiento (desvios).
* Pruebas Automatizadas (QA): Integracion continua preparada con cobertura de pruebas unitarias y de integracion utilizando Jest y Supertest.

## Tecnologias Utilizadas

* Backend: Node.js, Express.js.
* Base de Datos: Microsoft SQL Server (T-SQL), modulo mssql.
* Frontend: HTML5, Vanilla JavaScript, CSS3 (Diseno responsivo sin frameworks externos).
* Testing: Jest, Supertest.

## Requisitos Previos

Para ejecutar este proyecto en un entorno local, asegurese de contar con lo siguiente:
1. Node.js (v16.x o superior).
2. Microsoft SQL Server y SQL Server Management Studio (SSMS).

## Instrucciones de Instalacion

1. Clonar o descargar el repositorio. Abra una terminal en la carpeta del proyecto.
2. Instalar dependencias de Node. Ejecute: npm install
3. Configurar la Base de Datos. Abra SSMS y conectese a su servidor local. Abra el archivo database.sql incluido en la raiz de este proyecto y ejecutelo. Esto creara la base de datos CentralMovilDB, las tablas estructuradas y los datos de prueba.
4. Configurar credenciales del Servidor. Abra el archivo server.js y verifique que las credenciales en el objeto dbConfig coincidan con su instalacion local de SQL Server.

## Ejecucion del Sistema

Para levantar el servidor web y la API REST, ejecute en su terminal:
npm start

Una vez iniciado, abra su navegador web y acceda a: http://localhost:3000

## Credenciales de Prueba Incluidas

Para evaluar los distintos roles del sistema, el script de la base de datos ya incluye los siguientes usuarios:

Perfil: Administrador
Usuario: Admin
Contrasena: 1234
Nivel de Acceso: Total (Auditoria global, creacion de usuarios).

Perfil: Cliente
Usuario: ElielGA
Contrasena: cliente1
Nivel de Acceso: Restringido (Gestion de lineas propias unicamente).

## Pruebas y Control de Calidad (SQC)

El sistema incluye una suite de pruebas para los endpoints principales. Para ejecutar las pruebas y generar el reporte de cobertura (Coverage), utilice:
npm test
