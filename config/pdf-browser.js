/**
 * Pool de navegador Chromium para geração de PDF (puppeteer-core).
 * Reutiliza uma instância entre requisições — evita ~30–60s de launch a cada PDF.
 */
const fsSync = require('fs');
const pathMod = require('path');

let _browser = null;
let _launching = null;

/**
 * O pacote `chromium-browser` do Ubuntu 20.04+ não é o navegador: é um shell
 * script de ~2KB que apenas redireciona para o snap. O Puppeteer precisa ler o
 * endereço do WebSocket no stdout do processo, o que nunca acontece através
 * desse wrapper — daí o erro "Timed out waiting for the WS endpoint URL".
 * Preferimos sempre um binário de verdade; o wrapper só é usado se não houver
 * outra opção (mantém o comportamento antigo em vez de quebrar quem funciona).
 */
function pareceBinarioReal(p) {
  try {
    // /snap/bin/chromium é symlink para /usr/bin/snap — um ELF real de ~21MB que
    // passaria nas checagens abaixo, mas é só o launcher do snap: o Chromium sobe
    // confinado, o WS endpoint não chega ao stdout e o Puppeteer estoura o timeout.
    if (/[\\/]snap[\\/]/.test(p)) return false;
    const st = fsSync.statSync(p);
    if (!st.isFile() || st.size < 1024 * 1024) return false; // navegador real tem MBs
    const fd = fsSync.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(2);
      fsSync.readSync(fd, buf, 0, 2, 0);
      return !(buf[0] === 0x23 && buf[1] === 0x21); // "#!" = script, não binário
    } finally {
      fsSync.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function findChrome() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    process.env.CHROME_PATH,
    // Google Chrome primeiro: é binário de verdade e o mais confiável com o
    // Puppeteer. Os caminhos de chromium do Ubuntu vêm depois porque costumam
    // ser wrapper/snap (ver pareceBinarioReal) e só servem como último recurso.
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/snap/bin/chromium',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    local ? pathMod.join(local, 'Google/Chrome/Application/chrome.exe') : null,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);

  // CHROME_PATH é escolha explícita do operador — vale sem validação.
  if (process.env.CHROME_PATH && fsSync.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  const existentes = candidates.filter(p => fsSync.existsSync(p));
  return existentes.find(pareceBinarioReal) || existentes[0] || null;
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

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** Embute imagens /uploads/ como data: URL — Puppeteer não depende de HTTP para logos/fotos. */
function inlineLocalUploadImages(html, publicRoot) {
  if (!html || typeof html !== 'string') return html;
  const root = publicRoot || pathMod.join(process.cwd(), 'public');
  return html.replace(/<img([^>]*)\ssrc=["'](\/?uploads\/[^"']+)["']/gi, (match, attrs, src) => {
    try {
      const fp = pathMod.join(root, src.replace(/^\//, '').replace(/\//g, pathMod.sep));
      if (!fsSync.existsSync(fp)) return match;
      const ext = pathMod.extname(fp).slice(1).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) return match;
      const b64 = fsSync.readFileSync(fp).toString('base64');
      return `<img${attrs} src="data:${mime};base64,${b64}"`;
    } catch {
      return match;
    }
  });
}

/**
 * @param {string} html
 * @param {{ baseUrl?: string }} [opts]
 * @returns {Promise<Buffer>}
 */
async function htmlToPdf(html, opts = {}) {
  const baseUrl = opts.baseUrl || process.env.APP_URL || process.env.PUBLIC_URL || '';
  let doc = inlineLocalUploadImages(html);
  doc = injectBaseHref(doc, baseUrl);
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

/**
 * Warmup é OPT-IN (PDF_WARMUP=1). Cada processo Node mantém o próprio Chromium
 * (~300MB): numa VPS multi-tenant com 12+ processos, subir todos no boot pode
 * estourar a memória da máquina inteira. Sem warmup o navegador sobe sob demanda,
 * no primeiro PDF do tenant — só quem realmente usa envio para fábrica paga.
 */
async function warmupPdfBrowser() {
  if (String(process.env.PDF_WARMUP || '') !== '1') {
    console.log('[PDF] Warmup desativado (defina PDF_WARMUP=1 para pré-carregar)');
    return;
  }
  try {
    await getBrowser();
    console.log('[PDF] Navegador Chromium pronto (pool)');
  } catch (e) {
    console.warn('[PDF] Warmup ignorado:', e.message);
  }
}

module.exports = { htmlToPdf, closePdfBrowser, findChrome, injectBaseHref, inlineLocalUploadImages, warmupPdfBrowser };
