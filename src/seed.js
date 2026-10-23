'use strict';

const { pool, withTx } = require('./db');
const { addHistory } = require('./history');

const A = {
  a1: '00000000-0000-4000-8000-0000000000a1',
  a2: '00000000-0000-4000-8000-0000000000a2',
  a3: '00000000-0000-4000-8000-0000000000a3',
  a4: '00000000-0000-4000-8000-0000000000a4',
  a5: '00000000-0000-4000-8000-0000000000a5',
  a6: '00000000-0000-4000-8000-0000000000a6',
  a7: '00000000-0000-4000-8000-0000000000a7',
  a8: '00000000-0000-4000-8000-0000000000a8',
};
const R = {
  r1: '00000000-0000-4000-8000-0000000000b1',
  r2: '00000000-0000-4000-8000-0000000000b2',
  r3: '00000000-0000-4000-8000-0000000000b3',
  r4: '00000000-0000-4000-8000-0000000000b4',
};
const P = {
  p1: '00000000-0000-4000-8000-0000000000c1',
  p2: '00000000-0000-4000-8000-0000000000c2',
  p3: '00000000-0000-4000-8000-0000000000c3',
  p4: '00000000-0000-4000-8000-0000000000c4',
};
const U = {
  col1: '00000000-0000-4000-8000-0000000000d1',
  col2: '00000000-0000-4000-8000-0000000000d2',
  col3: '00000000-0000-4000-8000-0000000000d3',
  adm: '00000000-0000-4000-8000-0000000000d4',
};

async function seed() {
  await withTx(async (client) => {
    const existing = await client.query(
      `SELECT 1 FROM users WHERE code IN ('COL-001', 'ADM-001') LIMIT 1`
    );
    if (existing.rowCount) return;

    const areas = [
      [A.a1, 'Calidad'], [A.a2, 'Ingeniería'], [A.a3, 'Producción'],
      [A.a4, 'Recursos Humanos'], [A.a5, 'Finanzas'], [A.a6, 'IT'],
      [A.a7, 'Compras'], [A.a8, 'Logística'],
    ];
    for (const [id, name] of areas) {
      await client.query('INSERT INTO areas (id, name) VALUES ($1, $2)', [id, name]);
    }

    const reqs = [
      [R.r1, 'Correo corporativo', 'Cuenta institucional para comunicación y herramientas de trabajo.', 'Service Desk', '', 'Identificación oficial', 'Formato_Correo.pdf', '24 horas', 'Alta', true, 'Solicitar mediante el portal corporativo autorizado.'],
      [R.r2, 'VPN', 'Acceso remoto seguro a los recursos autorizados.', 'Seguridad de TI', '', 'Autorización del responsable de área', 'Formato_VPN.pdf', '48 horas', 'Media', true, 'Solo cuando el puesto requiera acceso remoto.'],
      [R.r3, 'SAP QM', 'Acceso al módulo de gestión de calidad.', 'Aplicaciones empresariales', '', 'Visto bueno del jefe inmediato', 'Solicitud_SAP.pdf', '3 días hábiles', 'Alta', true, 'El acceso depende de la función del puesto.'],
      [R.r4, 'Power BI', 'Acceso a tableros e informes autorizados.', 'Inteligencia de Negocios', '', 'Autorización del responsable', '', '2 días hábiles', 'Baja', true, 'La licencia está sujeta a disponibilidad.'],
    ];
    for (const row of reqs) {
      await client.query(
        `INSERT INTO requirements (id, name, description, responsible, url, documents, template, time, priority, active, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        row
      );
    }

    const profiles = [
      [P.p1, 'Ingeniero de Calidad', A.a1, 'Personal del área de calidad.'],
      [P.p2, 'Practicante de Calidad', A.a1, 'Prácticas profesionales.'],
      [P.p3, 'Ingeniero de Procesos', A.a2, 'Ingeniería de procesos.'],
      [P.p4, 'Analista Financiero', A.a5, 'Análisis y reportes financieros.'],
    ];
    for (const row of profiles) {
      await client.query(
        'INSERT INTO profiles (id, name, area_id, description) VALUES ($1,$2,$3,$4)',
        row
      );
    }

    const pr = [
      [P.p1, R.r1], [P.p1, R.r2], [P.p1, R.r3], [P.p1, R.r4],
      [P.p2, R.r1], [P.p2, R.r4],
      [P.p3, R.r1], [P.p3, R.r2],
      [P.p4, R.r1], [P.p4, R.r4],
    ];
    for (const row of pr) {
      await client.query(
        'INSERT INTO profile_requirements (profile_id, requirement_id) VALUES ($1,$2)',
        row
      );
    }

    await client.query(
      `INSERT INTO users (id, code, name, email, role, profile_id) VALUES
       ($1,'COL-001','Ana García','ana@empresa.com','employee',$2),
       ($3,'COL-002','Luis Pérez','luis@empresa.com','employee',$4),
       ($5,'COL-003','María López','maria@empresa.com','employee',$6),
       ($7,'ADM-001','Administrador','admin@empresa.com','admin',NULL)`,
      [U.col1, P.p1, U.col2, P.p2, U.col3, P.p3, U.adm]
    );

    const states = [
      [U.col1, R.r1, 'Completado'], [U.col1, R.r2, 'En proceso'],
      [U.col1, R.r3, 'Pendiente'], [U.col1, R.r4, 'Pendiente'],
      [U.col2, R.r1, 'Completado'], [U.col2, R.r4, 'Completado'],
      [U.col3, R.r1, 'Pendiente'], [U.col3, R.r2, 'Pendiente'],
    ];
    for (const row of states) {
      await client.query(
        'INSERT INTO user_requirement_states (user_id, requirement_id, status) VALUES ($1,$2,$3)',
        row
      );
    }

    await addHistory(client, 'Catálogos y perfiles iniciales cargados.');
  });
}

async function maybeAutoSeed() {
  if (process.env.AUTO_SEED !== 'true') return;
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n === 0) await seed();
}

module.exports = { seed, maybeAutoSeed };
