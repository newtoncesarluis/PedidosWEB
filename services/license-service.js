const { getPool,
  createPool,
  runWithPool,
  customerDbFromLicense,
  readLicenseBinding,
  writeLicenseBinding,
  ensureCustomerPoolFromLicenseIfNeeded,
} = require('../config/database');
const { getLicensePool } = require('../config/db-license');
const { extractMysqlConfigFromLicenseRow } = require('../config/customer-db-from-license');
const LicenseCache = require('./license-cache');
const crypto = require('crypto');

let _dbConfigApplied = false;

/** Só para instalações legadas (.env com DB_*): troca pool via API do painel. */
async function applyDbConfigFromLicense(chave_licenca) {
  if (_dbConfigApplied || customerDbFromLicense()) return;
  const cfg       = await fetchMysqlConfigFromPainelApi(chave_licenca);
  if (!cfg) return;
  createPool(cfg);
  _dbConfigApplied = true;
  console.log(`[License] DB via Painel: ${cfg.database}@${cfg.host}`);
}

async function fetchMysqlConfigFromPainelApi(chave_licenca) {
  const apiUrl = process.env.PAINEL_API_URL;
  const apiKey = process.env.PAINEL_API_KEY;
  if (!apiUrl || !apiKey) return null;
  try {
    const axios = require('axios');
    const { data } = await axios.post(
      `${apiUrl}/api/licenca/db-config`,
      { chave_licenca },
      { headers: { 'x-api-key': apiKey }, timeout: 8000 }
    );
    const { host, port, user, password, database } = data;
    if (host && user && database) {
      return {
        host: String(host).trim(),
        port: Number(port) || 3306,
        user: String(user).trim(),
        password: password != null ? String(password) : '',
        database: String(database).trim(),
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        timezone: '-03:00',
      };
    }
  } catch (err) {
    console.error('[License] Erro API db-config:', err.message);
  }
  return null;
}

function resetDbConfigFlag() {
  _dbConfigApplied = false;
}

async function ensureTable() {
  if (customerDbFromLicense() && readLicenseBinding()) {
    await ensureCustomerPoolFromLicenseIfNeeded();
  }
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config_licenca (
      id                 INT          NOT NULL AUTO_INCREMENT,
      chave_licenca      VARCHAR(19)  NOT NULL,
      status             ENUM('ativo','demo','bloqueado','expirado') NOT NULL DEFAULT 'demo',
      data_ativacao      DATETIME     NULL,
      data_expiracao     DATE         NULL,
      ultima_verificacao DATETIME     NULL,
      dados_cliente      JSON         NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_chave (chave_licenca)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

const LicenseService = {

  generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${seg()}-${seg()}-${seg()}-${seg()}`;
  },

  encryptData(data, secret) {
    const key = crypto.scryptSync(secret || process.env.JWT_SECRET || 'default', 'salt', 32);
    const iv   = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let enc = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    enc += cipher.final('hex');
    return iv.toString('hex') + ':' + enc;
  },

  decryptData(encrypted, secret) {
    try {
      const [ivHex, enc] = encrypted.split(':');
      const key    = crypto.scryptSync(secret || process.env.JWT_SECRET || 'default', 'salt', 32);
      const ivv     = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, ivv);
      let dec = decipher.update(enc, 'hex', 'utf8');
      dec += decipher.final('utf8');
      return JSON.parse(dec);
    } catch {
      return null;
    }
  },

  async checkLocal() {
    try {
      if (customerDbFromLicense()) {
        const binding = readLicenseBinding();
        if (!binding) {
          return {
            valid: false,
            status: 'sem_licenca',
            mensagem: 'Informe a chave de licença na tela de login para conectar ao banco de dados do cliente.',
          };
        }
      }

      await ensureTable();
      const pool = getPool();

      const [rows] = await pool.query('SELECT * FROM config_licenca ORDER BY id DESC LIMIT 1');
      if (!rows.length || !rows[0].chave_licenca) {
        return { valid: false, status: 'sem_licenca', mensagem: 'Nenhuma licença configurada' };
      }

      const localRow = rows[0];
      const chave    = localRow.chave_licenca;

      if (localRow.status === 'demo') {
        if (localRow.data_expiracao) {
          const hoje      = new Date();
          const expiracao = new Date(localRow.data_expiracao);
          const diasRestantes = Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24));
          if (diasRestantes <= 0) {
            return { valid: false, status: 'expirado', mensagem: 'Demo expirado. Ative uma licença para continuar.' };
          }
          return { valid: true, status: 'demo', demo: true, diasRestantes, aviso: diasRestantes <= 5,
            mensagem: `Demo ativo — ${diasRestantes} dia(s) restante(s)`, chave_licenca: chave };
        }
        return { valid: true, status: 'demo', demo: true, chave_licenca: chave };
      }

      const licPool = getLicensePool();
      const [remote] = await licPool.query(
        'SELECT * FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1',
        [chave]
      );

      if (!remote.length) {
        return { valid: false, status: 'sem_licenca', mensagem: 'Licença não encontrada na base central' };
      }

      const lic = remote[0];

      // Registra acesso para tracking de sessões em tempo real
      licPool.query('UPDATE sistema_licencas SET data_ultimo_acesso = NOW() WHERE id = ?', [lic.id]).catch(() => {});

      if (lic.status === 'ativo' && !customerDbFromLicense()) {
        await applyDbConfigFromLicense(chave);
      }

      if (lic.status === 'bloqueado') {
        return { valid: false, status: 'bloqueado', motivo: lic.motivo_bloqueio || null, chave, mensagem: 'Licença bloqueada. Entre em contato com o suporte.' };
      }

      if (lic.status === 'suspenso') {
        return { valid: false, status: 'bloqueado', chave, mensagem: 'Licença suspensa. Entre em contato com o suporte.' };
      }

      if (lic.data_fim) {
        const hoje    = new Date();
        const dataFim = new Date(lic.data_fim);
        const diasRestantes = Math.ceil((dataFim - hoje) / (1000 * 60 * 60 * 24));
        const carencia = parseInt(lic.limite_dias_vencimento) || 0;

        if (diasRestantes <= 0) {
          const diasAposVencimento = Math.abs(diasRestantes);
          if (carencia > 0 && diasAposVencimento <= carencia) {
            const diasRestantesCarencia = carencia - diasAposVencimento;
            return {
              valid: true,
              status: 'vencido',
              vencido: true,
              aviso: true,
              diasRestantesCarencia,
              mensagem: `Sistema vencido. Você tem mais ${diasRestantesCarencia} dia(s) até o bloqueio.`,
              chave_licenca: chave,
              dados: lic,
            };
          }
          return { valid: false, status: 'expirado', mensagem: 'Licença expirada. Renove para continuar.' };
        }

        return { valid: true, status: 'ativo', diasRestantes, chave_licenca: chave, dados: lic };
      }

      return { valid: true, status: 'ativo', chave_licenca: chave, dados: lic };
    } catch (err) {
      console.error('License check error:', err.message);
      return { valid: false, status: 'sem_conexao', mensagem: 'Não foi possível verificar a licença. Verifique sua conexão com a internet.' };
    }
  },

  async syncWithRemote(chave_licenca) {
    try {
      if (customerDbFromLicense() && readLicenseBinding()) {
        await ensureCustomerPoolFromLicenseIfNeeded();
      }
      const pool    = getPool();
      const licPool = getLicensePool();
      const [rows]  = await licPool.query(
        'SELECT * FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1',
        [chave_licenca]
      );
      if (!rows.length) return { sucesso: false, mensagem: 'Licença não encontrada na base central' };

      const remota = rows[0];
      await licPool.query('UPDATE sistema_licencas SET data_ultimo_acesso = NOW() WHERE id = ?', [remota.id]);
      await licPool.query(
        'INSERT INTO historico_licencas (licenca_id, acao, ip_origem, detalhes) VALUES (?, ?, ?, ?)',
        [remota.id, 'verificacao', 'sistema', JSON.stringify({ origem: 'sync' })]
      );

      const dadosCliente = JSON.stringify({
        razao_social:    remota.razao_social,
        cnpj_cpf:        remota.cnpj_cpf,
        tipo:            remota.tipo_licenca,
        limite_usuarios: remota.limite_usuarios,
        motivo_bloqueio: remota.motivo_bloqueio || null,
      });

      await pool.query(
        `UPDATE config_licenca SET status = ?, data_expiracao = ?, ultima_verificacao = NOW(), dados_cliente = ?
         WHERE chave_licenca = ?`,
        [remota.status, remota.data_fim, dadosCliente, chave_licenca]
      );

      LicenseCache.write(chave_licenca, { valid: true, status: remota.status || 'ativo', chave_licenca, dados: remota });
      return { sucesso: true, dados: remota };
    } catch (err) {
      console.error('License sync error:', err.message);
      return { sucesso: false, mensagem: 'Erro ao conectar base de licenças: ' + err.message };
    }
  },

  async activateLicense(chave, dadosCliente = {}) {
    try {
      const licPool = getLicensePool();
      const [rows]  = await licPool.query(
        'SELECT * FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1',
        [chave]
      );
      if (!rows.length) return { sucesso: false, mensagem: 'Chave de licença inválida' };

      const remota = rows[0];
      if (remota.status === 'bloqueado') return { sucesso: false, mensagem: 'Esta licença está bloqueada' };
      if (remota.status === 'suspenso') return { sucesso: false, mensagem: 'Esta licença está suspensa' };

      let cfg = extractMysqlConfigFromLicenseRow(remota);
      if (!cfg) cfg = await fetchMysqlConfigFromPainelApi(chave);

      if (customerDbFromLicense()) {
        if (!cfg) {
          return {
            sucesso: false,
            mensagem:
              'Licença sem dados de conexão MySQL. Cadastre no registro da licença as colunas ' +
              'mysql_host, mysql_port, mysql_user, mysql_password, mysql_database ' +
              '(ou configure PAINEL_API_URL + PAINEL_API_KEY com /api/licenca/db-config).',
          };
        }
        const newPool = createPool(cfg, chave);
        // Não escreve license-binding.json em multi-tenant: o arquivo é global e contamina outros tenants.
        // Recuperação de pool após restart usa LicenseCache (.enc por chave) — veja auth.js.
        _dbConfigApplied = true;

        // Executa no pool do cliente recém-criado — sem contaminar o pool global
        return await runWithPool(newPool, async () => {
          await ensureTable();
          const pool = getPool(); // → ALS → newPool
          const [existente] = await pool.query('SELECT id FROM config_licenca LIMIT 1');
          if (existente.length) {
            await pool.query(
              'UPDATE config_licenca SET chave_licenca = ?, status = ?, data_expiracao = ?, data_ativacao = NOW() WHERE id = ?',
              [chave, remota.status || 'ativo', remota.data_fim || null, existente[0].id]
            );
          } else {
            await pool.query(
              'INSERT INTO config_licenca (chave_licenca, status, data_expiracao, data_ativacao) VALUES (?, ?, ?, NOW())',
              [chave, remota.status || 'ativo', remota.data_fim || null]
            );
          }
          try {
            await licPool.query(
              'INSERT INTO historico_licencas (licenca_id, acao, detalhes) VALUES (?, ?, ?)',
              [remota.id, 'ativacao', JSON.stringify({ ...dadosCliente, origem: 'SysRepWeb' })]
            );
          } catch { /* histórico opcional */ }
          LicenseCache.write(chave, { valid: true, status: remota.status || 'ativo', chave_licenca: chave, dados: remota });
          return { sucesso: true, mensagem: 'Licença ativada com sucesso', dados: remota };
        });
      }

      // Modo single-tenant (.env com DB_*): comportamento original
      await ensureTable();
      const pool = getPool();
      const [existente] = await pool.query('SELECT id FROM config_licenca LIMIT 1');
      if (existente.length) {
        await pool.query(
          'UPDATE config_licenca SET chave_licenca = ?, status = ?, data_expiracao = ?, data_ativacao = NOW() WHERE id = ?',
          [chave, remota.status || 'ativo', remota.data_fim || null, existente[0].id]
        );
      } else {
        await pool.query(
          'INSERT INTO config_licenca (chave_licenca, status, data_expiracao, data_ativacao) VALUES (?, ?, ?, NOW())',
          [chave, remota.status || 'ativo', remota.data_fim || null]
        );
      }

      try {
        await licPool.query(
          'INSERT INTO historico_licencas (licenca_id, acao, detalhes) VALUES (?, ?, ?)',
          [remota.id, 'ativacao', JSON.stringify({ ...dadosCliente, origem: 'SysRepWeb' })]
        );
      } catch { /* histórico opcional */ }

      LicenseCache.write(chave, { valid: true, status: remota.status || 'ativo', chave_licenca: chave, dados: remota });
      return { sucesso: true, mensagem: 'Licença ativada com sucesso', dados: remota };
    } catch (err) {
      return { sucesso: false, mensagem: err.message };
    }
  },

  // Verifica licença diretamente pela chave (sem depender de config_licenca local)
  async checkByKey(chave_licenca) {
    try {
      const licPool = getLicensePool();
      const [remote] = await licPool.query(
        'SELECT * FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1',
        [chave_licenca]
      );
      if (!remote.length) {
        return { valid: false, status: 'sem_licenca', mensagem: 'Licença não encontrada na base central' };
      }

      const lic = remote[0];
      licPool.query('UPDATE sistema_licencas SET data_ultimo_acesso = NOW() WHERE id = ?', [lic.id]).catch(() => {});

      if (lic.status === 'bloqueado') {
        return { valid: false, status: 'bloqueado', motivo: lic.motivo_bloqueio || null, chave: chave_licenca, mensagem: 'Licença bloqueada. Entre em contato com o suporte.' };
      }
      if (lic.status === 'suspenso') {
        return { valid: false, status: 'bloqueado', chave: chave_licenca, mensagem: 'Licença suspensa. Entre em contato com o suporte.' };
      }

      if (lic.data_fim) {
        const hoje           = new Date();
        const dataFim        = new Date(lic.data_fim);
        const diasRestantes  = Math.ceil((dataFim - hoje) / (1000 * 60 * 60 * 24));
        const carencia       = parseInt(lic.limite_dias_vencimento) || 0;

        if (diasRestantes <= 0) {
          const diasApos = Math.abs(diasRestantes);
          if (carencia > 0 && diasApos <= carencia) {
            const diasRestantesCarencia = carencia - diasApos;
            return { valid: true, status: 'vencido', vencido: true, aviso: true, diasRestantesCarencia,
              mensagem: `Sistema vencido. Você tem mais ${diasRestantesCarencia} dia(s) até o bloqueio.`,
              chave_licenca, dados: lic };
          }
          return { valid: false, status: 'expirado', mensagem: 'Licença expirada. Renove para continuar.' };
        }
        return { valid: true, status: 'ativo', diasRestantes, chave_licenca, dados: lic };
      }

      return { valid: true, status: 'ativo', chave_licenca, dados: lic };
    } catch (err) {
      console.error('[License] checkByKey error:', err.message);
      return { valid: false, status: 'sem_conexao', mensagem: 'Não foi possível verificar a licença.' };
    }
  },

  async activateDemo() {
    if (customerDbFromLicense() && !readLicenseBinding()) {
      return { sucesso: false, mensagem: 'Modo demo não disponível sem banco cliente. Ative uma licença primeiro.' };
    }
    if (customerDbFromLicense()) await ensureCustomerPoolFromLicenseIfNeeded();
    const pool = getPool();
    const [existente] = await pool.query('SELECT id FROM config_licenca LIMIT 1');
    const expiracao = new Date();
    expiracao.setDate(expiracao.getDate() + 30);

    if (existente.length) {
      await pool.query(
        "UPDATE config_licenca SET status = 'demo', data_ativacao = NOW(), data_expiracao = ?, ultima_verificacao = NOW() WHERE id = ?",
        [expiracao.toISOString().split('T')[0], existente[0].id]
      );
    } else {
      const demoKey = 'DEMO-' + this.generateKey().substring(5);
      await pool.query(
        "INSERT INTO config_licenca (chave_licenca, status, data_ativacao, data_expiracao, ultima_verificacao) VALUES (?, 'demo', NOW(), ?, NOW())",
        [demoKey, expiracao.toISOString().split('T')[0]]
      );
    }
    return { sucesso: true, mensagem: 'Modo demo ativado por 30 dias' };
  },
};

module.exports = LicenseService;
module.exports.resetDbConfigFlag = resetDbConfigFlag;
