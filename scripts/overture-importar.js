#!/usr/bin/env node
'use strict';
/**
 * Importa lugares (comércios/serviços) do Overture Maps — dados abertos — para a tabela
 * `overture_lugares` usada por GET /api/geolocalizacao/lugares.  Rodar ~1x por mês.
 *
 * Requisitos (somente para ESTE script; o servidor não depende disso):
 *     npm i --no-save @duckdb/node-api
 *
 * Exemplos:
 *     node scripts/overture-importar.js --uf SP                       # estado inteiro
 *     node scripts/overture-importar.js --uf SP,MG,PR --conf 0.5
 *     node scripts/overture-importar.js --centro -22.3246,-49.0871 --raio 25   # raio em km
 *     node scripts/overture-importar.js --bbox -49.2,-22.4,-48.9,-22.2
 *     node scripts/overture-importar.js --uf SP --dry-run              # só conta, não grava
 *     node scripts/overture-importar.js --uf SP --saida lugares.ndjson # só exporta o arquivo
 *
 * Opções: --release AAAA-MM-DD.N (padrão: a mais recente) · --conf 0.4 (confiança mínima)
 *         --manter-antigos (não apaga registros de releases anteriores na região)
 *
 * Onde grava: ver config/lugares-overture.js (OVERTURE_DB_* no .env, senão nc_painel).
 * Agendar (exemplos): cron  `0 3 5 * * cd /caminho/SysRepWeb && node scripts/overture-importar.js --uf SP >> logs/overture.log 2>&1`
 *                     ou Agendador de Tarefas do Windows / PM2 cron_restart.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const readline = require('readline');

// [oeste, sul, leste, norte] aproximados de cada UF (inclui um pouco da vizinhança; o filtro país=BR limpa o resto)
const UF_BBOX = {
  AC: [-74.0, -11.2, -66.6, -7.1], AL: [-38.3, -10.5, -35.1, -8.8], AP: [-54.9, -1.3, -49.8, 4.5], AM: [-73.8, -9.9, -56.1, 2.3],
  BA: [-46.7, -18.4, -37.3, -8.5], CE: [-41.5, -7.9, -37.2, -2.7], DF: [-48.3, -16.1, -47.3, -15.5], ES: [-41.9, -21.4, -39.6, -17.9],
  GO: [-53.3, -19.6, -45.9, -12.4], MA: [-48.8, -10.3, -41.8, -1.0], MT: [-61.7, -18.1, -50.2, -7.3], MS: [-58.2, -24.1, -50.9, -17.2],
  MG: [-51.1, -22.9, -39.8, -14.2], PA: [-58.9, -9.9, -46.0, 2.6], PB: [-38.8, -8.3, -34.8, -6.0], PR: [-54.7, -26.8, -48.0, -22.5],
  PE: [-41.4, -9.5, -34.8, -7.3], PI: [-45.9, -10.9, -40.4, -2.7], RJ: [-44.9, -23.4, -40.9, -20.7], RN: [-38.6, -6.98, -34.9, -4.8],
  RS: [-57.7, -33.8, -49.7, -27.0], RO: [-66.8, -13.7, -59.8, -7.9], RR: [-64.8, -1.6, -58.9, 5.3], SC: [-53.9, -29.4, -48.3, -25.9],
  SP: [-53.2, -25.4, -44.1, -19.7], SE: [-38.3, -11.6, -36.4, -9.5], TO: [-50.8, -13.5, -45.7, -5.1],
};

function parseArgs(argv) {
  const a = { conf: 0.4, limpar: true };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--uf') a.uf = String(v()).toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
    else if (k === '--centro') a.centro = String(v()).split(',').map(Number);
    else if (k === '--raio') a.raio = parseFloat(v());
    else if (k === '--bbox') a.bbox = String(v()).split(',').map(Number);
    else if (k === '--release') a.release = v();
    else if (k === '--conf') a.conf = parseFloat(v());
    else if (k === '--saida') a.saida = v();
    else if (k === '--dry-run') a.dry = true;
    else if (k === '--manter-antigos') a.limpar = false;
  }
  return a;
}

function resolverRegioes(a) {
  const out = [];
  (a.uf || []).forEach(uf => {
    if (!UF_BBOX[uf]) throw new Error('UF inválida: ' + uf);
    const [w, s, e, n] = UF_BBOX[uf];
    out.push({ nome: uf, w, s, e, n });
  });
  if (a.centro && a.centro.length === 2 && a.centro.every(isFinite)) {
    const km = a.raio || 15;
    const dLat = km / 111;
    const dLng = km / (111 * Math.max(0.2, Math.cos(a.centro[0] * Math.PI / 180)));
    out.push({ nome: `raio ${km} km`, w: a.centro[1] - dLng, s: a.centro[0] - dLat, e: a.centro[1] + dLng, n: a.centro[0] + dLat });
  }
  if (a.bbox && a.bbox.length === 4 && a.bbox.every(isFinite)) {
    const [w, s, e, n] = a.bbox;
    out.push({ nome: 'bbox', w, s, e, n });
  }
  if (!out.length) throw new Error('Informe a região: --uf SP | --centro lat,lng --raio km | --bbox w,s,e,n');
  return out;
}

function ultimaRelease() {
  return new Promise((resolve, reject) => {
    https.get('https://overturemaps-us-west-2.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/', (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const rel = [...d.matchAll(/<Prefix>release\/([0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+)\/<\/Prefix>/g)].map(m => m[1]).sort();
        if (!rel.length) return reject(new Error('Não consegui listar as releases do Overture'));
        resolve(rel[rel.length - 1]);
      });
    }).on('error', reject);
  });
}

async function exportarNdjson({ release, regiao, conf, arquivo }) {
  let DuckDBInstance;
  try { ({ DuckDBInstance } = require('@duckdb/node-api')); }
  catch (_) { throw new Error('Falta o DuckDB. Rode:  npm i --no-save @duckdb/node-api'); }
  const inst = await DuckDBInstance.create(':memory:');
  const conn = await inst.connect();
  await conn.run('INSTALL httpfs');
  await conn.run('LOAD httpfs');
  await conn.run("SET s3_region='us-west-2'");
  const src = `s3://overturemaps-us-west-2/release/${release}/theme=places/type=place/*`;
  const dest = arquivo.replace(/\\/g, '/').replace(/'/g, "''");
  const sql = `
    COPY (
      SELECT id,
             names.primary                  AS nome,
             taxonomy.primary               AS categoria,
             basic_category                 AS categoria_basica,
             phones[1]                      AS fone,
             websites[1]                    AS site,
             emails[1]                      AS email,
             addresses[1].freeform          AS endereco,
             addresses[1].locality          AS cidade,
             addresses[1].region            AS uf,
             addresses[1].postcode          AS cep,
             round(bbox.ymin, 6)            AS lat,
             round(bbox.xmin, 6)            AS lng,
             round(coalesce(confidence, 0), 3) AS confianca
        FROM read_parquet('${src}', hive_partitioning = 1)
       WHERE bbox.xmin BETWEEN ${regiao.w} AND ${regiao.e}
         AND bbox.ymin BETWEEN ${regiao.s} AND ${regiao.n}
         AND names.primary IS NOT NULL
         AND coalesce(confidence, 0) >= ${conf}
         AND coalesce(addresses[1].country, 'BR') = 'BR'
    ) TO '${dest}' (FORMAT JSON)`;
  await conn.run(sql);
  if (conn.closeSync) conn.closeSync();
  if (inst.closeSync) inst.closeSync();
}

const COLS = ['id', 'nome', 'categoria', 'categoria_basica', 'fone', 'site', 'email', 'endereco', 'cidade', 'uf', 'cep', 'lat', 'lng', 'confianca', 'release_ver'];
const cut = (v, n) => (v == null ? '' : String(v).slice(0, n));

function linhaParaRegistro(o, release) {
  const lat = Number(o.lat), lng = Number(o.lng);
  if (!o.id || !isFinite(lat) || !isFinite(lng)) return null;
  const uf = cut(o.uf, 5).toUpperCase();
  return [
    cut(o.id, 40), cut(o.nome, 200), cut(o.categoria, 80), cut(o.categoria_basica, 80),
    cut(o.fone, 30), cut(o.site, 255), cut(o.email, 150), cut(o.endereco, 255), cut(o.cidade, 100),
    uf.length === 2 ? uf : '', cut(o.cep, 12), lat, lng, Number(o.confianca) || 0, release,
  ];
}

async function carregarNoMysql(pool, arquivo, release, log) {
  const sql = `INSERT INTO overture_lugares (${COLS.join(',')}) VALUES ?
               ON DUPLICATE KEY UPDATE ${COLS.slice(1).map(c => `${c}=VALUES(${c})`).join(',')}`;
  const rl = readline.createInterface({ input: fs.createReadStream(arquivo, { encoding: 'utf8' }), crlfDelay: Infinity });
  let batch = [], total = 0, ignorados = 0;
  const flush = async () => {
    if (!batch.length) return;
    await pool.query(sql, [batch]);
    total += batch.length; batch = [];
    if (total % 20000 === 0) log(`  ${total.toLocaleString('pt-BR')} registros...`);
  };
  for await (const linha of rl) {
    if (!linha.trim()) continue;
    let o; try { o = JSON.parse(linha); } catch (_) { ignorados++; continue; }
    const r = linhaParaRegistro(o, release);
    if (!r) { ignorados++; continue; }
    batch.push(r);
    if (batch.length >= 1000) await flush();
  }
  await flush();
  return { total, ignorados };
}

async function contarLinhas(arquivo) {
  let n = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(arquivo, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) n++;
  return n;
}

/** API usada pelo CLI e por testes. `pool` = pool MySQL onde fica overture_lugares. */
async function importar({ pool, regioes, release, conf = 0.4, limpar = true, dry = false, saida = null, log = console.log }) {
  const rel = release || await ultimaRelease();
  log(`Release do Overture: ${rel} · confiança mínima: ${conf}`);
  if (!dry && !saida) await require('../config/lugares-overture').garantirTabela(pool);
  const resumo = [];
  for (const reg of regioes) {
    const arquivo = saida || path.join(os.tmpdir(), `overture-${rel}-${reg.nome.replace(/\W+/g, '_')}-${Date.now()}.ndjson`);
    log(`\n▶ Região ${reg.nome}  [${reg.w.toFixed(2)}, ${reg.s.toFixed(2)}, ${reg.e.toFixed(2)}, ${reg.n.toFixed(2)}]  — exportando do S3...`);
    const t0 = Date.now();
    await exportarNdjson({ release: rel, regiao: reg, conf, arquivo });
    const linhas = await contarLinhas(arquivo);
    log(`  ${linhas.toLocaleString('pt-BR')} lugares exportados em ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (dry || saida) { resumo.push({ regiao: reg.nome, linhas, gravados: 0 }); if (!saida) fs.unlinkSync(arquivo); continue; }
    const r = await carregarNoMysql(pool, arquivo, rel, log);
    log(`  gravados/atualizados: ${r.total.toLocaleString('pt-BR')} (ignorados: ${r.ignorados})`);
    let apagados = 0;
    if (limpar) {
      const [d] = await pool.query(
        'DELETE FROM overture_lugares WHERE release_ver <> ? AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?',
        [rel, reg.s, reg.n, reg.w, reg.e]
      );
      apagados = d.affectedRows || 0;
      if (apagados) log(`  removidos de releases antigas: ${apagados.toLocaleString('pt-BR')}`);
    }
    fs.unlinkSync(arquivo);
    resumo.push({ regiao: reg.nome, linhas, gravados: r.total, apagados });
  }
  return { release: rel, resumo };
}

async function main() {
  try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch (_) {}
  const a = parseArgs(process.argv.slice(2));
  const regioes = resolverRegioes(a);
  const pool = (a.dry || a.saida) ? null : require('../config/lugares-overture').getLugaresPool();
  const r = await importar({ pool, regioes, release: a.release, conf: a.conf, limpar: a.limpar, dry: a.dry, saida: a.saida });
  console.log('\nConcluído:', JSON.stringify(r.resumo));
  if (pool && pool.end) await pool.end();
  process.exit(0);
}

module.exports = { importar, resolverRegioes, parseArgs, ultimaRelease, UF_BBOX, linhaParaRegistro };
if (require.main === module) main().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
