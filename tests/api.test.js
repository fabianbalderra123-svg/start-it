'use strict';

require('dotenv').config();
process.env.NODE_ENV = 'test';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../src/app');
const { pool } = require('../src/db');

function agent() {
  return request.agent(app);
}

test('GET /api/health', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('login correcto e incorrecto', async () => {
  const ok = await request(app)
    .post('/api/auth/login')
    .send({ code: 'COL-001', email: 'ana@empresa.com' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.code, 'COL-001');

  const bad = await request(app)
    .post('/api/auth/login')
    .send({ code: 'COL-001', email: 'no@empresa.com' });
  assert.equal(bad.status, 401);
  assert.equal(
    bad.body.error.message,
    'No encontramos esa combinación de ID y correo. Verifica tus datos o contacta al administrador.'
  );
});

test('employee recibe 403 en rutas admin y solo ve lo suyo', async () => {
  const a = agent();
  await a.post('/api/auth/login').send({ code: 'COL-001', email: 'ana@empresa.com' });
  const forbidden = await a.get('/api/admin/metrics');
  assert.equal(forbidden.status, 403);

  const mine = await a.get('/api/me/requirements');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.name, 'Ana García');
  assert.equal(mine.body.progress, 25);
  assert.equal(mine.body.status, 'En proceso');
  assert.ok(mine.body.requirements.every((r) => r.name));
  assert.equal(JSON.stringify(mine.body).includes('Luis Pérez'), false);
});

test('cálculo de progreso y estado', async () => {
  const a = agent();
  await a.post('/api/auth/login').send({ code: 'COL-002', email: 'luis@empresa.com' });
  const mine = await a.get('/api/me/requirements');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.progress, 100);
  assert.equal(mine.body.status, 'Completado');

  const admin = agent();
  await admin.post('/api/auth/login').send({ code: 'ADM-001', email: 'admin@empresa.com' });
  const metrics = await admin.get('/api/admin/metrics');
  assert.equal(metrics.status, 200);
  const luis = metrics.body.byCollaborator.find((x) => x.name === 'Luis Pérez');
  const ana = metrics.body.byCollaborator.find((x) => x.name === 'Ana García');
  assert.equal(luis.percent, 100);
  assert.equal(luis.status, 'Completado');
  assert.equal(luis.traffic, 'green');
  assert.equal(ana.percent, 25);
  assert.equal(ana.status, 'En proceso');
  assert.equal(ana.traffic, 'red');
  assert.equal(metrics.body.byCollaborator.some((x) => x.name === 'Administrador'), false);
});

test('409 al eliminar área con perfiles y perfil con colaboradores', async () => {
  const admin = agent();
  await admin.post('/api/auth/login').send({ code: 'ADM-001', email: 'admin@empresa.com' });
  const areas = await admin.get('/api/areas');
  const areaId = areas.body[0].id;
  const delArea = await admin.delete(`/api/areas/${areaId}`);
  assert.equal(delArea.status, 409);
  assert.equal(delArea.body.error.message, 'No se puede eliminar un área con perfiles asociados.');

  const profiles = await admin.get('/api/profiles');
  const profileId = profiles.body[0].id;
  const delProfile = await admin.delete(`/api/profiles/${profileId}`);
  assert.equal(delProfile.status, 409);
  assert.equal(delProfile.body.error.message, 'No se puede eliminar un perfil asignado a colaboradores.');
});

test('ID y correo duplicados', async () => {
  const admin = agent();
  await admin.post('/api/auth/login').send({ code: 'ADM-001', email: 'admin@empresa.com' });
  const profiles = await admin.get('/api/profiles');
  const profileId = profiles.body[0].id;

  const dupId = await admin.post('/api/users').send({
    code: 'COL-001',
    name: 'Otra',
    email: 'otra@empresa.com',
    profileId,
  });
  assert.equal(dupId.status, 409);
  assert.equal(dupId.body.error.message, 'Ese ID ya existe.');

  const dupEmail = await admin.post('/api/users').send({
    code: 'COL-999',
    name: 'Otra',
    email: 'ana@empresa.com',
    profileId,
  });
  assert.equal(dupEmail.status, 409);
  assert.equal(dupEmail.body.error.message, 'Ese correo ya está registrado.');
});

after(async () => {
  await pool.end();
});
