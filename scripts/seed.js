'use strict';

require('dotenv').config();
const { pool } = require('../src/db');
const { seed } = require('../src/seed');

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
