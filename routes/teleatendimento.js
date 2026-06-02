const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

// ─── ensureTabelas ────────────────────────────────────────────────────────────
// Cria as tabelas do módulo se não existirem — mesmo sem migração rodada.
let _tabelasCriadas = false;
async function ensureTabelas() {
  if (_tabelasCriadas) return;
  const pool = getPool();
  const sqls = [
    `CREATE TABLE IF NOT EXISTS tele_campanhas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_empresa INT NOT NULL DEFAULT 1,
      nome VARCHAR(150) NOT NULL,
      descricao TEXT NULL,
      script_abordagem TEXT NULL,
      data_inicio DATE NULL,
      data_fim DATE NULL,
      meta_ligacoes_dia INT DEFAULT 0,
      max_tentativas INT NOT NULL DEFAULT 3,
      horario_inicio TIME NULL,
      horario_fim TIME NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ATIVA',
      id_usuario_criador INT NOT NULL DEFAULT 0,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tc_empresa (id_empresa),
      INDEX idx_tc_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS tele_fila (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_campanha INT NOT NULL,
      id_empresa INT NOT NULL DEFAULT 1,
      id_cliente INT NULL,
      nome_prospect VARCHAR(150) NOT NULL DEFAULT '',
      telefone VARCHAR(30) NOT NULL DEFAULT '',
      cidade VARCHAR(100) NOT NULL DEFAULT '',
      uf VARCHAR(2) NOT NULL DEFAULT '',
      ordem INT NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      id_operador_atual INT NULL,
      tentativas INT NOT NULL DEFAULT 0,
      max_tentativas INT NOT NULL DEFAULT 3,
      proximo_contato DATETIME NULL,
      excluido CHAR(1) NOT NULL DEFAULT 'N',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tf_campanha (id_campanha),
      INDEX idx_tf_status (status),
      INDEX idx_tf_cliente (id_cliente),
      INDEX idx_tf_operador (id_operador_atual)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS tele_chamadas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_fila INT NOT NULL,
      id_campanha INT NOT NULL,
      id_empresa INT NOT NULL DEFAULT 1,
      id_operador INT NOT NULL,
      id_cliente INT NULL,
      data_hora_inicio DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      data_hora_fim DATETIME NULL,
      duracao_seg INT NULL,
      resultado VARCHAR(40) NOT NULL DEFAULT 'NAO_ATENDEU',
      observacao TEXT NULL,
      id_pedido INT NULL,
      id_lead INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tch_campanha (id_campanha),
      INDEX idx_tch_operador (id_operador),
      INDEX idx_tch_cliente (id_cliente),
      INDEX idx_tch_data (data_hora_inicio)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS tele_pausas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_campanha INT NOT NULL,
      id_empresa INT NOT NULL DEFAULT 1,
      id_operador INT NOT NULL,
      inicio DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fim DATETIME NULL,
      duracao_seg INT NULL,
      motivo VARCHAR(100) NULL,
      INDEX idx_tp_operador (id_operador),
      INDEX idx_tp_campanha (id_campanha),
      INDEX idx_tp_data (inicio)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // Colunas novas em tele_campanhas (bases que já tinham a tabela sem esses campos)
    `ALTER TABLE tele_campanhas ADD COLUMN IF NOT EXISTS max_tentativas INT NOT NULL DEFAULT 3`,
    `ALTER TABLE tele_campanhas ADD COLUMN IF NOT EXISTS horario_inicio TIME NULL`,
    `ALTER TABLE tele_campanhas ADD COLUMN IF NOT EXISTS horario_fim TIME NULL`,

    // Tabela de configuração do WhatsApp (criada em config-sistema mas pode não existir)
    `CREATE TABLE IF NOT EXISTS configuracao (
      id INT AUTO_INCREMENT PRIMARY KEY,
      w_apiglobal VARCHAR(250) NULL DEFAULT NULL,
      w_urlplataforma VARCHAR(250) NULL DEFAULT NULL,
      excluido VARCHAR(1) NULL DEFAULT 'N',
      empresa_liberada VARCHAR(50) NULL DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8`,
  ];
  for (const sql of sqls) {
    await pool.query(sql).catch(() => {});
  }

  // Fallback para MySQL < 8: verifica e cria colunas individualmente
  // (ADD COLUMN IF NOT EXISTS só existe no MySQL 8+)
  const colunasPendentes = [
    { tabela: 'clientes',  coluna: 'dnd',       ddl: "CHAR(1) NOT NULL DEFAULT 'N'" },
    { tabela: 'usuarios',  coluna: 'instancia',  ddl: 'VARCHAR(100) NULL DEFAULT NULL' },
    { tabela: 'usuarios',  coluna: 'chave',      ddl: 'VARCHAR(250) NULL DEFAULT NULL' },
    { tabela: 'usuarios',  coluna: 'status',     ddl: "VARCHAR(30) NULL DEFAULT NULL" },
    { tabela: 'usuarios',  coluna: 'data_conexao', ddl: 'DATETIME NULL DEFAULT NULL' },
    { tabela: 'usuarios',  coluna: 'numero_whatsApp', ddl: 'VARCHAR(50) NULL DEFAULT NULL' },
  ];

  try {
    const nomes = colunasPendentes.map(c => c.tabela).filter((v, i, a) => a.indexOf(v) === i);
    const ph = nomes.map(() => '?').join(',');
    const [existentes] = await pool.query(
      `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${ph})`,
      nomes
    );
    const existSet = new Set(existentes.map(r => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));
    for (const { tabela, coluna, ddl } of colunasPendentes) {
      if (!existSet.has(`${tabela}.${coluna}`)) {
        await pool.query(`ALTER TABLE \`${tabela}\` ADD COLUMN \`${coluna}\` ${ddl}`).catch(() => {});
      }
    }
  } catch (_) {}
  _tabelasCriadas = true;
}

// Garante tabelas na primeira requisição de qualquer endpoint
router.use(async (_req, _res, next) => {
  try { await ensureTabelas(); } catch (_) {}
  next();
});

// ─── helpers ─────────────────────────────────────────────────────────────────

const RESULTADOS_VALIDOS = [
  'ATENDEU_INTERESSE','ATENDEU_SEM_INTERESSE',
  'NAO_ATENDEU','OCUPADO','NUMERO_ERRADO','CAIXA_POSTAL','REAGENDAR',
];

function normalizeResultado(v) {
  const s = (v || '').toUpperCase().trim().replace(/\s+/g, '_');
  return RESULTADOS_VALIDOS.includes(s) ? s : 'NAO_ATENDEU';
}

function eid(req) { return req.user?.id_empresa || 1; }
function uid(req) { return req.user?.idusuario  || 0; }
function isSupervisor(req) {
  return req.user?.perfil == 1 || req.user?.role === 'admin'
      || req.user?.permissoes?.manutencaocadastros === 'S';
}

// Expande variáveis do script de abordagem
function expandirScript(script, fila, nomeOperador) {
  if (!script) return '';
  return script
    .replace(/\{nome_cliente\}/gi,    fila.nome_prospect || fila.nome_cliente_cadastrado || '')
    .replace(/\{nome_operador\}/gi,   nomeOperador || '')
    .replace(/\{cidade\}/gi,          fila.cidade_cadastrada || fila.cidade || '')
    .replace(/\{uf\}/gi,              fila.uf_cadastrada || fila.uf || '')
    .replace(/\{ultimo_pedido\}/gi,   fila.ultimo_pedido
        ? new Date(fila.ultimo_pedido).toLocaleDateString('pt-BR') : 'nenhum')
    .replace(/\{total_ano\}/gi,       fila.total_ano
        ? 'R$ ' + Number(fila.total_ano).toLocaleString('pt-BR', {minimumFractionDigits:2}) : 'R$ 0,00')
    .replace(/\{tentativas\}/gi,      String(fila.tentativas || 0));
}

// ─── CAMPANHAS ───────────────────────────────────────────────────────────────

router.get('/campanhas', async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    let sql = `
      SELECT c.*,
        (SELECT COUNT(*) FROM tele_fila f WHERE f.id_campanha=c.id AND f.excluido='N') AS total_fila,
        (SELECT COUNT(*) FROM tele_fila f WHERE f.id_campanha=c.id AND f.status='CONCLUIDO' AND f.excluido='N') AS total_concluido,
        (SELECT COUNT(*) FROM tele_fila f WHERE f.id_campanha=c.id AND f.status='PENDENTE' AND f.excluido='N'
           AND (f.proximo_contato IS NULL OR DATE(f.proximo_contato)=CURDATE())) AS pendentes_hoje,
        (SELECT COUNT(*) FROM tele_chamadas ch WHERE ch.id_campanha=c.id AND DATE(ch.data_hora_inicio)=CURDATE()) AS ligacoes_hoje,
        (SELECT COUNT(*) FROM tele_chamadas ch WHERE ch.id_campanha=c.id AND ch.resultado='ATENDEU_INTERESSE' AND DATE(ch.data_hora_inicio)=CURDATE()) AS interesse_hoje,
        u.nomeusu AS nome_criador
      FROM tele_campanhas c
      LEFT JOIN usuarios u ON u.idusuario=c.id_usuario_criador
      WHERE c.id_empresa=? AND c.excluido='N'`;
    const params = [eid(req)];
    if (status) { sql += ` AND c.status=?`; params.push(status.toUpperCase()); }
    sql += ` ORDER BY c.created_at DESC`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('[tele/campanhas GET]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/campanhas/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [[row]] = await pool.query(
      `SELECT c.*, u.nomeusu AS nome_criador
       FROM tele_campanhas c
       LEFT JOIN usuarios u ON u.idusuario=c.id_usuario_criador
       WHERE c.id=? AND c.id_empresa=? AND c.excluido='N'`,
      [req.params.id, eid(req)]
    );
    if (!row) return res.status(404).json({ error: 'Campanha não encontrada' });
    res.json(row);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campanhas', async (req, res) => {
  if (!isSupervisor(req)) return res.status(403).json({ error: 'Apenas supervisores podem criar campanhas' });
  try {
    const pool = getPool();
    const { nome, descricao, script_abordagem, data_inicio, data_fim,
            meta_ligacoes_dia, max_tentativas, horario_inicio, horario_fim } = req.body;
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const [r] = await pool.query(
      `INSERT INTO tele_campanhas (id_empresa, nome, descricao, script_abordagem, data_inicio, data_fim,
         meta_ligacoes_dia, max_tentativas, horario_inicio, horario_fim, id_usuario_criador)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [eid(req), nome.trim(), descricao||null, script_abordagem||null,
       data_inicio||null, data_fim||null, meta_ligacoes_dia||0,
       max_tentativas||3, horario_inicio||null, horario_fim||null, uid(req)]
    );
    res.status(201).json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/campanhas/:id', async (req, res) => {
  if (!isSupervisor(req)) return res.status(403).json({ error: 'Apenas supervisores podem editar campanhas' });
  try {
    const pool = getPool();
    const { nome, descricao, script_abordagem, data_inicio, data_fim,
            meta_ligacoes_dia, max_tentativas, horario_inicio, horario_fim, status } = req.body;
    if (!nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });
    const statusValidos = ['ATIVA','PAUSADA','ENCERRADA'];
    const st = statusValidos.includes((status||'').toUpperCase()) ? status.toUpperCase() : 'ATIVA';
    await pool.query(
      `UPDATE tele_campanhas SET nome=?, descricao=?, script_abordagem=?, data_inicio=?, data_fim=?,
         meta_ligacoes_dia=?, max_tentativas=?, horario_inicio=?, horario_fim=?, status=?
       WHERE id=? AND id_empresa=? AND excluido='N'`,
      [nome.trim(), descricao||null, script_abordagem||null, data_inicio||null, data_fim||null,
       meta_ligacoes_dia||0, max_tentativas||3, horario_inicio||null, horario_fim||null, st,
       req.params.id, eid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/campanhas/:id', async (req, res) => {
  if (!isSupervisor(req)) return res.status(403).json({ error: 'Apenas supervisores podem excluir campanhas' });
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE tele_campanhas SET excluido='S' WHERE id=? AND id_empresa=?`,
      [req.params.id, eid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── FILA ────────────────────────────────────────────────────────────────────

router.get('/campanhas/:id/fila', async (req, res) => {
  try {
    const pool = getPool();
    const { status } = req.query;
    let sql = `
      SELECT f.*, c.nome AS nome_cliente_cadastrado, c.foneprincipal AS telefone_cadastrado,
        u.nomeusu AS nome_operador
      FROM tele_fila f
      LEFT JOIN clientes c ON c.id=f.id_cliente
      LEFT JOIN usuarios u ON u.idusuario=f.id_operador_atual
      WHERE f.id_campanha=? AND f.id_empresa=? AND f.excluido='N'`;
    const params = [req.params.id, eid(req)];
    if (status) { sql += ` AND f.status=?`; params.push(status.toUpperCase()); }
    sql += ` ORDER BY f.ordem, f.id`;
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campanhas/:id/fila', async (req, res) => {
  if (!isSupervisor(req)) return res.status(403).json({ error: 'Apenas supervisores podem gerenciar a fila' });
  try {
    const pool = getPool();
    const { clientes } = req.body;
    if (!Array.isArray(clientes) || !clientes.length)
      return res.status(400).json({ error: 'Lista de clientes vazia' });

    const [[campRow]] = await pool.query(
      `SELECT max_tentativas FROM tele_campanhas WHERE id=? AND excluido='N'`, [req.params.id]
    );
    const maxTent = campRow?.max_tentativas || 3;

    const [[maxRow]] = await pool.query(
      `SELECT COALESCE(MAX(ordem),0) AS max_ordem FROM tele_fila WHERE id_campanha=? AND excluido='N'`,
      [req.params.id]
    );
    let ordem = maxRow.max_ordem + 1;

    const values = clientes.map(c => [
      req.params.id, eid(req), c.id_cliente||null,
      (c.nome_prospect||c.nome||'').slice(0,150),
      (c.telefone||'').slice(0,30),
      (c.cidade||'').slice(0,100),
      (c.uf||'').slice(0,2).toUpperCase(),
      ordem++, maxTent,
    ]);
    await pool.query(
      `INSERT INTO tele_fila (id_campanha, id_empresa, id_cliente, nome_prospect, telefone, cidade, uf, ordem, max_tentativas)
       VALUES ?`, [values]
    );
    res.status(201).json({ inseridos: values.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campanhas/:id/fila/por-filtro', async (req, res) => {
  if (!isSupervisor(req)) return res.status(403).json({ error: 'Apenas supervisores podem gerenciar a fila' });
  try {
    const pool = getPool();
    const { sem_pedido_dias, regiao_id, segmento, limite } = req.body;

    // Busca max_tentativas da campanha
    const [[campRow]] = await pool.query(
      `SELECT max_tentativas FROM tele_campanhas WHERE id=? AND excluido='N'`, [req.params.id]
    );
    const maxTent = campRow?.max_tentativas || 3;

    let sql = `
      SELECT c.id, c.nome AS nome_prospect, c.foneprincipal AS telefone, c.cidade, c.uf
      FROM clientes c
      WHERE (c.excluido='N' OR c.excluido IS NULL OR c.excluido='')
        AND (c.status='A' OR c.status IS NULL OR c.status='')
        AND (c.dnd IS NULL OR c.dnd='N')
        AND c.id NOT IN (
          SELECT DISTINCT f.id_cliente FROM tele_fila f
          WHERE f.id_campanha=? AND f.excluido='N' AND f.id_cliente IS NOT NULL
        )`;
    const params = [req.params.id];

    if (sem_pedido_dias && Number(sem_pedido_dias) > 0) {
      sql += ` AND (
        NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.cod_cliente=c.id AND COALESCE(p.excluido,'N')='N')
        OR (SELECT MAX(p2.data_abertura) FROM pedidos p2 WHERE p2.cod_cliente=c.id AND COALESCE(p2.excluido,'N')='N')
            < DATE_SUB(CURDATE(), INTERVAL ? DAY)
      )`;
      params.push(Number(sem_pedido_dias));
    }
    if (regiao_id) { sql += ` AND c.regiao=?`;    params.push(regiao_id); }
    if (segmento)  { sql += ` AND c.segmento=?`;  params.push(segmento); }
    sql += ` ORDER BY c.nome LIMIT ?`;
    params.push(Math.min(Number(limite)||500, 2000));

    const [clientes] = await pool.query(sql, params);
    if (!clientes.length) return res.json({ inseridos: 0 });

    const [[maxRow]] = await pool.query(
      `SELECT COALESCE(MAX(ordem),0) AS max_ordem FROM tele_fila WHERE id_campanha=? AND excluido='N'`,
      [req.params.id]
    );
    let ordem = maxRow.max_ordem + 1;

    const values = clientes.map(c => [
      req.params.id, eid(req),
      c.id, c.nome_prospect, c.telefone||'', c.cidade||'', c.uf||'',
      ordem++, maxTent,
    ]);
    await pool.query(
      `INSERT INTO tele_fila (id_campanha, id_empresa, id_cliente, nome_prospect, telefone, cidade, uf, ordem, max_tentativas)
       VALUES ?`, [values]
    );
    res.json({ inseridos: values.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/campanhas/:id/fila/:fid', async (req, res) => {
  if (!isSupervisor(req)) return res.status(403).json({ error: 'Apenas supervisores podem remover da fila' });
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE tele_fila SET excluido='S' WHERE id=? AND id_campanha=? AND id_empresa=?`,
      [req.params.fid, req.params.id, eid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PRÓXIMA LIGAÇÃO ─────────────────────────────────────────────────────────

router.post('/campanhas/:id/proxima', async (req, res) => {
  const pool = getPool();

  // Verifica horário comercial da campanha
  try {
    const [[camp]] = await pool.query(
      `SELECT horario_inicio, horario_fim, status FROM tele_campanhas WHERE id=? AND excluido='N'`,
      [req.params.id]
    );
    if (camp?.status === 'PAUSADA' || camp?.status === 'ENCERRADA') {
      return res.json({ fim: true, mensagem: `Campanha ${camp.status.toLowerCase()}` });
    }
    if (camp?.horario_inicio && camp?.horario_fim) {
      const agora = new Date().toLocaleTimeString('pt-BR', { timeZone:'America/Sao_Paulo', hour12:false }).slice(0,5);
      if (agora < camp.horario_inicio.slice(0,5) || agora > camp.horario_fim.slice(0,5)) {
        return res.json({
          fim: true,
          mensagem: `Fora do horário de atendimento (${camp.horario_inicio.slice(0,5)}–${camp.horario_fim.slice(0,5)})`,
        });
      }
    }
  } catch (_) {}

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[fila]] = await conn.query(
      `SELECT f.*, c.nome AS nome_cliente_cadastrado, c.foneprincipal AS telefone_cadastrado,
              c.cpf AS cnpj_cpf, c.cidade AS cidade_cadastrada, c.uf AS uf_cadastrada,
              c.email, c.regiao, COALESCE(c.dnd,'N') AS dnd,
              (SELECT MAX(p.data_abertura) FROM pedidos p WHERE p.cod_cliente=c.id AND COALESCE(p.excluido,'N')='N') AS ultimo_pedido,
              (SELECT COALESCE(SUM(p.vlrtotalpedido),0) FROM pedidos p WHERE p.cod_cliente=c.id AND COALESCE(p.excluido,'N')='N' AND YEAR(p.data_abertura)=YEAR(CURDATE())) AS total_ano
       FROM tele_fila f
       LEFT JOIN clientes c ON c.id=f.id_cliente
       WHERE f.id_campanha=? AND f.id_empresa=?
         AND f.excluido='N' AND f.status='PENDENTE'
         AND (f.proximo_contato IS NULL OR f.proximo_contato<=NOW())
         AND (c.dnd IS NULL OR c.dnd='N')
       ORDER BY f.ordem, f.id
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [req.params.id, eid(req)]
    );

    if (!fila) {
      await conn.rollback();
      return res.json({ fim: true, mensagem: 'Fila concluída para esta campanha' });
    }

    await conn.query(
      `UPDATE tele_fila SET status='EM_ATENDIMENTO', id_operador_atual=? WHERE id=?`,
      [uid(req), fila.id]
    );
    await conn.commit();

    // Busca script + nome do operador para expansão das variáveis
    const [[campanha]] = await pool.query(
      `SELECT script_abordagem, nome FROM tele_campanhas WHERE id=?`, [req.params.id]
    );
    const [[urow]] = await pool.query(
      `SELECT nomeusu FROM usuarios WHERE idusuario=?`, [uid(req)]
    );

    res.json({
      fila,
      campanha,
      script: expandirScript(campanha?.script_abordagem, fila, urow?.nomeusu || ''),
    });
  } catch (err) {
    await conn.rollback();
    console.error('[tele/proxima]', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ─── REGISTRAR CHAMADA ────────────────────────────────────────────────────────

router.post('/chamadas', async (req, res) => {
  try {
    const pool = getPool();
    const { id_fila, id_campanha, id_cliente, resultado, observacao,
            duracao_seg, data_hora_inicio, data_hora_fim, id_pedido, id_lead, reagendar_em } = req.body;

    if (!id_fila || !id_campanha) return res.status(400).json({ error: 'id_fila e id_campanha obrigatórios' });
    const res_norm = normalizeResultado(resultado);

    const [ins] = await pool.query(
      `INSERT INTO tele_chamadas
         (id_fila, id_campanha, id_empresa, id_operador, id_cliente,
          data_hora_inicio, data_hora_fim, duracao_seg, resultado, observacao, id_pedido, id_lead)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id_fila, id_campanha, eid(req), uid(req), id_cliente||null,
       data_hora_inicio||new Date(), data_hora_fim||new Date(),
       duracao_seg||null, res_norm, observacao||null, id_pedido||null, id_lead||null]
    );

    const [[filaRow]] = await pool.query(
      `SELECT tentativas, max_tentativas FROM tele_fila WHERE id=?`, [id_fila]
    );
    const novasTentativas = (filaRow?.tentativas||0) + 1;
    const maxTent = filaRow?.max_tentativas || 3;

    let novoStatus;
    if (['ATENDEU_INTERESSE','ATENDEU_SEM_INTERESSE','NUMERO_ERRADO'].includes(res_norm)) {
      novoStatus = 'CONCLUIDO';
    } else if (res_norm === 'REAGENDAR' && reagendar_em) {
      novoStatus = 'PENDENTE';
    } else if (novasTentativas >= maxTent) {
      novoStatus = 'CONCLUIDO';
    } else {
      novoStatus = 'PENDENTE';
    }

    await pool.query(
      `UPDATE tele_fila SET status=?, tentativas=?, id_operador_atual=NULL, proximo_contato=? WHERE id=?`,
      [novoStatus, novasTentativas, (res_norm==='REAGENDAR'&&reagendar_em)?reagendar_em:null, id_fila]
    );

    res.status(201).json({ id: ins.insertId, status_fila: novoStatus });
  } catch (err) {
    console.error('[tele/chamadas POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/chamadas/liberar', async (req, res) => {
  try {
    const pool = getPool();
    const { id_fila } = req.body;
    await pool.query(
      `UPDATE tele_fila SET status='PENDENTE', id_operador_atual=NULL
       WHERE id=? AND id_operador_atual=? AND status='EM_ATENDIMENTO'`,
      [id_fila, uid(req)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LIMPAR TRAVADOS (registros EM_ATENDIMENTO há >30min) ────────────────────

router.post('/limpar-travados', async (req, res) => {
  if (!isSupervisor(req)) return res.status(403).json({ error: 'Apenas supervisores' });
  try {
    const pool = getPool();
    const minutos = Number(req.body?.minutos) || 30;
    const [r] = await pool.query(
      `UPDATE tele_fila SET status='PENDENTE', id_operador_atual=NULL
       WHERE id_empresa=? AND status='EM_ATENDIMENTO'
         AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
      [eid(req), minutos]
    );
    res.json({ liberados: r.affectedRows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PAUSA DO OPERADOR ────────────────────────────────────────────────────────

router.post('/pausar', async (req, res) => {
  try {
    const pool = getPool();
    const { id_campanha, motivo } = req.body;
    if (!id_campanha) return res.status(400).json({ error: 'id_campanha obrigatório' });
    // Fecha pausas abertas anteriores deste operador nesta campanha
    await pool.query(
      `UPDATE tele_pausas SET fim=NOW(), duracao_seg=TIMESTAMPDIFF(SECOND,inicio,NOW())
       WHERE id_operador=? AND id_campanha=? AND fim IS NULL`,
      [uid(req), id_campanha]
    );
    const [r] = await pool.query(
      `INSERT INTO tele_pausas (id_campanha, id_empresa, id_operador, motivo) VALUES (?, ?, ?, ?)`,
      [id_campanha, eid(req), uid(req), motivo||null]
    );
    res.json({ id: r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/retomar', async (req, res) => {
  try {
    const pool = getPool();
    const { id_campanha } = req.body;
    await pool.query(
      `UPDATE tele_pausas SET fim=NOW(), duracao_seg=TIMESTAMPDIFF(SECOND,inicio,NOW())
       WHERE id_operador=? AND id_campanha=? AND fim IS NULL`,
      [uid(req), id_campanha]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/status-operador', async (req, res) => {
  try {
    const pool = getPool();
    const { id_campanha } = req.query;
    if (!id_campanha) return res.json({ pausado: false });
    const [[pausa]] = await pool.query(
      `SELECT id, inicio, motivo FROM tele_pausas
       WHERE id_operador=? AND id_campanha=? AND fim IS NULL
       ORDER BY id DESC LIMIT 1`,
      [uid(req), id_campanha]
    );
    res.json({ pausado: !!pausa, pausa: pausa || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PAINEL SUPERVISOR ────────────────────────────────────────────────────────

router.get('/painel/:id_campanha', async (req, res) => {
  try {
    const pool = getPool();
    const cid = req.params.id_campanha;

    const [[totais]] = await pool.query(
      `SELECT
         COUNT(*) AS total_fila,
         SUM(status='PENDENTE' AND (proximo_contato IS NULL OR proximo_contato<=NOW())) AS pendentes,
         SUM(status='CONCLUIDO') AS concluidos,
         SUM(status='EM_ATENDIMENTO') AS em_atendimento,
         SUM(status='PENDENTE' AND proximo_contato > NOW()) AS reagendados_futuros,
         SUM(status='PENDENTE' AND DATE(proximo_contato)=CURDATE()) AS reagendados_hoje
       FROM tele_fila WHERE id_campanha=? AND id_empresa=? AND excluido='N'`,
      [cid, eid(req)]
    );

    const [[hoje]] = await pool.query(
      `SELECT
         COUNT(*) AS ligacoes,
         SUM(resultado IN ('ATENDEU_INTERESSE','ATENDEU_SEM_INTERESSE')) AS contatos,
         SUM(resultado='ATENDEU_INTERESSE') AS interesse,
         SUM(id_pedido IS NOT NULL) AS pedidos,
         SUM(resultado='REAGENDAR') AS reagendados,
         AVG(duracao_seg) AS duracao_media
       FROM tele_chamadas
       WHERE id_campanha=? AND id_empresa=? AND DATE(data_hora_inicio)=CURDATE()`,
      [cid, eid(req)]
    );

    const [operadores] = await pool.query(
      `SELECT u.idusuario, u.nomeusu AS nome,
         COUNT(ch.id) AS ligacoes,
         SUM(ch.resultado IN ('ATENDEU_INTERESSE','ATENDEU_SEM_INTERESSE')) AS contatos,
         SUM(ch.resultado='ATENDEU_INTERESSE') AS interesse,
         SUM(ch.id_pedido IS NOT NULL) AS pedidos,
         MAX(CASE WHEN f.status='EM_ATENDIMENTO' AND f.id_operador_atual=u.idusuario THEN 1 ELSE 0 END) AS em_ligacao,
         (SELECT COUNT(*) FROM tele_pausas tp WHERE tp.id_operador=u.idusuario AND tp.id_campanha=ch.id_campanha AND tp.fim IS NULL) AS pausado,
         (SELECT COALESCE(SUM(tp2.duracao_seg),0) FROM tele_pausas tp2 WHERE tp2.id_operador=u.idusuario AND tp2.id_campanha=ch.id_campanha AND DATE(tp2.inicio)=CURDATE()) AS pausa_total_seg
       FROM tele_chamadas ch
       JOIN usuarios u ON u.idusuario=ch.id_operador
       LEFT JOIN tele_fila f ON f.id_operador_atual=u.idusuario AND f.id_campanha=ch.id_campanha
       WHERE ch.id_campanha=? AND ch.id_empresa=? AND DATE(ch.data_hora_inicio)=CURDATE()
       GROUP BY u.idusuario, u.nomeusu
       ORDER BY ligacoes DESC`,
      [cid, eid(req)]
    );

    const [historico] = await pool.query(
      `SELECT ch.*, u.nomeusu AS nome_operador,
         COALESCE(f.nome_prospect, cl.nome) AS nome_contato
       FROM tele_chamadas ch
       JOIN usuarios u ON u.idusuario=ch.id_operador
       JOIN tele_fila f ON f.id=ch.id_fila
       LEFT JOIN clientes cl ON cl.id=ch.id_cliente
       WHERE ch.id_campanha=? AND ch.id_empresa=?
       ORDER BY ch.data_hora_inicio DESC LIMIT 50`,
      [cid, eid(req)]
    );

    res.json({ totais, hoje, operadores, historico });
  } catch (err) {
    console.error('[tele/painel]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── RELATÓRIO ────────────────────────────────────────────────────────────────

router.get('/relatorio', async (req, res) => {
  try {
    const pool = getPool();
    const { id_campanha, data_inicio, data_fim, formato } = req.query;

    let sql = `
      SELECT
        u.nomeusu AS operador,
        DATE(ch.data_hora_inicio) AS data,
        tc.nome AS campanha,
        COUNT(*) AS total_ligacoes,
        SUM(ch.resultado IN ('ATENDEU_INTERESSE','ATENDEU_SEM_INTERESSE')) AS total_contatos,
        SUM(ch.resultado='ATENDEU_INTERESSE') AS total_interesse,
        SUM(ch.resultado='NAO_ATENDEU') AS nao_atendeu,
        SUM(ch.resultado='OCUPADO') AS ocupado,
        SUM(ch.resultado='CAIXA_POSTAL') AS caixa_postal,
        SUM(ch.resultado='NUMERO_ERRADO') AS numero_errado,
        SUM(ch.resultado='REAGENDAR') AS reagendado,
        SUM(ch.id_pedido IS NOT NULL) AS pedidos_gerados,
        SUM(ch.id_lead IS NOT NULL) AS leads_gerados,
        ROUND(AVG(ch.duracao_seg)) AS duracao_media,
        ROUND(SUM(ch.resultado IN ('ATENDEU_INTERESSE','ATENDEU_SEM_INTERESSE'))*100/COUNT(*),1) AS taxa_contato,
        ROUND(SUM(ch.resultado='ATENDEU_INTERESSE')*100/COUNT(*),1) AS taxa_interesse
      FROM tele_chamadas ch
      JOIN usuarios u ON u.idusuario=ch.id_operador
      LEFT JOIN tele_campanhas tc ON tc.id=ch.id_campanha
      WHERE ch.id_empresa=?`;
    const params = [eid(req)];

    if (id_campanha) { sql += ` AND ch.id_campanha=?`;              params.push(id_campanha); }
    if (data_inicio)  { sql += ` AND DATE(ch.data_hora_inicio)>=?`; params.push(data_inicio); }
    if (data_fim)     { sql += ` AND DATE(ch.data_hora_inicio)<=?`; params.push(data_fim); }

    sql += ` GROUP BY u.idusuario, u.nomeusu, DATE(ch.data_hora_inicio), ch.id_campanha, tc.nome
             ORDER BY data DESC, total_ligacoes DESC`;

    const [rows] = await pool.query(sql, params);

    if (formato === 'csv') {
      const header = ['Data','Operador','Campanha','Ligações','Contatos','%Contato',
        'Interesses','%Interesse','Pedidos','Leads','Não Atendeu','Ocupado','Caixa Postal',
        'Nº Errado','Reagendado','Dur.Média(s)'];
      const linhas = rows.map(r => [
        r.data, r.operador, r.campanha||'', r.total_ligacoes, r.total_contatos,
        r.taxa_contato||0, r.total_interesse, r.taxa_interesse||0, r.pedidos_gerados,
        r.leads_gerados, r.nao_atendeu, r.ocupado, r.caixa_postal,
        r.numero_errado, r.reagendado, r.duracao_media||0,
      ].map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(';'));
      const csv = [header.join(';'), ...linhas].join('\r\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="relatorio-teleatendimento.csv"');
      return res.send('﻿' + csv); // BOM UTF-8 para Excel
    }

    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── COMPARATIVO ENTRE CAMPANHAS ─────────────────────────────────────────────

router.get('/comparativo', async (req, res) => {
  try {
    const pool = getPool();
    const { data_inicio, data_fim } = req.query;

    let sql = `
      SELECT
        tc.id, tc.nome AS campanha, tc.status AS status_campanha,
        COUNT(DISTINCT f.id) AS total_fila,
        COUNT(DISTINCT CASE WHEN f.status='CONCLUIDO' THEN f.id END) AS concluidos,
        COUNT(ch.id) AS total_ligacoes,
        SUM(ch.resultado IN ('ATENDEU_INTERESSE','ATENDEU_SEM_INTERESSE')) AS contatos,
        SUM(ch.resultado='ATENDEU_INTERESSE') AS interesses,
        SUM(ch.id_pedido IS NOT NULL) AS pedidos,
        SUM(ch.id_lead IS NOT NULL) AS leads,
        ROUND(SUM(ch.resultado IN ('ATENDEU_INTERESSE','ATENDEU_SEM_INTERESSE'))*100/NULLIF(COUNT(ch.id),0),1) AS taxa_contato,
        ROUND(SUM(ch.resultado='ATENDEU_INTERESSE')*100/NULLIF(COUNT(ch.id),0),1) AS taxa_interesse,
        ROUND(AVG(ch.duracao_seg)) AS duracao_media,
        COUNT(DISTINCT ch.id_operador) AS operadores_ativos
      FROM tele_campanhas tc
      LEFT JOIN tele_fila f ON f.id_campanha=tc.id AND f.excluido='N'
      LEFT JOIN tele_chamadas ch ON ch.id_campanha=tc.id AND ch.id_empresa=tc.id_empresa`;

    const params = [];
    const wheres = [`tc.id_empresa=?`, `tc.excluido='N'`];
    params.push(eid(req));

    // ch.id IS NULL = campanha sem nenhuma ligação — mantida no resultado mesmo com filtro de data
    if (data_inicio) { wheres.push(`(ch.id IS NULL OR DATE(ch.data_hora_inicio)>=?)`); params.push(data_inicio); }
    if (data_fim)    { wheres.push(`(ch.id IS NULL OR DATE(ch.data_hora_inicio)<=?)`); params.push(data_fim); }

    sql += ` WHERE ${wheres.join(' AND ')}`;
    sql += ` GROUP BY tc.id, tc.nome, tc.status ORDER BY total_ligacoes DESC`;

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CLIENTES COM LIGAÇÕES (badge na lista de clientes) ───────────────────────

router.get('/clientes-com-ligacoes', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT DISTINCT id_cliente,
         MAX(resultado) AS ultimo_resultado,
         MAX(data_hora_inicio) AS ultima_ligacao
       FROM tele_chamadas
       WHERE id_empresa=? AND id_cliente IS NOT NULL
       GROUP BY id_cliente`,
      [eid(req)]
    );
    // Retorna mapa { id_cliente: { ultimo_resultado, ultima_ligacao } }
    const mapa = {};
    rows.forEach(r => { mapa[r.id_cliente] = { r: r.ultimo_resultado, d: r.ultima_ligacao }; });
    res.json(mapa);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── WHATSAPP (Evolution API + fallback wa.me) ────────────────────────────────

router.post('/whatsapp', async (req, res) => {
  try {
    const pool = getPool();
    const { numero, mensagem } = req.body;
    if (!numero || !mensagem) return res.status(400).json({ error: 'numero e mensagem obrigatórios' });

    const numeroLimpo = numero.replace(/\D/g, '');
    const waLink = `https://wa.me/55${numeroLimpo}?text=${encodeURIComponent(mensagem)}`;

    const [[urow]] = await pool.query(
      `SELECT instancia, chave FROM usuarios WHERE idusuario=? AND COALESCE(excluido,'N')='N' LIMIT 1`,
      [uid(req)]
    );
    if (!urow?.instancia)
      return res.json({ ok: false, fallback: true, wa_link: waLink, motivo: 'sem_instancia' });

    const [[cfg]] = await pool.query(
      `SELECT w_urlplataforma AS url, w_apiglobal AS apikey FROM configuracao LIMIT 1`
    ).catch(() => [[null]]);
    if (!cfg?.url)
      return res.json({ ok: false, fallback: true, wa_link: waLink, motivo: 'sem_config' });

    const axios = require('axios');
    const base  = cfg.url.replace(/\/$/, '');

    try {
      const stateResp = await axios.get(
        `${base}/instance/connectionState/${urow.instancia}`,
        { headers: { apikey: urow.chave || cfg.apikey }, timeout: 5000 }
      );
      const state = stateResp.data?.instance?.state || stateResp.data?.state;
      if (state !== 'open')
        return res.json({ ok: false, fallback: true, wa_link: waLink, motivo: 'desconectado' });
    } catch {
      return res.json({ ok: false, fallback: true, wa_link: waLink, motivo: 'erro_conexao' });
    }

    const resp = await axios.post(
      `${base}/message/sendText/${urow.instancia}`,
      { number: numeroLimpo, text: mensagem },
      { headers: { 'Content-Type': 'application/json', apikey: urow.chave || cfg.apikey }, timeout: 15000 }
    );

    if (resp.status === 200 || resp.status === 201) {
      res.json({ ok: true });
    } else {
      res.json({ ok: false, fallback: true, wa_link: waLink, motivo: `erro_api_${resp.status}` });
    }
  } catch (err) {
    const n   = (req.body?.numero || '').replace(/\D/g, '');
    const wl  = `https://wa.me/55${n}?text=${encodeURIComponent(req.body?.mensagem || '')}`;
    res.json({ ok: false, fallback: true, wa_link: wl, motivo: err.message });
  }
});

module.exports = router;
