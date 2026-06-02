'use strict';

const express = require('express');
const router  = express.Router();
const https   = require('https');
const { getPool } = require('../config/database');

// ─── Utilitário: faz requisição HTTPS simples ────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.get({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: { 'User-Agent': 'SysRepWeb-Geocoder/1.0' },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Geocode um endereço via Nominatim ─────────────────────────────────────
async function geocodeEndereco(endereco, cidade, uf, cep) {
  // Tenta com endereço completo primeiro
  const q = encodeURIComponent([endereco, cidade, uf, 'Brasil'].filter(Boolean).join(', '));
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`;
  try {
    const data = await httpsGet(url);
    if (data && data[0]) {
      return { lat: data[0].lat, lng: data[0].lon, fonte: 'endereco' };
    }
    // Fallback: tenta apenas cidade + UF
    if (cidade) {
      const q2 = encodeURIComponent([cidade, uf, 'Brasil'].filter(Boolean).join(', '));
      const url2 = `https://nominatim.openstreetmap.org/search?q=${q2}&format=json&limit=1&countrycodes=br`;
      const data2 = await httpsGet(url2);
      if (data2 && data2[0]) {
        return { lat: data2[0].lat, lng: data2[0].lon, fonte: 'cidade' };
      }
    }
  } catch {}
  return null;
}

// ─── GET /api/geocoding/pendentes ────────────────────────────────────────────
// Retorna a contagem de clientes sem coordenadas
router.get('/pendentes', async (req, res) => {
  try {
    const pool = getPool();
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS total FROM clientes
       WHERE (excluido = 'N' OR excluido IS NULL)
         AND (latitude IS NULL OR latitude = '' OR longitude IS NULL OR longitude = '')
         AND (cidade IS NOT NULL AND cidade != '')`
    ).catch(() => [[{ total: 0 }]]);
    let leads = 0;
    try {
      const [[lr]] = await pool.query(
        `SELECT COUNT(*) AS total FROM leads
         WHERE excluido = 'N'
           AND convertido_cliente_id IS NULL
           AND status_funil NOT IN ('GANHO', 'PERDIDO')
           AND (latitude IS NULL OR latitude = '' OR longitude IS NULL OR longitude = '')
           AND (cidade IS NOT NULL AND cidade != '')`
      );
      leads = Number(lr?.total) || 0;
    } catch (_) {}
    res.json({ total: row.total, leads });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/geocoding/processar ──────────────────────────────────────────
// Geocodifica em lote (limite de 20 por chamada para não sobrecarregar)
router.post('/processar', async (req, res) => {
  const limite = Math.min(parseInt(req.body?.limite || 20), 50);
  const pool   = getPool();

  let clientes;
  try {
    [clientes] = await pool.query(
      `SELECT id, nome, endereco, cidade, uf, cep FROM clientes
       WHERE (excluido = 'N' OR excluido IS NULL)
         AND (latitude IS NULL OR latitude = '' OR longitude IS NULL OR longitude = '')
         AND (cidade IS NOT NULL AND cidade != '')
         AND cep IS NOT NULL AND cep != ''
         AND LENGTH(REPLACE(REPLACE(cep, '-', ''), ' ', '')) >= 8
       ORDER BY id
       LIMIT ?`,
      [limite]
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const resultados = { ok: 0, falha: 0, total: clientes.length, itens: [] };

  for (const c of clientes) {
    // Rate limit: 1 req/segundo (respeita Nominatim usage policy)
    await new Promise(r => setTimeout(r, 1050));

    const coords = await geocodeEndereco(c.endereco, c.cidade, c.uf, c.cep);
    const item = { id: c.id, nome: c.nome, cidade: c.cidade, uf: c.uf, ok: false };
    if (coords) {
      try {
        await pool.query(
          `UPDATE clientes SET latitude = ?, longitude = ?, dtalterado = NOW() WHERE id = ?`,
          [coords.lat, coords.lng, c.id]
        );
        item.ok    = true;
        item.lat   = parseFloat(coords.lat).toFixed(6);
        item.lng   = parseFloat(coords.lng).toFixed(6);
        item.fonte = coords.fonte;
        resultados.ok++;
      } catch { resultados.falha++; }
    } else {
      resultados.falha++;
    }
    resultados.itens.push(item);
  }

  res.json(resultados);
});

// ─── PUT /api/geocoding/cliente/:id ─────────────────────────────────────────
// Geocodifica um único cliente manualmente
router.put('/cliente/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [[c]] = await pool.query(
      `SELECT id, endereco, cidade, uf, cep FROM clientes WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!c) return res.status(404).json({ error: 'Cliente não encontrado' });

    const coords = await geocodeEndereco(c.endereco, c.cidade, c.uf, c.cep);
    if (!coords) return res.status(422).json({ error: 'Não foi possível geocodificar o endereço' });

    await pool.query(
      `UPDATE clientes SET latitude = ?, longitude = ?, dtalterado = NOW() WHERE id = ?`,
      [coords.lat, coords.lng, c.id]
    );
    res.json({ ok: true, lat: coords.lat, lng: coords.lng, fonte: coords.fonte });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/geocoding/pendentes-leads ──────────────────────────────────────
router.get('/pendentes-leads', async (req, res) => {
  try {
    const pool = getPool();
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS total FROM leads
       WHERE excluido = 'N'
         AND convertido_cliente_id IS NULL
         AND status_funil NOT IN ('GANHO', 'PERDIDO')
         AND (latitude IS NULL OR latitude = '' OR longitude IS NULL OR longitude = '')
         AND (cidade IS NOT NULL AND cidade != '')`
    ).catch(() => [[{ total: 0 }]]);
    res.json({ total: row.total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/geocoding/processar-leads ───────────────────────────────────────
router.post('/processar-leads', async (req, res) => {
  const limite = Math.min(parseInt(req.body?.limite || 20), 50);
  const pool = getPool();
  let leads;
  try {
    [leads] = await pool.query(
      `SELECT id, endereco, bairro, cidade, uf, cep FROM leads
       WHERE excluido = 'N'
         AND convertido_cliente_id IS NULL
         AND (latitude IS NULL OR latitude = '' OR longitude IS NULL OR longitude = '')
         AND (cidade IS NOT NULL AND cidade != '')
       ORDER BY id
       LIMIT ?`,
      [limite]
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const resultados = { ok: 0, falha: 0, total: leads.length };
  for (const l of leads) {
    await new Promise(r => setTimeout(r, 1050));
    const end = [l.endereco, l.bairro].filter(Boolean).join(', ');
    const coords = await geocodeEndereco(end, l.cidade, l.uf, l.cep);
    if (coords) {
      try {
        await pool.query(
          `UPDATE leads SET latitude = ?, longitude = ?, dtalterado = NOW() WHERE id = ?`,
          [coords.lat, coords.lng, l.id]
        );
        resultados.ok++;
      } catch { resultados.falha++; }
    } else {
      resultados.falha++;
    }
  }
  res.json(resultados);
});

// ─── PUT /api/geocoding/lead/:id ───────────────────────────────────────────────
router.put('/lead/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [[l]] = await pool.query(
      `SELECT id, endereco, bairro, cidade, uf, cep FROM leads WHERE id = ? AND excluido = 'N' LIMIT 1`,
      [req.params.id]
    );
    if (!l) return res.status(404).json({ error: 'Lead não encontrado' });

    const end = [l.endereco, l.bairro].filter(Boolean).join(', ');
    const coords = await geocodeEndereco(end, l.cidade, l.uf, l.cep);
    if (!coords) return res.status(422).json({ error: 'Não foi possível geocodificar o endereço' });

    await pool.query(
      `UPDATE leads SET latitude = ?, longitude = ?, dtalterado = NOW() WHERE id = ?`,
      [coords.lat, coords.lng, l.id]
    );
    res.json({ ok: true, lat: coords.lat, lng: coords.lng, fonte: coords.fonte });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/geocoding/cidades ─────────────────────────────────────────────
// Geocodifica lista de cidades únicas — usado pelo mapa de rotas para clientes
// sem GPS individual. Cache em memória (reinicia com o servidor).
const _cidadeCache = new Map();

router.post('/cidades', async (req, res) => {
  const { cidades = [] } = req.body; // [{cidade, uf}]
  if (!Array.isArray(cidades) || cidades.length === 0) return res.json({});

  const result = {};
  for (const { cidade, uf } of cidades) {
    if (!cidade) continue;
    const key = `${(cidade||'').toLowerCase()},${(uf||'').toLowerCase()}`;
    if (_cidadeCache.has(key)) { result[key] = _cidadeCache.get(key); continue; }
    try {
      await new Promise(r => setTimeout(r, 1050)); // respeita 1 req/s do Nominatim
      const geo = await geocodeEndereco(null, cidade, uf, null);
      if (geo) {
        const val = { lat: parseFloat(geo.lat), lng: parseFloat(geo.lng) };
        _cidadeCache.set(key, val);
        result[key] = val;
      }
    } catch (_) {}
  }
  res.json(result);
});

module.exports = router;
module.exports.geocodeEndereco = geocodeEndereco;
