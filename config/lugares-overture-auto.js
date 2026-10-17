'use strict';
/**
 * Carga AUTOMÁTICA da base de comércios (Overture Maps) por região.
 *
 * Ninguém precisa rodar comando: quando um usuário abre o mapa ou busca comércios, o servidor
 * descobre a "célula" (~28 km) onde ele está e, se ela ainda não foi carregada (ou está velha),
 * baixa só essa área em segundo plano. Enquanto isso a busca usa o OpenStreetMap.
 * As células ficam registradas em `overture_regioes` e valem para todos os clientes.
 *
 * Requer o pacote @duckdb/node-api (já em package.json). Se não estiver disponível
 * (ex.: executável .exe do pkg), tudo continua funcionando só com OpenStreetMap.
 */
const { getLugaresPool, garantirTabela } = require('./lugares-overture');

const CELULA = 0.25;                       // graus (~28 km)
const VALIDADE_DIAS = 40;                  // recarrega em segundo plano depois disso
const ERRO_ESPERA_MS = 60 * 60 * 1000;     // após falha, só tenta de novo em 1 h
const MAX_FILA = 4;
const CONF_MIN = parseFloat(process.env.OVERTURE_CONF_MIN || '0.4');
const BRASIL = { w: -74.5, e: -32.0, s: -34.0, n: 6.0 };

const DDL_REGIOES = `
  CREATE TABLE IF NOT EXISTS overture_regioes (
    celula        VARCHAR(30)  NOT NULL PRIMARY KEY,
    status        VARCHAR(10)  NOT NULL DEFAULT 'ok',
    linhas        INT          NOT NULL DEFAULT 0,
    release_ver   VARCHAR(20)  NOT NULL DEFAULT '',
    erro          VARCHAR(255) NOT NULL DEFAULT '',
    atualizado_em DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

const _emMemoria = new Map();   // celula -> { status: 'pronto'|'carregando'|'erro', ate: ts }
const _fila = [];
let _rodando = false;
let _tabelaRegioesOk = false;

function duckdbDisponivel() {
  try { require.resolve('@duckdb/node-api'); return true; } catch (_) { return false; }
}

function celulaDe(lat, lng) {
  const x = Math.floor((lng + 180) / CELULA);
  const y = Math.floor((lat + 90) / CELULA);
  return {
    key: `${y}_${x}`,
    nome: `célula ${y}_${x}`,
    w: x * CELULA - 180, e: (x + 1) * CELULA - 180,
    s: y * CELULA - 90, n: (y + 1) * CELULA - 90,
  };
}

async function garantirTabelaRegioes(pool) {
  if (_tabelaRegioesOk) return;
  await pool.query(DDL_REGIOES);
  _tabelaRegioesOk = true;
}

async function processarFila() {
  if (_rodando) return;
  const cel = _fila.shift();
  if (!cel) return;
  _rodando = true;
  const pool = getLugaresPool();
  const t0 = Date.now();
  try {
    console.log(`[lugares-auto] carregando ${cel.nome} [${cel.w}, ${cel.s}, ${cel.e}, ${cel.n}]...`);
    const { importar } = require('../scripts/overture-importar');
    const r = await importar({
      pool, regioes: [{ nome: cel.nome, w: cel.w, s: cel.s, e: cel.e, n: cel.n }],
      conf: CONF_MIN, limpar: true, log: () => {},
    });
    const linhas = (r.resumo[0] && r.resumo[0].gravados) || 0;
    await pool.query(
      `INSERT INTO overture_regioes (celula, status, linhas, release_ver, erro, atualizado_em)
       VALUES (?, 'ok', ?, ?, '', NOW())
       ON DUPLICATE KEY UPDATE status='ok', linhas=VALUES(linhas), release_ver=VALUES(release_ver), erro='', atualizado_em=NOW()`,
      [cel.key, linhas, r.release]
    );
    _emMemoria.set(cel.key, { status: 'pronto', ate: Date.now() + 10 * 60 * 1000 });
    console.log(`[lugares-auto] ${cel.nome} pronta: ${linhas} lugares em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  } catch (e) {
    console.warn(`[lugares-auto] falha em ${cel.nome}:`, e.message);
    _emMemoria.set(cel.key, { status: 'erro', ate: Date.now() + ERRO_ESPERA_MS });
    try {
      await pool.query(
        `INSERT INTO overture_regioes (celula, status, erro, atualizado_em) VALUES (?, 'erro', ?, NOW())
         ON DUPLICATE KEY UPDATE status = IF(status='ok', status, 'erro'), erro=VALUES(erro), atualizado_em = IF(status='ok', atualizado_em, NOW())`,
        [cel.key, String(e.message).slice(0, 250)]
      );
    } catch (_) { /* sem banco: ignora */ }
  } finally {
    _rodando = false;
    setImmediate(processarFila);
  }
}

function enfileirar(cel) {
  if (_fila.some(c => c.key === cel.key)) return;
  if (_fila.length >= MAX_FILA) return;
  _emMemoria.set(cel.key, { status: 'carregando', ate: Date.now() + 30 * 60 * 1000 });
  _fila.push(cel);
  setImmediate(processarFila);
}

/**
 * Situação da região do ponto e, se preciso, dispara a carga em segundo plano.
 * Retorna 'pronto' | 'carregando' | 'indisponivel'. Nunca lança erro e responde rápido.
 */
async function statusRegiao(lat, lng) {
  try {
    if (!isFinite(lat) || !isFinite(lng)) return 'indisponivel';
    if (lng < BRASIL.w || lng > BRASIL.e || lat < BRASIL.s || lat > BRASIL.n) return 'indisponivel';
    const cel = celulaDe(lat, lng);

    const mem = _emMemoria.get(cel.key);
    if (mem && mem.ate > Date.now()) {
      if (mem.status === 'pronto') return 'pronto';
      if (mem.status === 'carregando') return 'carregando';
      if (mem.status === 'erro') return 'indisponivel';
    }

    if (!duckdbDisponivel()) return 'indisponivel';

    const pool = getLugaresPool();
    await garantirTabela(pool);
    await garantirTabelaRegioes(pool);
    const [rows] = await pool.query('SELECT status, atualizado_em FROM overture_regioes WHERE celula = ?', [cel.key]);
    const r = rows[0];

    if (r && r.status === 'ok') {
      const idadeDias = (Date.now() - new Date(r.atualizado_em).getTime()) / 86400000;
      if (idadeDias > VALIDADE_DIAS) enfileirar(cel);          // atualiza em segundo plano, segue usando o que já tem
      _emMemoria.set(cel.key, { status: 'pronto', ate: Date.now() + 10 * 60 * 1000 });
      return 'pronto';
    }
    if (r && r.status === 'erro') {
      const idadeMs = Date.now() - new Date(r.atualizado_em).getTime();
      if (idadeMs < ERRO_ESPERA_MS) return 'indisponivel';
    }

    // Já existem dados nessa célula (ex.: carga manual feita antes)? Então só registra.
    const [tem] = await pool.query(
      'SELECT 1 FROM overture_lugares WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? LIMIT 1',
      [cel.s + 0.01, cel.n - 0.01, cel.w + 0.01, cel.e - 0.01]
    );
    if (tem.length) {
      await pool.query(
        `INSERT INTO overture_regioes (celula, status, linhas, atualizado_em) VALUES (?, 'ok', 0, NOW())
         ON DUPLICATE KEY UPDATE status='ok', atualizado_em=NOW()`, [cel.key]);
      _emMemoria.set(cel.key, { status: 'pronto', ate: Date.now() + 10 * 60 * 1000 });
      return 'pronto';
    }

    enfileirar(cel);
    return 'carregando';
  } catch (e) {
    console.warn('[lugares-auto] statusRegiao:', e.message);
    return 'indisponivel';
  }
}

module.exports = { statusRegiao, celulaDe, duckdbDisponivel };
