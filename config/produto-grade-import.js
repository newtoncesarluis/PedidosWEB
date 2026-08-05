'use strict';

/**
 * Resolve texto de grade da planilha (ex.: P/M/G/GG, 46/48/50) → tipograde.id.
 * 1) Busca grade já cadastrada (nome/apelido ou mesmos tamanhos).
 * 2) Se não achar e o texto tiver tamanhos (não for só id numérico), cria a grade
 *    + itens em descricao_grades e vincula ao produto.
 */

const { ensureTipogradeColunas } = require('./tipograde-colunas');

const _cacheByDb = new Map();
const CACHE_MS = 60_000;

function normGradeKey(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/[\s_\-./\\|,;]+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
}

/** Tokens ordenados (ordem da planilha) — para criar itens. */
function tokensGradeOrdered(s) {
  const k = normGradeKey(s);
  if (!k) return [];
  return k.split('/').map((t) => t.trim()).filter(Boolean);
}

/** Tokens ordenados alfabeticamente — para match de tamanhos. */
function tokensGrade(s) {
  return tokensGradeOrdered(s).slice().sort();
}

function tokensKey(tokens) {
  return tokens.length ? tokens.join('/') : '';
}

async function _dbName(conn) {
  try {
    const [[row]] = await conn.query('SELECT DATABASE() AS db');
    if (row && row.db) return String(row.db);
  } catch (_) { /* ignore */ }
  return '_';
}

async function loadGradeIndex(conn) {
  const dbName = await _dbName(conn);
  const hit = _cacheByDb.get(dbName);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.index;

  const [grades] = await conn.query(
    `SELECT id, nome, apelido FROM tipograde
     WHERE (excluido = 'N' OR excluido IS NULL OR excluido = '')
       AND (status = 'A' OR status IS NULL OR status = '')`
  ).catch(() => [[]]);

  const [itens] = await conn.query(
    `SELECT id_grade, nome FROM descricao_grades
     WHERE (excluido = 'N' OR excluido IS NULL OR excluido = '')
     ORDER BY sequencial, nome`
  ).catch(() => [[]]);

  const itensByGrade = new Map();
  for (const it of itens) {
    const gid = parseInt(String(it.id_grade), 10);
    if (!gid) continue;
    if (!itensByGrade.has(gid)) itensByGrade.set(gid, []);
    const nm = String(it.nome || '').trim();
    if (nm) itensByGrade.get(gid).push(nm);
  }

  const byId = new Map();
  const byNome = new Map();
  const byTokens = new Map();

  for (const g of grades) {
    const id = parseInt(String(g.id), 10);
    if (!id) continue;
    byId.set(id, id);

    const kn = normGradeKey(g.nome);
    const ka = normGradeKey(g.apelido);
    if (kn && !byNome.has(kn)) byNome.set(kn, id);
    if (ka && !byNome.has(ka)) byNome.set(ka, id);

    const fromItens = tokensKey(tokensGrade((itensByGrade.get(id) || []).join('/')));
    if (fromItens && !byTokens.has(fromItens)) byTokens.set(fromItens, id);

    const fromNome = tokensKey(tokensGrade(g.nome));
    if (fromNome && !byTokens.has(fromNome)) byTokens.set(fromNome, id);
    const fromApel = tokensKey(tokensGrade(g.apelido));
    if (fromApel && !byTokens.has(fromApel)) byTokens.set(fromApel, id);
  }

  const index = { byId, byNome, byTokens };
  _cacheByDb.set(dbName, { at: Date.now(), index });
  return index;
}

function matchGradeNoIndex(index, raw) {
  if (/^\d+$/.test(raw)) {
    const id = parseInt(raw, 10);
    if (index.byId.has(id)) return id;
    return null;
  }
  const keyNome = normGradeKey(raw);
  if (keyNome && index.byNome.has(keyNome)) return index.byNome.get(keyNome);
  const tok = tokensKey(tokensGrade(raw));
  if (tok && index.byTokens.has(tok)) return index.byTokens.get(tok);
  return null;
}

/**
 * Cria tipograde + descricao_grades a partir do texto da planilha.
 * @returns {Promise<number>} id da grade
 */
async function criarGradeFromImport(conn, raw) {
  const tokens = tokensGradeOrdered(raw);
  if (!tokens.length) {
    throw new Error(`Não foi possível criar a grade «${raw}»: sem tamanhos válidos.`);
  }

  await ensureTipogradeColunas(conn);

  const nome = tokens.join('/');
  const apelido = nome.length <= 40 ? nome : tokens.slice(0, 4).join('/');

  const [result] = await conn.query(
    `INSERT INTO tipograde (nome, apelido, tipo, qtnumero, status, excluido, modo_grade, multiplo_grade)
     VALUES (?, ?, 'R', ?, 'A', 'N', 'A', 0)`,
    [nome, apelido, tokens.length]
  );
  const gradeId = result.insertId;

  for (let i = 0; i < tokens.length; i++) {
    await conn.query(
      `INSERT INTO descricao_grades (id_grade, nome, sequencial, excluido, qtd_minima)
       VALUES (?, ?, ?, 'N', 0)`,
      [gradeId, tokens[i], i + 1]
    );
  }

  resetGradeImportCache(await _dbName(conn));
  return gradeId;
}

/**
 * Só consulta (não cria) — usado no Validar Dados da importação.
 * @returns {{ vazia: boolean, existe: boolean, id?: number, idInexistente?: boolean }}
 */
async function checarGradeImport(conn, valor) {
  const raw = valor == null ? '' : String(valor).trim();
  if (!raw) return { vazia: true, existe: true };
  const index = await loadGradeIndex(conn);
  const id = matchGradeNoIndex(index, raw);
  if (id) return { vazia: false, existe: true, id };
  if (/^\d+$/.test(raw)) return { vazia: false, existe: false, idInexistente: true };
  return { vazia: false, existe: false };
}

/**
 * @returns {{ ok: true, id: number|null|undefined, criada?: boolean } | { ok: false, error: string }}
 * id undefined = célula vazia (não alterar)
 */
async function resolverGradeImport(conn, valor) {
  const raw = valor == null ? '' : String(valor).trim();
  if (!raw) return { ok: true, id: undefined };

  let index = await loadGradeIndex(conn);
  let id = matchGradeNoIndex(index, raw);
  if (id) return { ok: true, id };

  // Id numérico inexistente: não inventa grade
  if (/^\d+$/.test(raw)) {
    return {
      ok: false,
      error: `Grade id ${raw} não encontrada no cadastro. Cadastre em Cadastros → Grades ou informe os tamanhos (ex.: P/M/G/GG).`,
    };
  }

  const tokens = tokensGradeOrdered(raw);
  if (!tokens.length) {
    return {
      ok: false,
      error: `Grade «${raw}» inválida — informe tamanhos separados (ex.: P/M/G/GG ou 46/48/50).`,
    };
  }

  // Revalida sem cache (outra linha da importação pode ter criado agora)
  resetGradeImportCache(await _dbName(conn));
  index = await loadGradeIndex(conn);
  id = matchGradeNoIndex(index, raw);
  if (id) return { ok: true, id };

  try {
    const novoId = await criarGradeFromImport(conn, raw);
    return { ok: true, id: novoId, criada: true };
  } catch (e) {
    return {
      ok: false,
      error: e.message || `Falha ao criar grade «${raw}».`,
    };
  }
}

function resetGradeImportCache(dbName) {
  if (dbName) _cacheByDb.delete(dbName);
  else _cacheByDb.clear();
}

module.exports = {
  resolverGradeImport,
  checarGradeImport,
  criarGradeFromImport,
  normGradeKey,
  tokensGrade,
  tokensGradeOrdered,
  resetGradeImportCache,
};
