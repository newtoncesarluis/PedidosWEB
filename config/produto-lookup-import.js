'use strict';

/**
 * Resolve + auto-cria auxiliares na importação de preços/produtos.
 * Célula vazia → não altera. Texto inexistente → cadastra e devolve valor p/ gravar no produto.
 */

const { ensureProdutoAuxiliares, normKey } = require('./produto-auxiliares-schema');

function codigoFromDesc(desc) {
  return normKey(desc).replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'ITEM';
}

/**
 * @returns {{ ok:true, value?: any, criada?: boolean, skip?: boolean } | { ok:false, error:string }}
 * skip=true → célula vazia (não alterar campo)
 */
async function resolverAuxCodigoDesc(conn, opts) {
  const { table, valor, store = 'codigo' } = opts;
  const raw = valor == null ? '' : String(valor).trim();
  if (!raw) return { ok: true, skip: true };

  await ensureProdutoAuxiliares(conn);
  const key = normKey(raw);
  const codTry = codigoFromDesc(raw);

  const [[hit]] = await conn.query(
    `SELECT id, codigo, descricao FROM \`${table}\`
     WHERE COALESCE(excluido,'N')='N'
       AND (
         UPPER(TRIM(codigo)) = ?
         OR UPPER(TRIM(descricao)) = ?
         OR UPPER(TRIM(codigo)) = ?
       )
     ORDER BY id ASC LIMIT 1`,
    [key, key, codTry]
  ).catch(() => [[null]]);

  if (hit) {
    const value = store === 'id' ? hit.id : (store === 'descricao' ? hit.descricao : hit.codigo);
    return { ok: true, value, id: hit.id, criada: false };
  }

  const codigo = codTry;
  const descricao = raw.toUpperCase();
  try {
    const [ins] = await conn.query(
      `INSERT INTO \`${table}\` (codigo, descricao, ordem, status, excluido) VALUES (?,?,0,'A','N')`,
      [codigo, descricao]
    );
    const value = store === 'id' ? ins.insertId : (store === 'descricao' ? descricao : codigo);
    return { ok: true, value, id: ins.insertId, criada: true };
  } catch (e) {
    // Corrida: outro insert ganhou
    const [[again]] = await conn.query(
      `SELECT id, codigo, descricao FROM \`${table}\`
       WHERE COALESCE(excluido,'N')='N' AND (UPPER(TRIM(codigo))=? OR UPPER(TRIM(descricao))=?)
       LIMIT 1`,
      [codigo, key]
    ).catch(() => [[null]]);
    if (again) {
      const value = store === 'id' ? again.id : (store === 'descricao' ? again.descricao : again.codigo);
      return { ok: true, value, id: again.id, criada: false };
    }
    return { ok: false, error: e.message || `Falha ao criar ${table}` };
  }
}

async function resolverGrupoImport(conn, valor) {
  const raw = valor == null ? '' : String(valor).trim();
  if (!raw) return { ok: true, skip: true };
  await ensureProdutoAuxiliares(conn);
  const key = normKey(raw);
  const [[hit]] = await conn.query(
    `SELECT id, descricao FROM grupos
     WHERE COALESCE(excluido,'N')='N' AND UPPER(TRIM(descricao))=?
     LIMIT 1`,
    [key]
  ).catch(() => [[null]]);
  if (hit) return { ok: true, id: hit.id, descricao: hit.descricao, criada: false };

  try {
    const [ins] = await conn.query(
      `INSERT INTO grupos (descricao, ativo, excluido) VALUES (?,'SIM','N')`,
      [raw.toUpperCase()]
    );
    return { ok: true, id: ins.insertId, descricao: raw.toUpperCase(), criada: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Falha ao criar grupo' };
  }
}

async function resolverLocalImport(conn, valor) {
  const raw = valor == null ? '' : String(valor).trim();
  if (!raw) return { ok: true, skip: true };
  if (/^\d+$/.test(raw)) {
    const id = parseInt(raw, 10);
    const [[hit]] = await conn.query(
      `SELECT id FROM local_armazenamento WHERE id=? AND COALESCE(excluido,'N')='N' LIMIT 1`,
      [id]
    ).catch(() => [[null]]);
    if (hit) return { ok: true, id: hit.id, criada: false };
    return { ok: false, error: `Local id ${id} não encontrado` };
  }
  await ensureProdutoAuxiliares(conn);
  const key = normKey(raw);
  const [[hit]] = await conn.query(
    `SELECT id, nome_local FROM local_armazenamento
     WHERE COALESCE(excluido,'N')='N' AND UPPER(TRIM(nome_local))=? LIMIT 1`,
    [key]
  ).catch(() => [[null]]);
  if (hit) return { ok: true, id: hit.id, criada: false };
  try {
    const [ins] = await conn.query(
      `INSERT INTO local_armazenamento (nome_local, excluido, status) VALUES (?,'N','A')`,
      [raw.toUpperCase()]
    );
    return { ok: true, id: ins.insertId, criada: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Falha ao criar local' };
  }
}

async function resolverCategoriaImport(conn, valor) {
  const raw = valor == null ? '' : String(valor).trim();
  if (!raw) return { ok: true, skip: true };
  const key = normKey(raw);
  const [[hit]] = await conn.query(
    `SELECT id, descricao FROM categoria
     WHERE COALESCE(excluido,'N')='N' AND UPPER(TRIM(descricao))=? LIMIT 1`,
    [key]
  ).catch(() => [[null]]);
  if (hit) return { ok: true, value: hit.descricao, id: hit.id, criada: false };
  try {
    const [ins] = await conn.query(
      `INSERT INTO categoria (descricao, status, excluido) VALUES (?,'A','N')`,
      [raw.toUpperCase()]
    ).catch(async () => {
      // algumas bases não têm status
      return conn.query(`INSERT INTO categoria (descricao, excluido) VALUES (?,'N')`, [raw.toUpperCase()]);
    });
    return { ok: true, value: raw.toUpperCase(), id: ins.insertId, criada: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Falha ao criar categoria' };
  }
}

async function resolverFamiliaImport(conn, valor) {
  const raw = valor == null ? '' : String(valor).trim();
  if (!raw) return { ok: true, skip: true };
  if (/^\d+$/.test(raw)) {
    const id = parseInt(raw, 10);
    const [[hit]] = await conn.query(
      `SELECT id, nome FROM familia_produtos WHERE id=? AND COALESCE(excluido,'N')='N' LIMIT 1`,
      [id]
    ).catch(() => [[null]]);
    if (hit) return { ok: true, id: hit.id, criada: false };
    return { ok: false, error: `Família id ${id} não encontrada` };
  }
  const key = normKey(raw);
  const [[hit]] = await conn.query(
    `SELECT id, nome FROM familia_produtos
     WHERE COALESCE(excluido,'N')='N' AND UPPER(TRIM(nome))=? LIMIT 1`,
    [key]
  ).catch(() => [[null]]);
  if (hit) return { ok: true, id: hit.id, criada: false };
  try {
    const [ins] = await conn.query(
      `INSERT INTO familia_produtos (nome, status, informar_nota, excluido) VALUES (?,'A','N','N')`,
      [raw.toUpperCase()]
    );
    return { ok: true, id: ins.insertId, criada: true };
  } catch (e) {
    return { ok: false, error: e.message || 'Falha ao criar família' };
  }
}

/**
 * Aplica campos virtuais/auxiliares de importação em dadosParaSalvar.
 * Campos tratados: grupo, subfamilia, unidade, tipoprodutograde/tipo_grade,
 * local/id_endereco, segmento/categoria, familia/id_familiaproduto
 */
async function aplicarLookupsImportProduto(conn, dadosParaSalvar) {
  const avisos = [];

  // Grupo (texto → id + nome_grupo)
  if (Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'grupo') ||
      Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'nome_grupo')) {
    const raw = dadosParaSalvar.grupo != null ? dadosParaSalvar.grupo : dadosParaSalvar.nome_grupo;
    delete dadosParaSalvar.grupo;
    if (dadosParaSalvar.nome_grupo != null && raw === dadosParaSalvar.nome_grupo) {
      /* keep for resolver */
    }
    const r = await resolverGrupoImport(conn, raw);
    delete dadosParaSalvar.nome_grupo;
    if (!r.ok) return r;
    if (!r.skip) {
      dadosParaSalvar.id_grupo = String(r.id);
      dadosParaSalvar.nome_grupo = r.descricao;
      if (r.criada) avisos.push(`Grupo «${r.descricao}» criado`);
    }
  }

  // Subfamília
  if (Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'subfamilia')) {
    const r = await resolverAuxCodigoDesc(conn, {
      table: 'subfamilia_produto',
      valor: dadosParaSalvar.subfamilia,
      store: 'codigo',
    });
    if (!r.ok) return r;
    if (r.skip) delete dadosParaSalvar.subfamilia;
    else {
      dadosParaSalvar.subfamilia = r.value;
      if (r.criada) avisos.push(`Subfamília «${r.value}» criada`);
    }
  }

  // Unidade
  if (Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'unidade')) {
    const r = await resolverAuxCodigoDesc(conn, {
      table: 'unidade_produto',
      valor: dadosParaSalvar.unidade,
      store: 'codigo',
    });
    if (!r.ok) return r;
    if (r.skip) delete dadosParaSalvar.unidade;
    else {
      dadosParaSalvar.unidade = r.value;
      if (r.criada) avisos.push(`Unidade «${r.value}» criada`);
    }
  }

  // Tipo de grade (tipoprodutograde)
  const tipoKey = Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'tipoprodutograde')
    ? 'tipoprodutograde'
    : (Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'tipo_grade') ? 'tipo_grade' : null);
  if (tipoKey) {
    const r = await resolverAuxCodigoDesc(conn, {
      table: 'tipo_produto_grade',
      valor: dadosParaSalvar[tipoKey],
      store: 'codigo',
    });
    delete dadosParaSalvar.tipo_grade;
    if (!r.ok) return r;
    if (r.skip) delete dadosParaSalvar.tipoprodutograde;
    else {
      dadosParaSalvar.tipoprodutograde = r.value;
      if (r.criada) avisos.push(`Tipo de grade «${r.value}» criado`);
    }
  }

  // Local
  if (Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'local') ||
      Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'local_armazenamento') ||
      Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'id_endereco')) {
    const raw = dadosParaSalvar.local != null
      ? dadosParaSalvar.local
      : (dadosParaSalvar.local_armazenamento != null
        ? dadosParaSalvar.local_armazenamento
        : dadosParaSalvar.id_endereco);
    delete dadosParaSalvar.local;
    delete dadosParaSalvar.local_armazenamento;
    // se id_endereco já é numérico e existe, ok; senão resolve texto
    const r = await resolverLocalImport(conn, raw);
    if (!r.ok) return r;
    if (r.skip) delete dadosParaSalvar.id_endereco;
    else {
      dadosParaSalvar.id_endereco = String(r.id);
      if (r.criada) avisos.push(`Local «${raw}» criado`);
    }
  }

  // Categoria / segmento (grava descrição)
  if (Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'segmento') ||
      Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'categoria')) {
    const raw = dadosParaSalvar.segmento != null ? dadosParaSalvar.segmento : dadosParaSalvar.categoria;
    delete dadosParaSalvar.categoria;
    const r = await resolverCategoriaImport(conn, raw);
    if (!r.ok) return r;
    if (r.skip) delete dadosParaSalvar.segmento;
    else {
      dadosParaSalvar.segmento = r.value;
      if (r.criada) avisos.push(`Categoria «${r.value}» criada`);
    }
  }

  // Família
  if (Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'familia') ||
      Object.prototype.hasOwnProperty.call(dadosParaSalvar, 'id_familiaproduto')) {
    const raw = dadosParaSalvar.familia != null ? dadosParaSalvar.familia : dadosParaSalvar.id_familiaproduto;
    delete dadosParaSalvar.familia;
    const r = await resolverFamiliaImport(conn, raw);
    if (!r.ok) return r;
    if (r.skip) delete dadosParaSalvar.id_familiaproduto;
    else {
      dadosParaSalvar.id_familiaproduto = String(r.id);
      if (r.criada) avisos.push(`Família criada (id ${r.id})`);
    }
  }

  return { ok: true, avisos };
}

/** Checagem (sem criar) p/ Validar Dados — retorna status por campo (`ok` | `nova`). */
async function checarLookupsImportLinha(pool, campos) {
  try {
    await ensureProdutoAuxiliares(pool);
  } catch (e) {
    console.warn('[checarLookupsImportLinha] ensureProdutoAuxiliares:', e.message);
  }
  const out = {};
  async function checkAux(table, valor, key) {
    const raw = String(valor ?? '').trim();
    if (!raw) return;
    const k = normKey(raw);
    const codTry = codigoFromDesc(raw);
    try {
      const [rows] = await pool.query(
        `SELECT id FROM \`${table}\` WHERE COALESCE(excluido,'N')='N'
           AND (UPPER(TRIM(codigo))=? OR UPPER(TRIM(descricao))=? OR UPPER(TRIM(codigo))=?) LIMIT 1`,
        [k, k, codTry]
      );
      out[key] = rows && rows[0] ? 'ok' : 'nova';
    } catch (e) {
      // Tabela/coluna ausente → trata como novo (será criado no save após ensure)
      console.warn(`[checarLookupsImportLinha] ${table}/${key}:`, e.message);
      out[key] = 'nova';
    }
  }

  const c = campos || {};
  if (c.subfamilia) await checkAux('subfamilia_produto', c.subfamilia, 'subfamilia');
  if (c.unidade) await checkAux('unidade_produto', c.unidade, 'unidade');
  if (c.tipoprodutograde || c.tipo_grade) {
    await checkAux('tipo_produto_grade', c.tipoprodutograde || c.tipo_grade, 'tipo_grade');
  }
  if (c.grupo || c.nome_grupo) {
    const raw = String(c.grupo || c.nome_grupo || '').trim();
    if (raw) {
      try {
        const [rows] = await pool.query(
          `SELECT id FROM grupos WHERE COALESCE(excluido,'N')='N' AND UPPER(TRIM(descricao))=? LIMIT 1`,
          [normKey(raw)]
        );
        out.grupo = rows && rows[0] ? 'ok' : 'nova';
      } catch (_) { out.grupo = 'nova'; }
    }
  }
  if (c.local || c.local_armazenamento) {
    const raw = String(c.local || c.local_armazenamento || '').trim();
    if (raw && !/^\d+$/.test(raw)) {
      try {
        const [rows] = await pool.query(
          `SELECT id FROM local_armazenamento WHERE COALESCE(excluido,'N')='N' AND UPPER(TRIM(nome_local))=? LIMIT 1`,
          [normKey(raw)]
        );
        out.local = rows && rows[0] ? 'ok' : 'nova';
      } catch (_) { out.local = 'nova'; }
    }
  }
  if (c.segmento || c.categoria) {
    const raw = String(c.segmento || c.categoria || '').trim();
    if (raw) {
      try {
        const [rows] = await pool.query(
          `SELECT id FROM categoria WHERE COALESCE(excluido,'N')='N' AND UPPER(TRIM(descricao))=? LIMIT 1`,
          [normKey(raw)]
        );
        out.categoria = rows && rows[0] ? 'ok' : 'nova';
      } catch (_) { out.categoria = 'nova'; }
    }
  }
  if (c.familia) {
    const raw = String(c.familia || '').trim();
    if (raw && !/^\d+$/.test(raw)) {
      try {
        const [rows] = await pool.query(
          `SELECT id FROM familia_produtos WHERE COALESCE(excluido,'N')='N' AND UPPER(TRIM(nome))=? LIMIT 1`,
          [normKey(raw)]
        );
        out.familia = rows && rows[0] ? 'ok' : 'nova';
      } catch (_) { out.familia = 'nova'; }
    }
  }
  return out;
}

module.exports = {
  aplicarLookupsImportProduto,
  checarLookupsImportLinha,
  resolverGrupoImport,
  resolverLocalImport,
  resolverCategoriaImport,
  resolverFamiliaImport,
  resolverAuxCodigoDesc,
};
