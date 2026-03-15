const { getPool } = require('./database');
const crypto = require('crypto');

function generateLicenseKey() {
  return crypto.randomBytes(16).toString('hex').toUpperCase()
    .match(/.{4}/g).join('-');
}

async function getLicense() {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM system_license LIMIT 1');
    return rows[0] || null;
  } catch {
    return null;
  }
}

async function checkLicense() {
  const license = await getLicense();
  if (!license) return { valid: false, reason: 'Licença não encontrada' };

  const now = new Date();
  const expires = new Date(license.expires_at);

  if (now > expires) {
    const days = Math.floor((now - expires) / (1000 * 60 * 60 * 24));
    return { valid: false, reason: `Licença expirada há ${days} dia(s)`, expired: true, license };
  }

  const daysLeft = Math.ceil((expires - now) / (1000 * 60 * 60 * 24));
  return { valid: true, daysLeft, license };
}

async function createLicense({ clientName, plan, days }) {
  const pool = getPool();
  const key = generateLicenseKey();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);

  await pool.query(
    `INSERT INTO system_license (client_name, license_key, plan, expires_at, max_users, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
     client_name=VALUES(client_name), license_key=VALUES(license_key),
     plan=VALUES(plan), expires_at=VALUES(expires_at), max_users=VALUES(max_users)`,
    [clientName, key, plan, expiresAt, plan === 'trial' ? 3 : 999]
  );

  return { key, expiresAt };
}

module.exports = { getLicense, checkLicense, createLicense, generateLicenseKey };
