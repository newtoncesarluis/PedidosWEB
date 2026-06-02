const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');
const multer  = require('multer');
const XLSX    = require('xlsx');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

let _migDone = false;
async function ensureTables(pool) {
  if (_migDone) return;
  _migDone = true;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conciliacao_fabrica (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      id_fornecedor INT NOT NULL,
      referencia    VARCHAR(100) NOT NULL,
      dt_criacao    DATETIME DEFAULT NOW(),
      dt_fechamento DATETIME DEFAULT NULL,
      status        VARCHAR(10) DEFAULT 'ABERTO',
      obs           TEXT DEFAULT NULL,
      INDEX (id_fornecedor),
      INDEX (status)
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conciliacao_fabrica_itens (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      id_conciliacao       INT NOT NULL,
      num_pedido_fabrica   VARCHAR(100) DEFAULT NULL,
      vlr_comissao_fabrica DECIMAL(15,4) DEFAULT 0,
      id_pedido            INT DEFAULT NULL,
      id_pagtocomissao     INT DEFAULT NULL,
      num_pedido_sistema   VARCHAR(100) DEFAULT NULL,
      vlr_sistema          DECIMAL(15,4) DEFAULT 0,
      diferenca            DECIMAL(15,4) DEFAULT 0,
      status               VARCHAR(20) DEFAULT 'NAO_ENCONTRADO',
      obs                  TEXT DEFAULT NULL,
      INDEX (id_conciliacao),
      INDEX (id_pedido),
      INDEX (status)
    )
  `).catch(() => {});

  // Colunas auxiliares na tabela pedidos para conciliação
  const [pedCols] = await pool.query('DESCRIBE pedidos').catch(() => [[]]);
  const pc = new Set(pedCols.map(c => c.Field));
  if (!pc.has('num_nf')) {
    await pool.query(`ALTER TABLE pedidos ADD COLUMN num_nf VARCHAR(30) DEFAULT NULL`).catch(() => {});
  }
  if (!pc.has('num_ped_fabrica')) {
    await pool.query(`ALTER TABLE pedidos ADD COLUMN num_ped_fabrica VARCHAR(60) DEFAULT NULL`).catch(() => {});
  }

  // Coluna num_parcela em conciliacao_fabrica_itens
  const [itensCols] = await pool.query('DESCRIBE conciliacao_fabrica_itens').catch(() => [[]]);
  const ic = new Set(itensCols.map(c => c.Field));
  if (!ic.has('num_parcela')) {
    await pool.query(`ALTER TABLE conciliacao_fabrica_itens ADD COLUMN num_parcela VARCHAR(20) DEFAULT NULL AFTER num_pedido_fabrica`).catch(() => {});
  }
}

// ─── GET /api/conciliacao ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTables(pool);
    const { id_fornecedor, status } = req.query;
    const where = ['1=1']; const vals = [];
    if (id_fornecedor) { where.push('c.id_fornecedor = ?'); vals.push(id_fornecedor); }
    if (status)        { where.push('c.status = ?');        vals.push(status); }

    const [rows] = await pool.query(`
      SELECT c.*, f.nome AS nome_fornecedor,
        COALESCE(f.tipo_num_pedido,'SISTEMA') AS tipo_num_pedido,
        COALESCE(f.base_conciliacao,'PARCELA') AS base_conciliacao,
        (SELECT COUNT(*) FROM conciliacao_fabrica_itens WHERE id_conciliacao=c.id) AS total_itens,
        (SELECT COUNT(*) FROM conciliacao_fabrica_itens WHERE id_conciliacao=c.id AND status='CONFERIDO')     AS total_conferidos,
        (SELECT COUNT(*) FROM conciliacao_fabrica_itens WHERE id_conciliacao=c.id AND status='DIVERGENCIA')   AS total_divergencias,
        (SELECT COUNT(*) FROM conciliacao_fabrica_itens WHERE id_conciliacao=c.id AND status='NAO_ENCONTRADO') AS total_nao_encontrados,
        (SELECT COALESCE(SUM(vlr_comissao_fabrica),0) FROM conciliacao_fabrica_itens WHERE id_conciliacao=c.id) AS total_vlr_fabrica,
        (SELECT COALESCE(SUM(vlr_sistema),0)          FROM conciliacao_fabrica_itens WHERE id_conciliacao=c.id) AS total_vlr_sistema
      FROM conciliacao_fabrica c
      LEFT JOIN fornecedores f ON f.id = c.id_fornecedor
      WHERE ${where.join(' AND ')}
      ORDER BY c.dt_criacao DESC
      LIMIT 200
    `, vals);
    res.json({ conciliacoes: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/conciliacao ────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTables(pool);
    const { id_fornecedor, referencia, obs } = req.body;
    if (!id_fornecedor || !referencia?.trim())
      return res.status(400).json({ error: 'Fornecedor e referência obrigatórios' });
    const [r] = await pool.query(
      `INSERT INTO conciliacao_fabrica (id_fornecedor, referencia, obs) VALUES (?, ?, ?)`,
      [id_fornecedor, referencia.trim(), obs || null]
    );
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/conciliacao/:id ─────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    await ensureTables(pool);

    const [rows] = await pool.query(`
      SELECT c.*, f.nome AS nome_fornecedor,
        COALESCE(f.tipo_num_pedido,'SISTEMA') AS tipo_num_pedido
      FROM conciliacao_fabrica c
      LEFT JOIN fornecedores f ON f.id = c.id_fornecedor
      WHERE c.id = ? LIMIT 1
    `, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Conciliação não encontrada' });

    const [itens] = await pool.query(`
      SELECT i.*,
        p.numero AS ped_numero, p.data_abertura AS dtpedido, p.vlrtotalpedido,
        pc.status AS com_status
      FROM conciliacao_fabrica_itens i
      LEFT JOIN pedidos p  ON p.id  = i.id_pedido
      LEFT JOIN pagtocomissao pc ON pc.id = i.id_pagtocomissao
      WHERE i.id_conciliacao = ?
      ORDER BY i.id
    `, [req.params.id]);

    res.json({ conciliacao: rows[0], itens });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/conciliacao/:id/importar ──────────────────────────────────────
router.post('/:id/importar', upload.single('arquivo'), async (req, res) => {
  try {
    const pool = getPool();
    await ensureTables(pool);
    if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório' });

    const [hdrRows] = await pool.query(`
      SELECT c.*, COALESCE(f.tipo_num_pedido,'SISTEMA') AS tipo_num_pedido
      FROM conciliacao_fabrica c
      LEFT JOIN fornecedores f ON f.id = c.id_fornecedor
      WHERE c.id = ? AND c.status = 'ABERTO' LIMIT 1
    `, [req.params.id]);
    if (!hdrRows[0]) return res.status(404).json({ error: 'Conciliação não encontrada ou já fechada' });
    const conciliacao = hdrRows[0];

    const colNum    = parseInt(req.body.col_num    ?? 0, 10);
    const colVlr    = parseInt(req.body.col_vlr    ?? 1, 10);
    const colParc   = req.body.col_parcela !== undefined ? parseInt(req.body.col_parcela, 10) : -1;
    const skipRows  = parseInt(req.body.skip_rows  ?? 1, 10);
    const baseConcil = conciliacao.base_conciliacao || 'PARCELA';
    const porParcela = baseConcil === 'PARCELA' && colParc >= 0;

    // Parse Excel
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const linhas = data.slice(skipRows).filter(row => {
      const v = row[colNum]; return v !== null && v !== undefined && String(v).trim() !== '';
    });

    if (linhas.length === 0)
      return res.status(400).json({ error: 'Nenhuma linha encontrada no arquivo' });

    // Limpa itens anteriores
    await pool.query(`DELETE FROM conciliacao_fabrica_itens WHERE id_conciliacao = ?`, [req.params.id]);

    const tipoNum  = conciliacao.tipo_num_pedido;
    const colMatch = tipoNum === 'NF' ? 'num_nf' : tipoNum === 'PEDIDO_FABRICA' ? 'num_ped_fabrica' : 'numero';

    const itens = [];
    for (const row of linhas) {
      const numFabrica = String(row[colNum] ?? '').trim();
      const vlrFabrica = parseFloat(String(row[colVlr] ?? '0').replace(',', '.')) || 0;
      const numParc    = porParcela ? String(row[colParc] ?? '').trim() : null;
      if (!numFabrica) continue;

      // Busca o pedido pelo número configurado no fornecedor
      const [pedRows] = await pool.query(
        `SELECT p.id, p.numero FROM pedidos p
         WHERE p.\`${colMatch}\` = ? AND p.cod_fornecedor = ?
           AND (p.excluido = 'N' OR p.excluido IS NULL)
         LIMIT 1`,
        [numFabrica, conciliacao.id_fornecedor]
      );
      const ped = pedRows[0];

      let status, vlrSistema = 0, idPedido = null, idPagtoComissao = null, numSistema = null;

      if (!ped) {
        status = 'NAO_ENCONTRADO';
      } else if (porParcela && numParc) {
        // Modo PARCELA: busca a comissão da parcela específica
        const [pcRows] = await pool.query(
          `SELECT pc.id, pc.vlr_pago
           FROM pagtocomissao pc
           LEFT JOIN receber rec ON rec.id = pc.id_parcela
           WHERE pc.pedido = ? AND rec.parcela = ?
           LIMIT 1`,
          [ped.numero, numParc]
        );
        idPedido   = ped.id;
        numSistema = String(ped.numero);
        if (!pcRows[0]) {
          // Parcela não encontrada — tenta por sequência sem join (comissão única)
          const [pcUniq] = await pool.query(
            `SELECT id, vlr_pago FROM pagtocomissao WHERE pedido = ? AND id_parcela IS NULL LIMIT 1`,
            [ped.numero]
          );
          if (pcUniq[0]) {
            idPagtoComissao = pcUniq[0].id;
            vlrSistema      = parseFloat(pcUniq[0].vlr_pago) || 0;
            status          = Math.abs(vlrFabrica - vlrSistema) < 0.01 ? 'CONFERIDO' : 'DIVERGENCIA';
          } else {
            status = 'NAO_ENCONTRADO';
          }
        } else {
          idPagtoComissao = pcRows[0].id;
          vlrSistema      = parseFloat(pcRows[0].vlr_pago) || 0;
          status          = Math.abs(vlrFabrica - vlrSistema) < 0.01 ? 'CONFERIDO' : 'DIVERGENCIA';
        }
      } else {
        // Modo PEDIDO: soma todas as comissões do pedido
        const [pcRows] = await pool.query(
          `SELECT COALESCE(SUM(vlr_pago),0) AS total,
                  (SELECT id FROM pagtocomissao WHERE pedido = ? ORDER BY id LIMIT 1) AS first_id
           FROM pagtocomissao WHERE pedido = ?`,
          [ped.numero, ped.numero]
        );
        idPedido        = ped.id;
        numSistema      = String(ped.numero);
        idPagtoComissao = pcRows[0]?.first_id || null;
        vlrSistema      = parseFloat(pcRows[0]?.total) || 0;
        status          = Math.abs(vlrFabrica - vlrSistema) < 0.01 ? 'CONFERIDO' : 'DIVERGENCIA';
      }

      itens.push([
        req.params.id, numFabrica, numParc, vlrFabrica,
        idPedido, idPagtoComissao, numSistema,
        vlrSistema, vlrFabrica - vlrSistema, status
      ]);
    }

    if (itens.length > 0) {
      await pool.query(`
        INSERT INTO conciliacao_fabrica_itens
          (id_conciliacao, num_pedido_fabrica, num_parcela, vlr_comissao_fabrica,
           id_pedido, id_pagtocomissao, num_pedido_sistema, vlr_sistema, diferenca, status)
        VALUES ?
      `, [itens]);
    }

    const conferidos     = itens.filter(i => i[9] === 'CONFERIDO').length;
    const divergencias   = itens.filter(i => i[9] === 'DIVERGENCIA').length;
    const naoEncontrados = itens.filter(i => i[9] === 'NAO_ENCONTRADO').length;

    res.json({ ok: true, total: itens.length, conferidos, divergencias, naoEncontrados });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/conciliacao/:id/preview ───────────────────────────────────────
// Retorna as primeiras linhas do Excel para o usuário mapear colunas
router.post('/:id/preview', upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório' });
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    res.json({ rows: data.slice(0, 6) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/conciliacao/:id/buscar-pedido ───────────────────────────────────
router.get('/:id/buscar-pedido', async (req, res) => {
  try {
    const pool = getPool();
    const { numero } = req.query;
    if (!numero) return res.status(400).json({ error: 'numero obrigatório' });

    const [hdr] = await pool.query(
      `SELECT c.id_fornecedor, COALESCE(f.base_conciliacao,'PARCELA') AS base_conciliacao
       FROM conciliacao_fabrica c
       LEFT JOIN fornecedores f ON f.id = c.id_fornecedor
       WHERE c.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!hdr[0]) return res.status(404).json({ error: 'Conciliação não encontrada' });

    const [rows] = await pool.query(
      `SELECT p.id, p.numero, cl.nome AS cliente,
              COALESCE((SELECT SUM(vlr_pago) FROM pagtocomissao WHERE pedido = p.numero), 0) AS vlr_comissao_sistema
       FROM pedidos p
       LEFT JOIN clientes cl ON cl.id = p.cod_cliente
       WHERE p.numero = ? AND p.cod_fornecedor = ?
         AND (p.excluido = 'N' OR p.excluido IS NULL)
       LIMIT 1`,
      [numero, hdr[0].id_fornecedor]
    );

    if (!rows[0]) return res.json({ ok: true, pedido: null });

    // Se modo PARCELA, retorna lista de parcelas disponíveis
    let parcelas = [];
    if (hdr[0].base_conciliacao === 'PARCELA') {
      const [pcRows] = await pool.query(
        `SELECT pc.id, pc.vlr_pago,
                COALESCE(rec.parcela, 1) AS num_parcela,
                COALESCE(rec.qt_parcelas, 1) AS qt_parcelas,
                rec.vencimento
         FROM pagtocomissao pc
         LEFT JOIN receber rec ON rec.id = pc.id_parcela
         WHERE pc.pedido = ?
         ORDER BY COALESCE(rec.parcela, 1)`,
        [rows[0].numero]
      );
      parcelas = pcRows;
    }

    res.json({ ok: true, pedido: rows[0], parcelas, base_conciliacao: hdr[0].base_conciliacao });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/conciliacao/:id/item ──────────────────────────────────────────
router.post('/:id/item', async (req, res) => {
  try {
    const pool = getPool();
    const { num_pedido_fabrica, num_parcela, vlr_comissao_fabrica, num_pedido_sistema, vlr_sistema, id_pedido, id_pagtocomissao, obs } = req.body;
    if (!num_pedido_fabrica?.trim())
      return res.status(400).json({ error: 'N° do pedido da fábrica obrigatório' });

    const [hdr] = await pool.query(
      `SELECT id FROM conciliacao_fabrica WHERE id = ? AND status = 'ABERTO' LIMIT 1`,
      [req.params.id]
    );
    if (!hdr[0]) return res.status(404).json({ error: 'Conciliação não encontrada ou fechada' });

    const vlrFab       = parseFloat(vlr_comissao_fabrica) || 0;
    const vlrSis       = parseFloat(vlr_sistema) || 0;
    const dif          = vlrFab - vlrSis;
    const numSis       = num_pedido_sistema?.trim() || null;
    const numParc      = num_parcela?.trim() || null;
    const idPed        = id_pedido || null;
    const idPagtoComis = id_pagtocomissao || null;

    let status;
    if (!numSis && !idPed) status = 'NAO_ENCONTRADO';
    else status = Math.abs(dif) < 0.01 ? 'CONFERIDO' : 'DIVERGENCIA';

    const [ins] = await pool.query(
      `INSERT INTO conciliacao_fabrica_itens
         (id_conciliacao, num_pedido_fabrica, num_parcela, vlr_comissao_fabrica,
          id_pedido, id_pagtocomissao, num_pedido_sistema, vlr_sistema, diferenca, status, obs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.params.id, num_pedido_fabrica.trim(), numParc, vlrFab,
       idPed, idPagtoComis, numSis, vlrSis, dif, status, obs || null]
    );

    res.status(201).json({ ok: true, id: ins.insertId, status, num_pedido_sistema: numSis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/conciliacao/:id/item/:itemId ────────────────────────────────────
router.put('/:id/item/:itemId', async (req, res) => {
  try {
    const pool = getPool();
    const { status, obs } = req.body;
    const sets = []; const vals = [];
    if (status) { sets.push('status = ?'); vals.push(status); }
    if (obs !== undefined) { sets.push('obs = ?'); vals.push(obs || null); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nada para atualizar' });
    vals.push(req.params.itemId, req.params.id);
    await pool.query(
      `UPDATE conciliacao_fabrica_itens SET ${sets.join(', ')} WHERE id = ? AND id_conciliacao = ?`, vals
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/conciliacao/:id/liberar ───────────────────────────────────────
router.post('/:id/liberar', async (req, res) => {
  try {
    const pool = getPool();

    const [itens] = await pool.query(`
      SELECT i.id, i.id_pagtocomissao, i.id_pedido,
             p.numero AS pedido_numero
      FROM conciliacao_fabrica_itens i
      LEFT JOIN pedidos p ON p.id = i.id_pedido
      WHERE i.id_conciliacao = ?
        AND i.status = 'CONFERIDO'
        AND (i.id_pagtocomissao IS NOT NULL OR i.id_pedido IS NOT NULL)
    `, [req.params.id]);

    if (!itens.length) return res.json({ ok: true, parcelas: 0, pedidos: 0 });

    let parcelas = 0;
    const pedidosNums = new Set();

    for (const item of itens) {
      if (item.id_pagtocomissao) {
        // Libera a parcela específica (modo PARCELA)
        const [r] = await pool.query(
          `UPDATE pagtocomissao SET status = 'C', data_confirmacao = NOW()
           WHERE id = ? AND status = 'P'`,
          [item.id_pagtocomissao]
        );
        parcelas += r.affectedRows;
        if (item.pedido_numero) pedidosNums.add(item.pedido_numero);
      } else if (item.pedido_numero) {
        // Sem parcela específica — libera todas do pedido (modo PEDIDO)
        const [r] = await pool.query(
          `UPDATE pagtocomissao SET status = 'C', data_confirmacao = NOW()
           WHERE pedido = ? AND status = 'P'`,
          [item.pedido_numero]
        );
        parcelas += r.affectedRows;
        pedidosNums.add(item.pedido_numero);
      }
    }

    const phs = itens.map(() => '?').join(',');
    await pool.query(
      `UPDATE conciliacao_fabrica_itens SET status = 'LIBERADO' WHERE id IN (${phs})`,
      itens.map(i => i.id)
    );

    res.json({ ok: true, parcelas, pedidos: pedidosNums.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/conciliacao/:id/fechar ────────────────────────────────────────
router.post('/:id/fechar', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE conciliacao_fabrica SET status='FECHADO', dt_fechamento=NOW() WHERE id=?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/conciliacao/:id/reabrir ───────────────────────────────────────
router.post('/:id/reabrir', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE conciliacao_fabrica SET status='ABERTO', dt_fechamento=NULL WHERE id=?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/conciliacao/:id ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`DELETE FROM conciliacao_fabrica_itens WHERE id_conciliacao = ?`, [req.params.id]);
    await pool.query(`DELETE FROM conciliacao_fabrica WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
