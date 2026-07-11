'use strict';

const svc = require('./clientes.service');
const repo           = require('./clientes.repository');
const contatosSvc    = require('./sub/contatos.service');
const sociosSvc      = require('./sub/socios.service');
const faturamentoSvc = require('./sub/faturamento.service');
const refSvc         = require('./sub/referencias.service');
const historicSvc    = require('./sub/historico.service');
const { getPool }    = require('../../config/database');
const { assertUsuarioPodeAcessarCliente } = require('../../config/carteira-politica');
const { getPrepostoContext } = require('../../config/vendedor-visibilidade');

// ─── Helper: statusCode do erro → HTTP status ────────────────────────────────
function httpStatus(err) {
  if (err.statusCode) return err.statusCode;
  if (err.code === 'ER_DUP_ENTRY') return 409;
  return 500;
}

// ─── LISTAR ──────────────────────────────────────────────────────────────────
// Retorna formato compatível com frontend: { clientes, total }
const listar = async (req, res) => {
  try {
    const resultado = await svc.listarClientes(req.query, req.user);
    res.json(resultado); // { clientes: [...], total: N }
  } catch (err) {
    console.error('[clientes/listar]', err.message);
    res.status(httpStatus(err)).json({ error: err.message || 'Erro ao listar clientes' });
  }
};

// ─── BUSCAR POR ID ────────────────────────────────────────────────────────────
// Retorna o objeto do cliente diretamente (compat com frontend)
const buscar = async (req, res) => {
  try {
    const cliente = await svc.buscarCliente(req.params.id, req.user);
    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(cliente);
  } catch (err) {
    console.error('[clientes/buscar]', err.message);
    res.status(httpStatus(err)).json({ error: err.message });
  }
};

// ─── CRIAR ────────────────────────────────────────────────────────────────────
const criar = async (req, res) => {
  try {
    const resultado = await svc.criarCliente(req.body, req.user);
    res.status(201).json({ ok: true, id: resultado.id, message: 'Cliente criado com sucesso' });
  } catch (err) {
    console.error('[clientes/criar]', err.message);
    res.status(httpStatus(err)).json({
      ok: false,
      error: err.message || 'Erro ao criar cliente',
      details: err.details || undefined,
    });
  }
};

// ─── ATUALIZAR ────────────────────────────────────────────────────────────────
const atualizar = async (req, res) => {
  try {
    await svc.atualizarCliente(req.params.id, req.body, req.user);
    res.json({ ok: true, message: 'Cliente atualizado com sucesso' });
  } catch (err) {
    console.error('[clientes/atualizar]', err.message);
    res.status(httpStatus(err)).json({ ok: false, error: err.message });
  }
};

// ─── ATIVAR ───────────────────────────────────────────────────────────────────
const ativar = async (req, res) => {
  try {
    const resultado = await svc.ativarCliente(req.params.id, req.user);
    res.json({ ok: true, message: resultado.message });
  } catch (err) {
    res.status(httpStatus(err)).json({ ok: false, error: err.message });
  }
};

// ─── INATIVAR ─────────────────────────────────────────────────────────────────
const inativar = async (req, res) => {
  try {
    const resultado = await svc.inativarCliente(req.params.id, req.user);
    res.json({ ok: true, message: resultado.message });
  } catch (err) {
    res.status(httpStatus(err)).json({ ok: false, error: err.message });
  }
};

// ─── EXCLUIR ──────────────────────────────────────────────────────────────────
const excluir = async (req, res) => {
  try {
    const resultado = await svc.excluirCliente(req.params.id, req.user);
    res.json({ ok: true, message: resultado.message });
  } catch (err) {
    res.status(httpStatus(err)).json({ ok: false, error: err.message });
  }
};

// ─── CONSULTAR CNPJ ───────────────────────────────────────────────────────────
const consultarCNPJ = async (req, res) => {
  try {
    const dados = await svc.consultarCNPJ(req.params.cnpj);
    res.json({ success: true, data: dados });
  } catch (err) {
    res.status(httpStatus(err)).json({ success: false, error: err.message });
  }
};

// ─── AUXILIARES ───────────────────────────────────────────────────────────────
const auxiliares = async (req, res) => {
  try {
    const dados = await svc.listarAuxiliares(req.params.tipo, req.user, req.query);
    res.json({ success: true, data: dados });
  } catch (err) {
    res.status(httpStatus(err)).json({ success: false, error: err.message });
  }
};

// ─── COMPAT: /lookup/vendedores (formato antigo) ─────────────────────────────
const auxiliaresVendedores = async (req, res) => {
  try {
    const dados = await svc.listarAuxiliares('vendedores', req.user);
    res.json({ vendedores: dados });
  } catch (err) {
    res.json({ vendedores: [] });
  }
};

// ─── ATUALIZAR ÚLTIMA COMPRA ──────────────────────────────────────────────────
const atualizarUltimaCompra = async (req, res) => {
  try {
    const resultado = await svc.atualizarUltimaCompra(req.user);
    res.json({ ok: true, message: resultado.message });
  } catch (err) {
    res.status(httpStatus(err)).json({ ok: false, error: err.message });
  }
};

// ─── ALTERAR DIAS AVISO SEM COMPRA ───────────────────────────────────────────

const atualizarDiasAviso = async (req, res) => {
  try {
    const { dias } = req.body;
    const resultado = await svc.atualizarDiasAviso(dias);
    res.json({ ok: true, message: resultado.message });
  } catch (err) {
    res.status(httpStatus(err)).json({ ok: false, error: err.message });
  }
};

// ─── SUB-RECORD DELETES (usam pool diretamente) ───────────────────────────────
const excluirContato = async (req, res) => {
  try {
    const pool = getPool();
    await contatosSvc.excluirContato(req.params.id, pool);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

const excluirSocio = async (req, res) => {
  try {
    const pool = getPool();
    await sociosSvc.excluirSocio(req.params.id, pool);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

const excluirFaturamento = async (req, res) => {
  try {
    const pool = getPool();
    await faturamentoSvc.excluirFaturamento(req.params.id, pool);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

const excluirRefBancaria = async (req, res) => {
  try {
    const pool = getPool();
    await refSvc.excluirRefBancaria(req.params.id, pool);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

const excluirRefComercial = async (req, res) => {
  try {
    const pool = getPool();
    await refSvc.excluirRefComercial(req.params.id, pool);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
};

// ─── HISTÓRICO: lista completa (pedidos + itens + parcelas) ──────────────────
const historicoLista = async (req, res) => {
  try {
    const pool   = getPool();
    const prepCtx = await getPrepostoContext(pool, req);
    const check = await assertUsuarioPodeAcessarCliente(pool, req.params.id, req.user, prepCtx);
    if (!check.ok) return res.status(check.status || 403).json({ error: check.error });

    const config = await repo.getSistemaConfig(pool, req.user?.id_empresa).catch(() => ({}));
    const dados  = await historicSvc.buscarHistoricoCompleto(
      req.params.id,
      pool,
      {
        gcompartilhaCliente:  config.gcompartilhaCliente,
        gIdEmpresa:           req.user?.id_empresa,
        ghabilitapedidograde: config.ghabilitapedidograde,
      }
    );
    res.json(dados); // Array de { pedido, itens, parcelas }
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
};

// ─── HISTÓRICO: detalhe de pedido (itens + parcelas) ─────────────────────────
const historicoDetalhe = async (req, res) => {
  try {
    const pool = getPool();
    const prepCtx = await getPrepostoContext(pool, req);
    const numpedido = req.params.numpedido;
    const [[pedRow]] = await pool.query(
      `SELECT cod_cliente FROM pedidos WHERE numero = ? AND (excluido = 'N' OR excluido IS NULL) LIMIT 1`,
      [numpedido]
    ).catch(() => [[]]);
    if (pedRow?.cod_cliente) {
      const check = await assertUsuarioPodeAcessarCliente(pool, pedRow.cod_cliente, req.user, prepCtx);
      if (!check.ok) return res.status(check.status || 403).json({ error: check.error });
    }

    const data = await historicSvc.buscarDetalhesPedido(numpedido, pool);
    res.json(data);
  } catch (e) {
    res.status(500).json({ erro: e.message });
  }
};

// ─── FINANCEIRO ──────────────────────────────────────────────────────────────
const financeiro = async (req, res) => {
  try {
    const pool = getPool();
    const prepCtx = await getPrepostoContext(pool, req);
    const check = await assertUsuarioPodeAcessarCliente(pool, req.params.id, req.user, prepCtx);
    if (!check.ok) return res.status(check.status || 403).json({ error: check.error });

    const [rows] = await pool.query(`
      SELECT r.status, r.vencimento, r.valor, p.forma_pagto, p.data_abertura, p.numero as pedido
      FROM receber r
      INNER JOIN pedidos p ON r.numero = p.numero
      WHERE p.cod_cliente = ? AND (p.excluido = 'N' OR p.excluido IS NULL)
      ORDER BY r.vencimento DESC
      LIMIT 50
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
const notificacoes = async (req, res) => {
  try {
    const dados = await svc.buscarNotificacoes(req.user);
    res.json(dados);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const checkCnpj = async (req, res) => {
  try {
    const pool = getPool();
    const { cpf, excluir_id } = req.query;
    if (!cpf?.trim()) return res.status(400).json({ error: 'CPF/CNPJ obrigatório' });

    const [sys] = await pool.query(
      `SELECT gpermitecnpjduplicadoclientes FROM sistemas ORDER BY id DESC LIMIT 1`
    ).catch(() => [[]]);
    if ((sys[0]?.gpermitecnpjduplicadoclientes || 'S').toUpperCase() === 'S')
      return res.json({ permiteDuplicado: true, duplicado: false, cliente: null });

    const docLimpo = cpf.replace(/\D/g, '');
    let sql  = `SELECT id, nome, apelido, cpf, foneprincipal, cidade, uf, status
                FROM clientes
                WHERE REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),'/','') = ?
                  AND (excluido = 'N' OR excluido IS NULL OR excluido = '')`;
    const vals = [docLimpo];
    if (excluir_id) { sql += ` AND id <> ?`; vals.push(parseInt(excluir_id, 10)); }
    sql += ` LIMIT 1`;

    const [rows] = await pool.query(sql, vals);
    res.json(rows[0]
      ? { permiteDuplicado: false, duplicado: true,  cliente: rows[0] }
      : { permiteDuplicado: false, duplicado: false, cliente: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const aniversariantes = async (req, res) => {
  try {
    const pool = getPool();
    const dias = Math.min(Math.max(parseInt(req.query.dias || 30, 10), 1), 90);
    const hoje = new Date();
    const fim = new Date(hoje);
    fim.setDate(hoje.getDate() + dias);

    const mesH = hoje.getMonth() + 1;
    const diaH = hoje.getDate();
    const mesF = fim.getMonth() + 1;
    const diaF = fim.getDate();

    let sql;
    let vals;
    if (mesH === mesF) {
      sql = `SELECT id, nome, apelido, dtnascimento, foneprincipal AS celular, cidade, uf
             FROM clientes
             WHERE (excluido='N' OR excluido IS NULL OR excluido='')
               AND dtnascimento IS NOT NULL
               AND MONTH(dtnascimento)=? AND DAY(dtnascimento) BETWEEN ? AND ?
             ORDER BY DAY(dtnascimento) LIMIT 100`;
      vals = [mesH, diaH, diaF];
    } else {
      sql = `SELECT id, nome, apelido, dtnascimento, foneprincipal AS celular, cidade, uf
             FROM clientes
             WHERE (excluido='N' OR excluido IS NULL OR excluido='')
               AND dtnascimento IS NOT NULL
               AND ((MONTH(dtnascimento)=? AND DAY(dtnascimento)>=?)
                 OR (MONTH(dtnascimento)=? AND DAY(dtnascimento)<=?))
             ORDER BY MONTH(dtnascimento), DAY(dtnascimento) LIMIT 100`;
      vals = [mesH, diaH, mesF, diaF];
    }

    const [rows] = await pool.query(sql, vals);
    const hoje_mes = mesH;
    const hoje_dia = diaH;
    const result = rows.map(r => {
      const dt = r.dtnascimento ? new Date(r.dtnascimento) : null;
      const mes = dt ? dt.getUTCMonth() + 1 : null;
      const dia = dt ? dt.getUTCDate() : null;
      const hoje_aniver = mes === hoje_mes && dia === hoje_dia;
      const dias_faltam = (() => {
        if (!dt) return null;
        const thisYear = hoje.getFullYear();
        let aniver = new Date(thisYear, mes - 1, dia);
        if (aniver < hoje) aniver = new Date(thisYear + 1, mes - 1, dia);
        return Math.round((aniver - hoje) / 86400000);
      })();
      return { ...r, hoje_aniver, dias_faltam };
    });
    res.json({ clientes: result, total: result.length, dias });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── LIGAÇÕES (teleatendimento) ───────────────────────────────────────────────
const ligacoes = async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT ch.id, ch.data_hora_inicio, ch.data_hora_fim, ch.duracao_seg,
             ch.resultado, ch.observacao, ch.id_pedido, ch.id_lead,
             tc.nome AS nome_campanha,
             u.nomeusu AS nome_operador
      FROM tele_chamadas ch
      LEFT JOIN tele_campanhas tc ON tc.id = ch.id_campanha
      LEFT JOIN usuarios u ON u.idusuario = ch.id_operador
      WHERE ch.id_cliente = ?
      ORDER BY ch.data_hora_inicio DESC
      LIMIT 50
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return res.json([]);
    console.error('[clientes/ligacoes]', err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  listar,
  buscar,
  criar,
  atualizar,
  ativar,
  inativar,
  excluir,
  consultarCNPJ,
  auxiliares,
  auxiliaresVendedores,
  atualizarUltimaCompra,
  atualizarDiasAviso,
  excluirContato,
  excluirSocio,
  excluirFaturamento,
  excluirRefBancaria,
  excluirRefComercial,
  historicoLista,
  historicoDetalhe,
  financeiro,
  ligacoes,
  notificacoes,
  checkCnpj,
  aniversariantes,
};
