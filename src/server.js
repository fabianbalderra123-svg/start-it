'use strict';

require('dotenv').config();
const { app } = require('./app');
const { maybeAutoSeed } = require('./seed');

const port = Number(process.env.PORT) || 3000;

maybeAutoSeed()
  .then(() => {
    app.listen(port, () => {
      console.log(`Start-It en http://localhost:${port}`);
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
