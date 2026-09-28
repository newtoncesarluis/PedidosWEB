/**
 * Gera PDF da proposta comercial PedidosWeb (NC Solutions)
 * Uso: node scripts/gerar-proposta-pdf.js
 */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const ROOT = path.join(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'docs', 'proposta-comercial-pedidosweb.html');
const OUT_DIR = path.join(ROOT, 'docs');
const OUT_PDF = path.join(OUT_DIR, 'Proposta-PedidosWeb-NC-Solutions.pdf');

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  if (!fs.existsSync(HTML_PATH)) {
    console.error('Arquivo HTML não encontrado:', HTML_PATH);
    process.exit(1);
  }

  const chrome = findChrome();
  if (!chrome) {
    console.error('Chrome/Edge não encontrado. Defina CHROME_PATH ou instale o Chrome.');
    process.exit(1);
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const htmlUrl = 'file:///' + HTML_PATH.replace(/\\/g, '/');
  console.log('Gerando PDF com:', chrome);
  console.log('HTML:', htmlUrl);

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.goto(htmlUrl, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.pdf({
      path: OUT_PDF,
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
    console.log('\n✅ PDF gerado com sucesso!');
    console.log('📄', OUT_PDF);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Erro ao gerar PDF:', err.message);
  process.exit(1);
});
