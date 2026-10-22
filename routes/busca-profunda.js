'use strict';
/**
 * Busca profunda por CNAE (base aberta da Receita Federal).
 *   GET  /api/busca-profunda/status?uf=SP        → base carregada? importação em andamento?
 *   POST /api/busca-profunda/preparar { uf }     → (admin) baixa e importa a base da UF, em segundo plano
 *   POST /api/busca-profunda/iniciar { lat,lng,raio,q } → começa a busca; devolve { id }
 *   GET  /api/busca-profunda/:id                 → progresso e resultados parciais
 * Como a base não tem coordenadas, as posições são descobertas aos poucos (e guardadas) — por isso é "profunda".
 */
const crypto = require('crypto');
const https = require('https');
const express = require('express');
const router = express.Router();
const { parseLatLng, parseRaioKm } = require('../config/validate');
const R = require('../config/receita');
const { getLugaresPool } = require('../config/lugares-overture');
const { geocodePreciso } = require('../config/geocode');

const MAX_GEOCODIFICAR = 150;     // por busca (≈ 3 min); o que for descoberto fica guardado para as próximas
const META_RESULTADOS = 60;
const TEMPO_MAX_MS = 4 * 60 * 1000;
const jobs = new Map();

function distKm(la1, lo1, la2, lo2) {
  const r = (x) => x * Math.PI / 180, dLa = r(la2 - la1), dLo = r(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(r(la1)) * Math.cos(r(la2)) * Math.sin(dLo / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const rq = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'SysRepWeb-Geoloc/1.0', 'Accept-Language': 'pt-BR' } }, (res) => {
      let d = ''; res.on('data', (c) => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve(null); } });
    });
    rq.on('error', reject); rq.setTimeout(10000, () => { rq.destroy(); reject(new Error('timeout')); });
  });
}

/** Cidade/UF/CEP do ponto de origem (Nominatim). */
async function origemDe(lat, lng) {
  const d = await getJson(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18&accept-language=pt-BR`);
  const a = d && d.address;
  if (!a) return null;
  const cidade = a.city || a.town || a.village || a.municipality || '';
  const uf = R.ufDe(a['ISO3166-2-lvl4'] ? String(a['ISO3166-2-lvl4']).replace('BR-', '') : a.state);
  return cidade && uf ? { cidade, uf, cep: String(a.postcode || '').replace(/\D/g, '') } : null;
}

function tipoDe(q) {
  const { OSM_CATEGORIAS, SEGMENTOS_IND } = require('./geolocalizacao')._tipo;
  const termo = R.normCidade(q).toLowerCase();
  const casa = (c) => c.re.test(String(q).toLowerCase()) || c.re.test(termo);
  const cat = OSM_CATEGORIAS.find(c => c.label === 'Indústria / Fábrica' && casa(c)) || OSM_CATEGORIAS.find(casa);
  const seg = cat && cat.label === 'Indústria / Fábrica' ? SEGMENTOS_IND.find(s => s.re.test(termo)) : null;
  return { cat, seg };
}

function paraLugar(r, origem) {
  const lat = Number(r.lat), lng = Number(r.lng);
  const ab = r.abertura ? new Date(r.abertura) : null;
  const anos = ab && !isNaN(ab) ? Math.floor((Date.now() - ab) / 31557600000) : null;
  return {
    osm_id: 'cnpj/' + r.cnpj, sem_nome: false,
    nome: r.fantasia || r.razao_social || ('Empresa ' + R.fmtCnpj(r.cnpj)), razao_social: r.razao_social, cnpj: R.fmtCnpj(r.cnpj),
    categoria: r.cnae_desc || ('CNAE ' + r.cnae), cnae: r.cnae, porte: r.porte, anos_atividade: anos, matriz: !!r.matriz,
    endereco: r.endereco, bairro: r.bairro, cidade: r.cidade, cep: R.fmtCep(r.cep), uf: r.uf,
    telefone: r.fone, site: '', email: r.email, horario: '', fonte_contato: 'Receita',
    latitude: lat, longitude: lng, distancia: distKm(origem.lat, origem.lng, lat, lng),
    relevancia: 1, match: 'cnae', cliente_id: null, cliente_nome: null,
  };
}

async function executar(job, ctx) {
  try {
    const rows = await R.candidatas({ uf: ctx.uf, cidadeNorm: ctx.cidadeNorm, prefixos: ctx.prefixos, cepRef: ctx.cep });
    job.total = rows.length;
    const achou = (r) => {
      const l = paraLugar(r, ctx.origem);
      if (l.distancia <= ctx.raio * 1.03 + 0.01) job.encontrados.push(l);
    };
    // CEP de rua (não termina em 000) que já tem posição vale para as outras empresas da mesma rua: poupa consultas
    const porCep = new Map();
    for (const r of rows) {
      if (r.lat != null && r.lng != null && r.cep && !/000$/.test(r.cep) && !porCep.has(r.cep)) porCep.set(r.cep, { lat: Number(r.lat), lng: Number(r.lng) });
    }
    const semPos = [];
    for (const r of rows) {
      if (r.lat != null && r.lng != null) { achou(r); job.verificadas++; }
      else if (!r.geo_tentou && r.cep && porCep.has(r.cep)) {
        const pc = porCep.get(r.cep);
        await R.gravarPosicao(r.cnpj, pc.lat, pc.lng);
        achou({ ...r, lat: pc.lat, lng: pc.lng }); job.verificadas++;
      }
      else if (!r.geo_tentou) semPos.push(r);
      else job.sem_posicao++;
    }
    job.encontrados.sort((a, b) => a.distancia - b.distancia);
    const t0 = Date.now();
    let feitas = 0;
    for (const r of semPos) {
      if (job.cancelado || feitas >= MAX_GEOCODIFICAR || job.encontrados.length >= META_RESULTADOS || Date.now() - t0 > TEMPO_MAX_MS) break;
      const [logradouro, ...resto] = String(r.endereco || '').split(',');
      const numero = (resto.join(',').match(/^\s*(\d+)/) || [])[1] || '';
      const p = await geocodePreciso({ logradouro, numero, bairro: r.bairro, cidade: r.cidade, uf: r.uf, cep: r.cep });
      await new Promise(res => setTimeout(res, 1100));
      feitas++; job.verificadas++;
      if (p && isFinite(Number(p.lat)) && isFinite(Number(p.lng))) {
        await R.gravarPosicao(r.cnpj, Number(p.lat), Number(p.lng));
        achou({ ...r, lat: p.lat, lng: p.lng });
        job.encontrados.sort((a, b) => a.distancia - b.distancia);
      } else { await R.marcarTentou(r.cnpj); job.sem_posicao++; }
    }
    job.sem_posicao += Math.max(0, semPos.length - feitas);
    job.limitado = semPos.length > feitas;
    job.estado = 'pronto';
  } catch (e) {
    job.estado = 'erro'; job.erro = e.message;
  }
}

const _cacheOrigem = new Map();   // "lat,lng" arredondado -> { ts, origem }
/** Situação da base da Receita na cidade do ponto de partida: pronta | nao_carregada | preparando. */
router.get('/situacao', async (req, res) => {
  try {
    const geo = parseLatLng(req.query.lat, req.query.lng);
    if (!geo.ok) return res.status(400).json({ error: geo.error });
    const chave = geo.lat.toFixed(2) + ',' + geo.lng.toFixed(2);
    let c = _cacheOrigem.get(chave);
    if (!c || Date.now() - c.ts > 3600000) {
      c = { ts: Date.now(), origem: await origemDe(geo.lat, geo.lng) };
      if (_cacheOrigem.size > 200) _cacheOrigem.clear();
      if (c.origem) _cacheOrigem.set(chave, c);
    }
    const admin = podePreparar(req);
    if (!c.origem) return res.json({ estado: 'desconhecida', pode_preparar: admin });
    const { uf, cidade } = c.origem;
    const prep = importacao && !importacao.fim ? importacao : null;
    if (prep && prep.uf === uf) return res.json({ estado: 'preparando', uf, cidade, pct: prep.pct || 0, pode_preparar: admin });
    const pool = getLugaresPool();
    await R.garantirTabela(pool);
    const [r] = await pool.query('SELECT 1 FROM receita_estabelecimentos WHERE uf = ? LIMIT 1', [uf]);
    res.json({ estado: r.length ? 'pronta' : 'nao_carregada', uf, cidade, pode_preparar: admin, outra_prep: prep ? prep.uf : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/status', async (req, res) => {
  try {
    const uf = String(req.query.uf || '').toUpperCase();
    const pool = getLugaresPool();
    await R.garantirTabela(pool);
    let n = 0;
    if (/^[A-Z]{2}$/.test(uf)) { const [r] = await pool.query('SELECT COUNT(*) AS n FROM receita_estabelecimentos WHERE uf = ?', [uf]); n = r[0].n; }
    res.json({ uf, carregados: n, importacao: importacao && { uf: importacao.uf, fim: importacao.fim, erro: importacao.erro, ultima: importacao.ultima, pct: importacao.fim && !importacao.erro ? 100 : (importacao.pct || 0), atual: importacao.atual || null, mb: importacao.mb || 0, mbTotal: importacao.mbTotal || 0 } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

let importacao = null;

// tamanho aproximado (MB) de cada arquivo, para a barra de progresso refletir o peso real do download
const PESO_MB = { 'Estabelecimentos0': 2172, 'Empresas0': 545 };
const pesoDe = (nome) => PESO_MB[nome] || (/^Estab/.test(nome) ? 330 : 85);
const ARQUIVOS = [...Array(10).keys()].flatMap((i) => ['Estabelecimentos' + i, 'Empresas' + i]);
const PESO_TOTAL = ARQUIVOS.reduce((t, n) => t + pesoDe(n), 0);

/** Atualiza o andamento a partir das linhas de log do importador. */
function acompanhar(imp, msg) {
  const m = String(msg).trim();
  imp.ultima = m.slice(0, 160);
  imp.feito = imp.feito || 0;
  let x;
  if ((x = /baixando (\w+)\.zip/.exec(m))) { imp.atual = x[1]; imp.mb = 0; imp.mbTotal = 0; }
  else if ((x = /^(\d+) \/ (\d+) MB$/.exec(m))) { imp.mb = +x[1]; imp.mbTotal = +x[2]; }
  else if ((x = /^(\w+)\.zip(:| ok)/.exec(m))) { imp.feito += pesoDe(x[1]); imp.atual = null; imp.mb = 0; }
  else if (/^\d.* estabelecimentos no filtro/.test(m)) imp.feito = PESO_TOTAL;
  const emCurso = imp.atual ? Math.min(imp.mb || 0, pesoDe(imp.atual)) : 0;
  imp.pct = Math.min(99, Math.round(((imp.feito + emCurso) / PESO_TOTAL) * 100));
}
const podePreparar = (req) => String(process.env.RECEITA_PREPARAR_TENANT || '').toLowerCase() === 'true'
  && (Number(req.user && req.user.perfil) === 1 || !!(req.user && req.user.role === 'admin'));

router.post('/preparar', async (req, res) => {
  if (!podePreparar(req)) return res.status(403).json({ error: 'A base da Receita é mantida pela NC Sistemas. Fale com o suporte.' });
  const perfil = Number(req.user && (req.user.perfil != null ? req.user.perfil : 0));
  if (perfil !== 1 && !(req.user && req.user.role === 'admin')) return res.status(403).json({ error: 'Só o administrador pode preparar a base.' });
  const uf = String((req.body && req.body.uf) || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) return res.status(400).json({ error: 'UF inválida.' });
  if (importacao && !importacao.fim) return res.status(409).json({ error: 'Já existe uma preparação em andamento (UF ' + importacao.uf + ').' });
  const pool = getLugaresPool();
  importacao = { uf, inicio: Date.now(), fim: null, erro: null, ultima: 'Iniciando...' };
  const imp = importacao;
  res.json({ ok: true, aviso: 'Baixando a base da Receita (alguns GB). Pode levar de 20 minutos a algumas horas.' });
  try {
    const { importar } = require('../scripts/receita-importar');
    await importar({ pool, uf: [uf], cnae: '10-33', log: (m) => acompanhar(imp, m) });
  } catch (e) { imp.erro = e.message; }
  imp.fim = Date.now();
});

router.post('/iniciar', async (req, res) => {
  try {
    const b = req.body || {};
    const geo = parseLatLng(b.lat, b.lng);
    if (!geo.ok) return res.status(400).json({ error: geo.error });
    const raio = parseRaioKm(b.raio);
    const q = String(b.q || '').trim();
    const { cat, seg } = tipoDe(q);
    const prefixos = R.prefixosCnae(cat && cat.label, seg && seg.label);
    if (!prefixos) return res.status(400).json({ error: 'Para este tipo ainda não sei qual é o CNAE. Tente um setor (ex.: indústria eletrônica, padaria, farmácia).' });
    const origem = await origemDe(geo.lat, geo.lng);
    if (!origem) return res.status(422).json({ error: 'Não consegui descobrir a cidade do ponto de origem.' });
    if (!(await R.temBase(origem.uf, prefixos))) {
      return res.status(409).json({ code: 'sem_base', uf: origem.uf, error: `A base da Receita de ${origem.uf} ainda não foi carregada para este tipo.` });
    }
    const id = crypto.randomBytes(6).toString('hex');
    const job = { id, estado: 'rodando', total: 0, verificadas: 0, encontrados: [], sem_posicao: 0, limitado: false, erro: null, ts: Date.now(),
      cidade: origem.cidade, uf: origem.uf, categoria: seg ? `${cat.label} · ${seg.label}` : cat.label, cnae: prefixos.join(', ') };
    jobs.set(id, job);
    for (const [k, j] of jobs) if (Date.now() - j.ts > 30 * 60 * 1000) jobs.delete(k);
    executar(job, { uf: origem.uf, cidadeNorm: R.normCidade(origem.cidade), prefixos, cep: origem.cep, raio, origem: { lat: geo.lat, lng: geo.lng } });
    res.json({ id, cidade: origem.cidade, uf: origem.uf, categoria: job.categoria });
  } catch (e) { console.error('busca-profunda iniciar:', e); res.status(500).json({ error: e.message }); }
});

router.get('/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Busca não encontrada (expirou).' });
  res.json({ estado: j.estado, erro: j.erro, total: j.total, verificadas: j.verificadas, sem_posicao: j.sem_posicao, limitado: j.limitado,
    cidade: j.cidade, uf: j.uf, categoria: j.categoria, cnae: j.cnae, lugares: j.encontrados.slice(0, 150) });
});
router.delete('/:id', (req, res) => { const j = jobs.get(req.params.id); if (j) j.cancelado = true; res.json({ ok: true }); });

module.exports = router;
module.exports._paraLugar = paraLugar;
module.exports._tipoDe = tipoDe;
