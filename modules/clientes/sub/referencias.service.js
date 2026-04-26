'use strict';

const { getPool } = require('../../../config/database');

// ─── CACHE DE COLUNAS ─────────────────────────────────────────────────────────

const _cache = {}; // tableName → Set<string> | null

async function _getColunas(conn, tabela) {
  if (tabela in _cache) return _cache[tabela];
  try {
    const [rows] = await conn.query(`DESCRIBE \`${tabela}\``);
    _cache[tabela] = new Set(rows.map(r => r.Field));
  } catch (e) {
    console.error(`[referencias] DESCRIBE '${tabela}':`, e.message);
    _cache[tabela] = null;
  }
  return _cache[tabela];
}

/**
 * Retorna { tabela, cols } da tabela que realmente existe no BD.
 * Tenta Delphi primeiro, depois normalizada.
 */
async function _resolverTabela(conn, tabelaDelphi, tabelaNormal) {
  let cols = await _getColunas(conn, tabelaDelphi);
  if (cols) return { tabela: tabelaDelphi, cols };
  cols = await _getColunas(conn, tabelaNormal);
  if (cols) return { tabela: tabelaNormal, cols };
  console.error(`[referencias] nenhuma tabela encontrada: ${tabelaDelphi} / ${tabelaNormal}`);
  return { tabela: null, cols: null };
}

/**
 * Inicialização lazy: cria as tabelas normalizadas caso não existam no BD.
 * Usa getPool() para evitar DDL dentro de transação (MySQL faria commit implícito).
 */
let _inicializando = false;
let _inicializado  = false;

async function _garantirTabelas() {
  if (_inicializado || _inicializando) return;
  _inicializando = true;
  const pool = getPool();
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ref_bancarias_clientes (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        id_cliente  INT          NOT NULL,
        banco       VARCHAR(100),
        agencia     VARCHAR(30),
        conta       VARCHAR(30),
        fone        VARCHAR(20),
        gerente     VARCHAR(100),
        observacao  VARCHAR(255),
        excluido    CHAR(1)      NOT NULL DEFAULT 'N'
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ref_comerciais_clientes (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        id_cliente  INT          NOT NULL,
        empresa     VARCHAR(200),
        fone        VARCHAR(20),
        contato     VARCHAR(100),
        observacao  VARCHAR(255),
        excluido    CHAR(1)      NOT NULL DEFAULT 'N'
      )
    `);
    // Limpar cache para forçar novo DESCRIBE
    delete _cache['ref_bancarias_clientes'];
    delete _cache['ref_comerciais_clientes'];
    _inicializado = true;
  } catch (e) {
    console.error('[referencias] _garantirTabelas:', e.message);
    _inicializando = false; // permite nova tentativa
  }
}

// ─── REFERÊNCIAS BANCÁRIAS ────────────────────────────────────────────────────

async function buscarRefBancarias(idCliente, pool) {
  const executor = pool || getPool();
  // Tenta tabela Delphi primeiro
  try {
    const [rows] = await executor.query(
      `SELECT * FROM ref_bancariasclientes WHERE id_cliente = ? ORDER BY id`,
      [idCliente]
    );
    return rows.map(r => ({
      ...r,
      banco:   r.banco   || r.nome_banco    || null,
      conta:   r.conta   || r.contacorrente || null,
      gerente: r.gerente || r.contato       || null,
    }));
  } catch { /* tenta normalizada */ }
  // Fallback: tabela normalizada
  const [rows] = await executor.query(
    `SELECT * FROM ref_bancarias_clientes
     WHERE id_cliente = ? AND excluido = 'N' ORDER BY id`,
    [idCliente]
  ).catch(() => [[]]);
  return rows;
}

async function salvarRefBancarias(idCliente, refs, conn) {
  if (!Array.isArray(refs) || refs.length === 0) return;

  await _garantirTabelas();

  const { tabela, cols } = await _resolverTabela(conn, 'ref_bancariasclientes', 'ref_bancarias_clientes');
  if (!tabela) return;

  const temExcluido = cols.has('excluido');

  for (const ref of refs) {
    if (ref.excluido === 'S' || ref._delete) {
      if (ref.id) {
        if (temExcluido) {
          await conn.query(
            `UPDATE \`${tabela}\` SET excluido = 'S' WHERE id = ? AND id_cliente = ?`,
            [ref.id, idCliente]
          ).catch(() => {});
        } else {
          await conn.query(
            `DELETE FROM \`${tabela}\` WHERE id = ? AND id_cliente = ?`,
            [ref.id, idCliente]
          ).catch(() => {});
        }
      }
      continue;
    }

    const dados = { id_cliente: idCliente };
    if (temExcluido) dados.excluido = 'N';

    // Delphi usa '' (vazio) em vez de NULL — evita erro de NOT NULL constraint
    const s = v => (v == null || v === '') ? '' : String(v);
    const n = v => (v == null || v === '') ? null : v; // para tabelas normalizadas

    // banco: Delphi = nome_banco | normalizado = banco
    if (cols.has('nome_banco'))    dados.nome_banco    = s(ref.banco);
    else if (cols.has('banco'))    dados.banco         = n(ref.banco);

    // conta: Delphi = contacorrente | normalizado = conta
    if (cols.has('contacorrente')) dados.contacorrente = s(ref.conta);
    else if (cols.has('conta'))    dados.conta         = n(ref.conta);

    // gerente: Delphi = contato | normalizado = gerente
    if (cols.has('contato'))       dados.contato       = s(ref.gerente);
    else if (cols.has('gerente'))  dados.gerente       = n(ref.gerente);

    if (cols.has('agencia'))    dados.agencia    = s(ref.agencia);
    if (cols.has('fone'))       dados.fone       = s(ref.fone);
    if (cols.has('observacao')) dados.observacao = s(ref.observacao);

    if (ref.id) {
      const entries = Object.entries(dados).filter(([k]) => !['id_cliente','excluido'].includes(k));
      if (entries.length) {
        const set  = entries.map(([k]) => `\`${k}\` = ?`).join(', ');
        const vals = [...entries.map(([,v]) => v), ref.id, idCliente];
        await conn.query(
          `UPDATE \`${tabela}\` SET ${set} WHERE id = ? AND id_cliente = ?`, vals
        ).catch(e => console.error('[refBancarias/update]', e.message));
      }
    } else {
      const entries = Object.entries(dados);
      const colStr  = entries.map(([k]) => `\`${k}\``).join(', ');
      const phStr   = entries.map(() => '?').join(', ');
      const vals    = entries.map(([,v]) => v);
      await conn.query(
        `INSERT INTO \`${tabela}\` (${colStr}) VALUES (${phStr})`, vals
      ).catch(e => console.error('[refBancarias/insert]', e.message));
    }
  }
}

async function excluirRefBancaria(id, conn) {
  const executor = conn || getPool();
  await executor.query(`DELETE FROM ref_bancariasclientes WHERE id = ?`, [id])
    .catch(() =>
      executor.query(`UPDATE ref_bancarias_clientes SET excluido = 'S' WHERE id = ?`, [id])
        .catch(() => {})
    );
}

// ─── REFERÊNCIAS COMERCIAIS ───────────────────────────────────────────────────

async function buscarRefComerciais(idCliente, pool) {
  const executor = pool || getPool();
  try {
    const [rows] = await executor.query(
      `SELECT * FROM ref_comerciaisclientes WHERE id_cliente = ? ORDER BY id`,
      [idCliente]
    );
    return rows.map(r => ({
      ...r,
      empresa: r.empresa || r.nome  || null,
      contato: r.contato || r.email || null,
    }));
  } catch { /* tenta normalizada */ }
  const [rows] = await executor.query(
    `SELECT * FROM ref_comerciais_clientes
     WHERE id_cliente = ? AND excluido = 'N' ORDER BY id`,
    [idCliente]
  ).catch(() => [[]]);
  return rows;
}

async function salvarRefComerciais(idCliente, refs, conn) {
  if (!Array.isArray(refs) || refs.length === 0) return;

  await _garantirTabelas();

  const { tabela, cols } = await _resolverTabela(conn, 'ref_comerciaisclientes', 'ref_comerciais_clientes');
  if (!tabela) return;

  const temExcluido = cols.has('excluido');

  for (const ref of refs) {
    if (ref.excluido === 'S' || ref._delete) {
      if (ref.id) {
        if (temExcluido) {
          await conn.query(
            `UPDATE \`${tabela}\` SET excluido = 'S' WHERE id = ? AND id_cliente = ?`,
            [ref.id, idCliente]
          ).catch(() => {});
        } else {
          await conn.query(
            `DELETE FROM \`${tabela}\` WHERE id = ? AND id_cliente = ?`,
            [ref.id, idCliente]
          ).catch(() => {});
        }
      }
      continue;
    }

    const dados = { id_cliente: idCliente };
    if (temExcluido) dados.excluido = 'N';

    // Delphi usa '' (vazio) em vez de NULL — evita erro de NOT NULL constraint
    const s = v => (v == null || v === '') ? '' : String(v);
    const n = v => (v == null || v === '') ? null : v;

    // empresa: Delphi = nome | normalizado = empresa
    if (cols.has('nome'))          dados.nome    = s(ref.empresa);
    else if (cols.has('empresa'))  dados.empresa = n(ref.empresa);

    // contato: Delphi = email | normalizado = contato
    if (cols.has('email'))         dados.email   = s(ref.contato);
    else if (cols.has('contato'))  dados.contato = n(ref.contato);

    if (cols.has('fone'))       dados.fone       = s(ref.fone);
    if (cols.has('observacao')) dados.observacao = s(ref.observacao);

    if (ref.id) {
      const entries = Object.entries(dados).filter(([k]) => !['id_cliente','excluido'].includes(k));
      if (entries.length) {
        const set  = entries.map(([k]) => `\`${k}\` = ?`).join(', ');
        const vals = [...entries.map(([,v]) => v), ref.id, idCliente];
        await conn.query(
          `UPDATE \`${tabela}\` SET ${set} WHERE id = ? AND id_cliente = ?`, vals
        ).catch(e => console.error('[refComerciais/update]', e.message));
      }
    } else {
      const entries = Object.entries(dados);
      const colStr  = entries.map(([k]) => `\`${k}\``).join(', ');
      const phStr   = entries.map(() => '?').join(', ');
      const vals    = entries.map(([,v]) => v);
      await conn.query(
        `INSERT INTO \`${tabela}\` (${colStr}) VALUES (${phStr})`, vals
      ).catch(e => console.error('[refComerciais/insert]', e.message));
    }
  }
}

async function excluirRefComercial(id, conn) {
  const executor = conn || getPool();
  await executor.query(`DELETE FROM ref_comerciaisclientes WHERE id = ?`, [id])
    .catch(() =>
      executor.query(`UPDATE ref_comerciais_clientes SET excluido = 'S' WHERE id = ?`, [id])
        .catch(() => {})
    );
}

module.exports = {
  buscarRefBancarias,
  salvarRefBancarias,
  excluirRefBancaria,
  buscarRefComerciais,
  salvarRefComerciais,
  excluirRefComercial,
};
