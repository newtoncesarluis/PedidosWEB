'use strict';

const { getPool } = require('../../config/database');

/**
 * Cache de colunas existentes na tabela `clientes`.
 * Evita "Unknown column" em bancos que ainda não têm os campos novos.
 */
let _colunasClientes = null;

async function getColunasClientes(pool) {
  if (_colunasClientes) return _colunasClientes;
  try {
    const [rows] = await pool.query('DESCRIBE clientes');
    _colunasClientes = new Set(rows.map(r => r.Field));
  } catch {
    _colunasClientes = new Set(); // fallback: sem restrição
  }
  return _colunasClientes;
}

/**
 * Busca configuração do sistema na tabela `sistemas`
 */
async function getSistemaConfig(pool, idEmpresa) {
  const [rows] = await pool.query(
    `SELECT * FROM sistemas WHERE id_empresa = ? OR id_empresa IS NULL ORDER BY id DESC LIMIT 1`,
    [idEmpresa]
  ).catch(() => [[]]);
  return rows[0] || {};
}

/**
 * Lista clientes com filtros dinâmicos
 */
async function listar(filters, config, user) {
  const pool = getPool();
  const {
    q = '',
    status = 'A',
    limit = 100,
    offset = 0,
    cod_vendedor,
    segmento,
    regiao,
    tipo_pessoa,
    cidade,
    uf,
    lat,
    lng,
    raio = 50,
  } = filters;

  const where = [];
  const vals = [];

  // Filtro de status/exclusão
  if (status === 'A') {
    where.push(`c.excluido = 'N' AND c.status = 'A'`);
  } else if (status === 'I') {
    where.push(`c.excluido = 'N' AND c.status = 'I'`);
  } else if (status === 'E') {
    where.push(`c.excluido = 'S' AND c.status = 'E'`);
  } else {
    // todos
    where.push(`c.excluido = 'N'`);
  }

  // Isolamento por empresa
  if (config.gcompartilhaCliente === 'N') {
    where.push(`c.id_empresa = ?`);
    vals.push(user.id_empresa);
  }

  // Filtros adicionais
  if (cod_vendedor) { where.push(`c.cod_vendedor = ?`); vals.push(cod_vendedor); }
  if (segmento) { where.push(`c.segmento = ?`); vals.push(segmento); }
  if (regiao) { where.push(`c.regiao = ?`); vals.push(regiao); }
  if (tipo_pessoa) { where.push(`c.tipo_pessoa = ?`); vals.push(tipo_pessoa); }
  if (cidade) { where.push(`LOWER(c.cidade) LIKE ?`); vals.push(`%${cidade.toLowerCase()}%`); }
  if (uf) { where.push(`c.uf = ?`); vals.push(uf.toUpperCase()); }

  // Busca textual — inclui código do cliente (id)
  if (q && q.trim()) {
    where.push(`(
      CAST(c.id AS CHAR) LIKE ? OR
      LOWER(c.nome) LIKE ? OR
      LOWER(c.apelido) LIKE ? OR
      c.foneprincipal LIKE ? OR
      c.fonesecundario LIKE ? OR
      c.cep LIKE ? OR
      LOWER(c.endereco) LIKE ? OR
      LOWER(c.bairro) LIKE ? OR
      LOWER(c.cidade) LIKE ? OR
      c.cpf LIKE ? OR
      c.rg LIKE ? OR
      c.uf LIKE ? OR
      LOWER(c.segmento) LIKE ? OR
      LOWER(c.nomeclienteprincipal) LIKE ? OR
      LOWER(c.ramoatividades) LIKE ? OR
      LOWER(u.nomeusu) LIKE ?
    )`);
    const like = `%${q.trim().toLowerCase()}%`;
    vals.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like, like, like);
  }

  let distanceCol = "";
  let selectVals = [];
  if (lat && lng) {
    // Haversine
    distanceCol = `, (6371 * acos(cos(radians(?)) * cos(radians(c.latitude)) * cos(radians(c.longitude) - radians(?)) + sin(radians(?)) * sin(radians(c.latitude)))) AS distancia`;
    selectVals = [lat, lng, lat];
    
    where.push(`(6371 * acos(cos(radians(?)) * cos(radians(c.latitude)) * cos(radians(c.longitude) - radians(?)) + sin(radians(?)) * sin(radians(c.latitude)))) <= ?`);
    vals.push(lat, lng, lat, parseFloat(raio));
  }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countVals = [...vals];

  const mainSql = `
    SELECT
      c.id,
      LPAD(c.id, 7, '0') AS codigo_auxiliar,
      c.nome, c.apelido, c.tipo_pessoa, c.cpf,
      c.foneprincipal, c.fonesecundario, c.email,
      c.cidade, c.uf, c.bairro, c.status, c.endereco,
      c.dtultimacompra, c.dtcadastro,
      c.tipo_cliente, c.segmento, c.cod_vendedor,
      c.credito, c.desconto, c.conceitocliente,
      c.venda_suspensa, c.regiao,
      c.latitude, c.longitude,
      u.nomeusu AS nome_vendedor,
      rr.nome_regiao
      ${distanceCol}
    FROM clientes c
    LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido = 'N'
    LEFT JOIN regiao_rota rr ON rr.id = c.regiao AND rr.excluido = 'N'
    ${whereClause}
    ORDER BY ${lat && lng ? 'distancia ASC' : 'c.nome'}
    LIMIT ? OFFSET ?`;

  // Fallback sem LEFT JOIN regiao_rota (caso tabela não exista)
  const fallbackSql = `
    SELECT
      c.id,
      LPAD(c.id, 7, '0') AS codigo_auxiliar,
      c.nome, c.apelido, c.tipo_pessoa, c.cpf,
      c.foneprincipal, c.fonesecundario, c.email,
      c.cidade, c.uf, c.bairro, c.status, c.endereco,
      c.dtultimacompra, c.dtcadastro,
      c.tipo_cliente, c.segmento, c.cod_vendedor,
      c.credito, c.desconto, c.conceitocliente,
      c.venda_suspensa, c.regiao,
      c.latitude, c.longitude,
      u.nomeusu AS nome_vendedor,
      NULL AS nome_regiao
      ${distanceCol}
    FROM clientes c
    LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido = 'N'
    ${whereClause}
    ORDER BY ${lat && lng ? 'distancia ASC' : 'c.nome'}
    LIMIT ? OFFSET ?`;

  let rows;
  try {
    [rows] = await pool.query(mainSql, [...selectVals, ...vals, parseInt(limit), parseInt(offset)]);
  } catch (err) {
    [rows] = await pool.query(fallbackSql, [...selectVals, ...vals, parseInt(limit), parseInt(offset)]);
  }

  const countWhere = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // LEFT JOIN usuarios obrigatório: whereClause pode conter LOWER(u.nomeusu) LIKE ?
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM clientes c
     LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido = 'N'
     ${countWhere}`,
    countVals
  ).catch(() => [[{ total: 0 }]]);

  // Mapear status para texto legível
  const statusMap = { A: 'ATIVO', I: 'INATIVO', E: 'EXCLUÍDO' };
  const mapped = rows.map(r => ({ ...r, status_label: statusMap[r.status] || r.status }));

  return { clientes: mapped, total };
}

/**
 * Busca cliente por ID (sem sub-registros)
 * Fallback sem LEFT JOIN regiao_rota caso a tabela não exista
 */
async function buscarPorId(id, pool) {
  let rows;
  try {
    [rows] = await pool.query(
      `SELECT c.*,
        u.nomeusu AS nome_vendedor,
        rr.nome_regiao
       FROM clientes c
       LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido = 'N'
       LEFT JOIN regiao_rota rr ON rr.id = c.regiao AND rr.excluido = 'N'
       WHERE c.id = ? LIMIT 1`,
      [id]
    );
  } catch {
    [rows] = await pool.query(
      `SELECT c.*,
        u.nomeusu AS nome_vendedor,
        NULL AS nome_regiao
       FROM clientes c
       LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido = 'N'
       WHERE c.id = ? LIMIT 1`,
      [id]
    );
  }
  return rows[0] || null;
}

/**
 * Verifica se já existe CPF/CNPJ duplicado para outra empresa/cliente
 */
async function verificarDuplicadoCpfCnpj(cpf, idEmpresa, excluirId, isolado) {
  const pool = getPool();
  let sql = `SELECT id, nome FROM clientes WHERE cpf = ? AND excluido = 'N'`;
  const vals = [cpf];

  if (isolado) {
    sql += ` AND id_empresa = ?`;
    vals.push(idEmpresa);
  }

  if (excluirId) {
    sql += ` AND id <> ?`;
    vals.push(excluirId);
  }

  sql += ` LIMIT 1`;
  const [rows] = await pool.query(sql, vals);
  return rows[0] || null;
}

/**
 * Insere novo cliente — usa conn se fornecida (para transação)
 */
async function inserirCliente(dados, pool, conn) {
  const executor = conn || pool;

  // Todos os campos conhecidos — o filtro por colunas existentes garante compatibilidade
  // com qualquer versão do banco (campos novos são ignorados silenciosamente)
  const todasColunas = [
    'tipo_pessoa', 'nome', 'apelido', 'cpf', 'rg', 'sexo', 'dtnascimento',
    'cep', 'endereco', 'numero_end', 'bairro', 'cidade', 'uf', 'complemento',
    'foneprincipal', 'fonesecundario', 'contato', 'email',
    'tipo_cliente', 'segmento', 'cod_segmento', 'zonavenda',
    'conceitocliente', 'diapgt', 'cod_vendedor',
    'credito', 'desconto', 'status', 'obsendereco', 'obsgerais',
    'venda_suspensa', 'skype', 'site',
    'instragam',    // coluna original Delphi (typo intencional no BD)
    'instagram',    // alias normalizado — usado se BD foi migrado
    'facebook', 'linkedin',
    'cobrast', 'icms', 'ipi', 'regiao',
    'endereco_faturamento', 'bairro_faturamento', 'cidade_faturamento',
    'cep_faturamento', 'uf_faturamento',
    'telefone1_faturamento', 'telefone2_faturamento',
    'contato_recebedor', 'contato_financeiro',
    'clienteprincipal', 'cod_clienteprincipal', 'nomeclienteprincipal',
    'lembrete', 'possuilembrete',
    'id_ramoatividades', 'ramoatividades',
    'situacaocnpj', 'data_situacaocnpj',
    'data_abertura',          // data de abertura/fundação — Delphi: data_abertura
    'porte', 'tipo_cnpj', 'natureza',
    'capital_social', 'atividadeprincipal', 'atividadesecundaria', 'quadrosocios',
    'formapagto', 'condicaopagto',
    'prazopagto',             // prazo de pagamento — Delphi: prazopagto
    'numero_suframa',         // alias normalizado
    'numerosulframa',         // coluna original Delphi
    'imprimirsuframaped', 'descontoIPIsuframaped', 'calcularipiimpressao',
    'tipodocumento', 'id_empresa',
    'numsocios',              // nº de sócios — Delphi: numsocios
    'numalteracoes',          // nº de alterações contratuais — Delphi: numalteracoes
    'dt_ultialteracoes',      // data última alteração — Delphi: dt_ultialteracoes
    'rj_comercial',           // registro na junta comercial — Delphi: rj_comercial
    'numero_off', 'sincronizar', 'status_sinc',
    'latitude', 'longitude',
    'excluido',
  ];

  const colunasExistentes = await getColunasClientes(pool);

  const campos = todasColunas.filter(c =>
    dados[c] !== undefined &&
    (colunasExistentes.size === 0 || colunasExistentes.has(c))
  );

  if (!campos.includes('status'))  campos.push('status');
  if (!campos.includes('excluido')) campos.push('excluido');

  const colNames = campos.map(c => `\`${c}\``).join(', ');
  const placeholders = campos.map(() => '?').join(', ');
  const values = campos.map(c => {
    if (c === 'status'   && dados[c] === undefined) return 'A';
    if (c === 'excluido' && dados[c] === undefined) return 'N';
    return dados[c] !== undefined ? dados[c] : null;
  });

  const [result] = await executor.query(
    `INSERT INTO clientes (${colNames}, dtcadastro) VALUES (${placeholders}, CURDATE())`,
    values
  );
  return result.insertId;
}

/**
 * Atualiza cliente existente
 */
async function atualizarCliente(id, dados, pool, conn) {
  const executor = conn || pool;

  const todasColunas = [
    'tipo_pessoa', 'nome', 'apelido', 'cpf', 'rg', 'sexo', 'dtnascimento',
    'cep', 'endereco', 'numero_end', 'bairro', 'cidade', 'uf', 'complemento',
    'foneprincipal', 'fonesecundario', 'contato', 'email',
    'tipo_cliente', 'segmento', 'cod_segmento', 'zonavenda',
    'conceitocliente', 'diapgt', 'cod_vendedor',
    'credito', 'desconto', 'status', 'obsendereco', 'obsgerais',
    'venda_suspensa', 'skype', 'site',
    'instragam',    // coluna original Delphi
    'instagram',    // alias normalizado
    'facebook', 'linkedin',
    'cobrast', 'icms', 'ipi', 'regiao',
    'endereco_faturamento', 'bairro_faturamento', 'cidade_faturamento',
    'cep_faturamento', 'uf_faturamento',
    'telefone1_faturamento', 'telefone2_faturamento',
    'contato_recebedor', 'contato_financeiro',
    'clienteprincipal', 'cod_clienteprincipal', 'nomeclienteprincipal',
    'lembrete', 'possuilembrete',
    'id_ramoatividades', 'ramoatividades',
    'situacaocnpj', 'data_situacaocnpj',
    'data_abertura',
    'porte', 'tipo_cnpj', 'natureza',
    'capital_social', 'atividadeprincipal', 'atividadesecundaria', 'quadrosocios',
    'formapagto', 'condicaopagto', 'prazopagto',
    'numero_suframa',
    'numerosulframa',   // coluna original Delphi
    'imprimirsuframaped', 'descontoIPIsuframaped', 'calcularipiimpressao',
    'tipodocumento', 'id_empresa',
    'numsocios', 'numalteracoes', 'dt_ultialteracoes', 'rj_comercial',
    'latitude', 'longitude',
    'sincronizar', 'status_sinc',
  ];

  const colunasExistentes = await getColunasClientes(pool);

  const campos = todasColunas.filter(c =>
    dados[c] !== undefined &&
    (colunasExistentes.size === 0 || colunasExistentes.has(c))
  );

  if (campos.length === 0) return;

  const setClause = campos.map(c => `\`${c}\` = ?`).join(', ');
  const values = [...campos.map(c => dados[c] !== undefined ? dados[c] : null), id];

  await executor.query(
    `UPDATE clientes SET ${setClause}, dtalterado = NOW() WHERE id = ?`,
    values
  );
}

/**
 * Soft delete do cliente
 */
async function excluirCliente(id, conn) {
  await conn.query(
    `UPDATE clientes SET excluido = 'S', status = 'E', dtalterado = NOW() WHERE id = ?`,
    [id]
  );
}

/**
 * Ativa cliente
 */
async function ativarCliente(id, conn) {
  await conn.query(
    `UPDATE clientes SET status = 'A', excluido = 'N', dtalterado = NOW() WHERE id = ?`,
    [id]
  );
}

/**
 * Inativa cliente
 */
async function inativarCliente(id, conn) {
  await conn.query(
    `UPDATE clientes SET status = 'I', dtalterado = NOW() WHERE id = ?`,
    [id]
  );
}

/**
 * Verifica se cliente possui QUALQUER histórico de pedidos (inclusive inativados)
 * Equivalente ao verificarHistoricoCompras do Delphi — não filtra por excluido
 */
async function verificarHistoricoCompras(id, pool) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM pedidos WHERE id_cliente = ? LIMIT 1`,
    [id]
  ).catch(() => [[{ total: 0 }]]);
  return (rows[0]?.total || 0) > 0;
}

/**
 * Verifica se cliente possui pedidos ativos (excluido='N')
 */
async function verificarPedidosAtivos(id, pool) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM pedidos WHERE id_cliente = ? AND excluido = 'N' LIMIT 1`,
    [id]
  ).catch(() => [[{ total: 0 }]]);
  return (rows[0]?.total || 0) > 0;
}

/**
 * Gera número offline sequencial: LPAD(MAX(numero_off)+1, 6, '0')
 * Equivalente ao gerarNumeroOffLine do Delphi
 */
async function gerarNumeroOffLine(pool) {
  const [rows] = await pool.query(
    `SELECT LPAD(COALESCE(MAX(CAST(numero_off AS UNSIGNED)), 0) + 1, 6, '0') AS proximo
     FROM clientes WHERE numero_off IS NOT NULL AND numero_off <> ''`
  ).catch(() => [[{ proximo: '000001' }]]);
  return rows[0]?.proximo || '000001';
}

/**
 * Atualiza dias de aviso de cliente sem compra (gdiasavisoclientesemcompra)
 */
async function atualizarDiasAvisoSemCompra(dias, pool) {
  await pool.query(
    `UPDATE sistemas SET gdiasavisoclientesemcompra = ? WHERE id = (SELECT id FROM (SELECT id FROM sistemas ORDER BY id DESC LIMIT 1) AS t)`,
    [parseInt(dias, 10) || 0]
  ).catch(() => {});
}

/**
 * Busca atividades do cliente (status_atividades)
 */
async function buscarAtividadesCliente(id, pool) {
  const [rows] = await pool.query(
    `SELECT * FROM status_atividades WHERE id_cliente = ? AND excluido = 'N' ORDER BY data DESC`,
    [id]
  ).catch(() => [[]]);
  return rows;
}

/**
 * Atualiza campo dtultimacompra em lote baseado em pedidos
 */
async function atualizarUltimaCompra(pool) {
  await pool.query(`
    UPDATE clientes c
    INNER JOIN (
      SELECT id_cliente, MAX(dtpedido) AS ultima
      FROM pedidos
      WHERE excluido = 'N'
      GROUP BY id_cliente
    ) p ON p.id_cliente = c.id
    SET c.dtultimacompra = p.ultima
    WHERE c.excluido = 'N'
  `).catch(() => {});
}

module.exports = {
  getSistemaConfig,
  listar,
  buscarPorId,
  verificarDuplicadoCpfCnpj,
  inserirCliente,
  atualizarCliente,
  excluirCliente,
  ativarCliente,
  inativarCliente,
  verificarHistoricoCompras,
  verificarPedidosAtivos,
  gerarNumeroOffLine,
  atualizarDiasAvisoSemCompra,
  buscarAtividadesCliente,
  atualizarUltimaCompra,
};
