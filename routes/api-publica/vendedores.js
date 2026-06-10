/**
 * GET /api/v1/vendedores — lista vendedores ativos (somente leitura)
 */
const express = require('express');
const router  = express.Router();
const { getPool } = require('../../config/database');

router.get('/', async (req, res) => {
  try {
    const pool = getPool();

    const [rows] = await pool.query(
      `SELECT u.idusuario AS id, u.nomeusu AS nome, u.loginusu AS login, u.email
       FROM usuarios u
       INNER JOIN perfil p ON p.id = u.perfil AND p.p_vender = 'S'
       WHERE u.excluido = 'N' AND u.SITUACAO = 'ATIVO'
       ORDER BY u.nomeusu ASC`
    );

    res.json({
      data: rows.map(v => ({
        id:    v.id,
        nome:  v.nome,
        login: v.login  || null,
        email: v.email  || null,
      })),
    });
  } catch (err) {
    console.error('[api/v1/vendedores] GET /', err.message);
    res.status(500).json({ error: { code: 500, message: 'Erro interno ao buscar vendedores' } });
  }
});

module.exports = router;
