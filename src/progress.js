'use strict';

function progressOf(activeReqs, states) {
  const n = activeReqs.length;
  if (!n) return 0;
  const done = activeReqs.filter((r) => states[r.id] === 'Completado').length;
  return Math.round((done / n) * 100);
}

function statusOf(percent) {
  if (percent === 100) return 'Completado';
  if (percent === 0) return 'Pendiente';
  return 'En proceso';
}

function trafficOf(percent) {
  if (percent === 100) return 'green';
  if (percent >= 50) return 'yellow';
  return 'red';
}

module.exports = { progressOf, statusOf, trafficOf };
