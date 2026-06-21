const crypto = require('crypto');

/**
 * Descriptografa senha salva como AES-256-CBC (formato "ivHex:encHex").
 * Usa JWT_SECRET como chave de derivação — mesmo algoritmo do LicenseService.
 */
function _decryptPassword(enc) {
  try {
    const parts = String(enc).split(':');
    if (parts.length !== 2) return String(enc); // não está no formato esperado → usa como está
    const [ivHex, encHex] = parts;
    const key = crypto.scryptSync(process.env.JWT_SECRET || 'default', 'salt', 32);
    const iv  = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let dec = decipher.update(encHex, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch {
    // Falha na descriptografia (ex.: JWT_SECRET diferente do usado para gravar)
    // NUNCA retornar o texto cifrado bruto como senha — gera "Access denied
    // (using password: YES)" confuso. Vazio cai no fallback de .env, se houver.
    return '';
  }
}

/**
 * Extrai credenciais MySQL do registro em sistema_licencas (painel central).
 * Aceita vários nomes de coluna para compatibilidade com schemas existentes.
 * Suporta db_password_enc (AES-256-CBC, descriptografado automaticamente).
 */
function extractMysqlConfigFromLicenseRow(row) {
  if (!row || typeof row !== 'object') return null;

  const h =
    row.mysql_host ??
    row.db_host ??
    row.host_cliente ??
    row.host_mysql ??
    row.db_hostname;
  const db =
    row.mysql_database ??
    row.db_name ??
    row.database_cliente ??
    row.nome_banco ??
    row.database_mysql;
  const u =
    row.mysql_user ??
    row.db_user ??
    row.usuario_banco ??
    row.user_mysql;

  // db_password_enc tem prioridade sobre db_password (versão criptografada)
  const rawPw =
    row.mysql_password ??
    row.db_password_enc ??
    row.db_password ??
    row.senha_banco ??
    row._dbsenha ??
    row.dbsenha_local ??
    '';

  const port = row.mysql_port ?? row.db_port ?? row.porta_mysql ?? 3306;

  if (!h || !db || !u) return null;

  // Se veio de db_password_enc, descriptografa; caso contrário usa como está
  const password = (rawPw && rawPw === row.db_password_enc)
    ? _decryptPassword(rawPw)
    : (rawPw != null ? String(rawPw) : '');

  return {
    host: String(h).trim(),
    port: Number(port) || 3306,
    user: String(u).trim(),
    password,
    database: String(db).trim(),
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    timezone: '-03:00',
  };
}

module.exports = { extractMysqlConfigFromLicenseRow };
