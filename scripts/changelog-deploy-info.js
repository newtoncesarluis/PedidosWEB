#!/usr/bin/env node
'use strict';
/**
 * Resumo das novidades na fila para a versão atual (deploy).
 * Uso: node scripts/changelog-deploy-info.js
 */
const fs = require('fs');
const path = require('path');

const verFile = path.join(__dirname, '..', 'version.json');
let versao = '?';
try {
  versao = JSON.parse(fs.readFileSync(verFile, 'utf8')).versao || '?';
} catch (_) {}

let queue = [];
try {
  queue = require('../config/changelog-queue');
} catch (_) {}

const desta = queue.filter((e) => String(e.versao) === String(versao));
const outras = queue.filter((e) => String(e.versao) !== String(versao));

console.log('');
console.log('  Versao do deploy : ' + versao);
console.log('  Novidades na fila: ' + desta.length + ' para esta versao');
if (desta.length) {
  desta.forEach((e) => {
    console.log('    - [' + (e.tipo || 'MELHORIA') + '] ' + (e.titulo || ''));
  });
}
if (outras.length) {
  console.log('  Outras versoes na fila: ' + outras.length + ' (revise config/changelog-queue.js)');
}
console.log('');
console.log('  No servidor: entradas sincronizam no login do tenant.');
console.log('  Usuarios veem o modal na home. Admin: Sistema > Notas de Versao.');
console.log('');
