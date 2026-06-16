#!/usr/bin/env node
'use strict';
/**
 * Gestão da versão semântica do app (MAJOR.MINOR.RELEASE.SEQUENCIAL).
 * Lê/grava ../version.json. Preserva campos extras (ex.: _comment).
 *
 * Uso:
 *   node scripts/bump-version.js            → incrementa SEQUENCIAL (4º número)
 *   node scripts/bump-version.js seq        → idem
 *   node scripts/bump-version.js release    → +1 RELEASE, zera sequencial
 *   node scripts/bump-version.js minor      → +1 MINOR, zera release+seq
 *   node scripts/bump-version.js major      → +1 MAJOR, zera o resto
 *   node scripts/bump-version.js 1.2.0.0    → define versão exata
 *   node scripts/bump-version.js set 1.2.0.0→ define versão exata
 *   node scripts/bump-version.js show       → só imprime a versão atual (não altera)
 *
 * Sempre imprime a versão resultante no stdout (sem quebra de linha).
 */
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'version.json');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (_) { return { versao: '0.0.0.0' }; }
}
function parse(v) {
  const p = String(v || '0.0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  while (p.length < 4) p.push(0);
  return p.slice(0, 4);
}
function write(obj) {
  fs.writeFileSync(FILE, JSON.stringify(obj, null, 2) + '\n');
}

const data = read();
let parts = parse(data.versao);
const cmd = String(process.argv[2] || 'seq').toLowerCase();
const arg = process.argv[3];

if (cmd === 'show') {
  process.stdout.write(parts.join('.'));
  process.exit(0);
}

switch (cmd) {
  case 'major':   parts = [parts[0] + 1, 0, 0, 0]; break;
  case 'minor':   parts = [parts[0], parts[1] + 1, 0, 0]; break;
  case 'release': parts = [parts[0], parts[1], parts[2] + 1, 0]; break;
  case 'seq':
  case 'patch':
  case 'sequencial': parts = [parts[0], parts[1], parts[2], parts[3] + 1]; break;
  case 'set': parts = parse(arg); break;
  default:
    // versão passada diretamente (ex.: "1.2.0.0")
    if (/^\d+(\.\d+){0,3}$/.test(cmd)) parts = parse(cmd);
    else parts = [parts[0], parts[1], parts[2], parts[3] + 1];
}

data.versao = parts.join('.');
write(data);
process.stdout.write(data.versao);
