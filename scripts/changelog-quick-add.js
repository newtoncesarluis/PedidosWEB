#!/usr/bin/env node
'use strict';
/**
 * Adiciona entrada rápida à fila de changelog (deploy manual).
 * Uso: node scripts/changelog-quick-add.js "Titulo" "Descricao" [NOVO|MELHORIA|BUG]
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'config', 'changelog-queue.js');
const titulo = (process.argv[2] || '').trim();
const descricao = (process.argv[3] || '').trim();
const tipoArg = String(process.argv[4] || 'MELHORIA').toUpperCase();
const tipo = ['NOVO', 'MELHORIA', 'BUG'].includes(tipoArg) ? tipoArg : 'MELHORIA';

if (!titulo) {
  console.error('Uso: node scripts/changelog-quick-add.js "Titulo" "Descricao" [tipo]');
  process.exit(1);
}

let versao = '0.0.0.0';
try {
  versao = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'version.json'), 'utf8')).versao || versao;
} catch (_) {}

let content = fs.readFileSync(FILE, 'utf8');
const needle = 'titulo: ' + JSON.stringify(titulo);
if (content.includes(needle)) {
  console.log('Ja existe na fila:', titulo);
  process.exit(0);
}

const data = new Date().toISOString().substring(0, 10);
const entry =
  '  {\n' +
  "    versao: '" + versao + "',\n" +
  "    tipo: '" + tipo + "',\n" +
  '    titulo: ' + JSON.stringify(titulo) + ',\n' +
  '    descricao: ' + JSON.stringify(descricao) + ',\n' +
  "    data_lancamento: '" + data + "',\n" +
  '  },\n';

if (!/\];\s*$/.test(content.trimEnd())) {
  console.error('Formato inesperado em changelog-queue.js');
  process.exit(1);
}

content = content.replace(/\];\s*$/, entry + '];\n');
fs.writeFileSync(FILE, content, 'utf8');
console.log('Fila atualizada: [' + tipo + '] ' + titulo + ' (v' + versao + ')');
