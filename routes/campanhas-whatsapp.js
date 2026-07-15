'use strict';

/**
 * Campanhas WhatsApp — envio em massa com ritmo controlado.
 *
 * Fluxo: selecionar clientes por filtros → salvar campanha (RASCUNHO) →
 * iniciar → fila em background envia 1 mensagem por vez com intervalo
 * aleatório (proteção contra bloqueio do número) → progresso na tela.
 *
 * Provedor: roteia pelo configurado (EuAtendo → token; Evolution → instância
 * do usuário que iniciou). Cada envio (ou falha) entra em cliente_mensagens.
 *
 * Placeholders na mensagem: {nome} e {cidade} do cliente.
 * Permissão: tela_campanhas_wa (gtela_campanhas_wa no JWT).
 */

const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { getPool } = require('../config/database');
const { logError } = require('../config/logger');
const { permSn } = require('../config/cadastros-permissoes');
const { euatendoAtivo, enviarTextoEuAtendo } = require('../config/euatendo');
const { registrarMensagemCliente } = require('../config/cliente-mensagens');

// Intervalo entre mensagens (ms) — aleatório dentro da faixa, contra bloqueio
const INTERVALO_MIN_MS = 6000;
const INTERVALO_MAX_MS = 12000;

// ─── tabelas (criadas on-demand, cache por base) ─────────────────────────────
const _tabelasOk = new Map();

async function ensureTabelas(pool) {
  const [[{ db }]] = await pool.query('SELECT DATABASE() AS db');
  if (_tabelasOk.get(db)) return db;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campanhas_whatsapp (
      id                  INT          NOT NULL AUTO_INCREMENT,
      nome                VARCHAR(100) NOT NULL,
      mensagem            TEXT         NOT NULL,
      status              VARCHAR(12)  NOT NULL DEFAULT 'RASCUNHO',
      total_destinatarios INT          NOT NULL DEFAULT 0,
      total_enviados      INT          NOT NULL DEFAULT 0,
      total_falhas        INT          NOT NULL DEFAULT 0,
      id_usuario          INT          NULL DEFAULT NULL,
      data_criacao        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      data_inicio         DATETIME     NULL DEFAULT NULL,
      data_fim            DATETIME     NULL DEFAULT NULL,
      excluido            CHAR(1)      NOT NULL DEFAULT 'N',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campanhas_whatsapp_dest (
      id            INT          NOT NULL AUTO_INCREMENT,
      id_campanha   INT          NOT NULL,
      cod_cliente   INT          NOT NULL,
      nome_cliente  VARCHAR(150) NULL DEFAULT NULL,
      cidade        VARCHAR(100) NULL DEFAULT NULL,
      telefone      VARCHAR(30)  NULL DEFAULT NULL,
      status        VARCHAR(10)  NOT NULL DEFAULT 'PENDENTE',
      erro          VARCHAR(300) NULL DEFAULT NULL,
      data_envio    DATETIME     NULL DEFAULT NULL,
      PRIMARY KEY (id),
      KEY idx_cwd_campanha (id_campanha, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8;
  `);
  _tabelasOk.set(db, true);
  return db;
}

// ─── permissão ───────────────────────────────────────────────────────────────
function checarPermissao(req, res) {
  if (permSn(req, 'gtela_campanhas_wa') !== 'S') {
    res.status(403).json({ error: 'Sem permissão para Campanhas WhatsApp' });
    return false;
  }
  return true;
}

// Telefone preferido para WhatsApp (mesma prioridade do cadastro: fonesecundario = WhatsApp)
const TEL_EXPR = `COALESCE(
  NULLIF(TRIM(c.fonesecundario), ''),
  NULLIF(TRIM(c.celularcomprador), ''),
  NULLIF(TRIM(c.foneprincipal), '')
)`;

// ─── GET /api/campanhas-whatsapp/clientes — seleção de destinatários ─────────
router.get('/clientes', async (req, res) => {
  if (!checarPermissao(req, res)) return;
  try {
    const pool = getPool();
    const { busca, id_regiao, cod_vendedor, dias_sem_compra } = req.query;

    const where = [`(c.excluido = 'N' OR c.excluido IS NULL)`, `(c.status = 'A' OR c.status IS NULL)`];
    const vals  = [];

    if (busca) {
      where.push(`(LOWER(c.nome) LIKE ? OR LOWER(c.apelido) LIKE ? OR LOWER(c.cidade) LIKE ?)`);
      const b = `%${String(busca).toLowerCase()}%`;
      vals.push(b, b, b);
    }
    if (id_regiao && parseInt(id_regiao, 10) > 0) {
      where.push(`c.regiao = ?`);
      vals.push(parseInt(id_regiao, 10));
    }
    if (cod_vendedor && parseInt(cod_vendedor, 10) > 0) {
      where.push(`c.cod_vendedor = ?`);
      vals.push(parseInt(cod_vendedor, 10));
    }
    const dias = parseInt(dias_sem_compra, 10);
    if (dias > 0) {
      where.push(`NOT EXISTS (
        SELECT 1 FROM pedidos p
        WHERE p.cod_cliente = c.id
          AND (p.excluido = 'N' OR p.excluido IS NULL)
          AND p.data_abertura >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
      )`);
      vals.push(dias);
    }
    where.push(`${TEL_EXPR} IS NOT NULL`);

    const [rows] = await pool.query(
      `SELECT c.id, c.nome, c.apelido, c.cidade, c.uf, ${TEL_EXPR} AS telefone
       FROM clientes c
       WHERE ${where.join(' AND ')}
       ORDER BY c.nome
       LIMIT 500`,
      vals
    );
    res.json({ clientes: rows, total: rows.length });
  } catch (err) {
    logError(`${req.method} ${req.path}`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/campanhas-whatsapp — lista campanhas ───────────────────────────
router.get('/', async (req, res) => {
  if (!checarPermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureTabelas(pool);
    const [rows] = await pool.query(
      `SELECT cw.*, u.nomeusu AS nome_usuario
       FROM campanhas_whatsapp cw
       LEFT JOIN usuarios u ON u.idusuario = cw.id_usuario
       WHERE cw.excluido = 'N'
       ORDER BY cw.id DESC
       LIMIT 100`
    );
    res.json({ campanhas: rows });
  } catch (err) {
    logError(`${req.method} ${req.path}`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/campanhas-whatsapp/:id — detalhe + destinatários ───────────────
router.get('/:id(\\d+)', async (req, res) => {
  if (!checarPermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureTabelas(pool);
    const [[camp]] = await pool.query(
      `SELECT cw.*, u.nomeusu AS nome_usuario
       FROM campanhas_whatsapp cw
       LEFT JOIN usuarios u ON u.idusuario = cw.id_usuario
       WHERE cw.id = ? AND cw.excluido = 'N'`,
      [req.params.id]
    );
    if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });
    const [dest] = await pool.query(
      `SELECT id, cod_cliente, nome_cliente, cidade, telefone, status, erro, data_envio
       FROM campanhas_whatsapp_dest
       WHERE id_campanha = ?
       ORDER BY (status = 'FALHOU') DESC, (status = 'PENDENTE') DESC, id
       LIMIT 1000`,
      [req.params.id]
    );
    res.json({ campanha: camp, destinatarios: dest });
  } catch (err) {
    logError(`${req.method} ${req.path}`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/campanhas-whatsapp — cria campanha (RASCUNHO) ─────────────────
router.post('/', async (req, res) => {
  if (!checarPermissao(req, res)) return;
  try {
    const { nome, mensagem, clientes } = req.body || {};
    if (!nome || !String(nome).trim())         return res.status(400).json({ error: 'Informe o nome da campanha' });
    if (!mensagem || !String(mensagem).trim()) return res.status(400).json({ error: 'Digite a mensagem da campanha' });
    const ids = (Array.isArray(clientes) ? clientes : [])
      .map(v => parseInt(v, 10)).filter(v => v > 0);
    if (!ids.length) return res.status(400).json({ error: 'Selecione ao menos um cliente' });
    if (ids.length > 500) return res.status(400).json({ error: 'Máximo de 500 destinatários por campanha' });

    const pool = getPool();
    await ensureTabelas(pool);

    // Snapshot de nome/cidade/telefone dos clientes selecionados
    const [cliRows] = await pool.query(
      `SELECT c.id, c.nome, c.cidade, ${TEL_EXPR} AS telefone
       FROM clientes c
       WHERE c.id IN (${ids.map(() => '?').join(',')})
         AND (c.excluido = 'N' OR c.excluido IS NULL)`,
      ids
    );
    const comFone = cliRows.filter(c => c.telefone);
    if (!comFone.length) return res.status(400).json({ error: 'Nenhum cliente selecionado possui telefone cadastrado' });

    const [ins] = await pool.query(
      `INSERT INTO campanhas_whatsapp (nome, mensagem, status, total_destinatarios, id_usuario)
       VALUES (?, ?, 'RASCUNHO', ?, ?)`,
      [String(nome).trim().slice(0, 100), String(mensagem).trim(), comFone.length, req.user?.id || null]
    );
    const idCampanha = ins.insertId;

    const destVals = comFone.map(c => [idCampanha, c.id, c.nome || null, c.cidade || null, c.telefone]);
    await pool.query(
      `INSERT INTO campanhas_whatsapp_dest (id_campanha, cod_cliente, nome_cliente, cidade, telefone)
       VALUES ${destVals.map(() => '(?,?,?,?,?)').join(',')}`,
      destVals.flat()
    );

    res.status(201).json({
      ok: true, id: idCampanha,
      total: comFone.length,
      sem_fone: ids.length - comFone.length,
    });
  } catch (err) {
    logError(`${req.method} ${req.path}`, err);
    res.status(500).json({ error: err.message });
  }
});

// ═══ MOTOR DE ENVIO (fila em background, 1 por tenant+campanha) ═══════════════
const _emExecucao = new Set(); // `${db}:${idCampanha}`

const _sleep = ms => new Promise(r => setTimeout(r, ms));
const _intervalo = () => INTERVALO_MIN_MS + Math.floor(Math.random() * (INTERVALO_MAX_MS - INTERVALO_MIN_MS));

function _personalizar(msg, dest) {
  const primeiroNome = String(dest.nome_cliente || '').trim().split(/\s+/)[0] || 'cliente';
  return String(msg)
    .replace(/\{nome\}/gi, primeiroNome)
    .replace(/\{nome_completo\}/gi, dest.nome_cliente || '')
    .replace(/\{cidade\}/gi, dest.cidade || '');
}

async function _enviarEvolution(envio, numero, texto) {
  const numeroLimpo = String(numero).replace(/\D/g, '');
  const number = numeroLimpo.startsWith('55') ? numeroLimpo : `55${numeroLimpo}`;
  const base = envio.evolution.url.replace(/\/$/, '');
  await axios.post(
    `${base}/message/sendText/${envio.evolution.instancia}`,
    { number, text: texto },
    { headers: { apikey: envio.evolution.chave }, timeout: 20000 }
  );
}

async function processarCampanha(pool, chave, idCampanha, envio) {
  if (_emExecucao.has(chave)) return;
  _emExecucao.add(chave);
  try {
    for (;;) {
      // Cancelamento / status mudou?
      const [[camp]] = await pool.query(
        `SELECT status FROM campanhas_whatsapp WHERE id = ?`, [idCampanha]
      );
      if (!camp || camp.status !== 'ENVIANDO') break;

      const [[dest]] = await pool.query(
        `SELECT id, cod_cliente, nome_cliente, cidade, telefone
         FROM campanhas_whatsapp_dest
         WHERE id_campanha = ? AND status = 'PENDENTE'
         ORDER BY id LIMIT 1`,
        [idCampanha]
      );
      if (!dest) {
        await pool.query(
          `UPDATE campanhas_whatsapp SET status='CONCLUIDA', data_fim=NOW() WHERE id = ?`,
          [idCampanha]
        );
        break;
      }

      const texto = _personalizar(envio.mensagem, dest);
      let ok = true, erro = null;
      try {
        if (envio.euatendo) {
          await enviarTextoEuAtendo(envio.euatendo, dest.telefone, texto);
        } else {
          await _enviarEvolution(envio, dest.telefone, texto);
        }
      } catch (e) {
        ok = false;
        erro = String(e.message || e).slice(0, 300);
      }

      await pool.query(
        `UPDATE campanhas_whatsapp_dest SET status=?, erro=?, data_envio=NOW() WHERE id=?`,
        [ok ? 'ENVIADO' : 'FALHOU', erro, dest.id]
      );
      await pool.query(
        `UPDATE campanhas_whatsapp SET ${ok ? 'total_enviados = total_enviados + 1' : 'total_falhas = total_falhas + 1'} WHERE id=?`,
        [idCampanha]
      );
      void registrarMensagemCliente(pool, {
        cod_cliente: dest.cod_cliente,
        id_campanha: idCampanha,
        id_usuario:  envio.idUsuario,
        canal:       'WHATSAPP',
        provedor:    envio.euatendo ? 'EUATENDO' : 'EVOLUTION',
        destino:     dest.telefone,
        mensagem:    texto,
        status:      ok ? 'ENVIADO' : 'FALHOU',
        erro,
      });

      await _sleep(_intervalo());
    }
  } catch (e) {
    console.error(`[campanhas-wa] motor da campanha ${idCampanha} parou:`, e.message);
    await pool.query(
      `UPDATE campanhas_whatsapp SET status='CANCELADA' WHERE id=? AND status='ENVIANDO'`,
      [idCampanha]
    ).catch(() => {});
  } finally {
    _emExecucao.delete(chave);
  }
}

// ─── POST /api/campanhas-whatsapp/:id/iniciar ────────────────────────────────
router.post('/:id(\\d+)/iniciar', async (req, res) => {
  if (!checarPermissao(req, res)) return;
  try {
    const pool = getPool();
    const db   = await ensureTabelas(pool);
    const id   = parseInt(req.params.id, 10);

    const [[camp]] = await pool.query(
      `SELECT * FROM campanhas_whatsapp WHERE id = ? AND excluido = 'N'`, [id]
    );
    if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });
    if (camp.status === 'ENVIANDO') return res.status(400).json({ error: 'Campanha já está em envio' });
    if (camp.status === 'CONCLUIDA') return res.status(400).json({ error: 'Campanha já foi concluída' });

    const [[pend]] = await pool.query(
      `SELECT COUNT(*) AS n FROM campanhas_whatsapp_dest WHERE id_campanha = ? AND status='PENDENTE'`, [id]
    );
    if (!pend.n) return res.status(400).json({ error: 'Não há destinatários pendentes nesta campanha' });

    // Resolve o provedor UMA vez (o motor roda fora do contexto da requisição)
    const envio = {
      mensagem:     camp.mensagem,
      nomeCampanha: camp.nome,
      idUsuario:    req.user?.id || null,
      euatendo:     await euatendoAtivo(pool).catch(() => null),
      evolution:    null,
    };
    if (!envio.euatendo) {
      const [[cfg]] = await pool.query(
        `SELECT w_urlplataforma AS url, w_apiglobal AS apikey
         FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
      ).catch(() => [[]]);
      const [[usr]] = await pool.query(
        `SELECT instancia, chave FROM usuarios WHERE idusuario=? AND excluido='N' LIMIT 1`,
        [req.user?.id]
      ).catch(() => [[]]);
      if (!cfg?.url || !usr?.instancia) {
        return res.status(400).json({
          error: 'Nenhum provedor de envio pronto — configure o EuAtendo ou conecte sua instância WhatsApp (Evolution) em Configurações de API',
        });
      }
      envio.evolution = { url: cfg.url, instancia: usr.instancia, chave: usr.chave || cfg.apikey };
    }

    await pool.query(
      `UPDATE campanhas_whatsapp SET status='ENVIANDO', data_inicio=COALESCE(data_inicio, NOW()), data_fim=NULL WHERE id=?`,
      [id]
    );

    // dispara o motor em background (não aguarda)
    void processarCampanha(pool, `${db}:${id}`, id, envio);

    res.json({ ok: true, pendentes: pend.n, provedor: envio.euatendo ? 'EUATENDO' : 'EVOLUTION' });
  } catch (err) {
    logError(`${req.method} ${req.path}`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/campanhas-whatsapp/:id/cancelar ───────────────────────────────
router.post('/:id(\\d+)/cancelar', async (req, res) => {
  if (!checarPermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureTabelas(pool);
    const [r] = await pool.query(
      `UPDATE campanhas_whatsapp SET status='CANCELADA' WHERE id=? AND excluido='N' AND status IN ('ENVIANDO','RASCUNHO')`,
      [req.params.id]
    );
    if (!r.affectedRows) return res.status(400).json({ error: 'Campanha não pode ser cancelada neste status' });
    res.json({ ok: true });
  } catch (err) {
    logError(`${req.method} ${req.path}`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/campanhas-whatsapp/:id — soft delete ────────────────────────
router.delete('/:id(\\d+)', async (req, res) => {
  if (!checarPermissao(req, res)) return;
  try {
    const pool = getPool();
    await ensureTabelas(pool);
    const [r] = await pool.query(
      `UPDATE campanhas_whatsapp SET excluido='S' WHERE id=? AND status <> 'ENVIANDO'`,
      [req.params.id]
    );
    if (!r.affectedRows) return res.status(400).json({ error: 'Cancele o envio antes de excluir a campanha' });
    res.json({ ok: true });
  } catch (err) {
    logError(`${req.method} ${req.path}`, err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
// Reexpõe ensureTabelas — usado por modules/clientes para JOIN seguro
// com campanhas_whatsapp no histórico de mensagens do cliente.
module.exports.ensureCampanhasWhatsappTabelas = ensureTabelas;
