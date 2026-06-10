'use strict';

const https = require('https');
const repo = require('./clientes.repository');
const contatosSvc = require('./sub/contatos.service');
const faturamentoSvc = require('./sub/faturamento.service');
const sociosSvc = require('./sub/socios.service');
const refSvc = require('./sub/referencias.service');
const dependentesSvc = require('./sub/dependentes.service');
const lembretesSvc = require('./sub/lembretes.service');
const tabelaSvc = require('./sub/tabelapreco.service');
const { getPool } = require('../../config/database');
const { validarCliente, validarCpfCnpj } = require('./clientes.validator');

// ─── LISTAR ───────────────────────────────────────────────────────────────────

async function listarClientes(query, user) {
  const pool = getPool();
  const config = await repo.getSistemaConfig(pool, user.id_empresa);
  return repo.listar(query, config, user);
}

// ─── BUSCAR POR ID (completo) ─────────────────────────────────────────────────

async function buscarCliente(id, user) {
  const pool = getPool();
  if (!(await repo.usuarioPodeVerCliente(id, user, pool))) return null;
  const cliente = await repo.buscarPorId(id, pool);
  if (!cliente) return null;

  // allSettled garante que falha em tabela inexistente não derruba toda a requisição
  const settled = await Promise.allSettled([
    contatosSvc.buscarContatos(id, pool),
    faturamentoSvc.buscarFaturamento(id, pool),
    sociosSvc.buscarSocios(id, pool),
    refSvc.buscarRefBancarias(id, pool),
    refSvc.buscarRefComerciais(id, pool),
    dependentesSvc.buscarDependentes(id, pool),
    lembretesSvc.buscarLembretesCliente(id, pool),
    lembretesSvc.buscarCamposCadastro(pool),
    tabelaSvc.buscarTabelasCliente(id, pool),
  ]);

  const val = (i, fallback = []) => settled[i].status === 'fulfilled' ? settled[i].value : fallback;

  const contatos     = val(0);
  const faturamento  = val(1);
  const socios       = val(2);
  const refBancarias = val(3);
  const refComerciais = val(4);
  const dependentes  = val(5);
  const marcados     = val(6);
  const campos       = val(7);
  const tabelasPreco = val(8);

  return {
    ...cliente,
    contatos,
    faturamento,
    socios,
    refBancarias,
    refComerciais,
    dependentes,
    lembretes: { campos, marcados },
    tabelasPreco,
  };
}

// ─── CRIAR ────────────────────────────────────────────────────────────────────

async function criarCliente(body, user) {
  const pool = getPool();
  const config = await repo.getSistemaConfig(pool, user.id_empresa);

  // Validação de campos obrigatórios
  const validacao = validarCliente(body, config);
  if (!validacao.valid) {
    const err = new Error(validacao.errors.join('; '));
    err.statusCode = 400;
    err.errors = validacao.errors;
    throw err;
  }

  // Verificar CPF/CNPJ duplicado
  if (body.cpf && body.cpf.replace(/\D/g, '') && config.gpermitecnpjduplicadoclientes === 'N') {
    const isolado = config.gcompartilhaCliente === 'N';
    const existente = await repo.verificarDuplicadoCpfCnpj(body.cpf, user.id_empresa, null, isolado);
    if (existente) {
      const err = new Error(`CPF/CNPJ já cadastrado para ${existente.nome}`);
      err.statusCode = 409;
      err.details = { id: existente.id, nome: existente.nome };
      throw err;
    }
  }

  // Validar cod_segmento e buscar texto descritivo (igual ao Delphi: salva id + texto)
  let segmentoDescricao = body.segmento || null;
  if (body.cod_segmento) {
    const [segRows] = await pool.query(
      `SELECT id, descricao FROM categoria WHERE id = ? AND excluido = 'N' AND status = 'A' LIMIT 1`,
      [body.cod_segmento]
    ).catch(() => [[]]);
    if (!segRows[0]) {
      const err = new Error('Categoria (segmento) informada não existe ou está inativa');
      err.statusCode = 400;
      throw err;
    }
    // Delphi salva tanto o ID (cod_segmento) quanto o texto descritivo (segmento)
    segmentoDescricao = segRows[0].descricao;
  }

  // ── Montar dados base ────────────────────────────────────────────────────────
  const dados = { ...body };

  // Delphi salva o texto descritivo do segmento além do código
  if (segmentoDescricao) dados.segmento = segmentoDescricao;

  // id_empresa: só isola se gcompartilhaCliente='N'; caso contrário fica vazio
  dados.id_empresa = config.gcompartilhaCliente === 'N' ? (user.id_empresa || '') : '';

  dados.status     = 'A';
  dados.status_sinc = 'A';
  dados.dtcadastro = new Date().toISOString().split('T')[0];

  // ── Garantir aliases de campos com nomes duplos (Delphi vs normalizado) ──────
  // Delphi usa 'instragam' (typo original), frontend também envia 'instragam'
  // O repositório aceita ambos e o mecanismo DESCRIBE filtra o que existir no BD
  dados.instragam    = body.instragam    || body.instagram    || null;
  dados.instagram    = body.instagram    || body.instragam    || null;
  // Delphi usa 'numerosulframa', frontend envia 'numero_suframa'
  dados.numerosulframa = body.numerosulframa || body.numero_suframa || null;
  dados.numero_suframa = body.numero_suframa || body.numerosulframa || null;

  // Campos numéricos NOT NULL — garantir 0 quando vier null/vazio
  for (const campo of ['credito','desconto','diapgt','capital_social']) {
    if (dados[campo] === null || dados[campo] === undefined || dados[campo] === '') {
      dados[campo] = 0;
    }
  }

  // Campos booleanos S/N — garantir 'N' quando vier null/vazio
  // Delphi usa checkboxes para cobrast, icms, ipi, venda_suspensa, clienteprincipal
  for (const campo of ['cobrast','icms','ipi','venda_suspensa','clienteprincipal',
                       'imprimirsuframaped','descontoIPIsuframaped','calcularipiimpressao']) {
    if (!dados[campo] || dados[campo] === '') {
      dados[campo] = 'N';
    }
  }

  // Terminal offline: gerar numero_off e marcar sincronizar='S'
  if (config.gTerminalOffLine === 'S') {
    dados.numero_off  = await repo.gerarNumeroOffLine(pool);
    dados.sincronizar = 'S';
  } else {
    dados.sincronizar = 'N';
  }

  // Segurança: forçar cod_vendedor quando gacessartodosclientes='S'
  if (config.gacessartodosclientes === 'S') {
    dados.cod_vendedor = user.id;
  }

  // Transação
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    const novoId = await repo.inserirCliente(dados, pool, conn);

    // Sub-registros
    if (Array.isArray(body.contatos))    await contatosSvc.salvarContatos(novoId, body.contatos, conn);
    if (Array.isArray(body.faturamento)) await faturamentoSvc.salvarFaturamento(novoId, body.faturamento, conn);
    if (Array.isArray(body.socios))      await sociosSvc.salvarSocios(novoId, body.socios, conn);
    if (Array.isArray(body.refBancarias))  await refSvc.salvarRefBancarias(novoId, body.refBancarias, conn);
    if (Array.isArray(body.refComerciais)) await refSvc.salvarRefComerciais(novoId, body.refComerciais, conn);
    if (Array.isArray(body.dependentes)) await dependentesSvc.salvarDependentes(novoId, body.dependentes, conn);
    if (Array.isArray(body.tabelasPreco)) await tabelaSvc.salvarTabelasPreco(novoId, body.tabelasPreco, conn);
    // Lembretes: só se o módulo estiver habilitado na configuração do sistema
    if (config.gcampos_cadastrocliente === 'S' && Array.isArray(body.lembretes)) {
      await lembretesSvc.salvarLembretes(novoId, body.lembretes, conn);
    }

    await conn.commit();
    return { id: novoId, nome: dados.nome };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── ATUALIZAR ────────────────────────────────────────────────────────────────

async function atualizarCliente(id, body, user) {
  const pool = getPool();
  const config = await repo.getSistemaConfig(pool, user.id_empresa);

  // Validação de campos obrigatórios
  const validacao = validarCliente(body, config);
  if (!validacao.valid) {
    const err = new Error(validacao.errors.join('; '));
    err.statusCode = 400;
    err.errors = validacao.errors;
    throw err;
  }

  // Verificar CPF/CNPJ duplicado (excluindo o próprio cliente)
  if (body.cpf && body.cpf.replace(/\D/g, '') && config.gpermitecnpjduplicadoclientes === 'N') {
    const isolado = config.gcompartilhaCliente === 'N';
    const existente = await repo.verificarDuplicadoCpfCnpj(body.cpf, user.id_empresa, id, isolado);
    if (existente) {
      const err = new Error(`CPF/CNPJ já cadastrado para ${existente.nome}`);
      err.statusCode = 409;
      err.details = { id: existente.id, nome: existente.nome };
      throw err;
    }
  }

  // Validar cod_segmento e buscar texto descritivo (igual ao Delphi: salva id + texto)
  let segmentoDescricaoAtualizar = body.segmento || null;
  if (body.cod_segmento) {
    const [segRows] = await pool.query(
      `SELECT id, descricao FROM categoria WHERE id = ? AND excluido = 'N' AND status = 'A' LIMIT 1`,
      [body.cod_segmento]
    ).catch(() => [[]]);
    if (!segRows[0]) {
      const err = new Error('Categoria (segmento) informada não existe ou está inativa');
      err.statusCode = 400;
      throw err;
    }
    segmentoDescricaoAtualizar = segRows[0].descricao;
  }

  // ── Montar dados base ────────────────────────────────────────────────────────
  const dadosAtualizar = { ...body };

  // Delphi salva o texto descritivo do segmento além do código
  if (segmentoDescricaoAtualizar) dadosAtualizar.segmento = segmentoDescricaoAtualizar;

  // ── Garantir aliases de campos com nomes duplos (Delphi vs normalizado) ──────
  dadosAtualizar.instragam     = body.instragam    || body.instagram    || null;
  dadosAtualizar.instagram     = body.instagram    || body.instragam    || null;
  dadosAtualizar.numerosulframa = body.numerosulframa || body.numero_suframa || null;
  dadosAtualizar.numero_suframa = body.numero_suframa || body.numerosulframa || null;

  // Campos numéricos NOT NULL — garantir 0 quando vier null/vazio
  for (const campo of ['credito','desconto','diapgt','capital_social']) {
    if (dadosAtualizar[campo] === null || dadosAtualizar[campo] === undefined || dadosAtualizar[campo] === '') {
      dadosAtualizar[campo] = 0;
    }
  }

  // Campos booleanos S/N — garantir 'N' quando vier null/vazio
  for (const campo of ['cobrast','icms','ipi','venda_suspensa','clienteprincipal',
                       'imprimirsuframaped','descontoIPIsuframaped','calcularipiimpressao']) {
    if (!dadosAtualizar[campo] || dadosAtualizar[campo] === '') {
      dadosAtualizar[campo] = 'N';
    }
  }

  dadosAtualizar.status_sinc = 'A';

  // Terminal offline: marcar para sincronizar
  dadosAtualizar.sincronizar = config.gTerminalOffLine === 'S' ? 'S' : 'N';

  // Segurança: forçar cod_vendedor quando gacessartodosclientes='S'
  if (config.gacessartodosclientes === 'S') {
    dadosAtualizar.cod_vendedor = user.id;
  }

  // Transação
  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    await repo.atualizarCliente(id, dadosAtualizar, pool, conn);

    // Sub-registros
    if (Array.isArray(dadosAtualizar.contatos))    await contatosSvc.salvarContatos(id, dadosAtualizar.contatos, conn);
    if (Array.isArray(dadosAtualizar.faturamento)) await faturamentoSvc.salvarFaturamento(id, dadosAtualizar.faturamento, conn);
    if (Array.isArray(dadosAtualizar.socios))      await sociosSvc.salvarSocios(id, dadosAtualizar.socios, conn);
    if (Array.isArray(dadosAtualizar.refBancarias))  await refSvc.salvarRefBancarias(id, dadosAtualizar.refBancarias, conn);
    if (Array.isArray(dadosAtualizar.refComerciais)) await refSvc.salvarRefComerciais(id, dadosAtualizar.refComerciais, conn);
    if (Array.isArray(dadosAtualizar.dependentes)) await dependentesSvc.salvarDependentes(id, dadosAtualizar.dependentes, conn);
    if (Array.isArray(dadosAtualizar.tabelasPreco)) await tabelaSvc.salvarTabelasPreco(id, dadosAtualizar.tabelasPreco, conn);
    // Lembretes: só se o módulo estiver habilitado
    if (config.gcampos_cadastrocliente === 'S' && Array.isArray(dadosAtualizar.lembretes)) {
      await lembretesSvc.salvarLembretes(id, dadosAtualizar.lembretes, conn);
    }

    await conn.commit();
    return { id, nome: dadosAtualizar.nome };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── ATIVAR ───────────────────────────────────────────────────────────────────

async function ativarCliente(id, user) {
  const pool = getPool();
  const cliente = await repo.buscarPorId(id, pool);
  if (!cliente) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    await repo.ativarCliente(id, conn);
    await conn.commit();
    return { message: `Cliente "${cliente.nome}" ativado com sucesso` };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── INATIVAR ─────────────────────────────────────────────────────────────────

async function inativarCliente(id, user) {
  const pool = getPool();
  const cliente = await repo.buscarPorId(id, pool);
  if (!cliente) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    await repo.inativarCliente(id, conn);
    await conn.commit();
    return { message: `Cliente "${cliente.nome}" inativado com sucesso` };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── EXCLUIR ──────────────────────────────────────────────────────────────────

async function excluirCliente(id, user) {
  const pool = getPool();
  const config = await repo.getSistemaConfig(pool, user.id_empresa);

  const cliente = await repo.buscarPorId(id, pool);
  if (!cliente) {
    const err = new Error('Cliente não encontrado');
    err.statusCode = 404;
    throw err;
  }

  // Verifica histórico de pedidos (inclui pedidos inativados — igual ao Delphi)
  if (config.gexcluirclinenteshistorico === 'S') {
    const temHistorico = await repo.verificarHistoricoCompras(id, pool);
    if (temHistorico) {
      const err = new Error('Impossivel excluir o Cliente! Cliente com Historico de Compras, Inative o Cliente!');
      err.statusCode = 409;
      err.bloqueado = true;
      throw err;
    }
  }

  const conn = await pool.getConnection();
  await conn.beginTransaction();
  try {
    await repo.excluirCliente(id, conn);
    await conn.commit();
    return { message: `Cliente "${cliente.nome}" excluído com sucesso` };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ─── CONSULTA CNPJ (Receita Federal) ─────────────────────────────────────────

async function consultarCNPJ(cnpj) {
  const limpo = cnpj.replace(/\D/g, '');
  if (limpo.length !== 14) {
    const err = new Error('CNPJ inválido');
    err.statusCode = 400;
    throw err;
  }

  return new Promise((resolve, reject) => {
    const url = `https://receitaws.com.br/v1/cnpj/${limpo}`;
    const options = {
      headers: { 'User-Agent': 'SysRepWeb/1.0' },
      timeout: 10000,
    };

    const req = https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);

          if (json.status === 'ERROR') {
            const err = new Error(json.message || 'CNPJ não encontrado');
            err.statusCode = 404;
            return reject(err);
          }

          // Mapear campos da ReceitaWS para campos do cliente
          const result = {
            nome: json.nome || '',
            apelido: json.fantasia || '',
            tipo_pessoa: 'JURIDICA',
            cpf: limpo,
            endereco: json.logradouro || '',
            numero_end: json.numero || '',
            complemento: json.complemento || '',
            bairro: json.bairro || '',
            cidade: json.municipio || '',
            uf: json.uf || '',
            cep: (json.cep || '').replace(/\D/g, ''),
            foneprincipal: json.telefone || '',
            email: json.email || '',
            status_receita: json.situacao || '',
            abertura: json.abertura || '',
            capital_social: json.capital_social || '',
            atividade_principal: json.atividade_principal?.[0]?.text || '',
            natureza_juridica: json.natureza_juridica || '',
            socios: (json.qsa || []).map(s => ({
              nome: s.nome || '',
              cargo: s.qual || '',
              cpf: '',
            })),
            _raw: json,
          };

          resolve(result);
        } catch (parseErr) {
          reject(new Error('Erro ao interpretar resposta da Receita Federal'));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Erro ao consultar Receita Federal: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout ao consultar Receita Federal'));
    });
  });
}

// ─── AUXILIARES ───────────────────────────────────────────────────────────────

async function listarAuxiliares(tipo, user, query = {}) {
  const pool = getPool();

  if (tipo === 'vendedores') {
    return listarVendedores(pool, user);
  }

  // clientes-principais: exclui o próprio cliente e filtra por empresa se necessário
  if (tipo === 'clientes-principais') {
    const config = await repo.getSistemaConfig(pool, user?.id_empresa);
    let sql = `SELECT id, nome FROM clientes WHERE clienteprincipal='S' AND excluido='N'`;
    const vals = [];
    if (query.excluirId) {
      sql += ` AND id <> ?`;
      vals.push(parseInt(query.excluirId, 10));
    }
    if (config.gcompartilhaCliente === 'N' && user?.id_empresa) {
      sql += ` AND id_empresa = ?`;
      vals.push(user.id_empresa);
    }
    sql += ` ORDER BY nome`;
    const [rows] = await pool.query(sql, vals).catch(() => [[]]);
    return rows;
  }

  const queries = {
    'regioes':         `SELECT id, CONCAT(descricao, IF(sigla IS NOT NULL AND sigla != '', CONCAT(' (', sigla, ')'), '')) AS nome FROM regiao_rota WHERE (status='A' OR status IS NULL) AND (excluido='N' OR excluido IS NULL) ORDER BY descricao`,
    'segmentos':       `SELECT id, descricao AS nome FROM categoria WHERE status='A' AND excluido='N' ORDER BY descricao`,
    'formas-pagto':    `SELECT id, descricao AS nome FROM forma_pagto WHERE status='S' AND excluido='N' ORDER BY descricao`,
    'tabelas-preco':   `SELECT id, descricao AS nome FROM tabela_preco WHERE status='N' AND excluido='N' ORDER BY descricao`,
    'campos-cadastro':  `SELECT id, nome FROM campos_cadastros WHERE excluido='N' ORDER BY nome`,
    'ramo-atividades':  `SELECT id, descricao AS nome FROM ramo_atividades WHERE excluido='N' ORDER BY descricao`,
    'cores':            `SELECT id, descricao AS nome FROM cores WHERE status='A' AND excluido='N' ORDER BY descricao`,
    'racas':            `SELECT id, descricao AS nome FROM raca WHERE status='A' AND excluido='N' ORDER BY descricao`,
  };

  const sql = queries[tipo];
  if (!sql) {
    const err = new Error(`Tipo de auxiliar desconhecido: ${tipo}`);
    err.statusCode = 400;
    throw err;
  }

  const [rows] = await pool.query(sql).catch(() => [[]]);
  return rows;
}

// ─── LISTAR VENDEDORES (com regras de negócio completas) ──────────────────────

async function listarVendedores(pool, user) {
  const config = await repo.getSistemaConfig(pool, user?.id_empresa);

  let sql = `
    SELECT u.idusuario AS id, u.nomeusu AS nome, p.descricao AS perfil_descricao
    FROM usuarios u
    INNER JOIN perfil p ON p.id = u.idperfil
    WHERE u.excluido = 'N'
      AND u.situacao = 'ATIVO'
      AND p.p_vender = 'S'`;

  const vals = [];

  // Restrição por equipe/gerente
  if (config.grestringirdadosesquipe === 'S' && config.gIDGerente) {
    sql += ` AND u.id_gerente = ?`;
    vals.push(config.gIDGerente);
  }

  sql += ` ORDER BY u.nomeusu`;

  const [rows] = await pool.query(sql, vals).catch(() => [[]]);
  return rows;
}

// ─── ATUALIZAR ÚLTIMA COMPRA ──────────────────────────────────────────────────

async function atualizarUltimaCompra(user) {
  const pool = getPool();
  await repo.atualizarUltimaCompra(pool);
  return { message: 'Última compra atualizada com sucesso' };
}

// ─── ALTERAR DIAS AVISO SEM COMPRA ───────────────────────────────────────────
// Equivalente ao btnAlterarDiasAvisoClick do Delphi

async function atualizarDiasAviso(dias) {
  const pool = getPool();
  const diasNum = parseInt(dias, 10);
  if (isNaN(diasNum) || diasNum < 0) {
    const err = new Error('Quantidade de dias inválida');
    err.statusCode = 400;
    throw err;
  }
  await repo.atualizarDiasAvisoSemCompra(diasNum, pool);
  return { message: `Aviso de cliente sem compra atualizado para ${diasNum} dias` };
}

async function buscarNotificacoes(user) {
  const pool = getPool();
  const isAdmin = user.perfil == 1 || user.acessartodosclientes === 'S';
  let whereUser = isAdmin ? "" : " AND cod_vendedor = " + pool.escape(user.id);

  const [inativos] = await pool.query(`
    SELECT COUNT(*) as total 
    FROM clientes 
    WHERE status = 'A' AND excluido = 'N' 
      AND (dtultimacompra IS NULL OR DATEDIFF(CURDATE(), dtultimacompra) >= 90)
      ${whereUser}
  `).catch(() => [[{total:0}]]);

  const [aniversarios] = await pool.query(`
    SELECT id, nome, dtnascimento 
    FROM clientes 
    WHERE status = 'A' AND excluido = 'N' 
      AND MONTH(dtnascimento) = MONTH(CURDATE()) 
      AND DAY(dtnascimento) = DAY(CURDATE())
      ${whereUser}
  `).catch(() => [[]]);

  const [novos] = await pool.query(`
    SELECT COUNT(*) as total 
    FROM clientes 
    WHERE status = 'A' AND excluido = 'N' 
      AND dtcadastro >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      ${whereUser}
  `).catch(() => [[{total:0}]]);

  return {
    inativos90dias: inativos[0].total,
    aniversarios: aniversarios,
    novos7dias: novos[0].total
  };
}

module.exports = {
  listarClientes,
  buscarCliente,
  criarCliente,
  atualizarCliente,
  ativarCliente,
  inativarCliente,
  excluirCliente,
  consultarCNPJ,
  listarAuxiliares,
  atualizarUltimaCompra,
  atualizarDiasAviso,
  buscarNotificacoes,
};
