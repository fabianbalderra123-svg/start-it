'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { pool, withTx } = require('./db');
const { progressOf, statusOf, trafficOf } = require('./progress');
const { addHistory, formatDate } = require('./history');
const { HttpError, sendError, pgToHttp } = require('./errors');

const app = express();
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const COOKIE = 'token';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 8 * 60 * 60 * 1000,
  path: '/',
};

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, code: user.code },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues[0]?.message || 'Datos inválidos.';
    throw new HttpError(400, 'VALIDATION', msg);
  }
  return result.data;
}

function requireAuth(req, _res, next) {
  const token = req.cookies[COOKIE];
  if (!token) return next(new HttpError(401, 'UNAUTHORIZED', 'No autorizado.'));
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new HttpError(401, 'UNAUTHORIZED', 'No autorizado.'));
  }
}

function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') {
    return next(new HttpError(403, 'FORBIDDEN', 'No autorizado.'));
  }
  next();
}

const httpsUrl = z.string().refine((v) => !v || /^https:\/\//i.test(v), {
  message: 'Utiliza una URL HTTPS válida o deja el campo vacío.',
});
const uuid = z.string().uuid({ message: 'Identificador inválido.' });
const statusEnum = z.enum(['Pendiente', 'En proceso', 'Completado']);
const areaBody = z.object({ name: z.string().trim().min(1, 'Nombre requerido.') });
const profileBody = z.object({
  name: z.string().trim().min(1, 'Nombre requerido.'),
  areaId: uuid,
  description: z.string().optional().default(''),
  requirementIds: z.array(uuid).optional().default([]),
});
const requirementBody = z.object({
  name: z.string().trim().min(1, 'Nombre requerido.'),
  description: z.string().optional().default(''),
  responsible: z.string().optional().default(''),
  url: httpsUrl.optional().default(''),
  documents: z.string().optional().default(''),
  template: z.string().optional().default(''),
  time: z.string().optional().default(''),
  priority: z.enum(['Alta', 'Media', 'Baja']),
  active: z.boolean(),
  notes: z.string().optional().default(''),
});
const userBody = z.object({
  code: z.string().trim().min(1, 'ID requerido.').transform((s) => s.toUpperCase()),
  name: z.string().trim().min(1, 'Nombre requerido.'),
  email: z.string().trim().email('Correo inválido.').transform((s) => s.toLowerCase()),
  profileId: uuid,
  states: z.record(statusEnum).optional().default({}),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Demasiados intentos. Espera unos minutos.' } },
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/login', process.env.NODE_ENV === 'test' ? (_req, _res, next) => next() : loginLimiter, wrap(async (req, res) => {
  const code = String(req.body?.code || req.body?.id || '').trim().toUpperCase();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const { rows } = await pool.query(
    'SELECT id, code, name, email, role, profile_id AS "profileId" FROM users WHERE code = $1 AND email = $2',
    [code, email]
  );
  const user = rows[0];
  if (!user) {
    throw new HttpError(401, 'LOGIN_FAILED', 'No encontramos esa combinación de ID y correo. Verifica tus datos o contacta al administrador.');
  }
  res.cookie(COOKIE, signToken(user), COOKIE_OPTS);
  res.json({ user });
}));

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie(COOKIE, { ...COOKIE_OPTS, maxAge: undefined });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, code, name, email, role, profile_id AS "profileId" FROM users WHERE id = $1',
    [req.user.sub]
  );
  if (!rows[0]) throw new HttpError(401, 'UNAUTHORIZED', 'No autorizado.');
  res.json({ user: rows[0] });
}));

app.get('/api/me/requirements', requireAuth, wrap(async (req, res) => {
  if (req.user.role !== 'employee') throw new HttpError(403, 'FORBIDDEN', 'No autorizado.');
  const { rows: users } = await pool.query(
    `SELECT u.id, u.name, p.name AS profile, a.name AS area, p.id AS profile_id
     FROM users u
     LEFT JOIN profiles p ON p.id = u.profile_id
     LEFT JOIN areas a ON a.id = p.area_id
     WHERE u.id = $1`,
    [req.user.sub]
  );
  const u = users[0];
  if (!u) throw new HttpError(404, 'NOT_FOUND', 'No encontrado.');
  const { rows: reqs } = u.profile_id
    ? await pool.query(
      `SELECT r.id, r.name, r.description, r.responsible, r.time, r.priority, r.documents,
              r.template, r.notes, r.url, COALESCE(s.status, 'Pendiente') AS status
       FROM profile_requirements pr
       JOIN requirements r ON r.id = pr.requirement_id AND r.active = TRUE
       LEFT JOIN user_requirement_states s ON s.requirement_id = r.id AND s.user_id = $1
       WHERE pr.profile_id = $2
       ORDER BY r.id`,
      [u.id, u.profile_id]
    )
    : { rows: [] };
  const states = Object.fromEntries(reqs.map((r) => [r.id, r.status]));
  const percent = progressOf(reqs, states);
  res.json({
    name: u.name,
    profile: u.profile || 'Sin perfil',
    area: u.area || 'Sin área',
    progress: percent,
    status: statusOf(percent),
    requirements: reqs,
  });
}));

async function listAreas() {
  const { rows } = await pool.query('SELECT id, name FROM areas ORDER BY id');
  return rows;
}

async function listRequirements() {
  const { rows } = await pool.query(
    `SELECT id, name, description, responsible, url, documents, template, time, priority, active, notes
     FROM requirements ORDER BY id`
  );
  return rows;
}

async function listProfiles() {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.area_id AS "areaId", p.description,
            COALESCE((
              SELECT json_agg(pr.requirement_id ORDER BY pr.requirement_id)
              FROM profile_requirements pr WHERE pr.profile_id = p.id
            ), '[]'::json) AS "requirementIds"
     FROM profiles p ORDER BY p.id`
  );
  return rows.map((p) => ({
    ...p,
    requirementIds: (p.requirementIds || []).map(String),
  }));
}

async function listUsers() {
  const { rows } = await pool.query(
    `SELECT u.id, u.code, u.name, u.email, u.role, u.profile_id AS "profileId",
            COALESCE((
              SELECT json_object_agg(s.requirement_id::text, s.status)
              FROM user_requirement_states s WHERE s.user_id = u.id
            ), '{}'::json) AS states
     FROM users u WHERE u.role = 'employee' ORDER BY u.code`
  );
  return rows;
}

async function setProfileReqs(client, profileId, requirementIds) {
  await client.query('DELETE FROM profile_requirements WHERE profile_id = $1', [profileId]);
  for (const rid of requirementIds) {
    await client.query(
      'INSERT INTO profile_requirements (profile_id, requirement_id) VALUES ($1,$2)',
      [profileId, rid]
    );
  }
}

async function setUserStates(client, userId, profileId, states) {
  const { rows } = await client.query(
    'SELECT requirement_id FROM profile_requirements WHERE profile_id = $1',
    [profileId]
  );
  const allowed = new Set(rows.map((r) => String(r.requirement_id)));
  await client.query('DELETE FROM user_requirement_states WHERE user_id = $1', [userId]);
  for (const [rid, status] of Object.entries(states || {})) {
    if (!allowed.has(String(rid))) continue;
    await client.query(
      `INSERT INTO user_requirement_states (user_id, requirement_id, status) VALUES ($1,$2,$3)`,
      [userId, rid, status]
    );
  }
}

app.get('/api/areas', requireAuth, requireAdmin, wrap(async (_req, res) => {
  res.json(await listAreas());
}));
app.post('/api/areas', requireAuth, requireAdmin, wrap(async (req, res) => {
  const body = parse(areaBody, req.body);
  const row = await withTx(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO areas (name) VALUES ($1) RETURNING id, name',
      [body.name]
    );
    await addHistory(client, `Registro agregado: ${body.name}`);
    return rows[0];
  });
  res.status(201).json(row);
}));
app.put('/api/areas/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(areaBody, req.body);
  const row = await withTx(async (client) => {
    const { rows } = await client.query(
      'UPDATE areas SET name = $1 WHERE id = $2 RETURNING id, name',
      [body.name, id]
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'No encontrado.');
    await addHistory(client, `Información modificada: ${body.name}`);
    return rows[0];
  });
  res.json(row);
}));
app.delete('/api/areas/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await withTx(async (client) => {
    const { rows } = await client.query('SELECT id, name FROM areas WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'No encontrado.');
    const used = await client.query('SELECT 1 FROM profiles WHERE area_id = $1 LIMIT 1', [id]);
    if (used.rowCount) {
      throw new HttpError(409, 'CONFLICT', 'No se puede eliminar un área con perfiles asociados.');
    }
    await client.query('DELETE FROM areas WHERE id = $1', [id]);
    await addHistory(client, `Registro eliminado: ${rows[0].name}`);
  });
  res.status(204).end();
}));

app.get('/api/profiles', requireAuth, requireAdmin, wrap(async (_req, res) => {
  res.json(await listProfiles());
}));
app.post('/api/profiles', requireAuth, requireAdmin, wrap(async (req, res) => {
  const body = parse(profileBody, req.body);
  const created = await withTx(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO profiles (name, area_id, description) VALUES ($1,$2,$3) RETURNING id',
      [body.name, body.areaId, body.description]
    );
    await setProfileReqs(client, rows[0].id, body.requirementIds);
    await addHistory(client, `Registro agregado: ${body.name}`);
    return rows[0].id;
  });
  const all = await listProfiles();
  res.status(201).json(all.find((p) => p.id === created));
}));
app.put('/api/profiles/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(profileBody, req.body);
  await withTx(async (client) => {
    const { rows } = await client.query(
      'UPDATE profiles SET name = $1, area_id = $2, description = $3 WHERE id = $4 RETURNING id',
      [body.name, body.areaId, body.description, id]
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'No encontrado.');
    await setProfileReqs(client, id, body.requirementIds);
    await addHistory(client, `Información modificada: ${body.name}`);
  });
  const all = await listProfiles();
  res.json(all.find((p) => p.id === id));
}));
app.delete('/api/profiles/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await withTx(async (client) => {
    const { rows } = await client.query('SELECT id, name FROM profiles WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'No encontrado.');
    const used = await client.query('SELECT 1 FROM users WHERE profile_id = $1 LIMIT 1', [id]);
    if (used.rowCount) {
      throw new HttpError(409, 'CONFLICT', 'No se puede eliminar un perfil asignado a colaboradores.');
    }
    await client.query('DELETE FROM profiles WHERE id = $1', [id]);
    await addHistory(client, `Registro eliminado: ${rows[0].name}`);
  });
  res.status(204).end();
}));

app.get('/api/requirements', requireAuth, requireAdmin, wrap(async (_req, res) => {
  res.json(await listRequirements());
}));
app.post('/api/requirements', requireAuth, requireAdmin, wrap(async (req, res) => {
  const body = parse(requirementBody, req.body);
  const row = await withTx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO requirements (name, description, responsible, url, documents, template, time, priority, active, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, name, description, responsible, url, documents, template, time, priority, active, notes`,
      [body.name, body.description, body.responsible, body.url, body.documents, body.template, body.time, body.priority, body.active, body.notes]
    );
    await addHistory(client, `Registro agregado: ${body.name}`);
    return rows[0];
  });
  res.status(201).json(row);
}));
app.put('/api/requirements/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(requirementBody, req.body);
  const row = await withTx(async (client) => {
    const { rows } = await client.query(
      `UPDATE requirements SET name=$1, description=$2, responsible=$3, url=$4, documents=$5, template=$6,
        time=$7, priority=$8, active=$9, notes=$10
       WHERE id=$11
       RETURNING id, name, description, responsible, url, documents, template, time, priority, active, notes`,
      [body.name, body.description, body.responsible, body.url, body.documents, body.template, body.time, body.priority, body.active, body.notes, id]
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'No encontrado.');
    await addHistory(client, `Información modificada: ${body.name}`);
    return rows[0];
  });
  res.json(row);
}));
app.delete('/api/requirements/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await withTx(async (client) => {
    const { rows } = await client.query('SELECT id, name FROM requirements WHERE id = $1', [id]);
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'No encontrado.');
    await client.query('DELETE FROM requirements WHERE id = $1', [id]);
    await addHistory(client, `Registro eliminado: ${rows[0].name}`);
  });
  res.status(204).end();
}));

app.get('/api/users', requireAuth, requireAdmin, wrap(async (_req, res) => {
  res.json(await listUsers());
}));
app.post('/api/users', requireAuth, requireAdmin, wrap(async (req, res) => {
  const body = parse(userBody, req.body);
  const created = await withTx(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (code, name, email, role, profile_id)
       VALUES ($1,$2,$3,'employee',$4) RETURNING id`,
      [body.code, body.name, body.email, body.profileId]
    );
    await setUserStates(client, rows[0].id, body.profileId, body.states);
    await addHistory(client, `Registro agregado: ${body.name}`);
    return rows[0].id;
  });
  const all = await listUsers();
  res.status(201).json(all.find((u) => u.id === created));
}));
app.put('/api/users/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  const body = parse(userBody, req.body);
  await withTx(async (client) => {
    const { rows } = await client.query(
      `UPDATE users SET code=$1, name=$2, email=$3, profile_id=$4
       WHERE id=$5 AND role='employee' RETURNING id`,
      [body.code, body.name, body.email, body.profileId, id]
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'No encontrado.');
    await setUserStates(client, id, body.profileId, body.states);
    await addHistory(client, `Información modificada: ${body.name}`);
  });
  const all = await listUsers();
  res.json(all.find((u) => u.id === id));
}));
app.delete('/api/users/:id', requireAuth, requireAdmin, wrap(async (req, res) => {
  const id = parse(uuid, req.params.id);
  await withTx(async (client) => {
    const { rows } = await client.query(
      `SELECT id, name FROM users WHERE id = $1 AND role = 'employee'`,
      [id]
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'No encontrado.');
    await client.query('DELETE FROM users WHERE id = $1', [id]);
    await addHistory(client, `Registro eliminado: ${rows[0].name}`);
  });
  res.status(204).end();
}));

app.get('/api/admin/metrics', requireAuth, requireAdmin, wrap(async (_req, res) => {
  const { rows: users } = await pool.query(
    `SELECT u.id, u.name, p.id AS profile_id, COALESCE(p.name, 'Sin perfil') AS profile
     FROM users u LEFT JOIN profiles p ON p.id = u.profile_id
     WHERE u.role = 'employee' ORDER BY u.name`
  );
  const { rows: reqs } = await pool.query(
    `SELECT pr.profile_id, r.id
     FROM profile_requirements pr
     JOIN requirements r ON r.id = pr.requirement_id AND r.active = TRUE`
  );
  const { rows: statesRows } = await pool.query(
    'SELECT user_id, requirement_id, status FROM user_requirement_states'
  );
  const reqsByProfile = {};
  for (const r of reqs) {
    (reqsByProfile[r.profile_id] ||= []).push({ id: r.id });
  }
  const statesByUser = {};
  for (const s of statesRows) {
    (statesByUser[s.user_id] ||= {})[s.requirement_id] = s.status;
  }
  const byCollaborator = users.map((u) => {
    const percent = progressOf(reqsByProfile[u.profile_id] || [], statesByUser[u.id] || {});
    return {
      name: u.name,
      profile: u.profile,
      percent,
      status: statusOf(percent),
      traffic: trafficOf(percent),
    };
  });
  res.json({
    totals: {
      collaborators: byCollaborator.length,
      completed: byCollaborator.filter((x) => x.status === 'Completado').length,
      inProgress: byCollaborator.filter((x) => x.status === 'En proceso').length,
      pending: byCollaborator.filter((x) => x.status === 'Pendiente').length,
    },
    byCollaborator,
  });
}));

app.get('/api/history', requireAuth, requireAdmin, wrap(async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, created_at, detail FROM history ORDER BY created_at DESC LIMIT 100'
  );
  res.json(rows.map((h) => ({ id: h.id, detail: h.detail, date: formatDate(h.created_at) })));
}));

app.use('/api', (_req, res) => sendError(res, 404, 'NOT_FOUND', 'No encontrado.'));
app.use(express.static(path.join(__dirname, '../public')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use((err, _req, res, _next) => {
  const mapped = pgToHttp(err);
  if (mapped instanceof HttpError) {
    return sendError(res, mapped.status, mapped.code, mapped.message);
  }
  console.error(mapped);
  return sendError(res, 500, 'INTERNAL', 'Error interno.');
});

module.exports = { app };
