/**
 * Captura screenshots reais para a landing page.
 * Uso: node scratch/capture-landing-screenshots.js
 * Requer: servidor local rodando + Chrome/Edge instalado.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const OUT = path.join(__dirname, '..', 'public', 'assets', 'landing');
const PORT = process.env.PORT || 3002;
const BASE = `http://localhost:${PORT}`;

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

async function findBrowser() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error('Chrome/Edge não encontrado. Defina CHROME_PATH.');
}

function loadPrep() {
  const raw = execSync('node scratch/landing-capture-prep.js', {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const line = raw.trim().split('\n').filter(l => l.startsWith('{')).pop();
  if (!line) throw new Error('Prep não retornou JSON');
  return JSON.parse(line);
}

async function shot(page, name, opts = {}) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, type: 'png', ...opts });
  console.log('OK', file);
}

async function injectAuth(page, creds) {
  await page.goto(`${BASE}/login.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const login = await page.evaluate(async (base, c) => {
    const r = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        loginusu: c.loginusu,
        senhausu: c.senhausu,
        chave_licenca: c.chave_licenca,
      }),
    });
    return r.json();
  }, BASE, creds);
  if (!login?.token) throw new Error('Login falhou: ' + (login?.error || 'sem token'));
  await page.evaluate((token) => {
    localStorage.setItem('token', token);
    sessionStorage.setItem('token', token);
  }, login.token);
  return login;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const prep = loadPrep();

  const browser = await puppeteer.launch({
    executablePath: await findBrowser(),
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();

  // Dashboard demo
  await page.goto(`${BASE}/demo.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.kpi-grid', { timeout: 15000 });
  await shot(page, 'hero-dashboard.png', { clip: { x: 0, y: 52, width: 1280, height: 620 } });

  // Vitrine Digital (screenshot real)
  const vitrinePage = await browser.newPage();
  await vitrinePage.setViewport({ width: 520, height: 820, deviceScaleFactor: 2 });
  await vitrinePage.goto(`${BASE}/vitrine/${prep.token}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await vitrinePage.waitForFunction(
    () => {
      const loading = document.getElementById('vt-loading');
      const content = document.getElementById('vt-content');
      const err = document.getElementById('vt-error');
      const cards = content?.querySelectorAll('.vt-card, .vt-product, [data-vt-product]');
      if (err && getComputedStyle(err).display !== 'none') return false;
      const hasProducts = cards && cards.length >= 2;
      const loaded = content && content.children.length > 0 && (!loading || getComputedStyle(loading).display === 'none');
      return loaded && hasProducts;
    },
    { timeout: 30000 }
  ).catch(async () => {
    await vitrinePage.waitForSelector('#vt-header', { timeout: 10000 });
  });
  await new Promise(r => setTimeout(r, 800));
  await shot(vitrinePage, 'vitrine-app.png', { clip: { x: 0, y: 0, width: 520, height: 720 } });

  // Portal do Representante (screenshot real)
  const portalPage = await browser.newPage();
  await portalPage.setViewport({ width: 1100, height: 720, deviceScaleFactor: 2 });
  await injectAuth(portalPage, prep);
  await portalPage.goto(`${BASE}/portal.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await portalPage.waitForFunction(
    () => {
      const kpis = document.querySelectorAll('#dash-kpis .kpi-value');
      if (kpis.length < 3) return false;
      if ([...kpis].some(el => el.classList.contains('skeleton'))) return false;
      const vendas = kpis[0]?.textContent || '';
      return vendas.includes('R$') && !/^R\$\s*0([,.]0*)?$/.test(vendas.trim());
    },
    { timeout: 30000 }
  ).catch(() => portalPage.waitForSelector('#dash-kpis', { timeout: 10000 }));
  await new Promise(r => setTimeout(r, 600));
  await shot(portalPage, 'portal-app.png', { clip: { x: 0, y: 0, width: 1100, height: 620 } });

  // Mobile hero (dashboard)
  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await mobile.goto(`${BASE}/demo.html`, { waitUntil: 'networkidle2', timeout: 60000 });
  await mobile.waitForSelector('.kpi-grid', { timeout: 15000 });
  await shot(mobile, 'hero-mobile.png', { fullPage: false });

  await mobile.click('.topbar-tab:nth-child(2)');
  await new Promise(r => setTimeout(r, 400));
  await shot(mobile, 'mobile-app.png', { clip: { x: 0, y: 36, width: 390, height: 760 } });

  async function demoTab(tabIndex, file, clip) {
    await page.goto(`${BASE}/demo.html`, { waitUntil: 'networkidle2', timeout: 60000 });
    const tabs = await page.$$('.topbar-tab');
    if (!tabs[tabIndex]) throw new Error('Aba demo índice ' + tabIndex);
    await tabs[tabIndex].click();
    await new Promise(r => setTimeout(r, 600));
    if (tabIndex === 3 && !await page.$('#chartCidades')) await new Promise(r => setTimeout(r, 400));
    if (tabIndex === 6) await page.waitForSelector('#page-comissoes.active', { timeout: 10000 }).catch(() => {});
    await shot(page, file, clip);
  }

  await demoTab(6, 'shot-comissao.png', { clip: { x: 0, y: 52, width: 1280, height: 640 } });
  await demoTab(3, 'shot-mapa.png', { clip: { x: 0, y: 52, width: 1280, height: 640 } });
  await demoTab(4, 'shot-crm.png', { clip: { x: 0, y: 52, width: 1280, height: 520 } });

  // OG image composta
  const og = await browser.newPage();
  await og.setViewport({ width: 1200, height: 630 });
  await og.setContent(`<!DOCTYPE html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:1200px;height:630px;font-family:Inter,system-ui,sans-serif;
      background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f172a 100%);
      display:flex;align-items:center;padding:60px;gap:48px;overflow:hidden;position:relative}
    body::before{content:'';position:absolute;inset:0;
      background:radial-gradient(ellipse 60% 80% at 20% 50%,rgba(14,165,233,.25),transparent)}
    .text{flex:1;position:relative;z-index:1}
    .badge{display:inline-block;background:rgba(14,165,233,.2);border:1px solid rgba(14,165,233,.4);
      color:#38bdf8;padding:6px 14px;border-radius:99px;font-size:13px;font-weight:700;
      text-transform:uppercase;letter-spacing:.5px;margin-bottom:20px}
    h1{font-size:52px;font-weight:900;color:#fff;line-height:1.08;letter-spacing:-2px;margin-bottom:16px}
    h1 em{font-style:normal;color:#38bdf8}
    p{font-size:20px;color:rgba(255,255,255,.65);line-height:1.5;max-width:480px}
    .shot{width:520px;border-radius:16px;overflow:hidden;box-shadow:0 32px 80px rgba(0,0,0,.5);
      border:1px solid rgba(255,255,255,.1);position:relative;z-index:1;flex-shrink:0}
    .shot img{width:100%;display:block}
  </style></head><body>
    <div class="text">
      <div class="badge">CRM para Representantes</div>
      <h1>Pedidos, comissão e rotas<br><em>em um só lugar</em></h1>
      <p>Plataforma completa para representantes comerciais — offline, mobile e inteligência comercial.</p>
    </div>
    <div class="shot"><img src="${BASE}/assets/landing/hero-dashboard.png" alt=""></div>
  </body></html>`, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 500));
  await shot(og, 'og-image.png', { fullPage: false });

  await browser.close();
  console.log('Screenshots prontos em public/assets/landing/');
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
