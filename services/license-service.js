const { getPool }        = require('../config/database');
const { getLicensePool } = require('../config/db-license');
const crypto             = require('crypto');

// Cria a tabela config_licenca se ainda não existir
async function ensureTable() {
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

  // Gera uma chave de licença no formato XXXX-XXXX-XXXX-XXXX
  generateKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${seg()}-${seg()}-${seg()}-${seg()}`;
  },

  // Criptografa dados da licença para armazenamento local
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
      const iv     = Buffer.from(ivHex, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let dec = decipher.update(enc, 'hex', 'utf8');
      dec += decipher.final('utf8');
      return JSON.parse(dec);
    } catch {
      return null;
    }
  },

  // Verifica a licença direto no banco remoto (sem cache local de status)
  async checkLocal() {
    try {
      await ensureTable();
      const pool = getPool();

      // Busca apenas a chave salva localmente
      const [rows] = await pool.query('SELECT * FROM config_licenca ORDER BY id DESC LIMIT 1');
      if (!rows.length || !rows[0].chave_licenca) {
        return { valid: false, status: 'sem_licenca', mensagem: 'Nenhuma licença configurada' };
      }

      const localRow = rows[0];
      const chave = localRow.chave_licenca;

      // Demo local: valida sem consultar o banco remoto
      if (localRow.status === 'demo') {
        if (localRow.data_expiracao) {
          const hoje = new Date();
          const expiracao = new Date(localRow.data_expiracao);
          const diasRestantes = Math.ceil((expiracao - hoje) / (1000 * 60 * 60 * 24));
          if (diasRestantes <= 0) {
            return { valid: false, status: 'expirado', mensagem: 'Demo expirado. Ative uma licença para continuar.' };
          }
          return { valid: true, status: 'demo', demo: true, diasRestantes, aviso: diasRestantes <= 5,
            mensagem: `Demo ativo — ${diasRestantes} dia(s) restante(s)` };
        }
        return { valid: true, status: 'demo', demo: true };
      }

      // Licença real: consulta o status sempre no banco remoto
      const licPool = getLicensePool();
      const [remote] = await licPool.query(
        'SELECT * FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1',
        [chave]
      );

      if (!remote.length) {
        return { valid: false, status: 'sem_licenca', mensagem: 'Licença não encontrada na base central' };
      }

      const lic = remote[0];

      if (lic.status === 'bloqueado') {
        return { valid: false, status: 'bloqueado', motivo: lic.motivo_bloqueio || null, chave, mensagem: 'Licença bloqueada. Entre em contato com o suporte.' };
      }

      if (lic.status === 'suspenso') {
        return { valid: false, status: 'bloqueado', chave, mensagem: 'Licença suspensa. Entre em contato com o suporte.' };
      }

      if (lic.data_fim) {
        const hoje = new Date();
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
              dados: lic,
            };
          }
          return { valid: false, status: 'expirado', mensagem: 'Licença expirada. Renove para continuar.' };
        }

        return { valid: true, status: 'ativo', diasRestantes, aviso: diasRestantes <= 15, dados: lic };
      }

      return { valid: true, status: 'ativo', dados: lic };
    } catch (err) {
      console.error('License check error:', err.message);
      return { valid: false, status: 'sem_conexao', mensagem: 'Não foi possível verificar a licença. Verifique sua conexão com a internet.' };
    }
  },

  // Sincroniza com base remota
  async syncWithRemote(chave_licenca) {
    try {
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

      return { sucesso: true, dados: remota };
    } catch (err) {
      console.error('License sync error:', err.message);
      return { sucesso: false, mensagem: 'Erro ao conectar base de licenças: ' + err.message };
    }
  },

  // Ativa uma licença pelo código — verifica no remoto e salva só a chave localmente
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
      if (remota.status === 'suspenso')  return { sucesso: false, mensagem: 'Esta licença está suspensa' };

      // Salva apenas a chave localmente (status sempre consultado no remoto)
      await ensureTable();
      const pool = getPool();
      const [existente] = await pool.query('SELECT id FROM config_licenca LIMIT 1');
      if (existente.length) {
        await pool.query('UPDATE config_licenca SET chave_licenca = ?, data_ativacao = NOW() WHERE id = ?',
          [chave, existente[0].id]);
      } else {
        await pool.query('INSERT INTO config_licenca (chave_licenca, data_ativacao) VALUES (?, NOW())', [chave]);
      }

      // Registra ativação no histórico remoto (ignora se a tabela/coluna não existir)
      try {
        await licPool.query(
          'INSERT INTO historico_licencas (licenca_id, acao, detalhes) VALUES (?, ?, ?)',
          [remota.id, 'ativacao', JSON.stringify({ ...dadosCliente, origem: 'SysRepWeb' })]
        );
      } catch { /* histórico opcional */ }

      return { sucesso: true, mensagem: 'Licença ativada com sucesso', dados: remota };
    } catch (err) {
      return { sucesso: false, mensagem: err.message };
    }
  },

  // Ativa modo demo local sem necessidade de base remota (30 dias)
  async activateDemo() {
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
