'use strict';

async function addHistory(client, detail) {
  await client.query('INSERT INTO history (detail) VALUES ($1)', [detail]);
  await client.query(`
    DELETE FROM history
    WHERE id IN (
      SELECT id FROM history ORDER BY created_at DESC OFFSET 100
    )
  `);
}

function formatDate(value) {
  return new Date(value).toLocaleString('es-MX');
}

module.exports = { addHistory, formatDate };
