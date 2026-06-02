const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const CACHE_DIR  = path.join(__dirname, '..', 'data', 'licenses');
const FILE_TTL   = 24 * 60 * 60 * 1000; // 24 horas

function secret() {
  return process.env.JWT_SECRET || 'sysrepweb-lic-fallback';
}

function safeName(chave) {
  return String(chave).replace(/[^A-Z0-9\-]/gi, '').toUpperCase().slice(0, 40);
}

function filePath(chave) {
  return path.join(CACHE_DIR, `${safeName(chave)}.enc`);
}

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function encrypt(obj) {
  const key    = crypto.scryptSync(secret(), 'lic-salt-v1', 32);
  const iv     = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let enc = cipher.update(JSON.stringify(obj), 'utf8', 'hex');
  enc    += cipher.final('hex');
  return iv.toString('hex') + ':' + enc;
}

function decrypt(raw) {
  try {
    const [ivHex, enc] = raw.trim().split(':');
    const key      = crypto.scryptSync(secret(), 'lic-salt-v1', 32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
    let dec = decipher.update(enc, 'hex', 'utf8');
    dec    += decipher.final('utf8');
    return JSON.parse(dec);
  } catch {
    return null;
  }
}

const LicenseCache = {
  read(chave) {
    try {
      const p = filePath(chave);
      if (!fs.existsSync(p)) return null;
      if (Date.now() - fs.statSync(p).mtimeMs > FILE_TTL) return null;
      const obj = decrypt(fs.readFileSync(p, 'utf8'));
      if (!obj || obj.chave_licenca !== chave) return null;
      return obj;
    } catch {
      return null;
    }
  },

  write(chave, data) {
    try {
      ensureDir();
      fs.writeFileSync(
        filePath(chave),
        encrypt({ ...data, chave_licenca: chave, salvo_em: new Date().toISOString() }),
        'utf8'
      );
    } catch (err) {
      console.error('[LicenseCache] write error:', err.message);
    }
  },

  clear(chave) {
    try {
      const p = filePath(chave);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch { /* ignore */ }
  },

  clearAll() {
    try {
      if (!fs.existsSync(CACHE_DIR)) return;
      fs.readdirSync(CACHE_DIR)
        .filter(f => f.endsWith('.enc'))
        .forEach(f => fs.unlinkSync(path.join(CACHE_DIR, f)));
    } catch { /* ignore */ }
  },
};

module.exports = LicenseCache;
