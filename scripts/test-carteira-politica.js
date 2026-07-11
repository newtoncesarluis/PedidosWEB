#!/usr/bin/env node
'use strict';

/**
 * Testes unitários da política de carteira (sem banco).
 * Executar: node scripts/test-carteira-politica.js
 */

const assert = require('assert');
const cp = require('../config/carteira-politica');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

const vendedorA = { id: 10, idusuario: 10, perfil: 2, permissoes: {} };
const vendedorB = { id: 20, idusuario: 20, perfil: 2, permissoes: {} };
const admin = { id: 1, perfil: 1, role: 'admin', permissoes: {} };
const gerente = { id: 30, perfil: 2, permissoes: { gerentecomercial: 'S' } };
const backoffice = { id: 40, perfil: 2, permissoes: { acessartodosclientes: 'S' } };
const prepCtxTodos = { idRep: 10, idPreposto: 99, modo: 'TODOS', pedidosVisib: 'CARTEIRA' };
const prepCtxAtrib = { idRep: 10, idPreposto: 99, modo: 'ATRIBUIDOS', pedidosVisib: 'CARTEIRA' };

console.log('\n=== carteira-politica — testes unitários ===\n');

test('LEGADO: vendedor filtra por cod_vendedor', () => {
  const f = cp.buildClienteVendedorWhere(vendedorA, 'c', null, { carteira_politica: 'LEGADO' });
  assert.ok(f.clause.includes('cod_vendedor'));
  assert.deepStrictEqual(f.params, [10, 10]);
});

test('LEGADO: admin sem filtro', () => {
  const f = cp.buildClienteVendedorWhere(admin, 'c', null, { carteira_politica: 'LEGADO' });
  assert.strictEqual(f.clause, '');
  assert.deepStrictEqual(f.params, []);
});

test('LEGADO: gerente inclui subordinados', () => {
  const f = cp.buildClienteVendedorWhere(gerente, 'c', null, { carteira_politica: 'LEGADO' });
  assert.ok(f.clause.includes('id_gerente'));
});

test('LEGADO: backoffice sem filtro', () => {
  const f = cp.buildClienteVendedorWhere(backoffice, 'c', null, { carteira_politica: 'LEGADO' });
  assert.strictEqual(f.clause, '');
});

test('ABERTA: vendedor comum sem filtro', () => {
  const f = cp.buildClienteVendedorWhere(vendedorA, 'c', null, { carteira_politica: 'ABERTA' });
  assert.strictEqual(f.clause, '');
});

test('ABERTA: preposto ATRIBUIDOS ainda filtra', () => {
  const f = cp.buildClienteVendedorWhere(vendedorA, 'c', prepCtxAtrib, { carteira_politica: 'ABERTA' });
  assert.ok(f.clause.includes('preposto_cliente'));
});

test('FECHADA: força vendedor no cadastro', () => {
  assert.strictEqual(cp.deveForcarVendedorNoCadastro(vendedorA, { carteira_politica: 'FECHADA' }), true);
});

test('FECHADA: admin não força', () => {
  assert.strictEqual(cp.deveForcarVendedorNoCadastro(admin, { carteira_politica: 'FECHADA' }), false);
});

test('FECHADA: backoffice com acessartodosclientes não força', () => {
  assert.strictEqual(cp.deveForcarVendedorNoCadastro(backoffice, { carteira_politica: 'FECHADA' }), false);
});

test('LEGADO: força só com gacessartodosclientes=S', () => {
  assert.strictEqual(cp.deveForcarVendedorNoCadastro(vendedorA, { carteira_politica: 'LEGADO', gacessartodosclientes: 'N' }), false);
  assert.strictEqual(cp.deveForcarVendedorNoCadastro(vendedorA, { carteira_politica: 'LEGADO', gacessartodosclientes: 'S' }), true);
});

test('resolveCodVendedorGravacao: preposto → representante', () => {
  const id = cp.resolveCodVendedorGravacao(vendedorA, { carteira_politica: 'FECHADA' }, prepCtxTodos, null);
  assert.strictEqual(id, 10);
});

test('resolveCodVendedorGravacao: FECHADA → usuário logado', () => {
  const id = cp.resolveCodVendedorGravacao(vendedorB, { carteira_politica: 'FECHADA' }, null, 99);
  assert.strictEqual(id, 20);
});

test('compat: sem config = LEGADO (vendedor filtrado)', () => {
  const f = cp.buildClienteVendedorWhere(vendedorA, 'c');
  assert.ok(f.clause.includes('cod_vendedor'));
});

test('normalizeModo: inválido → LEGADO', () => {
  assert.strictEqual(cp.normalizeModo('xyz'), 'LEGADO');
});

test('codVendedorInformado: rejeita vazio e zero', () => {
  assert.strictEqual(cp.codVendedorInformado(null), false);
  assert.strictEqual(cp.codVendedorInformado(''), false);
  assert.strictEqual(cp.codVendedorInformado('0'), false);
  assert.strictEqual(cp.codVendedorInformado(0), false);
  assert.strictEqual(cp.codVendedorInformado('12'), true);
});

test('validarCliente: FECHADA exige cod_vendedor', () => {
  const { validarCliente } = require('../modules/clientes/clientes.validator');
  const r = validarCliente(
    { nome: 'Teste', tipo_pessoa: 'JURIDICA', cpf: '59.146.514/0003-54' },
    { carteira_politica: 'FECHADA' }
  );
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(e => e.includes('Vendedor')));
});

console.log(`\nResultado: ${passed} ok, ${failed} falha(s)\n`);
process.exit(failed > 0 ? 1 : 0);
