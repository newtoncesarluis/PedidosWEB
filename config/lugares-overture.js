'use strict';
/**
 * Lugares (estabelecimentos) a partir do Overture Maps — dados abertos, sem chave de API.
 *
 * A tabela `overture_lugares` é CENTRAL (a mesma para todos os tenants) e é carregada por
 * `scripts/overture-importar.js` (rodar ~1x por mês). Aqui só fica a CONSULTA usada por
 * `GET /api/geolocalizacao/lugares`; se a tabela estiver vazia/indisponível, a rota cai
 * automaticamente para OpenStreetMap (Overpass → Nominatim).
 *
 * Onde fica a tabela (nessa ordem):
 *   1) OVERTURE_DB_HOST/PORT/USER/PASSWORD/NAME no .env  (banco próprio — útil em dev/instalação única)
 *   2) banco central do Painel NC (config/db-painel.js → nc_painel)
 */
const mysql = require('mysql2/promise');

const CONF_MIN = parseFloat(process.env.OVERTURE_CONF_MIN || '0.4');
const TIMEOUT_MS = 3500;                 // não deixa a busca travar se o banco central estiver fora
const PAUSA_APOS_FALHA_MS = 5 * 60 * 1000;

let _pool = null;
let _indisponivelAte = 0;
let _tabelaPronta = false;

const DDL = `
  CREATE TABLE IF NOT EXISTS overture_lugares (
    id               VARCHAR(40)  NOT NULL PRIMARY KEY,
    nome             VARCHAR(200) NOT NULL DEFAULT '',
    categoria        VARCHAR(80)  NOT NULL DEFAULT '',
    categoria_basica VARCHAR(80)  NOT NULL DEFAULT '',
    fone             VARCHAR(30)  NOT NULL DEFAULT '',
    site             VARCHAR(255) NOT NULL DEFAULT '',
    email            VARCHAR(150) NOT NULL DEFAULT '',
    endereco         VARCHAR(255) NOT NULL DEFAULT '',
    cidade           VARCHAR(100) NOT NULL DEFAULT '',
    uf               CHAR(2)      NOT NULL DEFAULT '',
    cep              VARCHAR(12)  NOT NULL DEFAULT '',
    lat              DECIMAL(9,6) NOT NULL,
    lng              DECIMAL(9,6) NOT NULL,
    confianca        DECIMAL(4,3) NOT NULL DEFAULT 0,
    release_ver      VARCHAR(20)  NOT NULL DEFAULT '',
    INDEX idx_ovt_geo (lat, lng),
    INDEX idx_ovt_cat (categoria),
    INDEX idx_ovt_uf  (uf)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

let _poolTeste = null;
/** Somente testes: força um pool específico (ex.: banco de homologação). */
function definirPoolParaTeste(p) { _poolTeste = p; _tabelaPronta = false; _indisponivelAte = 0; }

function getLugaresPool() {
  if (_poolTeste) return _poolTeste;
  if (process.env.OVERTURE_DB_HOST) {
    if (!_pool || _pool.pool._closed) {
      _pool = mysql.createPool({
        host: process.env.OVERTURE_DB_HOST,
        port: parseInt(process.env.OVERTURE_DB_PORT || '3306', 10),
        user: process.env.OVERTURE_DB_USER,
        password: process.env.OVERTURE_DB_PASSWORD || '',
        database: process.env.OVERTURE_DB_NAME || 'nc_painel',
        waitForConnections: true, connectionLimit: 4, queueLimit: 0,
        charset: 'utf8mb4', connectTimeout: 4000,
      });
    }
    return _pool;
  }
  return require('./db-painel').getPainelPool();
}

function comTimeout(promessa) {
  return Promise.race([
    promessa,
    new Promise((_, rej) => setTimeout(() => rej(new Error('banco de lugares: tempo esgotado')), TIMEOUT_MS)),
  ]);
}

async function garantirTabela(pool) {
  if (_tabelaPronta) return;
  await pool.query(DDL);
  _tabelaPronta = true;
}

// ── Termos em português → categorias do Overture (taxonomy.primary) ──────────
// exact = igualdade; like = padrões SQL LIKE. Chave = rótulo de OSM_CATEGORIAS (routes/geolocalizacao.js)
const OVT_POR_LABEL = {
  'Açougue': { exact: ['butcher_shop', 'meat_shop', 'meat_wholesaler'], like: ['%butcher%', '%meat%'] },
  'Padaria': { exact: ['bakery'], like: ['%bakery%', '%patisserie%'] },
  'Supermercado': { exact: ['grocery_store', 'supermarket', 'hypermarket', 'warehouse_club'], like: ['%supermarket%', '%grocery%'] },
  'Mercearia': { exact: ['convenience_store', 'grocery_store', 'deli'], like: ['%grocery%', '%convenience%'] },
  'Hortifruti': { exact: ['fruits_and_vegetables', 'farmers_market', 'health_food_store'], like: ['%fruit%', '%vegetable%', '%produce%'] },
  'Farmácia': { exact: ['pharmacy', 'drugstore'], like: ['%pharmacy%', '%drugstore%'] },
  'Restaurante': { exact: [], like: ['%restaurant%', 'steakhouse', 'buffet%'] },
  'Lanchonete': { exact: ['fast_food_restaurant', 'burger_restaurant', 'sandwich_shop', 'snack_bar', 'diner', 'pizza_restaurant'], like: ['%fast_food%', '%burger%', '%sandwich%', '%snack%'] },
  'Bar': { exact: ['bar', 'pub', 'brewery', 'sports_bar', 'cocktail_bar', 'beer_bar'], like: ['%\\_bar', '%\\_pub'] },
  'Café': { exact: ['cafe', 'coffee_shop', 'tea_room', 'smoothie_juice_bar'], like: ['%coffee%'] },
  'Material de construção': { exact: ['building_supply_store', 'hardware_store', 'home_improvement_store', 'lumber_store', 'paint_store'], like: ['%building\\_material%', '%hardware%'] },
  'Roupas': { exact: ['clothing_store', 'fashion_boutique', 'womens_clothing_store', 'mens_clothing_store', 'childrens_clothing_store', 'uniform_store', 'lingerie_store'], like: ['%\\_clothing\\_store'] },
  'Calçados': { exact: ['shoe_store'], like: ['%shoe%'] },
  'Pet shop': { exact: ['pet_store', 'pet_groomer', 'pet_supplies_store'], like: ['%pet\\_store%', '%pet\\_supplies%'] },
  'Salão / Beleza': { exact: ['beauty_salon', 'barber', 'hair_salon', 'nail_salon', 'day_spa', 'spa'], like: ['%hair%', '%beauty%'] },
  'Posto': { exact: ['gas_station', 'fuel_station'], like: ['%gas\\_station%'] },
  'Papelaria': { exact: ['bookstore', 'stationery_store', 'office_supply_store', 'printing_service'], like: ['%stationery%', '%book%'] },
  'Ótica': { exact: ['eyewear_store', 'optician'], like: ['%eyewear%', '%optical%'] },
  'Autopeças': { exact: ['auto_parts_store', 'tire_dealer_and_repair'], like: ['%auto\\_parts%'] },
  'Eletrônicos': { exact: ['electronics_store', 'mobile_phone_store', 'computer_store', 'appliance_store', 'car_stereo_store'], like: ['%electronics%'] },
  'Móveis': { exact: ['furniture_store', 'home_goods_store', 'mattress_store'], like: ['%furniture%'] },
  'Floricultura': { exact: ['flowers_and_gifts_store', 'florist', 'garden_center'], like: ['%flower%'] },
  'Cosméticos': { exact: ['cosmetic_and_beauty_supplies', 'perfume_store'], like: ['%cosmetic%', '%perfum%'] },
  'Atacado / Distribuidor': { exact: ['food_beverage_distributor', 'wholesaler', 'wholesale_store', 'cash_and_carry'], like: ['%wholesale%', '%distributor%'] },
  'Oficina mecânica': { exact: ['automotive_repair', 'auto_body_shop', 'motorcycle_repair', 'auto_glass_service', 'car_wash', 'auto_detailing'], like: ['%\\_repair'] },
  'Saúde': { exact: ['doctors_office', 'hospital', 'general_dentistry', 'dental_clinic', 'medical_center', 'health_care', 'veterinarian', 'laboratory_testing'], like: ['%clinic%', '%dentist%'] },
  'Escola': { exact: ['school', 'elementary_school', 'private_school', 'public_school', 'language_school', 'driving_school', 'preschool', 'college_university'], like: ['%\\_school'] },
  'Lojas': { exact: [], like: ['%\\_store'] },
};

function escLike(s) { return String(s).replace(/[\\%_]/g, m => '\\' + m); }

function formatarFone(f) {
  const d = String(f || '').replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(f || '');
}

// Categoria do Overture (inglês) → rótulo em português, usando as mesmas regras de busca
function rotuloPt(cat) {
  for (const [label, r] of Object.entries(OVT_POR_LABEL)) {
    if (label === 'Lojas' || label === 'Restaurante') continue;
    if (r.exact.includes(cat)) return label;
  }
  if (/restaurant/.test(cat)) return 'Restaurante';
  return humanizar(cat);
}

function humanizar(cat) { return String(cat || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()); }

/**
 * Busca no raio. Retorna array de "elements" no mesmo formato da Overpass (type/id/lat/lon/tags)
 * para reaproveitar o mapeamento da rota; ou null se a base não está disponível/vazia.
 */
async function buscarOverture({ bbox, q, catLabel, centro = null, limite = 600 }) {
  if (Date.now() < _indisponivelAte) return null;
  try {
    const pool = getLugaresPool();
    await comTimeout(garantirTabela(pool));

    const regra = catLabel ? OVT_POR_LABEL[catLabel] : null;
    const cond = [];
    const prm = [bbox.s, bbox.n, bbox.w, bbox.e, CONF_MIN];

    if (regra) {
      if (regra.exact.length) { cond.push(`categoria IN (${regra.exact.map(() => '?').join(',')})`); prm.push(...regra.exact); }
      regra.like.forEach(l => { cond.push('categoria LIKE ?'); prm.push(l); });
    }
    // também pelo nome digitado (ex.: "Padaria X" cadastrada como restaurante), por PALAVRA:
    // termos curtos (≤3 letras, ex.: "bar") só como palavra inteira, senão "bar" casaria com "barbearia".
    const t = escLike(String(q).trim());
    if (t.length <= 3) {
      cond.push('(nome = ? OR nome LIKE ? OR nome LIKE ? OR nome LIKE ?)');
      prm.push(q.trim(), `${t} %`, `% ${t} %`, `% ${t}`);
    } else {
      cond.push('(nome LIKE ? OR nome LIKE ?)');
      prm.push(`${t}%`, `% ${t}%`);
    }
    prm.push(limite);

    const cLat = centro ? centro.lat : (bbox.s + bbox.n) / 2;
    const cLng = centro ? centro.lng : (bbox.w + bbox.e) / 2;
    const k = Math.pow(Math.cos(cLat * Math.PI / 180), 2).toFixed(6);
    const ordem = `((lat - ${Number(cLat).toFixed(6)}) * (lat - ${Number(cLat).toFixed(6)}) + (lng - ${Number(cLng).toFixed(6)}) * (lng - ${Number(cLng).toFixed(6)}) * ${k})`;
    const sql = `SELECT id, nome, categoria, categoria_basica, fone, site, email, endereco, cidade, uf, cep, lat, lng, confianca
                   FROM overture_lugares
                  WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND confianca >= ?
                    AND (${cond.join(' OR ')})
                  ORDER BY ${ordem}
                  LIMIT ?`;
    const [rows] = await comTimeout(pool.query(sql, prm));
    if (!rows.length) return null;

    return rows.map(r => ({
      type: 'ovt', id: r.id, lat: parseFloat(r.lat), lon: parseFloat(r.lng),
      tags: {
        name: r.nome,
        _cat: rotuloPt(r.categoria),
        phone: formatarFone(r.fone),
        website: r.site || undefined,
        email: r.email || undefined,
        'addr:street': r.endereco || undefined,
        'addr:city': r.cidade || undefined,
        'addr:postcode': r.cep || undefined,
      },
    }));
  } catch (e) {
    console.warn('[lugares-overture] indisponível, usando OSM:', e.message);
    _indisponivelAte = Date.now() + PAUSA_APOS_FALHA_MS;
    return null;
  }
}

module.exports = { definirPoolParaTeste, getLugaresPool, garantirTabela, buscarOverture, formatarFone, OVT_POR_LABEL, DDL };
