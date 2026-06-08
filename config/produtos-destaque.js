/**
 * Destaques comerciais — marketing no catálogo sem desconto obrigatório.
 */

const { parseOptInt } = require('./promocoes-produto');

let _tabelaOk = null;

async function tabelaProdutosDestaqueExiste(pool) {
  if (_tabelaOk != null) return _tabelaOk;
  try {
    const [rows] = await pool.query("SHOW TABLES LIKE 'produtos_destaque'");
    _tabelaOk = rows.length > 0;
  } catch {
    _tabelaOk = false;
  }
  return _tabelaOk;
}

function sqlVigenciaDestaque(alias = 'pd') {
  return `((${alias}.data_inicio IS NULL OR ${alias}.data_inicio <= CURDATE())
    AND (${alias}.data_fim IS NULL OR ${alias}.data_fim >= CURDATE()))`;
}

function normalizarPayloadDestaque(body = {}) {
  const codProduto = parseOptInt(body.cod_produto);
  if (!codProduto) return { error: 'Informe o produto (cod_produto).' };
  const codFornecedor = parseOptInt(body.cod_fornecedor) || null;
  const prioridade = parseInt(body.prioridade, 10);
  return {
    cod_produto: codProduto,
    cod_fornecedor: codFornecedor,
    titulo: String(body.titulo || '').trim().slice(0, 200) || null,
    texto_marketing: String(body.texto_marketing || '').trim().slice(0, 500) || null,
    prioridade: Number.isFinite(prioridade) ? prioridade : 0,
    data_inicio: body.data_inicio || null,
    data_fim: body.data_fim || null,
    ativo: String(body.ativo || 'S').toUpperCase() === 'N' ? 'N' : 'S',
  };
}

async function listarDestaquesComerciais(pool, getProdTabela, opts = {}) {
  if (!(await tabelaProdutosDestaqueExiste(pool))) {
    return { data: [], total: 0 };
  }
  const tb = await getProdTabela(pool);
  const q = String(opts.q || '').trim();
  const ativo = opts.ativo === 'N' ? null : 'S';
  const codFornecedor = parseOptInt(opts.cod_fornecedor);
  const limit = Math.min(parseInt(opts.limit, 10) || 100, 200);
  const offset = Math.max(parseInt(opts.offset, 10) || 0, 0);

  const params = [];
  let where = `pd.excluido = 'N'`;
  if (ativo) {
    where += ` AND pd.ativo = ?`;
    params.push(ativo);
  }
  if (codFornecedor) {
    where += ` AND (pd.cod_fornecedor IS NULL OR CAST(pd.cod_fornecedor AS UNSIGNED) = ?)`;
    params.push(codFornecedor);
  }
  if (q) {
    where += ` AND (p.descricao LIKE ? OR p.cod_fabricante LIKE ? OR pd.titulo LIKE ? OR pd.texto_marketing LIKE ?)`;
    const lk = `%${q}%`;
    params.push(lk, lk, lk, lk);
  }

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM produtos_destaque pd
     JOIN ${tb} p ON CAST(p.ID AS UNSIGNED) = CAST(pd.cod_produto AS UNSIGNED)
     WHERE ${where}`,
    params
  );

  const [rows] = await pool.query(
    `SELECT pd.*, p.descricao AS desc_produto, p.cod_fabricante,
            f.nome AS nome_fornecedor
     FROM produtos_destaque pd
     JOIN ${tb} p ON CAST(p.ID AS UNSIGNED) = CAST(pd.cod_produto AS UNSIGNED)
     LEFT JOIN fornecedores f ON CAST(f.id AS UNSIGNED) = CAST(pd.cod_fornecedor AS UNSIGNED)
       AND (f.excluido = 'N' OR f.excluido IS NULL)
     WHERE ${where}
     ORDER BY pd.prioridade DESC, pd.data_inicio DESC, pd.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return { data: rows, total: Number(total) || 0 };
}

async function getDestaqueComercial(pool, getProdTabela, id) {
  if (!(await tabelaProdutosDestaqueExiste(pool))) return null;
  const tb = await getProdTabela(pool);
  const [rows] = await pool.query(
    `SELECT pd.*, p.descricao AS desc_produto, p.cod_fabricante,
            f.nome AS nome_fornecedor
     FROM produtos_destaque pd
     JOIN ${tb} p ON CAST(p.ID AS UNSIGNED) = CAST(pd.cod_produto AS UNSIGNED)
     LEFT JOIN fornecedores f ON CAST(f.id AS UNSIGNED) = CAST(pd.cod_fornecedor AS UNSIGNED)
     WHERE pd.id = ? AND pd.excluido = 'N'
     LIMIT 1`,
    [parseInt(id, 10)]
  );
  return rows[0] || null;
}

async function gravarDestaqueComercial(pool, getProdTabela, payload, id = null) {
  if (!(await tabelaProdutosDestaqueExiste(pool))) {
    return { error: 'Tabela produtos_destaque não disponível.' };
  }
  const norm = normalizarPayloadDestaque(payload);
  if (norm.error) return norm;

  const tb = await getProdTabela(pool);
  const [[prod]] = await pool.query(
    `SELECT ID FROM ${tb} WHERE ID = ? AND (excluido = 'N' OR excluido IS NULL OR excluido = '') LIMIT 1`,
    [norm.cod_produto]
  );
  if (!prod) return { error: 'Produto não encontrado.' };

  const vals = [
    norm.cod_produto,
    norm.cod_fornecedor,
    norm.titulo,
    norm.texto_marketing,
    norm.prioridade,
    norm.data_inicio,
    norm.data_fim,
    norm.ativo,
  ];

  if (id) {
    await pool.query(
      `UPDATE produtos_destaque SET
        cod_produto = ?, cod_fornecedor = ?, titulo = ?, texto_marketing = ?,
        prioridade = ?, data_inicio = ?, data_fim = ?, ativo = ?
       WHERE id = ? AND excluido = 'N'`,
      [...vals, parseInt(id, 10)]
    );
    return { id: parseInt(id, 10), ok: true };
  }

  const [r] = await pool.query(
    `INSERT INTO produtos_destaque
      (cod_produto, cod_fornecedor, titulo, texto_marketing, prioridade, data_inicio, data_fim, ativo, excluido)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'N')`,
    vals
  );
  return { id: r.insertId, ok: true };
}

async function excluirDestaqueComercial(pool, id) {
  if (!(await tabelaProdutosDestaqueExiste(pool))) {
    return { error: 'Tabela produtos_destaque não disponível.' };
  }
  await pool.query(`UPDATE produtos_destaque SET excluido = 'S' WHERE id = ?`, [parseInt(id, 10)]);
  return { ok: true };
}

async function attachDestaquesComerciais(pool, produtos, ctx = {}) {
  if (!Array.isArray(produtos) || !produtos.length) return produtos;
  if (!(await tabelaProdutosDestaqueExiste(pool))) return produtos;

  const ids = [...new Set(produtos.map((p) => parseInt(p.cod_produto || p.id, 10)).filter(Boolean))];
  if (!ids.length) return produtos;

  const ph = ids.map(() => '?').join(',');
  const params = [...ids];
  let fornSql = '';
  const codForn = parseOptInt(ctx.codFornecedor);
  if (codForn) {
    fornSql = ' AND (pd.cod_fornecedor IS NULL OR CAST(pd.cod_fornecedor AS UNSIGNED) = ?) ';
    params.push(codForn);
  }

  const [rows] = await pool.query(
    `SELECT pd.id, pd.cod_produto, pd.titulo, pd.texto_marketing, pd.prioridade
     FROM produtos_destaque pd
     WHERE pd.excluido = 'N' AND pd.ativo = 'S'
       AND pd.cod_produto IN (${ph})
       AND ${sqlVigenciaDestaque('pd')}
       ${fornSql}
     ORDER BY pd.prioridade DESC, pd.id DESC`,
    params
  );

  const map = new Map();
  rows.forEach((r) => {
    const pid = parseInt(r.cod_produto, 10);
    if (!map.has(pid)) map.set(pid, r);
  });

  return produtos.map((p) => {
    const pid = parseInt(p.cod_produto || p.id, 10);
    const d = map.get(pid);
    if (!d) return p;
    return {
      ...p,
      destaque_comercial: true,
      destaque_comercial_id: d.id,
      destaque_comercial_titulo: d.titulo,
      destaque_marketing: d.texto_marketing || d.titulo || null,
    };
  });
}

function sqlExistsDestaqueComercial(prodAlias = 'p', opts = {}) {
  const fId = parseOptInt(opts.idFornecedor);
  let forn = '';
  if (fId) {
    forn = ` AND (pd.cod_fornecedor IS NULL OR CAST(pd.cod_fornecedor AS UNSIGNED) = ${fId}) `;
  }
  return `EXISTS (
    SELECT 1 FROM produtos_destaque pd
    WHERE pd.cod_produto = ${prodAlias}.ID
      AND pd.excluido = 'N' AND pd.ativo = 'S'
      AND ${sqlVigenciaDestaque('pd')}
      ${forn}
  )`;
}

module.exports = {
  tabelaProdutosDestaqueExiste,
  sqlVigenciaDestaque,
  listarDestaquesComerciais,
  getDestaqueComercial,
  gravarDestaqueComercial,
  excluirDestaqueComercial,
  attachDestaquesComerciais,
  sqlExistsDestaqueComercial,
};
