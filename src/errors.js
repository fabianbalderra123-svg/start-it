'use strict';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

function pgToHttp(err) {
  if (err instanceof HttpError) return err;
  if (err.code === '23505') {
    const name = String(err.constraint || '');
    if (/email/i.test(name)) {
      return new HttpError(409, 'CONFLICT', 'Ese correo ya está registrado.');
    }
    return new HttpError(409, 'CONFLICT', 'Ese ID ya existe.');
  }
  return err;
}

module.exports = { HttpError, sendError, pgToHttp };
