'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('./clientes.controller');

// ─── Rotas de auxiliares (antes de /:id para evitar conflito) ─────────────────
router.get('/auxiliares/:tipo', ctrl.auxiliares);
router.get('/consulta-cnpj/:cnpj', ctrl.consultarCNPJ);
router.get('/notificacoes',        ctrl.notificacoes);
router.post('/atualizar-ultima-compra', ctrl.atualizarUltimaCompra);
router.post('/dias-aviso',              ctrl.atualizarDiasAviso);

// ─── Exclusão de sub-registros ────────────────────────────────────────────────
router.delete('/contatos/:id', ctrl.excluirContato);
router.delete('/socios/:id', ctrl.excluirSocio);
router.delete('/faturamento/:id', ctrl.excluirFaturamento);
router.delete('/ref-bancarias/:id', ctrl.excluirRefBancaria);
router.delete('/ref-comerciais/:id', ctrl.excluirRefComercial);

// ─── Compat: rota antiga usada pelo frontend ──────────────────────────────────
router.get('/lookup/vendedores', ctrl.auxiliaresVendedores);

// ─── Histórico e Financeiro de pedidos por cliente ────────────────────────────────────────
router.get('/:id/historico',            ctrl.historicoLista);
router.get('/:id/historico/:numpedido', ctrl.historicoDetalhe);
router.get('/:id/financeiro',           ctrl.financeiro);

// ─── CRUD principal ───────────────────────────────────────────────────────────
router.get('/', ctrl.listar);
router.get('/:id', ctrl.buscar);
router.post('/', ctrl.criar);
router.put('/:id', ctrl.atualizar);
// Aceita PATCH e PUT para ativar/inativar (compat com frontend legado)
router.patch('/:id/ativar',   ctrl.ativar);
router.patch('/:id/inativar', ctrl.inativar);
router.put('/:id/ativar',     ctrl.ativar);
router.put('/:id/inativar',   ctrl.inativar);
router.delete('/:id', ctrl.excluir);

module.exports = router;
