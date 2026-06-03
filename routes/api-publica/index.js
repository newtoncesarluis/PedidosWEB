/**
 * API Pública v1 — SysRepWeb
 * Base: /api/v1
 *
 * Autenticação: Bearer API Key (middleware api-key-auth)
 */
const express = require('express');
const router  = express.Router();
const { apiKeyAuth } = require('../../middleware/api-key-auth');

// Healthcheck sem auth — permite testar se a API está online
router.get('/ping', (req, res) => res.json({ status: 'ok', version: '1.0', ts: new Date().toISOString() }));

// Aplica autenticação em todos os endpoints abaixo
router.use(apiKeyAuth);

router.use('/pedidos',          require('./pedidos'));
router.use('/clientes',         require('./clientes'));
router.use('/produtos',         require('./produtos'));
router.use('/formas-pagamento', require('./formas-pagamento'));

module.exports = router;
