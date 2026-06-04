/**
 * Pool de navegador Chromium para geração de PDF (puppeteer-core).
 * Reutiliza uma instância entre requisições — evita ~30–60s de launch a cada PDF.
 */
const fsSync = require('fs');
const pathMod = require('path');

let _browser = null;
let _launching = null;

function findChrome() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    local ? pathMod.join(local, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);
  return candidates.find(p => fsSync.existsSync(p)) || null;
}

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  if (_launching) return _launching;

  _launching = (async () => {
    const puppeteer = require('puppeteer-core');
    const execPath = findChrome();
    if (!execPath) {
      throw new Error('Chrome/Edge não encontrado. Defina CHROME_PATH no .env');
    }
    const browser = await puppeteer.launch({
      executablePath: execPath,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    browser.on('disconnected', () => {
      if (_browser === browser) _browser = null;
    });
    _browser = browser;
    return browser;
  })();

  try {
    return await _launching;
  } finally {
    _launching = null;
  }
}

function injectBaseHref(html, baseUrl) {
  if (!baseUrl || typeof html !== 'string') return html;
  if (/<base\s[\s\S]*?href=/i.test(html)) return html;
  const href = baseUrl.replace(/\/$/, '') + '/';
  const safe = href.replace(/"/g, '&quot;');
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1><base href="${safe}">`);
  }
  return `<base href="${safe}">` + html;
}

/**
 * @param {string} html
 * @param {{ baseUrl?: string }} [opts]
 * @returns {Promise<Buffer>}
 */
async function htmlToPdf(html, opts = {}) {
  const baseUrl = opts.baseUrl || process.env.APP_URL || process.env.PUBLIC_URL || '';
  const doc = injectBaseHref(html, baseUrl);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (type === 'font' || type === 'media') {
        req.abort().catch(() => {});
        return;
      }
      req.continue().catch(() => {});
    });

    await page.setContent(doc, { waitUntil: 'domcontentloaded', timeout: 20000 });

    if (/<img\s/i.test(doc)) {
      await page.evaluate(() =>
        Promise.all(
          Array.from(document.images).map(img =>
            img.complete
              ? Promise.resolve()
              : new Promise(resolve => {
                  img.onload = img.onerror = resolve;
                  setTimeout(resolve, 2500);
                })
          )
        )
      ).catch(() => {});
    }

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '12mm', right: '12mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

async function closePdfBrowser() {
  if (_browser) {
    try { await _browser.close(); } catch (_) {}
    _browser = null;
  }
}

async function warmupPdfBrowser() {
  try {
    await getBrowser();
    console.log('[PDF] Navegador Chromium pronto (pool)');
  } catch (e) {
    console.warn('[PDF] Warmup ignorado:', e.message);
  }
}

module.exports = { htmlToPdf, closePdfBrowser, findChrome, injectBaseHref, warmupPdfBrowser };
