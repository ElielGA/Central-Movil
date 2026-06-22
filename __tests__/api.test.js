const request = require('supertest');
const app = require('../server'); // Sube un nivel para encontrar el servidor

describe('🧪 Pruebas Automatizadas (SQC) - Central Móvil', () => {

    test('La API de terminales debe responder correctamente (Integración)', async () => {
        const respuesta = await request(app).get('/api/terminales');
        expect(respuesta.statusCode).toBe(200);
    });

    test('El Login debe rechazar credenciales inexistentes (Seguridad)', async () => {
        const respuesta = await request(app)
            .post('/api/login')
            .send({ username: "no_existo", password: "123" });
        expect(respuesta.statusCode).toBe(401);
    });
});