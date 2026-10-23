# Start-It
Portal de incorporación tecnológica (Express + PostgreSQL). Un servicio sirve la API y `public/index.html`.
## Local
1. Crea la base y copia `.env.example` a `.env` (`DATABASE_URL`, `JWT_SECRET`).
2. `npm install && npm run migrate && npm run seed && npm start`
3. Abre http://localhost:3000 — COL-001 / ana@empresa.com o ADM-001 / admin@empresa.com
## Render
Sube el repo a GitHub → Render → New → Blueprint → elige el repositorio.
`render.yaml` crea el servicio, PostgreSQL, `JWT_SECRET` y `AUTO_SEED=true`.
Arranque: `npm run migrate && npm start`. Si `users` está vacía, siembra datos una vez.
## Scripts
`start`, `dev`, `migrate`, `seed`, `test`
