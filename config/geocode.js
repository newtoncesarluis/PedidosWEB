'use strict';
/** Geocodifica um endereço via Nominatim (OpenStreetMap). Retorna { lat, lng, fonte } ou null. */
const https = require('https');

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get({
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { 'User-Agent': 'SysRepWeb-Geoloc/1.0', 'Accept-Language': 'pt-BR' },
    }, (res) => {
      let data = '';
      res.on('data', (d) => { data += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function buscar(partes) {
  const q = encodeURIComponent(partes.filter(Boolean).join(', '));
  const data = await httpsGet(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=br`);
  return data && data[0] ? { lat: data[0].lat, lng: data[0].lon } : null;
}

async function geocodeEndereco(endereco, cidade, uf, cep) {
  try {
    const exato = await buscar([endereco, cep, cidade, uf, 'Brasil']);
    if (exato) return { ...exato, fonte: 'endereco' };
    if (cidade) {
      const aprox = await buscar([cidade, uf, 'Brasil']);
      if (aprox) return { ...aprox, fonte: 'cidade' };
    }
  } catch (_) { /* sem rede: segue sem coordenadas */ }
  return null;
}

/** Só posição de endereço/rua (sem cair no centro da cidade). Para a busca profunda por CNAE. */
async function geocodePreciso({ logradouro, numero, bairro, cidade, uf, cep }) {
  try {
    const rua = String(logradouro || '').replace(/\s+/g, ' ').trim();
    const t1 = await buscar([[rua, numero].filter(Boolean).join(', '), bairro, cidade, uf, 'Brasil']);
    if (t1) return t1;
    await new Promise(r => setTimeout(r, 1100));   // política do Nominatim: 1 consulta por segundo
    if (rua) { const t2 = await buscar([rua, cidade, uf, 'Brasil']); if (t2) return t2; }
    return null;
  } catch (_) { return null; }
}

module.exports = { geocodeEndereco, geocodePreciso };
