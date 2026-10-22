'use strict';
/**
 * "Busca profunda" por CNAE — base aberta da Receita Federal (CNPJ), gratuita.
 *
 * A tabela `receita_estabelecimentos` fica no mesmo banco dos lugares do Overture (ver getLugaresPool)
 * e é carregada por `scripts/receita-importar.js` (opcional; só quem usar a busca profunda precisa).
 * A base não traz coordenadas: elas são descobertas sob demanda (geocodificação) e guardadas aqui.
 */
const { getLugaresPool } = require('./lugares-overture');

const DDL = `
  CREATE TABLE IF NOT EXISTS receita_estabelecimentos (
    cnpj         CHAR(14)     NOT NULL PRIMARY KEY,
    razao_social VARCHAR(200) NOT NULL DEFAULT '',
    fantasia     VARCHAR(200) NOT NULL DEFAULT '',
    cnae         CHAR(7)      NOT NULL DEFAULT '',
    cnae_desc    VARCHAR(200) NOT NULL DEFAULT '',
    abertura     DATE         NULL,
    porte        VARCHAR(40)  NOT NULL DEFAULT '',
    capital      DECIMAL(16,2) NULL,
    matriz       TINYINT      NOT NULL DEFAULT 1,
    uf           CHAR(2)      NOT NULL DEFAULT '',
    cidade       VARCHAR(100) NOT NULL DEFAULT '',
    cidade_norm  VARCHAR(100) NOT NULL DEFAULT '',
    bairro       VARCHAR(100) NOT NULL DEFAULT '',
    cep          CHAR(8)      NOT NULL DEFAULT '',
    endereco     VARCHAR(255) NOT NULL DEFAULT '',
    fone         VARCHAR(30)  NOT NULL DEFAULT '',
    email        VARCHAR(150) NOT NULL DEFAULT '',
    lat          DECIMAL(9,6) NULL,
    lng          DECIMAL(9,6) NULL,
    geo_tentou   TINYINT      NOT NULL DEFAULT 0,
    release_ver  VARCHAR(10)  NOT NULL DEFAULT '',
    INDEX idx_rec_cid (uf, cidade_norm, cnae),
    INDEX idx_rec_cnae (uf, cnae),
    INDEX idx_rec_cep (cep)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const _ok = new WeakSet();
async function garantirTabela(pool) {
  if (_ok.has(pool)) return;
  await pool.query(DDL);
  // bancos criados pela primeira versão tinham porte VARCHAR(20) — curto para "Empresa de pequeno porte"
  await pool.query("ALTER TABLE receita_estabelecimentos MODIFY porte VARCHAR(40) NOT NULL DEFAULT ''").catch(() => {});
  _ok.add(pool);
}

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normCidade = (s) => semAcento(s).toUpperCase().replace(/\s+/g, ' ').trim();

const UF_POR_NOME = {
  'ACRE': 'AC', 'ALAGOAS': 'AL', 'AMAPA': 'AP', 'AMAZONAS': 'AM', 'BAHIA': 'BA', 'CEARA': 'CE', 'DISTRITO FEDERAL': 'DF', 'ESPIRITO SANTO': 'ES',
  'GOIAS': 'GO', 'MARANHAO': 'MA', 'MATO GROSSO': 'MT', 'MATO GROSSO DO SUL': 'MS', 'MINAS GERAIS': 'MG', 'PARA': 'PA', 'PARAIBA': 'PB', 'PARANA': 'PR',
  'PERNAMBUCO': 'PE', 'PIAUI': 'PI', 'RIO DE JANEIRO': 'RJ', 'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', 'RONDONIA': 'RO', 'RORAIMA': 'RR',
  'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', 'SERGIPE': 'SE', 'TOCANTINS': 'TO',
};
const ufDe = (estado) => {
  const n = normCidade(estado);
  return n.length === 2 ? n : (UF_POR_NOME[n] || '');
};

// ── Tipo de negócio → prefixos de CNAE (divisão = 2 dígitos, grupo/classe = 4) ──
// Indústria: divisões 10–33 (transformação). Cada setor usa as divisões que o definem.
const CNAE_INDUSTRIA = {
  'Química': ['20'], 'Eletrônica': ['26', '27'], 'Alimentícia': ['10', '11'], 'Metalúrgica': ['24', '25', '28'],
  'Têxtil / Confecção': ['13', '14', '15'], 'Plástico / Embalagem': ['22'], 'Madeira / Móveis': ['16', '31'],
  'Farmacêutica': ['21'], 'Papel / Gráfica': ['17', '18'], 'Cerâmica / Vidro / Cimento': ['23'],
};
const CNAE_INDUSTRIA_GERAL = ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31', '32', '33'];
const CNAE_POR_LABEL = {
  'Indústria / Fábrica': CNAE_INDUSTRIA_GERAL,
  'Açougue': ['4722'], 'Padaria': ['1091', '4721'], 'Supermercado': ['4711', '4712'], 'Mercearia': ['4712', '4729'], 'Hortifruti': ['4724'],
  'Farmácia': ['4771'], 'Restaurante': ['5611'], 'Lanchonete': ['5611', '5612'], 'Bar': ['5611'], 'Café': ['5611'],
  'Tintas': ['4744'], 'Elétrica / Iluminação': ['4742', '4753', '4759'], 'Bebidas / Adega': ['4723'], 'Agropecuária': ['4623', '4683', '4789'],
  'Brinquedos': ['4763'], 'Bazar / Armarinho': ['4755', '4759', '4789'], 'Material de construção': ['4741', '4742', '4744'],
  'Roupas': ['4781'], 'Calçados': ['4782'], 'Pet shop': ['4789'], 'Salão / Beleza': ['9602'], 'Posto': ['4731'],
  'Papelaria': ['4761', '4762'], 'Ótica': ['4774'], 'Hotel': ['5510'], 'Academia': ['9313'],
};

/** Prefixos de CNAE para o que foi pedido (categoria detectada + setor industrial), ou null se não há mapa. */
function prefixosCnae(catLabel, segLabel) {
  if (segLabel && CNAE_INDUSTRIA[segLabel]) return CNAE_INDUSTRIA[segLabel];
  return (catLabel && CNAE_POR_LABEL[catLabel]) || null;
}

const fmtCnpj = (c) => String(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const fmtCep = (c) => String(c || '').replace(/^(\d{5})(\d{3})$/, '$1-$2');

function condCnae(prefixos) {
  return { sql: '(' + prefixos.map(() => 'cnae LIKE ?').join(' OR ') + ')', prm: prefixos.map((p) => p + '%') };
}

/** Há dados dessa UF carregados para esses CNAEs? */
async function temBase(uf, prefixos) {
  const pool = getLugaresPool();
  await garantirTabela(pool);
  const c = condCnae(prefixos);
  const [r] = await pool.query(`SELECT 1 FROM receita_estabelecimentos WHERE uf = ? AND ${c.sql} LIMIT 1`, [uf, ...c.prm]);
  return r.length > 0;
}

/** Candidatas de uma cidade, ordenadas pela proximidade do CEP (quando há) — as já geocodificadas primeiro entram nos filtros do chamador. */
async function candidatas({ uf, cidadeNorm, prefixos, cepRef = null, limite = 5000 }) {
  const pool = getLugaresPool();
  await garantirTabela(pool);
  const c = condCnae(prefixos);
  const ref = cepRef ? parseInt(String(cepRef).replace(/\D/g, '').padEnd(8, '0').slice(0, 8), 10) : null;
  const ordem = ref ? `ABS(CAST(cep AS SIGNED) - ${ref})` : 'cnpj';
  const [rows] = await pool.query(
    `SELECT cnpj, razao_social, fantasia, cnae, cnae_desc, abertura, porte, capital, matriz, uf, cidade, bairro, cep, endereco, fone, email, lat, lng, geo_tentou
       FROM receita_estabelecimentos
      WHERE uf = ? AND cidade_norm = ? AND ${c.sql}
      ORDER BY (lat IS NULL), ${ordem}
      LIMIT ?`,
    [uf, cidadeNorm, ...c.prm, limite]
  );
  return rows;
}

async function gravarPosicao(cnpj, lat, lng) {
  const pool = getLugaresPool();
  await pool.query('UPDATE receita_estabelecimentos SET lat = ?, lng = ?, geo_tentou = 1 WHERE cnpj = ?', [lat, lng, cnpj]);
}
async function marcarTentou(cnpj) {
  const pool = getLugaresPool();
  await pool.query('UPDATE receita_estabelecimentos SET geo_tentou = 1 WHERE cnpj = ?', [cnpj]);
}

module.exports = {
  DDL, garantirTabela, normCidade, ufDe, prefixosCnae, fmtCnpj, fmtCep, temBase, candidatas, gravarPosicao, marcarTentou,
  CNAE_INDUSTRIA, CNAE_INDUSTRIA_GERAL, CNAE_POR_LABEL,
};
