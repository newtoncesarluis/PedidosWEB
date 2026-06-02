const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

// ─── Rota /extrato — consolida tudo em uma única chamada (compatibilidade) ───
router.get('/extrato', async (req, res) => {
  const pool = getPool();
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Sessão expirada' });

  const { dt_inicio, dt_fim, id_fornecedor } = req.query;
  const dtIni = dt_inicio || '2000-01-01';
  const dtFim = dt_fim   || '2100-01-01';

  const fabFilter = id_fornecedor ? ' AND ped.nome_fornecedor = ?' : '';
  const fabParam  = id_fornecedor ? [id_fornecedor] : [];

  // Preposto filtra por id_preposto; representante por cod_user
  const isPrep = _isPreposto(req);
  const uf = isPrep ? 'id_preposto' : 'cod_user';

  try {
    const [resumoRows] = await pool.query(`
      SELECT
        (SELECT nomeusu FROM usuarios WHERE idusuario = ?) as nome,
        (SELECT COALESCE(vlr_meta, 0) FROM usuarios WHERE idusuario = ?) as meta,
        (SELECT COALESCE(SUM(vlr_pago), 0) FROM pagtocomissao WHERE ${uf} = ? AND status = 'C' AND excluido = 'N' AND data_lancamento BETWEEN ? AND ?) as comissao_total,
        (SELECT COALESCE(SUM(vlr_pago), 0) FROM pagtocomissao WHERE ${uf} = ? AND status IN ('P','I') AND excluido = 'N' AND data_lancamento BETWEEN ? AND ?) as comissao_futura,
        (SELECT COALESCE(SUM(ped.vlrtotalpedido), 0) FROM pagtocomissao p JOIN pedidos ped ON p.pedido = ped.numero WHERE p.${uf} = ? AND p.excluido = 'N' AND p.data_lancamento BETWEEN ? AND ?) as vendas_totais,
        (SELECT COUNT(DISTINCT pedido) FROM pagtocomissao WHERE ${uf} = ? AND excluido = 'N' AND data_lancamento BETWEEN ? AND ?) as total_pedidos
    `, [userId, userId, userId, dtIni, dtFim, userId, dtIni, dtFim, userId, dtIni, dtFim, userId, dtIni, dtFim]);

    const [pendentes] = await pool.query(`
      SELECT p.*, ped.nome_cliente, ped.nome_fornecedor, ped.vlrtotalpedido
      FROM pagtocomissao p LEFT JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.status IN ('P','I') AND p.excluido = 'N'
        AND p.data_lancamento BETWEEN ? AND ? ${fabFilter}
      ORDER BY p.data_lancamento DESC
    `, [userId, dtIni, dtFim, ...fabParam]);

    const [conferidas] = await pool.query(`
      SELECT p.*, ped.nome_cliente, ped.nome_fornecedor, ped.vlrtotalpedido
      FROM pagtocomissao p LEFT JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.status = 'C' AND p.excluido = 'N'
        AND p.data_lancamento BETWEEN ? AND ? ${fabFilter}
      ORDER BY p.data_confirmacao DESC
    `, [userId, dtIni, dtFim, ...fabParam]);

    const [liquidadas] = await pool.query(`
      SELECT p.*, ped.nome_cliente, ped.nome_fornecedor, ped.vlrtotalpedido
      FROM pagtocomissao p LEFT JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.status = 'R' AND p.excluido = 'N'
        AND p.data_lancamento BETWEEN ? AND ? ${fabFilter}
      ORDER BY p.data_lancamento DESC
    `, [userId, dtIni, dtFim, ...fabParam]);

    const [fabricas] = await pool.query(`
      SELECT ped.nome_fornecedor, SUM(p.vlr_pago) as total
      FROM pagtocomissao p JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.excluido = 'N' AND p.data_lancamento BETWEEN ? AND ?
      GROUP BY ped.nome_fornecedor ORDER BY total DESC LIMIT 10
    `, [userId, dtIni, dtFim]);

    const [diaria] = await pool.query(`
      SELECT p.data_lancamento as data, SUM(p.vlr_pago) as total
      FROM pagtocomissao p
      WHERE p.${uf} = ? AND p.excluido = 'N' AND p.data_lancamento BETWEEN ? AND ?
      GROUP BY p.data_lancamento ORDER BY p.data_lancamento ASC
    `, [userId, dtIni, dtFim]);

    const [allFornecedores] = await pool.query(`
      SELECT DISTINCT ped.nome_fornecedor
      FROM pagtocomissao p
      JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.excluido = 'N'
        AND ped.nome_fornecedor IS NOT NULL
        AND TRIM(ped.nome_fornecedor) != ''
        AND TRIM(ped.nome_fornecedor) != 'undefined'
      ORDER BY ped.nome_fornecedor
    `, [userId]);

    res.json({
      resumo: resumoRows[0] || { vendas_totais: 0, meta: 0, comissao_total: 0, comissao_futura: 0, nome: 'Vendedor', total_pedidos: 0 },
      rankings: { fabricas, diaria },
      fornecedores:     allFornecedores,
      lista_pendentes:  pendentes,
      lista_conferidas: conferidas,
      lista_liquidadas: liquidadas,
      tipo_usuario:     isPrep ? 'PREPOSTO' : 'REPRESENTANTE'
    });
  } catch (e) {
    console.error('ERRO /extrato:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Helper: true se o usuário logado é administrador
function _isAdmin(req) { return req.user?.role === 'admin'; }
// Helper: true se o usuário logado é preposto
function _isPreposto(req) { return req.user?.tipo_usuario === 'PREPOSTO'; }

// ─── Rota /admin/vendedores — lista todos os usuários vendedores ─────────────
router.get('/admin/vendedores', async (req, res) => {
  const pool = getPool();
  // Não-admin só enxerga a si mesmo
  if (!_isAdmin(req)) {
    return res.json([{ id: req.user.id, nome: req.user.name || req.user.login || 'Você' }]);
  }
  try {
    const [rows] = await pool.query(
      `SELECT idusuario as id, nomeusu as nome FROM usuarios
       WHERE situacao = 'ATIVO' AND excluido = 'N'
       ORDER BY nomeusu`
    );
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

// ─── Rota /admin/extrato — visão do gestor, filtrável por vendedor ────────────
router.get('/admin/extrato', async (req, res) => {
  const pool = getPool();
  const { status, dt_ini, dt_fim, id_fornecedor, q_cliente, id_pedido, limit } = req.query;
  const dtIni = dt_ini || '2000-01-01';
  const dtFim = dt_fim || '2100-01-01';

  // Não-admin só pode ver as próprias comissões
  const id_vendedor = _isAdmin(req) ? req.query.id_vendedor : String(req.user.id);

  const params = [dtIni, dtFim];
  let where = `pc.excluido = 'N' AND pc.data_lancamento BETWEEN ? AND ?`;

  if (id_vendedor) { where += ' AND pc.cod_user = ?'; params.push(id_vendedor); }
  if (id_fornecedor) { where += ' AND ped.cod_fornecedor = ?'; params.push(id_fornecedor); }
  if (q_cliente) { where += ' AND ped.nome_cliente LIKE ?'; params.push('%' + q_cliente + '%'); }
  if (id_pedido) { where += ' AND ped.numero = ?'; params.push(id_pedido); }
  if (status && status !== 'T') {
    if (status === 'Q') { where += ` AND pc.status IN ('R','C')`; }
    else { where += ' AND pc.status = ?'; params.push(status); }
  }

  const lim = parseInt(limit) || 500;

  try {
    const [rows] = await pool.query(`
      SELECT
        pc.id,
        u.nomeusu                                          AS nome_vendedor,
        ped.nome_cliente,
        ped.nome_fornecedor,
        ped.numero,
        COALESCE(rec.parcela, 1)                           AS parcela,
        COALESCE(rec.qt_parcelas, ped.qt_parcelas, 1)      AS qt_parcelas,
        COALESCE(rec.comissao, ped.comissao, 0)            AS comissao,
        COALESCE(ped.vlrtotalpedido, 0)                    AS vlr_total_pedido,
        COALESCE(rec.vencimento, pc.data_pagar)            AS vencimento,
        COALESCE(rec.valor, pc.vlr_pago, 0)                AS valor_parcela,
        pc.vlr_pago                                        AS vlr_comissao,
        pc.status                                          AS status_comissao,
        ped.data_abertura                                  AS data_pedido,
        CASE
          WHEN UPPER(COALESCE(ped.origem_comissao,'')) LIKE '%FABRICA%'
            OR UPPER(COALESCE(ped.origem_comissao,'')) LIKE '%FORNECEDOR%'
            OR ped.origem_comissao = 'F' THEN 'FÁBRICA'
          WHEN UPPER(COALESCE(ped.origem_comissao,'')) LIKE '%PRODUTO%'
            OR ped.origem_comissao = 'P' THEN 'PRODUTO'
          ELSE 'VENDEDOR'
        END AS label_origem,
        COALESCE(forn.com_tipo, 'PARCELADA')   AS com_tipo,
        COALESCE(forn.com_sobre_ipi, 'S')      AS com_sobre_ipi,
        COALESCE(forn.com_sobre_st, 'S')       AS com_sobre_st
      FROM pagtocomissao pc
      JOIN pedidos ped ON pc.pedido = ped.numero
      JOIN usuarios u ON pc.cod_user = u.idusuario
      LEFT JOIN receber rec ON pc.id_parcela = rec.id
      LEFT JOIN fornecedores forn ON forn.id = ped.cod_fornecedor
      WHERE ${where}
      ORDER BY pc.data_lancamento DESC
      LIMIT ${lim}
    `, params);

    const statsParams = [dtIni, dtFim];
    let statsWhere = `pc.excluido = 'N' AND pc.data_lancamento BETWEEN ? AND ?`;
    if (id_vendedor) { statsWhere += ' AND pc.cod_user = ?'; statsParams.push(id_vendedor); }

    const [[stats]] = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN pc.status IN ('P','I') THEN pc.vlr_pago ELSE 0 END), 0) AS pendente,
        COALESCE(SUM(CASE WHEN pc.status IN ('R','C') THEN pc.vlr_pago ELSE 0 END), 0) AS pago,
        COUNT(*) AS qtd
      FROM pagtocomissao pc
      WHERE ${statsWhere}
    `, statsParams);

    res.json({ data: rows, stats });
  } catch (e) {
    console.error('ERRO /admin/extrato:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Rota /baixar — processa pagamento em lote (gestor) ──────────────────────
router.post('/baixar', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Sessão expirada' });

  const { ids, senha, exigirAceite } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'Nenhuma comissão selecionada' });
  if (!senha) return res.status(400).json({ error: 'Senha obrigatória' });

  try {
    const [[user]] = await pool.query(
      `SELECT senhausu FROM usuarios WHERE idusuario = ? AND excluido = 'N'`, [userId]
    );
    if (!user || user.senhausu.toUpperCase() !== senha.toUpperCase()) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }

    const novoStatus = exigirAceite ? 'C' : 'R';
    const placeholders = ids.map(() => '?').join(',');

    // ─── Integração com Contas a Pagar ───
    // Buscamos os dados das comissões ANTES da atualização para alimentar o financeiro
    const [dadosComissoes] = await pool.query(`
      SELECT pc.vlr_pago, pc.pedido, u.idusuario, u.nomeusu 
      FROM pagtocomissao pc
      JOIN usuarios u ON pc.cod_user = u.idusuario
      WHERE pc.id IN (${placeholders}) AND pc.status = 'P'
    `, ids);

    await pool.query(
      `UPDATE pagtocomissao SET status = ?, data_pagamento = NOW()
       WHERE id IN (${placeholders}) AND status = 'P'`,
      [novoStatus, ...ids]
    );

    // Se for liquidação ('R') ou conferência ('C'), geramos o título no Contas a Pagar
    // Note: Geralmente 'R' já é o pagamento, mas o usuário quer "alimentar a tabela de pagar"
    if (dadosComissoes.length > 0) {
      for (const c of dadosComissoes) {
        await pool.query(`
          INSERT INTO pagar (
            tipo, vencimento, valor, status, obs, 
            cod_fornecedor, nome_fornecedor, data_lanc, id_pedido, excluido
          ) VALUES (?, CURDATE(), ?, ?, ?, ?, ?, NOW(), ?, 'N')
        `, [
          'COMISSAO', 
          c.vlr_pago, 
          novoStatus === 'R' ? 'LIQUIDADO' : 'ABERTA', 
          `Comissão ref. Pedido #${c.pedido}`,
          c.idusuario,
          c.nomeusu,
          c.pedido
        ]).catch(err => console.error('Erro ao alimentar pagar:', err.message));
      }
    }

    res.json({ ok: true, message: `${ids.length} comissão(ões) processada(s) com sucesso e enviada(s) ao Contas a Pagar.` });
  } catch (e) {
    console.error('ERRO /baixar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Rota /vendedor/aceitar — vendedor/preposto confirma comissões ───────────
router.post('/vendedor/aceitar', async (req, res) => {
  const pool = getPool();
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Sessão expirada' });

  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'Nenhuma comissão informada' });

  const isPrep = _isPreposto(req);
  const guardField = isPrep ? 'id_preposto' : 'cod_user';

  try {
    const placeholders = ids.map(() => '?').join(',');
    await pool.query(
      `UPDATE pagtocomissao SET status = 'C', data_confirmacao = NOW()
       WHERE id IN (${placeholders}) AND ${guardField} = ? AND status = 'P'`,
      [...ids, userId]
    );
    res.json({ sucesso: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Rota /vendedores — lista fábricas/fornecedores do vendedor ──────────────
router.get('/vendedores', async (req, res) => {
  const pool = getPool();
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ vendedores: [] });
  const uf = _isPreposto(req) ? 'id_preposto' : 'cod_user';
  try {
    const [rows] = await pool.query(`
      SELECT DISTINCT ped.nome_fornecedor, ped.id_fornecedor
      FROM pagtocomissao p
      JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.excluido = 'N'
      ORDER BY ped.nome_fornecedor
    `, [userId]);
    res.json({ vendedores: rows });
  } catch (e) {
    res.json({ vendedores: [] });
  }
});

// Rota de Stats (KPIs e Gráficos)
router.get('/vendedor/stats', async (req, res) => {
  const pool = getPool();
  const userId = req.user?.id;
  const { dt_inicio, dt_fim } = req.query;
  const dtIni = dt_inicio || '2000-01-01';
  const dtFim = dt_fim || '2100-01-01';

  if (!userId) return res.status(401).json({ error: 'Sessão expirada' });

  const uf = _isPreposto(req) ? 'id_preposto' : 'cod_user';

  try {
    const [resumoRows] = await pool.query(`
      SELECT
        (SELECT nomeusu FROM usuarios WHERE idusuario = ?) as nome,
        (SELECT COALESCE(vlr_meta, 0) FROM usuarios WHERE idusuario = ?) as meta,
        (SELECT COALESCE(SUM(vlr_pago), 0) FROM pagtocomissao WHERE ${uf} = ? AND status = 'C' AND excluido = 'N' AND data_lancamento BETWEEN ? AND ?) as comissao_total,
        (SELECT COALESCE(SUM(vlr_pago), 0) FROM pagtocomissao WHERE ${uf} = ? AND status IN ('P','I') AND excluido = 'N' AND data_lancamento BETWEEN ? AND ?) as comissao_futura,
        (SELECT COALESCE(SUM(ped.vlrtotalpedido), 0) FROM pagtocomissao p JOIN pedidos ped ON p.pedido = ped.numero WHERE p.${uf} = ? AND p.excluido = 'N' AND p.data_lancamento BETWEEN ? AND ?) as vendas_totais,
        (SELECT COUNT(DISTINCT pedido) FROM pagtocomissao WHERE ${uf} = ? AND excluido = 'N' AND data_lancamento BETWEEN ? AND ?) as total_pedidos
    `, [userId, userId, userId, dtIni, dtFim, userId, dtIni, dtFim, userId, dtIni, dtFim, userId, dtIni, dtFim]);

    const [distFabricas] = await pool.query(`
      SELECT ped.nome_fornecedor, SUM(p.vlr_pago) as total
      FROM pagtocomissao p
      JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.excluido = 'N' AND p.data_lancamento BETWEEN ? AND ?
      GROUP BY ped.nome_fornecedor ORDER BY total DESC LIMIT 10
    `, [userId, dtIni, dtFim]);

    const [vendasDiarias] = await pool.query(`
      SELECT p.data_lancamento as data, SUM(p.vlr_pago) as total
      FROM pagtocomissao p
      JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.excluido = 'N' AND p.data_lancamento BETWEEN ? AND ?
      GROUP BY p.data_lancamento ORDER BY p.data_lancamento ASC
    `, [userId, dtIni, dtFim]);

    res.json({
      resumo: resumoRows[0] || { vendas_totais: 0, meta: 0, comissao_total: 0, nome: 'Vendedor' },
      rankings: { fabricas: distFabricas, diaria: vendasDiarias }
    });
  } catch (e) {
    console.error("ERRO STATS:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Rota de Pendentes
router.get('/vendedor/pendentes', async (req, res) => {
  const pool = getPool();
  const userId = req.user?.id;
  const { dt_inicio, dt_fim } = req.query;
  if (!userId) return res.status(401).json({ error: 'Sessão expirada' });
  const uf = _isPreposto(req) ? 'id_preposto' : 'cod_user';
  try {
    const [rows] = await pool.query(`
      SELECT p.*, ped.nome_cliente, ped.nome_fornecedor, ped.vlrtotalpedido
      FROM pagtocomissao p
      LEFT JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.status IN ('P','I') AND p.excluido = 'N'
      AND p.data_lancamento BETWEEN ? AND ?
      ORDER BY p.status ASC, p.data_lancamento DESC
    `, [userId, dt_inicio || '2000-01-01', dt_fim || '2100-01-01']);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/vendedor/conferidas', async (req, res) => {
  const pool = getPool();
  const userId = req.user?.id;
  const { dt_inicio, dt_fim } = req.query;
  const uf = _isPreposto(req) ? 'id_preposto' : 'cod_user';
  try {
    const [rows] = await pool.query(`
      SELECT p.*, ped.nome_cliente, ped.nome_fornecedor, ped.vlrtotalpedido FROM pagtocomissao p
      LEFT JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.status = 'C' AND p.excluido = 'N' AND p.data_lancamento BETWEEN ? AND ?
      ORDER BY p.data_confirmacao DESC
    `, [userId, dt_inicio || '2000-01-01', dt_fim || '2100-01-01']);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/vendedor/historico', async (req, res) => {
  const pool = getPool();
  const userId = req.user?.id;
  const { dt_inicio, dt_fim } = req.query;
  const uf = _isPreposto(req) ? 'id_preposto' : 'cod_user';
  try {
    const [rows] = await pool.query(`
      SELECT p.*, ped.nome_cliente, ped.nome_fornecedor, ped.vlrtotalpedido FROM pagtocomissao p
      LEFT JOIN pedidos ped ON p.pedido = ped.numero
      WHERE p.${uf} = ? AND p.status = 'R' AND p.excluido = 'N' AND p.data_lancamento BETWEEN ? AND ?
      ORDER BY p.data_lancamento DESC
    `, [userId, dt_inicio || '2000-01-01', dt_fim || '2100-01-01']);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/conferir/:id', async (req, res) => {
  const { id } = req.params;
  const userId = req.user?.id;
  const guardField = _isPreposto(req) ? 'id_preposto' : 'cod_user';
  try {
    const pool = getPool();
    await pool.query(
      `UPDATE pagtocomissao SET status = 'C', data_confirmacao = NOW()
       WHERE id = ? AND ${guardField} = ? AND status = 'P'`,
      [id, userId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Rota /:id/estornar — reverte comissão conferida/recebida para pendente ───
router.post('/:id/estornar', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Sessão expirada' });

  const { id } = req.params;
  const { senha, motivo } = req.body;
  if (!senha)  return res.status(400).json({ error: 'Senha obrigatória' });
  if (!motivo) return res.status(400).json({ error: 'Motivo obrigatório' });

  try {
    const [[user]] = await pool.query(
      `SELECT senhausu FROM usuarios WHERE idusuario = ? AND excluido = 'N'`, [userId]
    );
    if (!user || user.senhausu.toUpperCase() !== senha.toUpperCase())
      return res.status(401).json({ error: 'Senha incorreta' });

    const [[comissao]] = await pool.query(
      `SELECT id, status, pedido, vlr_pago, cod_user FROM pagtocomissao WHERE id = ? AND COALESCE(excluido,'N') = 'N'`, [id]
    );
    if (!comissao) return res.status(404).json({ error: 'Comissão não encontrada' });
    if (comissao.status === 'P') return res.status(400).json({ error: 'Comissão já está pendente' });

    const statusAnterior = comissao.status;

    await pool.query(
      `UPDATE pagtocomissao SET status = 'P', data_pagamento = NULL, data_confirmacao = NULL,
       observacao = CONCAT(COALESCE(observacao,''), ' | ESTORNO: ', ?)
       WHERE id = ?`,
      [`${motivo} (por usuário ${userId})`, id]
    );

    // Cancela o lançamento em Contas a Pagar gerado pelo /baixar, se existir
    await pool.query(
      `UPDATE pagar SET excluido = 'S'
       WHERE tipo = 'COMISSAO' AND id_pedido = ? AND cod_fornecedor = ?
         AND status NOT IN ('PAGO','BAIXADO','QUITADO','LIQUIDADO')
         AND COALESCE(excluido,'N') = 'N'`,
      [comissao.pedido, comissao.cod_user]
    ).catch(() => {});

    res.json({ ok: true, statusAnterior, message: 'Comissão estornada para Pendente.' });
  } catch (e) {
    console.error('ERRO /estornar:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Rota /dashboard — analytics de comissões para gestores ──────────────────
router.get('/dashboard', async (req, res) => {
  const pool = getPool();
  const { dt_ini, dt_fim, id_fornecedor, status } = req.query;
  const dtIni = dt_ini || new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
  const dtFim = dt_fim || new Date().toISOString().slice(0, 10);

  // Não-admin só vê os próprios dados
  const id_vendedor = _isAdmin(req) ? req.query.id_vendedor : String(req.user.id);

  const baseWhere = [`pc.excluido = 'N'`, `pc.data_lancamento BETWEEN ? AND ?`];
  const baseParams = [dtIni, dtFim];

  if (id_vendedor) { baseWhere.push('pc.cod_user = ?'); baseParams.push(id_vendedor); }
  if (id_fornecedor) { baseWhere.push('ped.cod_fornecedor = ?'); baseParams.push(id_fornecedor); }
  if (status && status !== 'T') {
    if (status === 'Q') baseWhere.push(`pc.status IN ('R','C')`);
    else { baseWhere.push('pc.status = ?'); baseParams.push(status); }
  }

  const w = baseWhere.join(' AND ');

  try {
    const [[kpisRow], [porVendedor], [porFornecedor], [porStatus], [porPeriodo], [top10], [metas]] = await Promise.all([
      // KPIs
      pool.query(`
        SELECT
          COALESCE(SUM(pc.vlr_pago), 0)                                               AS total,
          COALESCE(SUM(CASE WHEN pc.status IN ('R','C')    THEN pc.vlr_pago END),0)  AS pago,
          COALESCE(SUM(CASE WHEN pc.status IN ('P','I')    THEN pc.vlr_pago END),0)  AS pendente,
          COALESCE(SUM(CASE WHEN pc.status = 'I'           THEN pc.vlr_pago END),0)  AS inadimplente,
          COALESCE(AVG(CASE WHEN pc.status IN ('R','C') THEN ped.vlrtotalpedido END),0) AS ticket,
          0 AS cancelado
        FROM pagtocomissao pc
        LEFT JOIN pedidos ped ON pc.pedido = ped.numero
        WHERE ${w}
      `, baseParams),

      // Por vendedor
      pool.query(`
        SELECT u.nomeusu AS label, COALESCE(SUM(pc.vlr_pago),0) AS value, pc.cod_user AS id
        FROM pagtocomissao pc
        JOIN usuarios u ON pc.cod_user = u.idusuario
        LEFT JOIN pedidos ped ON pc.pedido = ped.numero
        WHERE ${w}
        GROUP BY pc.cod_user, u.nomeusu ORDER BY value DESC LIMIT 15
      `, baseParams),

      // Por fornecedor
      pool.query(`
        SELECT COALESCE(ped.nome_fornecedor,'Sem fornecedor') AS label,
               COALESCE(SUM(pc.vlr_pago),0) AS value,
               ped.cod_fornecedor AS id
        FROM pagtocomissao pc
        LEFT JOIN pedidos ped ON pc.pedido = ped.numero
        WHERE ${w}
        GROUP BY ped.nome_fornecedor, ped.cod_fornecedor ORDER BY value DESC LIMIT 15
      `, baseParams),

      // Por status
      pool.query(`
        SELECT
          CASE pc.status WHEN 'P' THEN 'Pendente' WHEN 'C' THEN 'Conferida' WHEN 'R' THEN 'Liquidada' ELSE pc.status END AS label,
          pc.status AS id,
          COALESCE(SUM(pc.vlr_pago),0) AS value
        FROM pagtocomissao pc
        LEFT JOIN pedidos ped ON pc.pedido = ped.numero
        WHERE ${w}
        GROUP BY pc.status
      `, baseParams),

      // Evolução mensal
      pool.query(`
        SELECT DATE_FORMAT(pc.data_lancamento,'%Y-%m') AS label,
               COALESCE(SUM(pc.vlr_pago),0)            AS value
        FROM pagtocomissao pc
        LEFT JOIN pedidos ped ON pc.pedido = ped.numero
        WHERE ${w}
        GROUP BY DATE_FORMAT(pc.data_lancamento,'%Y-%m') ORDER BY label ASC
      `, baseParams),

      // Top 10 pedidos
      pool.query(`
        SELECT pc.pedido AS ped, u.nomeusu AS vend, COALESCE(SUM(pc.vlr_pago),0) AS vlr
        FROM pagtocomissao pc
        JOIN usuarios u ON pc.cod_user = u.idusuario
        LEFT JOIN pedidos ped ON pc.pedido = ped.numero
        WHERE ${w}
        GROUP BY pc.pedido, u.nomeusu ORDER BY vlr DESC LIMIT 10
      `, baseParams),

      // Metas (realizado vs meta)
      pool.query(`
        SELECT u.nomeusu AS label,
               COALESCE(SUM(pc.vlr_pago),0) AS realizado,
               COALESCE(u.vlr_meta,0)        AS meta
        FROM pagtocomissao pc
        JOIN usuarios u ON pc.cod_user = u.idusuario
        LEFT JOIN pedidos ped ON pc.pedido = ped.numero
        WHERE ${w}
        GROUP BY pc.cod_user, u.nomeusu, u.vlr_meta
        HAVING meta > 0 OR realizado > 0
        ORDER BY realizado DESC LIMIT 15
      `, baseParams),
    ]);

    res.json({
      kpis:   kpisRow[0] || { total: 0, pago: 0, pendente: 0, ticket: 0, cancelado: 0 },
      charts: {
        vendedor:      porVendedor,
        fornecedores:  porFornecedor,
        status:        porStatus,
        periodo:       porPeriodo,
        top10:         top10,
        metas:         metas,
        tipoProduto:   [],
        regioes:       [],
        desconto:      [],
        leadTime:      [],
        abc:           [],
        rentabilidade: [],
        inadimplencia: [],
      }
    });
  } catch (e) {
    console.error('ERRO /dashboard:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Rota /admin/recalcular/:id — recalcula vlr_pago respeitando regras do fornecedor ──
router.post('/admin/recalcular/:id', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ ok: false, error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  try {
    const [[pc]] = await pool.query(`
      SELECT pc.id, pc.pedido, pc.id_parcela, pc.id_preposto,
             rec.valor AS vlr_parcela,
             COALESCE(rec.comissao, ped.comissao, 0) AS perc_comissao,
             ped.id AS id_pedido, ped.cod_fornecedor
      FROM pagtocomissao pc
      LEFT JOIN receber rec ON rec.id = pc.id_parcela
      LEFT JOIN pedidos ped ON ped.numero = pc.pedido
      WHERE pc.id = ? LIMIT 1
    `, [req.params.id]);
    if (!pc) return res.status(404).json({ ok: false, error: 'Comissão não encontrada' });

    let fornConfig = { com_sobre_ipi: 'S', com_sobre_st: 'S', com_tipo: 'PARCELADA' };
    if (pc.cod_fornecedor) {
      const [[forn]] = await pool.query(
        `SELECT COALESCE(com_sobre_ipi,'S') AS com_sobre_ipi,
                COALESCE(com_sobre_st,'S') AS com_sobre_st,
                COALESCE(com_tipo,'PARCELADA') AS com_tipo
         FROM fornecedores WHERE id = ? LIMIT 1`,
        [pc.cod_fornecedor]
      ).catch(() => [[null]]);
      if (forn) Object.assign(fornConfig, forn);
    }

    const [[impos]] = await pool.query(
      `SELECT COALESCE(SUM(vlr_ipi),0) AS ipi, COALESCE(SUM(vlr_st),0) AS st FROM itensped WHERE id_pedido = ?`,
      [pc.id_pedido]
    ).catch(() => [[{ ipi: 0, st: 0 }]]);
    const [[totParc]] = await pool.query(
      `SELECT COALESCE(SUM(valor),0) AS total FROM receber WHERE numero = ? AND id_pedido = ?`,
      [pc.pedido, pc.id_pedido]
    ).catch(() => [[{ total: 0 }]]);

    const totalParcelas = parseFloat(totParc?.total || 0);
    const totalIpi = parseFloat(impos?.ipi || 0);
    const totalSt  = parseFloat(impos?.st  || 0);

    let base = parseFloat(pc.vlr_parcela || 0);
    if (!pc.id_parcela) base = totalParcelas;

    if (totalParcelas > 0 && (fornConfig.com_sobre_ipi !== 'S' || fornConfig.com_sobre_st !== 'S')) {
      const prop = pc.id_parcela ? base / totalParcelas : 1;
      if (fornConfig.com_sobre_ipi !== 'S') base -= totalIpi * prop;
      if (fornConfig.com_sobre_st  !== 'S') base -= totalSt  * prop;
      if (base < 0) base = 0;
    }

    // Se for comissão de preposto, usa % por fornecedor ou % padrão do preposto
    let percFinal = parseFloat(pc.perc_comissao);
    if (pc.id_preposto) {
      let pctPrep = 0;
      if (pc.cod_fornecedor) {
        const [[pcf]] = await pool.query(
          `SELECT pct_comissao FROM preposto_comissao_fornecedor WHERE id_usuario = ? AND id_fornecedor = ? LIMIT 1`,
          [pc.id_preposto, pc.cod_fornecedor]
        ).catch(() => [[null]]);
        if (pcf) pctPrep = parseFloat(pcf.pct_comissao) || 0;
      }
      if (!pctPrep) {
        const [[pu]] = await pool.query(
          `SELECT COALESCE(comissao_preposto_pct,6) AS pct FROM usuarios WHERE idusuario = ? LIMIT 1`,
          [pc.id_preposto]
        ).catch(() => [[null]]);
        pctPrep = parseFloat(pu?.pct || 6);
      }
      percFinal = pctPrep;
    }

    const novoValor = Math.round(base * percFinal / 100 * 100) / 100;
    await pool.query(`UPDATE pagtocomissao SET vlr_pago = ? WHERE id = ?`, [novoValor, pc.id]);

    res.json({ ok: true, vlr_pago: novoValor, base_calculada: base, perc: percFinal, tipo: pc.id_preposto ? 'PREPOSTO' : 'VENDEDOR' });
  } catch (e) {
    console.error('ERRO /recalcular:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Rota /:id/update-perc — atualiza % e valor de uma comissão (gestor) ─────
router.put('/:id/update-perc', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ ok: false, error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  const { id } = req.params;
  const { perc, valor } = req.body;

  if (!perc && !valor) return res.status(400).json({ ok: false, error: 'Informe perc ou valor' });

  try {
    const novoValor = parseFloat(String(valor || '').replace(',', '.')) || null;
    if (novoValor === null) return res.status(400).json({ ok: false, error: 'Valor inválido' });

    await pool.query(
      `UPDATE pagtocomissao SET vlr_pago = ? WHERE id = ?`,
      [novoValor, parseInt(id, 10)]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('ERRO /update-perc:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ─── Rota /meu-painel — resumo mobile do vendedor logado ─────────────────────
router.get('/meu-painel', async (req, res) => {
  const pool = getPool();
  await ensureMetasTables(pool);
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Sessão expirada' });

  const hoje = new Date();
  const mes  = hoje.getMonth() + 1;
  const ano  = hoje.getFullYear();
  const dtIni = `${ano}-${String(mes).padStart(2,'0')}-01`;
  const dtFim = new Date(ano, mes, 0).toISOString().slice(0, 10);

  try {
    // Meta do mês atual
    const [[meta]] = await pool.query(
      `SELECT * FROM comissao_metas WHERE id_usuario=? AND mes=? AND ano=?`,
      [userId, mes, ano]
    );

    // Realizado do mês (vendas + comissões confirmadas)
    const ufPainel = _isPreposto(req) ? 'id_preposto' : 'cod_user';
    const [[realizado]] = await pool.query(`
      SELECT
        COALESCE((SELECT SUM(vlrtotalpedido) FROM pedidos
                  WHERE id_usuario=? AND excluido='N' AND data_abertura BETWEEN ? AND ?), 0) AS vendas,
        COALESCE((SELECT SUM(vlr_pago) FROM pagtocomissao
                  WHERE ${ufPainel}=? AND excluido='N' AND status IN ('C','R') AND data_lancamento BETWEEN ? AND ?), 0) AS comissoes
    `, [userId, dtIni, dtFim, userId, dtIni, dtFim]);

    // Campanhas ativas em que o vendedor participa
    const [campanhas] = await pool.query(`
      SELECT c.* FROM comissao_campanhas c
      WHERE c.excluido='N' AND c.status='ATIVA'
        AND c.dt_inicio <= ? AND c.dt_fim >= ?
        AND (c.para_todos='S' OR EXISTS (
          SELECT 1 FROM comissao_campanhas_vendedores cv
          WHERE cv.id_campanha=c.id AND cv.id_usuario=?
        ))
      ORDER BY c.dt_fim ASC
    `, [dtFim, dtIni, userId]);

    // Progresso em cada campanha
    const campanhasProgresso = await Promise.all(campanhas.map(async c => {
      const fornFilter = c.id_fornecedor ? ' AND ped.cod_fornecedor=?' : '';
      const fornParam  = c.id_fornecedor ? [c.id_fornecedor] : [];
      let realiz = 0;
      if (c.tipo_meta === 'VENDAS') {
        const [[r]] = await pool.query(
          `SELECT COALESCE(SUM(ped.vlrtotalpedido),0) AS t FROM pedidos ped
           WHERE ped.id_usuario=? AND ped.excluido='N' AND ped.data_abertura BETWEEN ? AND ? ${fornFilter}`,
          [userId, c.dt_inicio, c.dt_fim, ...fornParam]
        );
        realiz = parseFloat(r.t) || 0;
      } else {
        const [[r]] = await pool.query(
          `SELECT COALESCE(SUM(pc.vlr_pago),0) AS t FROM pagtocomissao pc
           LEFT JOIN pedidos ped ON pc.pedido=ped.numero
           WHERE pc.cod_user=? AND pc.excluido='N' AND pc.data_lancamento BETWEEN ? AND ? ${fornFilter}`,
          [userId, c.dt_inicio, c.dt_fim, ...fornParam]
        );
        realiz = parseFloat(r.t) || 0;
      }
      const pct    = c.vlr_meta > 0 ? Math.min(100, (realiz / c.vlr_meta) * 100) : 0;
      const atingiu = pct >= 100;
      const bonus  = atingiu
        ? (c.tipo_bonus === 'PERCENTUAL' ? realiz * (c.vlr_bonus / 100) : parseFloat(c.vlr_bonus))
        : 0;
      return {
        id: c.id, nome: c.nome, dt_fim: c.dt_fim,
        tipo_meta: c.tipo_meta, vlr_meta: c.vlr_meta,
        tipo_bonus: c.tipo_bonus, vlr_bonus: c.vlr_bonus,
        nome_fornecedor: c.nome_fornecedor,
        realizado: realiz, pct: parseFloat(pct.toFixed(1)),
        faltam: Math.max(0, c.vlr_meta - realiz),
        atingiu, bonus
      };
    }));

    // Fechamentos: mês atual + mês anterior
    const mesAnt = mes === 1 ? 12 : mes - 1;
    const anoAnt = mes === 1 ? ano - 1 : ano;
    const [fechamentos] = await pool.query(`
      SELECT * FROM comissao_fechamento
      WHERE id_usuario=? AND ((mes=? AND ano=?) OR (mes=? AND ano=?))
      ORDER BY ano DESC, mes DESC
    `, [userId, mes, ano, mesAnt, anoAnt]);

    res.json({
      mes, ano,
      meta: meta || null,
      realizado: { vendas: parseFloat(realizado.vendas)||0, comissoes: parseFloat(realizado.comissoes)||0 },
      campanhas: campanhasProgresso,
      fechamentos,
    });
  } catch (e) {
    console.error('ERRO /meu-painel:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// METAS, CAMPANHAS E FECHAMENTO MENSAL
// ═══════════════════════════════════════════════════════════════════════════

let _metasMigDone = false;
async function ensureMetasTables(pool) {
  if (_metasMigDone) return;
  _metasMigDone = true;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comissao_metas (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario        INT NOT NULL,
      mes               INT NOT NULL,
      ano               INT NOT NULL,
      vlr_meta_vendas   DECIMAL(15,2) DEFAULT 0,
      vlr_meta_comissao DECIMAL(15,2) DEFAULT 0,
      obs               VARCHAR(500) DEFAULT NULL,
      criado_em         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_meta (id_usuario, mes, ano)
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comissao_campanhas (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      nome             VARCHAR(200) NOT NULL,
      descricao        TEXT DEFAULT NULL,
      dt_inicio        DATE NOT NULL,
      dt_fim           DATE NOT NULL,
      id_fornecedor    INT DEFAULT NULL,
      nome_fornecedor  VARCHAR(200) DEFAULT NULL,
      tipo_meta        VARCHAR(20)  DEFAULT 'VENDAS',
      vlr_meta         DECIMAL(15,2) NOT NULL DEFAULT 0,
      tipo_bonus       VARCHAR(20)  DEFAULT 'PERCENTUAL',
      vlr_bonus        DECIMAL(15,4) NOT NULL DEFAULT 0,
      status           VARCHAR(20)  DEFAULT 'ATIVA',
      para_todos       CHAR(1)      DEFAULT 'S',
      excluido         CHAR(1)      DEFAULT 'N',
      criado_em        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      INDEX (status),
      INDEX (dt_inicio, dt_fim)
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comissao_campanhas_vendedores (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      id_campanha  INT NOT NULL,
      id_usuario   INT NOT NULL,
      UNIQUE KEY uq_cv (id_campanha, id_usuario)
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comissao_fechamento (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      id_usuario        INT NOT NULL,
      mes               INT NOT NULL,
      ano               INT NOT NULL,
      status            VARCHAR(20)   DEFAULT 'ABERTO',
      vlr_comissoes     DECIMAL(15,2) DEFAULT 0,
      vlr_bonus         DECIMAL(15,2) DEFAULT 0,
      vlr_total         DECIMAL(15,2) DEFAULT 0,
      data_fechamento   DATETIME      DEFAULT NULL,
      data_pagamento    DATE          DEFAULT NULL,
      obs               VARCHAR(500)  DEFAULT NULL,
      id_usuario_fechou INT           DEFAULT NULL,
      criado_em         TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_fech (id_usuario, mes, ano),
      INDEX (status),
      INDEX (mes, ano)
    )
  `).catch(() => {});
}

// ─── METAS ───────────────────────────────────────────────────────────────────

// GET /api/comissoes/metas?ano=2026
router.get('/metas', async (req, res) => {
  const pool = getPool();
  await ensureMetasTables(pool);
  const ano = parseInt(req.query.ano) || new Date().getFullYear();
  try {
    const [rows] = await pool.query(`
      SELECT m.*, u.nomeusu AS nome_vendedor
      FROM comissao_metas m
      JOIN usuarios u ON m.id_usuario = u.idusuario
      WHERE m.ano = ?
      ORDER BY u.nomeusu, m.mes
    `, [ano]);
    // Também retorna todos os vendedores ativos para o grid
    const [vendedores] = await pool.query(
      `SELECT idusuario AS id, nomeusu AS nome FROM usuarios WHERE situacao='ATIVO' AND excluido='N' ORDER BY nomeusu`
    );
    res.json({ metas: rows, vendedores, ano });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/comissoes/metas — upsert
router.post('/metas', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  await ensureMetasTables(pool);
  const { id_usuario, mes, ano, vlr_meta_vendas, vlr_meta_comissao, obs } = req.body;
  if (!id_usuario || !mes || !ano) return res.status(400).json({ error: 'id_usuario, mes e ano são obrigatórios' });
  try {
    await pool.query(`
      INSERT INTO comissao_metas (id_usuario, mes, ano, vlr_meta_vendas, vlr_meta_comissao, obs)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        vlr_meta_vendas   = VALUES(vlr_meta_vendas),
        vlr_meta_comissao = VALUES(vlr_meta_comissao),
        obs               = VALUES(obs)
    `, [id_usuario, mes, ano, vlr_meta_vendas || 0, vlr_meta_comissao || 0, obs || null]);
    const [[meta]] = await pool.query(
      `SELECT m.*, u.nomeusu AS nome_vendedor FROM comissao_metas m JOIN usuarios u ON m.id_usuario = u.idusuario WHERE m.id_usuario=? AND m.mes=? AND m.ano=?`,
      [id_usuario, mes, ano]
    );
    res.json({ ok: true, meta });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/comissoes/metas/:id
router.delete('/metas/:id', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  await ensureMetasTables(pool);
  try {
    await pool.query(`DELETE FROM comissao_metas WHERE id = ?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── CAMPANHAS ───────────────────────────────────────────────────────────────

// GET /api/comissoes/campanhas?status=ATIVA
router.get('/campanhas', async (req, res) => {
  const pool = getPool();
  await ensureMetasTables(pool);
  const { status } = req.query;
  try {
    let where = `excluido = 'N'`;
    const params = [];
    if (status && status !== 'T') { where += ` AND status = ?`; params.push(status); }
    const [campanhas] = await pool.query(
      `SELECT * FROM comissao_campanhas WHERE ${where} ORDER BY dt_inicio DESC`,
      params
    );
    // Vendedores de cada campanha
    const ids = campanhas.map(c => c.id);
    let vendMap = {};
    if (ids.length) {
      const [cv] = await pool.query(
        `SELECT cv.id_campanha, u.idusuario AS id, u.nomeusu AS nome
         FROM comissao_campanhas_vendedores cv JOIN usuarios u ON cv.id_usuario = u.idusuario
         WHERE cv.id_campanha IN (?)`,
        [ids]
      );
      for (const v of cv) {
        if (!vendMap[v.id_campanha]) vendMap[v.id_campanha] = [];
        vendMap[v.id_campanha].push({ id: v.id, nome: v.nome });
      }
    }
    const result = campanhas.map(c => ({ ...c, vendedores: vendMap[c.id] || [] }));
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/comissoes/campanhas
router.post('/campanhas', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  await ensureMetasTables(pool);
  const { nome, descricao, dt_inicio, dt_fim, id_fornecedor, nome_fornecedor,
          tipo_meta, vlr_meta, tipo_bonus, vlr_bonus, status, para_todos, vendedores } = req.body;
  if (!nome || !dt_inicio || !dt_fim) return res.status(400).json({ error: 'nome, dt_inicio e dt_fim são obrigatórios' });
  try {
    const [ins] = await pool.query(`
      INSERT INTO comissao_campanhas
        (nome, descricao, dt_inicio, dt_fim, id_fornecedor, nome_fornecedor,
         tipo_meta, vlr_meta, tipo_bonus, vlr_bonus, status, para_todos)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `, [nome, descricao||null, dt_inicio, dt_fim, id_fornecedor||null, nome_fornecedor||null,
        tipo_meta||'VENDAS', vlr_meta||0, tipo_bonus||'PERCENTUAL', vlr_bonus||0,
        status||'ATIVA', para_todos||'S']);
    const id = ins.insertId;
    if (para_todos === 'N' && Array.isArray(vendedores) && vendedores.length) {
      await pool.query(
        `INSERT IGNORE INTO comissao_campanhas_vendedores (id_campanha, id_usuario) VALUES ?`,
        [vendedores.map(v => [id, v])]
      );
    }
    res.json({ ok: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/comissoes/campanhas/:id
router.put('/campanhas/:id', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  await ensureMetasTables(pool);
  const { nome, descricao, dt_inicio, dt_fim, id_fornecedor, nome_fornecedor,
          tipo_meta, vlr_meta, tipo_bonus, vlr_bonus, status, para_todos, vendedores } = req.body;
  try {
    await pool.query(`
      UPDATE comissao_campanhas SET
        nome=?, descricao=?, dt_inicio=?, dt_fim=?, id_fornecedor=?, nome_fornecedor=?,
        tipo_meta=?, vlr_meta=?, tipo_bonus=?, vlr_bonus=?, status=?, para_todos=?
      WHERE id=?
    `, [nome, descricao||null, dt_inicio, dt_fim, id_fornecedor||null, nome_fornecedor||null,
        tipo_meta||'VENDAS', vlr_meta||0, tipo_bonus||'PERCENTUAL', vlr_bonus||0,
        status||'ATIVA', para_todos||'S', req.params.id]);
    await pool.query(`DELETE FROM comissao_campanhas_vendedores WHERE id_campanha=?`, [req.params.id]);
    if (para_todos === 'N' && Array.isArray(vendedores) && vendedores.length) {
      await pool.query(
        `INSERT IGNORE INTO comissao_campanhas_vendedores (id_campanha, id_usuario) VALUES ?`,
        [vendedores.map(v => [req.params.id, v])]
      );
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/comissoes/campanhas/:id (soft delete)
router.delete('/campanhas/:id', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  await ensureMetasTables(pool);
  try {
    await pool.query(`UPDATE comissao_campanhas SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/comissoes/campanhas/:id/progresso — realizado por vendedor na campanha
router.get('/campanhas/:id/progresso', async (req, res) => {
  const pool = getPool();
  await ensureMetasTables(pool);
  try {
    const [[camp]] = await pool.query(`SELECT * FROM comissao_campanhas WHERE id=?`, [req.params.id]);
    if (!camp) return res.status(404).json({ error: 'Campanha não encontrada' });

    // Determina quais vendedores participam
    let vendedores;
    if (camp.para_todos === 'S') {
      [vendedores] = await pool.query(
        `SELECT idusuario AS id, nomeusu AS nome FROM usuarios WHERE situacao='ATIVO' AND excluido='N'`
      );
    } else {
      [vendedores] = await pool.query(
        `SELECT u.idusuario AS id, u.nomeusu AS nome
         FROM comissao_campanhas_vendedores cv JOIN usuarios u ON cv.id_usuario = u.idusuario
         WHERE cv.id_campanha=?`, [camp.id]
      );
    }

    const fornFilter = camp.id_fornecedor ? ' AND ped.cod_fornecedor = ?' : '';
    const fornParam  = camp.id_fornecedor ? [camp.id_fornecedor] : [];

    const resultado = await Promise.all(vendedores.map(async v => {
      let realizado = 0;
      if (camp.tipo_meta === 'VENDAS') {
        const [[r]] = await pool.query(`
          SELECT COALESCE(SUM(ped.vlrtotalpedido),0) AS total
          FROM pedidos ped
          WHERE ped.id_usuario=? AND ped.excluido='N'
            AND ped.data_abertura BETWEEN ? AND ? ${fornFilter}
        `, [v.id, camp.dt_inicio, camp.dt_fim, ...fornParam]);
        realizado = parseFloat(r.total) || 0;
      } else {
        const [[r]] = await pool.query(`
          SELECT COALESCE(SUM(pc.vlr_pago),0) AS total
          FROM pagtocomissao pc LEFT JOIN pedidos ped ON pc.pedido=ped.numero
          WHERE pc.cod_user=? AND pc.excluido='N'
            AND pc.data_lancamento BETWEEN ? AND ? ${fornFilter}
        `, [v.id, camp.dt_inicio, camp.dt_fim, ...fornParam]);
        realizado = parseFloat(r.total) || 0;
      }
      const pct = camp.vlr_meta > 0 ? Math.min(100, (realizado / camp.vlr_meta) * 100) : 0;
      const atingiu = pct >= 100;
      const bonus = atingiu
        ? (camp.tipo_bonus === 'PERCENTUAL' ? realizado * (camp.vlr_bonus / 100) : parseFloat(camp.vlr_bonus))
        : 0;
      return { ...v, realizado, pct: pct.toFixed(1), atingiu, bonus };
    }));

    res.json({ campanha: camp, progresso: resultado });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── FECHAMENTO MENSAL ────────────────────────────────────────────────────────

// GET /api/comissoes/fechamento?mes=5&ano=2026
router.get('/fechamento', async (req, res) => {
  const pool = getPool();
  await ensureMetasTables(pool);
  const mes = parseInt(req.query.mes) || new Date().getMonth() + 1;
  const ano = parseInt(req.query.ano) || new Date().getFullYear();
  try {
    const [rows] = await pool.query(`
      SELECT f.*, u.nomeusu AS nome_vendedor
      FROM comissao_fechamento f
      JOIN usuarios u ON f.id_usuario = u.idusuario
      WHERE f.mes=? AND f.ano=?
      ORDER BY u.nomeusu
    `, [mes, ano]);
    // Vendedores sem fechamento ainda
    const [vendedores] = await pool.query(
      `SELECT idusuario AS id, nomeusu AS nome FROM usuarios WHERE situacao='ATIVO' AND excluido='N' ORDER BY nomeusu`
    );
    res.json({ fechamentos: rows, vendedores, mes, ano });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/comissoes/fechamento/calcular — calcula e upserta rascunho
router.post('/fechamento/calcular', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  await ensureMetasTables(pool);
  const { mes, ano, id_usuario } = req.body;
  if (!mes || !ano) return res.status(400).json({ error: 'mes e ano são obrigatórios' });

  const dtIni = `${ano}-${String(mes).padStart(2,'0')}-01`;
  const dtFim = new Date(ano, mes, 0).toISOString().slice(0, 10);

  try {
    let vendedores;
    if (id_usuario) {
      [vendedores] = await pool.query(
        `SELECT idusuario AS id FROM usuarios WHERE idusuario=? AND excluido='N'`, [id_usuario]
      );
    } else {
      [vendedores] = await pool.query(
        `SELECT idusuario AS id FROM usuarios WHERE situacao='ATIVO' AND excluido='N'`
      );
    }

    const resultados = [];
    for (const v of vendedores) {
      // Comissões confirmadas no período
      const [[com]] = await pool.query(`
        SELECT COALESCE(SUM(vlr_pago),0) AS total
        FROM pagtocomissao
        WHERE cod_user=? AND excluido='N' AND status IN ('C','R')
          AND data_lancamento BETWEEN ? AND ?
      `, [v.id, dtIni, dtFim]);
      const vlr_comissoes = parseFloat(com.total) || 0;

      // Bônus de campanhas ativas no período
      const [campsAtivas] = await pool.query(`
        SELECT c.* FROM comissao_campanhas c
        WHERE c.excluido='N' AND c.status='ATIVA'
          AND c.dt_inicio <= ? AND c.dt_fim >= ?
          AND (c.para_todos='S' OR EXISTS (
            SELECT 1 FROM comissao_campanhas_vendedores cv
            WHERE cv.id_campanha=c.id AND cv.id_usuario=?
          ))
      `, [dtFim, dtIni, v.id]);

      let vlr_bonus = 0;
      for (const camp of campsAtivas) {
        const fornFilter = camp.id_fornecedor ? ' AND ped.cod_fornecedor=?' : '';
        const fornParam  = camp.id_fornecedor ? [camp.id_fornecedor] : [];
        let realizado = 0;
        if (camp.tipo_meta === 'VENDAS') {
          const [[r]] = await pool.query(
            `SELECT COALESCE(SUM(ped.vlrtotalpedido),0) AS total FROM pedidos ped
             WHERE ped.id_usuario=? AND ped.excluido='N' AND ped.data_abertura BETWEEN ? AND ? ${fornFilter}`,
            [v.id, dtIni, dtFim, ...fornParam]
          );
          realizado = parseFloat(r.total) || 0;
        } else {
          const [[r]] = await pool.query(
            `SELECT COALESCE(SUM(pc.vlr_pago),0) AS total FROM pagtocomissao pc
             LEFT JOIN pedidos ped ON pc.pedido=ped.numero
             WHERE pc.cod_user=? AND pc.excluido='N' AND pc.data_lancamento BETWEEN ? AND ? ${fornFilter}`,
            [v.id, dtIni, dtFim, ...fornParam]
          );
          realizado = parseFloat(r.total) || 0;
        }
        if (realizado >= camp.vlr_meta) {
          vlr_bonus += camp.tipo_bonus === 'PERCENTUAL'
            ? realizado * (camp.vlr_bonus / 100)
            : parseFloat(camp.vlr_bonus);
        }
      }

      const vlr_total = vlr_comissoes + vlr_bonus;

      // Verifica se já existe fechamento fechado — não sobrescreve
      const [[existing]] = await pool.query(
        `SELECT id, status FROM comissao_fechamento WHERE id_usuario=? AND mes=? AND ano=?`,
        [v.id, mes, ano]
      );
      if (existing && existing.status !== 'ABERTO') {
        resultados.push({ id_usuario: v.id, status: existing.status, vlr_comissoes, vlr_bonus, vlr_total, atualizado: false });
        continue;
      }

      await pool.query(`
        INSERT INTO comissao_fechamento (id_usuario, mes, ano, status, vlr_comissoes, vlr_bonus, vlr_total)
        VALUES (?,?,?,'ABERTO',?,?,?)
        ON DUPLICATE KEY UPDATE
          vlr_comissoes=VALUES(vlr_comissoes),
          vlr_bonus=VALUES(vlr_bonus),
          vlr_total=VALUES(vlr_total)
      `, [v.id, mes, ano, vlr_comissoes, vlr_bonus, vlr_total]);

      resultados.push({ id_usuario: v.id, vlr_comissoes, vlr_bonus, vlr_total, atualizado: true });
    }
    res.json({ ok: true, mes, ano, resultados });
  } catch (e) {
    console.error('ERRO fechamento/calcular:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/comissoes/fechamento/:id/fechar
router.post('/fechamento/:id/fechar', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  await ensureMetasTables(pool);
  try {
    await pool.query(
      `UPDATE comissao_fechamento SET status='FECHADO', data_fechamento=NOW(), id_usuario_fechou=? WHERE id=? AND status='ABERTO'`,
      [req.user.id, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/comissoes/fechamento/:id/pagar
router.post('/fechamento/:id/pagar', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  await ensureMetasTables(pool);
  const { data_pagamento, obs } = req.body;
  try {
    await pool.query(
      `UPDATE comissao_fechamento SET status='PAGO', data_pagamento=?, obs=COALESCE(?,obs) WHERE id=? AND status='FECHADO'`,
      [data_pagamento || new Date().toISOString().slice(0,10), obs||null, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/comissoes/fechamento/:id/reabrir
router.post('/fechamento/:id/reabrir', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  await ensureMetasTables(pool);
  try {
    await pool.query(
      `UPDATE comissao_fechamento SET status='ABERTO', data_fechamento=NULL, data_pagamento=NULL WHERE id=? AND status != 'PAGO'`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /extrato-unificado — extrato cronológico com saldo acumulado ────────
router.get('/extrato-unificado', async (req, res) => {
  const pool = getPool();
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Sessão expirada' });

  const { dt_ini, dt_fim, id_fornecedor } = req.query;
  const dtIni = dt_ini || '2000-01-01';
  const dtFim = dt_fim || '2100-01-01';
  const isPrep = _isPreposto(req);
  const id_vendedor = _isAdmin(req) ? (req.query.id_vendedor || null) : String(userId);

  const params = [dtIni, dtFim];
  let where = `pc.excluido = 'N' AND pc.data_lancamento BETWEEN ? AND ?`;
  if (isPrep) {
    where += ' AND pc.id_preposto = ?'; params.push(userId);
  } else if (id_vendedor) {
    where += ' AND pc.cod_user = ?'; params.push(id_vendedor);
  }
  if (id_fornecedor) { where += ' AND ped.cod_fornecedor = ?'; params.push(id_fornecedor); }

  try {
    const [rows] = await pool.query(`
      SELECT
        pc.id,
        pc.data_lancamento                                  AS data,
        pc.data_pagar                                       AS vencimento,
        pc.data_pagamento,
        pc.pedido                                           AS num_pedido,
        COALESCE(rec.parcela, 1)                            AS parcela,
        COALESCE(rec.qt_parcelas, ped.qt_parcelas, 1)       AS qt_parcelas,
        ped.nome_cliente,
        ped.nome_fornecedor,
        ped.cod_fornecedor,
        u.nomeusu                                           AS nome_vendedor,
        pc.vlr_pago                                         AS valor,
        pc.status,
        CASE pc.status
          WHEN 'P' THEN 'Pendente'
          WHEN 'C' THEN 'Conferida'
          WHEN 'R' THEN 'Liquidada'
          WHEN 'I' THEN 'Inadimplente'
          ELSE pc.status
        END AS status_label,
        pc.observacao
      FROM pagtocomissao pc
      JOIN pedidos ped ON pc.pedido = ped.numero
      JOIN usuarios u   ON pc.cod_user = u.idusuario
      LEFT JOIN receber rec ON pc.id_parcela = rec.id
      WHERE ${where}
      ORDER BY pc.data_lancamento ASC, pc.id ASC
    `, params);

    let saldo = 0;
    const comSaldo = rows.map(r => {
      if (r.status === 'C' || r.status === 'R') saldo += parseFloat(r.valor) || 0;
      return { ...r, saldo_acumulado: Math.round(saldo * 100) / 100 };
    });

    const totais = {
      liquidado:    rows.filter(r => r.status === 'C' || r.status === 'R').reduce((s, r) => s + (parseFloat(r.valor) || 0), 0),
      pendente:     rows.filter(r => r.status === 'P').reduce((s, r) => s + (parseFloat(r.valor) || 0), 0),
      inadimplente: rows.filter(r => r.status === 'I').reduce((s, r) => s + (parseFloat(r.valor) || 0), 0),
    };

    res.json({ data: comSaldo, totais, saldo_final: Math.round(saldo * 100) / 100 });
  } catch (e) {
    console.error('ERRO /extrato-unificado:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /admin/bloquear-inadimplentes — bloqueia comissões de parcelas em atraso
router.post('/admin/bloquear-inadimplentes', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  const { dias_carencia = 30 } = req.body;
  const dc = parseInt(dias_carencia) || 30;

  try {
    const [result] = await pool.query(`
      UPDATE pagtocomissao pc
      JOIN receber rec ON pc.id_parcela = rec.id
      SET pc.status = 'I',
          pc.observacao = CONCAT(COALESCE(pc.observacao,''), ' | BLOQUEADA: inadimplência > ', ?, ' dias em ', CURDATE())
      WHERE pc.status = 'P'
        AND COALESCE(pc.excluido,'N') = 'N'
        AND rec.status NOT IN ('PAGO','BAIXADO','LIQUIDADO','QUITADO')
        AND rec.vencimento < DATE_SUB(CURDATE(), INTERVAL ? DAY)
    `, [dc, dc]);

    res.json({ ok: true, bloqueadas: result.affectedRows, dias_carencia: dc });
  } catch (e) {
    console.error('ERRO /bloquear-inadimplentes:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /admin/reativar-inadimplentes — restaura comissões bloqueadas para 'P'
router.post('/admin/reativar-inadimplentes', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  const { ids } = req.body;

  try {
    let result;
    if (ids && ids.length) {
      const ph = ids.map(() => '?').join(',');
      [result] = await pool.query(
        `UPDATE pagtocomissao SET status = 'P' WHERE id IN (${ph}) AND status = 'I' AND COALESCE(excluido,'N') = 'N'`,
        ids
      );
    } else {
      [result] = await pool.query(
        `UPDATE pagtocomissao SET status = 'P' WHERE status = 'I' AND COALESCE(excluido,'N') = 'N'`
      );
    }
    res.json({ ok: true, reativadas: result.affectedRows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /admin/inadimplentes — lista comissões bloqueadas ───────────────────
router.get('/admin/inadimplentes', async (req, res) => {
  if (!_isAdmin(req)) return res.status(403).json({ error: 'Acesso restrito ao gestor' });
  const pool = getPool();
  const { id_fornecedor, id_vendedor } = req.query;

  let where = `pc.status = 'I' AND COALESCE(pc.excluido,'N') = 'N'`;
  const params = [];
  if (id_vendedor) { where += ' AND pc.cod_user = ?'; params.push(id_vendedor); }
  if (id_fornecedor) { where += ' AND ped.cod_fornecedor = ?'; params.push(id_fornecedor); }

  try {
    const [rows] = await pool.query(`
      SELECT
        pc.id, pc.pedido, pc.vlr_pago, pc.data_lancamento, pc.observacao,
        u.nomeusu          AS nome_vendedor,
        ped.nome_cliente,
        ped.nome_fornecedor,
        rec.vencimento,
        rec.valor          AS vlr_parcela,
        rec.status         AS status_parcela,
        DATEDIFF(CURDATE(), rec.vencimento) AS dias_atraso
      FROM pagtocomissao pc
      JOIN pedidos ped  ON pc.pedido = ped.numero
      JOIN usuarios u   ON pc.cod_user = u.idusuario
      LEFT JOIN receber rec ON pc.id_parcela = rec.id
      WHERE ${where}
      ORDER BY COALESCE(rec.vencimento, '9999-12-31') ASC
    `, params);

    const total = rows.reduce((s, r) => s + (parseFloat(r.vlr_pago) || 0), 0);
    res.json({ data: rows, total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── GET /prepostos-do-rep — comissões dos prepostos do representante logado ──
router.get('/prepostos-do-rep', async (req, res) => {
  if (_isPreposto(req)) return res.status(403).json({ error: 'Acesso restrito' });
  const pool = getPool();
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Sessão expirada' });

  const { dt_inicio, dt_fim, id_preposto, id_fornecedor } = req.query;
  const dtIni = dt_inicio || '2000-01-01';
  const dtFim = dt_fim    || '2100-01-01';

  const params = [userId, dtIni, dtFim];
  let where = `pc.cod_user = ? AND pc.id_preposto IS NOT NULL AND pc.excluido = 'N' AND pc.data_lancamento BETWEEN ? AND ?`;
  if (id_preposto)  { where += ' AND pc.id_preposto = ?';    params.push(id_preposto); }
  if (id_fornecedor){ where += ' AND ped.cod_fornecedor = ?'; params.push(id_fornecedor); }

  const sel = `
    pc.id, pc.pedido, pc.vlr_pago, pc.status, pc.data_lancamento, pc.data_confirmacao, pc.data_pagamento,
    ped.nome_cliente, ped.nome_fornecedor, ped.vlrtotalpedido,
    u_prep.nomeusu AS nome_preposto
  `;
  const joins = `
    FROM pagtocomissao pc
    JOIN pedidos ped ON pc.pedido = ped.numero
    JOIN usuarios u_prep ON pc.id_preposto = u_prep.idusuario
  `;

  try {
    const [pendentes]  = await pool.query(`SELECT ${sel} ${joins} WHERE ${where} AND pc.status IN ('P','I') ORDER BY u_prep.nomeusu, pc.data_lancamento DESC`, params);
    const [conferidas] = await pool.query(`SELECT ${sel} ${joins} WHERE ${where} AND pc.status = 'C'      ORDER BY u_prep.nomeusu, pc.data_confirmacao DESC`, params);
    const [liquidadas] = await pool.query(`SELECT ${sel} ${joins} WHERE ${where} AND pc.status = 'R'      ORDER BY u_prep.nomeusu, pc.data_lancamento DESC`, params);

    const [prepostos] = await pool.query(`
      SELECT DISTINCT u_prep.idusuario AS id, u_prep.nomeusu AS nome
      FROM pagtocomissao pc JOIN usuarios u_prep ON pc.id_preposto = u_prep.idusuario
      WHERE pc.cod_user = ? AND pc.id_preposto IS NOT NULL AND pc.excluido = 'N'
      ORDER BY u_prep.nomeusu
    `, [userId]);

    const [[stats]] = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN pc.status IN ('P','I') THEN pc.vlr_pago ELSE 0 END), 0) AS pendente,
        COALESCE(SUM(CASE WHEN pc.status IN ('C','R') THEN pc.vlr_pago ELSE 0 END), 0) AS pago
      FROM pagtocomissao pc
      WHERE pc.cod_user = ? AND pc.id_preposto IS NOT NULL AND pc.excluido = 'N'
        AND pc.data_lancamento BETWEEN ? AND ?
    `, [userId, dtIni, dtFim]);

    res.json({ pendentes, conferidas, liquidadas, prepostos, stats: stats || { pendente: 0, pago: 0 } });
  } catch (e) {
    console.error('ERRO /prepostos-do-rep:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /preposto/aceitar-pelo-rep — representante confirma comissões dos seus prepostos
router.post('/preposto/aceitar-pelo-rep', async (req, res) => {
  if (_isPreposto(req)) return res.status(403).json({ error: 'Acesso restrito' });
  const pool = getPool();
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Sessão expirada' });

  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'Nenhuma comissão informada' });

  try {
    const placeholders = ids.map(() => '?').join(',');
    await pool.query(
      `UPDATE pagtocomissao SET status = 'C', data_confirmacao = NOW()
       WHERE id IN (${placeholders}) AND cod_user = ? AND id_preposto IS NOT NULL AND status = 'P'`,
      [...ids, userId]
    );
    res.json({ sucesso: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
