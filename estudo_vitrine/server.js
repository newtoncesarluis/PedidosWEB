'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const { getPool } = require('./config/database');

const app = express();
const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || '3090', 10);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'admin.html'));
});

app.get('/vitrine/:token', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'vitrine.html'));
});

app.use('/api/vitrine', require('./routes/vitrine'));
app.use('/api/demo', require('./routes/demo'));

app.get('/health', async (_req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Estudo Vitrine rodando em http://localhost:${PORT}`);
});
