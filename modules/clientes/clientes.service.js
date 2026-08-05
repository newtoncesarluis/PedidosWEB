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
const { getPrepostoContext } = require('../../config/vendedor-visibilidade');
const {
  getSistemaCarteiraConfig,
  resolveCodVendedorGravacao,
  vendedorObrigatorioNaCarteira,
  codVendedorInformado,
} = require('../../config/carteira-politica');
const { validarCliente, validarCpfCnpj } = require('./clientes.validator');
const representadasSvc = require('./sub/representadas.service');
const {
  ensureSegmentosTable,
  migrateSegmentosClienteFromCategoria,
} = require('../../config/segmentos-migrate');

/**
 * Resolve cod_segmento → descrição na tabela segmentos (não categoria de produto).
 * Combo do front (/api/categorias) já lê segmentos; validação precisa da mesma fonte.
 */
async function resolveSegmentoCliente(pool, codSegmento, segmentoTexto) {
  let descricao = segmentoTexto || null;
  const raw = String(codSegmento ?? '').trim();
  const id = parseInt(raw, 10);
  if (!raw || !(id > 0)) {
    return { cod_segmento: null, segmento: descricao || null };
  }
  await ensureSegmentosTable(pool);
  await migrateSegmentosClienteFromCategoria(pool).catch(() => {});
  const [segRows] = await pool.query(
    `SELECT id, descricao FROM segmentos
     WHERE id = ? AND COALESCE(excluido,'N') = 'N' AND COALESCE(status,'A') = 'A'
     LIMIT 1`,
    [id]
  ).catch(() => [[]]);
  if (!segRows[0]) {
    const err = new Error('Segmento informado não existe ou está inativo');
    err.statusCode = 400;
    throw err;
  }
  return { cod_segmento: id, segmento: segRows[0].descricao };
}

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
    representadasSvc.buscarRepresentadas(id, pool),
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
  const representadas = val(9);

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
    representadas,
  };
}

// ─── CRIAR ────────────────────────────────────────────────────────────────────

async function criarCliente(body, user) {
  const pool = getPool();
  const sysCfg = await getSistemaCarteiraConfig(pool);
  const config = { ...(await repo.getSistemaConfig(pool, user.id_empresa)), ...sysCfg };

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

  // Validar cod_segmento na tabela segmentos (cliente) — não em categoria (produto)
  const segNovo = await resolveSegmentoCliente(pool, body.cod_segmento, body.segmento);

  // ── Montar dados base ────────────────────────────────────────────────────────
  const dados = { ...body };
  dados.cod_segmento = segNovo.cod_segmento;
  if (segNovo.segmento) dados.segmento = segNovo.segmento;
  else if (!segNovo.cod_segmento) dados.segmento = null;

  // Flag trava de representadas — default N (não altera fluxo atual)
  const restNovo = String(body.restringe_representadas || 'N').toUpperCase();
  dados.restringe_representadas = restNovo === 'S' ? 'S' : 'N';

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

  const prepCtxNovo = await getPrepostoContext(pool, { user });
  dados.cod_vendedor = resolveCodVendedorGravacao(
    user,
    sysCfg,
    prepCtxNovo,
    dados.cod_vendedor
  );
  if (vendedorObrigatorioNaCarteira(sysCfg) && !codVendedorInformado(dados.cod_vendedor)) {
    const err = new Error('Vendedor / representante é obrigatório');
    err.statusCode = 400;
    throw err;
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
    if (Array.isArray(body.representadas)) await representadasSvc.salvarRepresentadas(novoId, body.representadas, conn);
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
  const sysCfg = await getSistemaCarteiraConfig(pool);
  const config = { ...(await repo.getSistemaConfig(pool, user.id_empresa)), ...sysCfg };

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

  // Validar cod_segmento na tabela segmentos (cliente) — não em categoria (produto)
  const segUpd = await resolveSegmentoCliente(pool, body.cod_segmento, body.segmento);

  // ── Montar dados base ────────────────────────────────────────────────────────
  const dadosAtualizar = { ...body };
  dadosAtualizar.cod_segmento = segUpd.cod_segmento;
  if (segUpd.segmento) dadosAtualizar.segmento = segUpd.segmento;
  else if (!segUpd.cod_segmento) dadosAtualizar.segmento = null;

  const restUpd = String(body.restringe_representadas || 'N').toUpperCase();
  dadosAtualizar.restringe_representadas = restUpd === 'S' ? 'S' : 'N';

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

  const prepCtxUpd = await getPrepostoContext(pool, { user });
  dadosAtualizar.cod_vendedor = resolveCodVendedorGravacao(
    user,
    sysCfg,
    prepCtxUpd,
    dadosAtualizar.cod_vendedor
  );
  if (vendedorObrigatorioNaCarteira(sysCfg) && !codVendedorInformado(dadosAtualizar.cod_vendedor)) {
    const err = new Error('Vendedor / representante é obrigatório');
    err.statusCode = 400;
    throw err;
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
    if (Array.isArray(dadosAtualizar.representadas)) {
      await representadasSvc.salvarRepresentadas(id, dadosAtualizar.representadas, conn);
    }
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

          // Mapear campos da ReceitaWS para campos do cliente.
          // ReceitaWS (Receita Federal) NÃO retorna inscrição estadual — IE vem de SEFAZ/SINTEGRA.
          // abertura = data de fundação / início de atividade (DD/MM/YYYY no provedor).
          const aberturaRaw = String(json.abertura || '').trim();
          let data_abertura = '';
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(aberturaRaw)) {
            const [dd, mm, yyyy] = aberturaRaw.split('/');
            data_abertura = `${yyyy}-${mm}-${dd}`;
          } else if (/^\d{4}-\d{2}-\d{2}/.test(aberturaRaw)) {
            data_abertura = aberturaRaw.slice(0, 10);
          }
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
            abertura: aberturaRaw,
            data_abertura,
            capital_social: json.capital_social || '',
            atividade_principal: json.atividade_principal?.[0]?.text || '',
            natureza_juridica: json.natureza_juridica || '',
            // Explícito: este provedor não entrega IE
            inscricao_estadual: null,
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
    if (String(config.gcompartilhaCliente || '').toUpperCase() === 'N' && user?.id_empresa) {
      // Legado: clientes sem id_empresa continuam visíveis
      sql += ` AND (id_empresa = ? OR id_empresa IS NULL OR TRIM(CAST(id_empresa AS CHAR)) = '' OR CAST(id_empresa AS CHAR) = '0')`;
      vals.push(user.id_empresa);
    }
    sql += ` ORDER BY nome`;
    const [rows] = await pool.query(sql, vals).catch(() => [[]]);
    return rows;
  }

  const queries = {
    'regioes':         `SELECT id, CONCAT(descricao, IF(sigla IS NOT NULL AND sigla != '', CONCAT(' (', sigla, ')'), '')) AS nome FROM regiao_rota WHERE (status='A' OR status IS NULL) AND (excluido='N' OR excluido IS NULL) ORDER BY descricao`,
    'segmentos':       null, // tratado abaixo (tabela segmentos)
    'formas-pagto':    `SELECT id, descricao AS nome FROM forma_pagto WHERE status='S' AND excluido='N' ORDER BY descricao`,
    'tabelas-preco':   `SELECT id, descricao AS nome FROM tabela_preco WHERE status='N' AND excluido='N' ORDER BY descricao`,
    'campos-cadastro':  `SELECT id, nome FROM campos_cadastros WHERE excluido='N' ORDER BY nome`,
    'ramo-atividades':  `SELECT id, descricao AS nome FROM ramo_atividades WHERE excluido='N' ORDER BY descricao`,
    'cores':            `SELECT id, descricao AS nome FROM cores WHERE status='A' AND excluido='N' ORDER BY descricao`,
    'racas':            `SELECT id, descricao AS nome FROM raca WHERE status='A' AND excluido='N' ORDER BY descricao`,
  };

  if (tipo === 'segmentos') {
    await ensureSegmentosTable(pool);
    await migrateSegmentosClienteFromCategoria(pool).catch(() => {});
    const [rows] = await pool.query(
      `SELECT id, descricao AS nome FROM segmentos
       WHERE COALESCE(status,'A')='A' AND COALESCE(excluido,'N')='N'
         AND (UPPER(COALESCE(uso,'AMBOS')) = 'AMBOS' OR UPPER(COALESCE(uso,'AMBOS')) = 'CLIENTE')
       ORDER BY descricao`
    ).catch(() => [[]]);
    return rows;
  }

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
