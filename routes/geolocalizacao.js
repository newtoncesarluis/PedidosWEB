'use strict';

const express = require('express');
const router  = express.Router();
const https   = require('https');
const { getPool } = require('../config/database');

// ─── Utilitário: faz requisição HTTPS ────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const opts = new URL(url);
    const req = https.get({
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
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ─── Estabelecimentos próximos (OpenStreetMap / Overpass) ───────────────────
// termo digitado → tags OSM. Sem match, cai em busca por nome.
const OSM_CATEGORIAS = [
  { re: /a[cç]ougue|carnes?|casa de carnes/, tags: ['shop=butcher'], label: 'Açougue' },
  { re: /padaria|panificadora/, tags: ['shop=bakery'], label: 'Padaria' },
  { re: /supermercado|mercado|hipermercado/, tags: ['shop=supermarket'], label: 'Supermercado' },
  { re: /mercearia|armaz[eé]m|minimercado|conveni[eê]ncia/, tags: ['shop=convenience'], label: 'Mercearia' },
  { re: /hortifruti|sacol[aã]o|frutas?|verduras?/, tags: ['shop=greengrocer'], label: 'Hortifruti' },
  { re: /farm[aá]cia|drogaria/, tags: ['amenity=pharmacy'], label: 'Farmácia' },
  { re: /restaurante/, tags: ['amenity=restaurant'], label: 'Restaurante' },
  { re: /lanchonete|fast ?food|pastelaria/, tags: ['amenity=fast_food'], label: 'Lanchonete' },
  { re: /\bbar\b|boteco|choperia/, tags: ['amenity=bar', 'amenity=pub'], label: 'Bar' },
  { re: /cafe|caf[eé]|cafeteria/, tags: ['amenity=cafe'], label: 'Café' },
  { re: /material de constru|constru[cç][aã]o|ferragem|ferramentas/, tags: ['shop=building_materials', 'shop=doityourself', 'shop=hardware'], label: 'Material de construção' },
  { re: /roupa|vestu[aá]rio|moda|boutique/, tags: ['shop=clothes'], label: 'Roupas' },
  { re: /cal[cç]ado|sapataria/, tags: ['shop=shoes'], label: 'Calçados' },
  { re: /pet ?shop|animais|ra[cç][aã]o/, tags: ['shop=pet'], label: 'Pet shop' },
  { re: /sal[aã]o|cabeleireir|beleza|barbearia/, tags: ['shop=hairdresser', 'shop=beauty'], label: 'Salão / Beleza' },
  { re: /posto|combust[ií]vel/, tags: ['amenity=fuel'], label: 'Posto' },
  { re: /papelaria|livraria/, tags: ['shop=stationery', 'shop=books'], label: 'Papelaria' },
  { re: /[oó]tica/, tags: ['shop=optician'], label: 'Ótica' },
  { re: /autope[cç]as?|pe[cç]as autom/, tags: ['shop=car_parts'], label: 'Autopeças' },
  { re: /eletro|eletr[oô]nic|inform[aá]tica|celular/, tags: ['shop=electronics', 'shop=mobile_phone', 'shop=computer'], label: 'Eletrônicos' },
  { re: /m[oó]veis|colch/, tags: ['shop=furniture'], label: 'Móveis' },
  { re: /flor|floricultura/, tags: ['shop=florist'], label: 'Floricultura' },
  { re: /cosm[eé]tic|perfum/, tags: ['shop=cosmetics', 'shop=perfumery'], label: 'Cosméticos' },
  { re: /atacad|distribuidor|cash ?(and|&) ?carry/, tags: ['shop=wholesale'], label: 'Atacado / Distribuidor' },
  { re: /oficina|mec[aâ]nic/, tags: ['shop=car_repair', 'craft=car_repair'], label: 'Oficina mecânica' },
  { re: /cl[ií]nica|consult[oó]rio|dentista|m[eé]dico|hospital/, tags: ['amenity=clinic', 'amenity=doctors', 'amenity=dentist', 'amenity=hospital'], label: 'Saúde' },
  { re: /escola|col[eé]gio|creche|faculdade/, tags: ['amenity=school', 'amenity=kindergarten', 'amenity=college'], label: 'Escola' },
  { re: /\bloja\b/, tags: ['shop'], label: 'Lojas' },
];
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const _cacheLugares = new Map(); // ql -> { ts, json }
const CACHE_LUGARES_MS = 10 * 60 * 1000;

function semAcento(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function overpassPost(endpoint, ql) {
  return new Promise((resolve, reject) => {
    const u = new URL(endpoint);
    const body = 'data=' + encodeURIComponent(ql);
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: 'POST',
      headers: {
        'User-Agent': 'SysRepWeb-Geoloc/1.0',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('Overpass HTTP ' + res.statusCode));
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(14000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function distKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// ─── GET /api/geolocalizacao/lugares?lat=&lng=&raio=km&q=açougue ────────────
router.get('/lugares', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
    if (q.length < 2) return res.status(400).json({ error: 'Digite o que procurar (ex.: açougue, padaria)' });

    const raioKm = Math.min(Math.max(parseFloat(req.query.raio) || 5, 0.5), 30);
    const metros = Math.round(raioKm * 1000);
    const termo = semAcento(q.toLowerCase());

    const cat = OSM_CATEGORIAS.find(c => c.re.test(q.toLowerCase()) || c.re.test(termo));
    const around = `(around:${metros},${lat},${lng})`;
    const nomeRe = q.replace(/[^\p{L}\p{N} ]/gu, '').trim();
    if (!cat && nomeRe.length < 2) return res.status(400).json({ error: 'Termo de busca inválido' });
    let partes;
    if (cat) {
      partes = cat.tags.map(t => {
        const [k, v] = t.split('=');
        return `nwr["${k}"${v ? `="${v}"` : ''}]${around};`;
      });
    } else {
      partes = [`nwr["name"~"${nomeRe}",i]${around};`];
    }
    const ql = `[out:json][timeout:20];(${partes.join('')});out center tags 400;`;

    let json = null, ultimoErro = null;
    const emCache = _cacheLugares.get(ql);
    if (emCache && Date.now() - emCache.ts < CACHE_LUGARES_MS) json = emCache.json;
    for (const ep of json ? [] : OVERPASS_URLS) {
      try { json = await overpassPost(ep, ql); break; } catch (e) { ultimoErro = e; }
    }
    const veioDoCache = emCache && emCache.json === json;
    if (json && !veioDoCache) {
      if (_cacheLugares.size > 200) _cacheLugares.clear();
      _cacheLugares.set(ql, { ts: Date.now(), json });
    }
    if (!json) return res.status(502).json({ error: 'Serviço de mapas indisponível no momento. Tente novamente em instantes. (' + (ultimoErro && ultimoErro.message) + ')' });

    // clientes já cadastrados (≤ 80 m de distância) para marcar "já é cliente"
    let cadastrados = [];
    try {
      const [rows] = await getPool().query(
        `SELECT id, nome, latitude, longitude FROM clientes
          WHERE (excluido = 'N' OR excluido IS NULL)
            AND latitude IS NOT NULL AND latitude != '' AND longitude IS NOT NULL AND longitude != ''
            AND ABS(latitude - ?) < ? AND ABS(longitude - ?) < ?`,
        [lat, raioKm / 100, lng, raioKm / 100]
      );
      cadastrados = rows.map(r => ({ id: r.id, nome: r.nome, lat: parseFloat(r.latitude), lng: parseFloat(r.longitude) }));
    } catch (_) { /* tabela/colunas ausentes: segue sem a marcação */ }

    const lugares = (json.elements || []).map(e => {
      const t = e.tags || {};
      const plat = e.lat != null ? e.lat : e.center && e.center.lat;
      const plng = e.lon != null ? e.lon : e.center && e.center.lon;
      if (plat == null || plng == null) return null;
      const endereco = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ');
      const ja = cadastrados.find(c => distKm(plat, plng, c.lat, c.lng) <= 0.08);
      return {
        osm_id: `${e.type}/${e.id}`,
        nome: t.name || t.brand || t.operator || '(sem nome)',
        categoria: cat ? cat.label : (t.shop || t.amenity || 'Estabelecimento'),
        endereco,
        bairro: t['addr:suburb'] || t['addr:neighbourhood'] || '',
        cidade: t['addr:city'] || '',
        telefone: t.phone || t['contact:phone'] || t['contact:mobile'] || '',
        site: t.website || t['contact:website'] || '',
        horario: t.opening_hours || '',
        latitude: plat,
        longitude: plng,
        distancia: distKm(lat, lng, plat, plng),
        cliente_id: ja ? ja.id : null,
        cliente_nome: ja ? ja.nome : null,
      };
    }).filter(Boolean).sort((a, b) => a.distancia - b.distancia).slice(0, 150);

    res.json({ raio_km: raioKm, categoria: cat ? cat.label : null, total: lugares.length, lugares });
  } catch (err) {
    console.error('Erro geolocalizacao lugares:', err);
    res.status(500).json({ error: err.message });
  }
});

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
// Busca clientes / pedidos / leads (ou clientes+leads = "misto") dentro de um raio (km).
// Filtros de carteira: dias_sem_compra (mín.), vendedor (respeita a permissão do usuário).
const { buildPedidosVendedorWhereSync, canPickOtherVendors, listVendedoresVisiveis } = require('../config/vendedor-visibilidade');

const HAV = (a, b) => `(6371 * acos(LEAST(1, cos(radians(?)) * cos(radians(${a})) *
            cos(radians(${b}) - radians(?)) + sin(radians(?)) * sin(radians(${a})))))`;

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
    if (![raioFloat, latFloat, lngFloat].every(isFinite)) {
      return res.status(400).json({ error: 'Parâmetros inválidos' });
    }
    const diasSemCompra = parseInt(req.query.dias_sem_compra, 10) || 0;
    const vendedorQ = req.query.vendedor ? String(req.query.vendedor) : '';

    // ── clientes ──
    const buscarClientes = async () => {
      let where = `(c.excluido = 'N' OR c.excluido IS NULL)
          AND c.latitude IS NOT NULL AND c.latitude != ''
          AND c.longitude IS NOT NULL AND c.longitude != ''`;
      const prm = [latFloat, lngFloat, latFloat];
      if (diasSemCompra > 0) {
        where += ` AND (c.dtultimacompra IS NULL OR DATEDIFF(CURDATE(), c.dtultimacompra) >= ?)`;
        prm.push(diasSemCompra);
      }
      if (vendedorQ) {
        const v = buildPedidosVendedorWhereSync(req, vendedorQ, 'c.cod_vendedor');
        where += v.clause; prm.push(...v.params);
      }
      prm.push(raioFloat);
      const [rows] = await pool.query(
        `SELECT c.id, c.nome, c.apelido, c.endereco, c.numero_end, c.bairro, c.cidade, c.uf,
                c.latitude, c.longitude, c.foneprincipal AS telefone, c.cod_vendedor, c.dtultimacompra,
                CASE WHEN c.dtultimacompra IS NULL THEN NULL ELSE DATEDIFF(CURDATE(), c.dtultimacompra) END AS dias_sem_compra,
                ${HAV('c.latitude', 'c.longitude')} AS distancia
           FROM clientes c WHERE ${where}
          HAVING distancia <= ? ORDER BY distancia LIMIT 150`,
        // a ordem dos "?" no SELECT vem antes do WHERE
        [prm[0], prm[1], prm[2], ...prm.slice(3)]
      ).catch((e) => { console.warn('raio clientes:', e.message); return [[]]; });
      return rows || [];
    };

    // ── leads ──
    const buscarLeads = async () => {
      const [rows] = await pool.query(
        `SELECT l.id, l.nome, l.empresa, l.endereco, l.bairro, l.cidade, l.uf, l.latitude, l.longitude,
                l.telefone, l.segmento, l.status_funil,
                ${HAV('l.latitude', 'l.longitude')} AS distancia
           FROM leads l
          WHERE l.excluido = 'N' AND l.convertido_cliente_id IS NULL
            AND l.latitude IS NOT NULL AND l.latitude != '' AND l.longitude IS NOT NULL AND l.longitude != ''
            AND l.status_funil NOT IN ('PERDIDO')
          HAVING distancia <= ? ORDER BY distancia LIMIT 150`,
        [latFloat, lngFloat, latFloat, raioFloat]
      ).catch((e) => { console.warn('raio leads:', e.message); return [[]]; });
      return (rows || []).map(r => ({ ...r, _lead: true }));
    };

    if (tipo === 'clientes') return res.json(await buscarClientes());
    if (tipo === 'leads') return res.json(await buscarLeads());
    if (tipo === 'misto') {
      const [cs, ls] = await Promise.all([buscarClientes(), buscarLeads()]);
      return res.json([...cs, ...ls].sort((a, b) => a.distancia - b.distancia).slice(0, 200));
    }

    // pedidos (usa o endereço do cliente vinculado)
    const [rows] = await pool.query(
      `SELECT p.id AS id_pedido, p.numero, p.vlrtotalpedido, p.data_abertura,
              c.id AS id_cliente, c.nome AS nome_cliente, c.apelido AS fantasia_cliente,
              c.endereco, c.cidade, c.uf, c.latitude, c.longitude,
              ${HAV('c.latitude', 'c.longitude')} AS distancia
         FROM pedidos p
         LEFT JOIN clientes c ON p.cod_cliente = c.id
        WHERE (p.excluido = 'N' OR p.excluido IS NULL)
          AND c.latitude IS NOT NULL AND c.latitude != ''
          AND c.longitude IS NOT NULL AND c.longitude != ''
        HAVING distancia <= ? ORDER BY distancia LIMIT 100`,
      [latFloat, lngFloat, latFloat, raioFloat]
    ).catch(() => [[]]);
    res.json(rows || []);
  } catch (err) {
    console.error('Erro geolocalizacao raio:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/geolocalizacao/vendedores ──────────────────────────────────────
// Combo de vendedores para filtrar a carteira (já respeita a permissão)
router.get('/vendedores', async (req, res) => {
  try {
    const rows = await listVendedoresVisiveis(getPool(), req, { onlyPVender: true });
    res.json({ pode_escolher: canPickOtherVendors(req), vendedores: rows });
  } catch (err) {
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

    const validos = listaPontos
      .map(p => ({ ...p, lat: parseFloat(p.lat), lng: parseFloat(p.lng) }))
      .filter(p => isFinite(p.lat) && isFinite(p.lng))
      .slice(0, 25);
    if (validos.length < 2) return res.json({ rota: [], distanciaTotal: 0 });

    // 1) Tenta OSRM: ordem ótima + traçado pelas ruas + tempo. O 1º ponto é a origem (fixa).
    try {
      const coords = validos.map(p => `${p.lng},${p.lat}`).join(';');
      const osrm = await httpsGet(
        `https://router.project-osrm.org/trip/v1/driving/${coords}?source=first&roundtrip=false&geometries=geojson&overview=full`
      );
      const trip = osrm && osrm.code === 'Ok' && osrm.trips && osrm.trips[0];
      if (trip && osrm.waypoints && osrm.waypoints.length === validos.length) {
        const ordem = validos
          .map((p, i) => ({ p, pos: osrm.waypoints[i].waypoint_index }))
          .sort((a, b) => a.pos - b.pos)
          .map(x => x.p);
        return res.json({
          rota: ordem,
          distanciaTotal: trip.distance / 1000,
          duracaoMin: Math.round(trip.duration / 60),
          geometry: trip.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          fonte: 'ruas',
          qtdPontos: validos.length
        });
      }
    } catch (e) {
      console.warn('OSRM indisponível, usando vizinho mais próximo:', e.message);
    }

    // 2) Fallback: vizinho mais próximo em linha reta, partindo do 1º ponto
    const resultado = otimizarRota(validos, 0);
    res.json({
      rota: resultado.rota,
      distanciaTotal: resultado.distanciaTotal,
      duracaoMin: null,
      geometry: null,
      fonte: 'linha-reta',
      qtdPontos: validos.length
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