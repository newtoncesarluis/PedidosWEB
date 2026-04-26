'use strict';

const svc = require('./clientes.service');
const repo           = require('./clientes.repository');
const contatosSvc    = require('./sub/contatos.service');
const sociosSvc      = require('./sub/socios.service');
const faturamentoSvc = require('./sub/faturamento.service');
const refSvc         = require('./sub/referencias.service');
const historicSvc    = require('./sub/historico.service');
const { getPool }    = require('../../config/database');

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
    const numpedido = req.params.numpedido;
    const pool = getPool();
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
  notificacoes,
};
