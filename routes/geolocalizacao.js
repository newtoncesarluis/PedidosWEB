'use strict';

const express = require('express');
const router  = express.Router();
const https   = require('https');
const { getPool } = require('../config/database');

// ─── Utilitário: faz requisição HTTPS ────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    https.get({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      headers: { 'User-Agent': 'SysRepWeb-Geoloc/1.0' },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    }).on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpsPost(url, body) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: opts.hostname,
      path: opts.pathname + opts.search,
      method: 'POST',
      headers: {
        'User-Agent': 'SysRepWeb-Geoloc/1.0',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(postData);
    req.end();
  });
}

// ─── GET /api/geolocalizacao/raio ────────────────────────────────────────────
// Busca clientes/pedidos dentro de um raio (km) de um ponto
router.get('/raio', async (req, res) => {
  try {
    const { lat, lng, raio = 50, tipo = 'clientes' } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
    }

    const pool = getPool();
    const raioFloat = parseFloat(raio);
    const latFloat = parseFloat(lat);
    const lngFloat = parseFloat(lng);

    let query, params;
    
    if (tipo === 'clientes') {
      query = `
        SELECT 
          id, nome, apelido, endereco, numero_end, bairro, cidade, uf,
          latitude, longitude,
          (6371 * acos(
            cos(radians(?)) * cos(radians(latitude)) * 
            cos(radians(longitude) - radians(?)) + 
            sin(radians(?)) * sin(radians(latitude))
          )) AS distancia
        FROM clientes
        WHERE (excluido = 'N' OR excluido IS NULL)
          AND latitude IS NOT NULL AND latitude != ''
          AND longitude IS NOT NULL AND longitude != ''
        HAVING distancia <= ?
        ORDER BY distancia
        LIMIT 100
      `;
      params = [latFloat, lngFloat, latFloat, raioFloat];
    } else {
      // Busca por pedidos (usando dados do cliente vinculado)
      query = `
        SELECT 
          p.id as id_pedido, p.numero, p.vlrtotalpedido, p.data_abertura,
          c.id as id_cliente, c.nome as nome_cliente, c.apelido as fantasia_cliente,
          c.endereco, c.cidade, c.uf,
          c.latitude, c.longitude,
          (6371 * acos(
            cos(radians(?)) * cos(radians(c.latitude)) * 
            cos(radians(c.longitude) - radians(?)) + 
            sin(radians(?)) * sin(radians(c.latitude))
          )) AS distancia
        FROM pedidos p
        LEFT JOIN clientes c ON p.cod_cliente = c.id
        WHERE (p.excluido = 'N' OR p.excluido IS NULL)
          AND c.latitude IS NOT NULL AND c.latitude != ''
          AND c.longitude IS NOT NULL AND c.longitude != ''
        HAVING distancia <= ?
        ORDER BY distancia
        LIMIT 100
      `;
      params = [latFloat, lngFloat, latFloat, raioFloat];
    }

    const [rows] = await pool.query(query, params).catch(() => [[]]);
    res.json(rows || []);
  } catch (err) {
    console.error('Erro geolocalizacao raio:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/geolocalizacao/otimizar-rota ───────────────────────────────────
// Otimiza rota entre múltiplos pontos usando algoritmo do vizinho mais próximo
router.get('/otimizar-rota', async (req, res) => {
  try {
    const { pontos } = req.query; // JSON string: [{lat, lng, id, nome}]
    if (!pontos) {
      return res.status(400).json({ error: 'Parâmetro pontos é obrigatório' });
    }

    const listaPontos = JSON.parse(pontos);
    if (!Array.isArray(listaPontos) || listaPontos.length < 2) {
      return res.json({ rota: [], distanciaTotal: 0 });
    }

    // Algoritmo do vizinho mais próximo (Nearest Neighbor)
    const otimizarRota = (pontos, inicioIndex = 0) => {
      const naoVisitados = pontos.map((p, i) => ({ ...p, index: i }));
      const rota = [naoVisitados.splice(inicioIndex, 1)[0]];
      let distanciaTotal = 0;

      while (naoVisitados.length > 0) {
        const atual = rota[rota.length - 1];
        let maisProximo = null;
        let menorDist = Infinity;

        for (let i = 0; i < naoVisitados.length; i++) {
          const dist = calcularDistancia(atual.lat, atual.lng, naoVisitados[i].lat, naoVisitados[i].lng);
          if (dist < menorDist) {
            menorDist = dist;
            maisProximo = i;
          }
        }

        if (maisProximo !== null) {
          rota.push(naoVisitados.splice(maisProximo, 1)[0]);
          distanciaTotal += menorDist;
        }
      }

      return { rota, distanciaTotal };
    };

    const calcularDistancia = (lat1, lon1, lat2, lon2) => {
      const R = 6371; // Raio da Terra em km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };

    // Otimiza começando do primeiro ponto
    const resultado = otimizarRota(listaPontos, 0);
    
    res.json({
      rota: resultado.rota,
      distanciaTotal: resultado.distanciaTotal,
      qtdPontos: listaPontos.length
    });
  } catch (err) {
    console.error('Erro otimizar rota:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/geolocalizacao/geocode-endereco ───────────────────────────────
// Geocodifica um endereço específico (usa Nominatim)
router.get('/geocode-endereco', async (req, res) => {
  try {
    const { endereco, cidade, uf, cep } = req.query;
    if (!endereco && !cidade) {
      return res.status(400).json({ error: 'Endereço ou cidade são obrigatórios' });
    }

    const q = encodeURIComponent([endereco, cidade, uf, 'Brasil'].filter(Boolean).join(', '));
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br&addressdetails=1`;
    
    const data = await httpsGet(url);
    
    if (data && data[0]) {
      const result = data[0];
      res.json({
        lat: result.lat,
        lng: result.lon,
        display_name: result.display_name,
        endereco_completo: result.address ? {
          road: result.address.road,
          house_number: result.address.house_number,
          neighbourhood: result.address.neighbourhood || result.address.suburb,
          city: result.address.city || result.address.town || result.address.village,
          state: result.address.state,
          postcode: result.address.postcode,
          country: result.address.country
        } : null
      });
    } else {
      res.status(404).json({ error: 'Endereço não encontrado' });
    }
  } catch (err) {
    console.error('Erro geocode:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/geolocalizacao/reverse-geocode ────────────────────────────────
// Descobre endereço a partir de coordenadas (usa Nominatim)
router.get('/reverse-geocode', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
    }

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
    const data = await httpsGet(url);

    if (data && data.lat) {
      res.json({
        lat: data.lat,
        lng: data.lon,
        display_name: data.display_name,
        endereco: data.address ? {
          road: data.address.road,
          house_number: data.address.house_number,
          neighbourhood: data.address.neighbourhood || data.address.suburb,
          city: data.address.city || data.address.town || data.address.village,
          state: data.address.state,
          postcode: data.address.postcode,
          country: data.address.country
        } : null
      });
    } else {
      res.status(404).json({ error: 'Endereço não encontrado para estas coordenadas' });
    }
  } catch (err) {
    console.error('Erro reverse geocode:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/geolocalizacao/calcula-distancia ──────────────────────────────
// Calcula distância entre dois pontos
router.get('/calcula-distancia', async (req, res) => {
  try {
    const { lat1, lng1, lat2, lng2 } = req.query;
    if (!lat1 || !lng1 || !lat2 || !lng2) {
      return res.status(400).json({ error: 'Todas as coordenadas são obrigatórias' });
    }

    const calcularDistancia = (lat1, lon1, lat2, lon2) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };

    const distancia = calcularDistancia(parseFloat(lat1), parseFloat(lng1), parseFloat(lat2), parseFloat(lng2));
    
    res.json({
      distancia_km: distancia,
      distancia_m: distancia * 1000,
      ponto_a: { lat: parseFloat(lat1), lng: parseFloat(lng1) },
      ponto_b: { lat: parseFloat(lat2), lng: parseFloat(lng2) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/geolocalizacao/clusters ───────────────────────────────────────
// Agrupa clientes/pedidos por proximidade (clusters)
router.get('/clusters', async (req, res) => {
  try {
    const { lat, lng, raio = 10, min_pontos = 3 } = req.query;
    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
    }

    const pool = getPool();
    const raioFloat = parseFloat(raio);
    const minPontos = parseInt(min_pontos);

    // Busca todos os pontos num raio maior
    const [pontos] = await pool.query(`
      SELECT 
        id, nome, apelido, cidade, uf,
        latitude, longitude,
        (6371 * acos(
          cos(radians(?)) * cos(radians(latitude)) * 
          cos(radians(longitude) - radians(?)) + 
          sin(radians(?)) * sin(radians(latitude))
        )) AS distancia
      FROM clientes
      WHERE (excluido = 'N' OR excluido IS NULL)
        AND latitude IS NOT NULL AND latitude != ''
        AND longitude IS NOT NULL AND longitude != ''
      HAVING distancia <= ?
      ORDER BY distancia
    `, [parseFloat(lat), parseFloat(lng), parseFloat(lat), raioFloat * 2]).catch(() => [[]]);

    if (!pontos.length) {
      return res.json({ clusters: [] });
    }

    // Algoritmo simples de clustering por distância
    const clusters = [];
    const visitados = new Set();

    const calcularDistancia = (lat1, lon1, lat2, lon2) => {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return R * c;
    };

    for (const ponto of pontos) {
      if (visitados.has(ponto.id)) continue;

      const cluster = [ponto];
      visitados.add(ponto.id);

      for (const outro of pontos) {
        if (visitados.has(outro.id)) continue;
        const dist = calcularDistancia(ponto.latitude, ponto.longitude, outro.latitude, outro.longitude);
        if (dist <= raioFloat) {
          cluster.push(outro);
          visitados.add(outro.id);
        }
      }

      if (cluster.length >= minPontos) {
        // Calcula centroide do cluster
        const latCentro = cluster.reduce((sum, p) => sum + parseFloat(p.latitude), 0) / cluster.length;
        const lngCentro = cluster.reduce((sum, p) => sum + parseFloat(p.longitude), 0) / cluster.length;
        
        clusters.push({
          centroide: { lat: latCentro, lng: lngCentro },
          qtd_pontos: cluster.length,
          cidades: [...new Set(cluster.map(p => p.cidade))],
          pontos: cluster
        });
      }
    }

    res.json({
      clusters: clusters.sort((a, b) => b.qtd_pontos - a.qtd_pontos),
      total_pontos: pontos.length,
      total_clusters: clusters.length
    });
  } catch (err) {
    console.error('Erro clusters:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;