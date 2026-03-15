require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3002;

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rotas de setup (sem autenticação nem licença)
app.use('/api/setup', require('./routes/setup'));
app.use('/api/auth', require('./routes/auth'));

// Redireciona raiz
app.get('/', (req, res) => {
  const installed = fs.existsSync(path.join(__dirname, '.installed'));
  if (!installed) return res.redirect('/setup.html');
  res.redirect('/login.html');
});

// ─── Licença e autenticação para rotas protegidas ───────────────────────────
const { licenseMiddleware } = require('./middleware/license');
const { authMiddleware } = require('./middleware/auth');

app.use('/api', licenseMiddleware);

// GET /api/license/status — info da licença (protegida só por auth)
app.get('/api/license/status', authMiddleware, async (req, res) => {
  const { checkLicense } = require('./config/license');
  const result = await checkLicense();
  res.json(result);
});

// ─── Status do backup (tabela log_backup) ───────────────────────────────────
app.get('/api/backup/status', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT DATEDIFF(CURDATE(), data) AS dias, nome, data
       FROM log_backup WHERE excluido = 'N'
       ORDER BY id DESC LIMIT 1`
    ).catch(() => [[]]);
    if (!rows[0]) return res.json({ dias: -1 });
    res.json({ dias: rows[0].dias, nome: rows[0].nome, data: rows[0].data });
  } catch {
    res.json({ dias: -1 });
  }
});

// ─── Módulos liberados (tabela modulos) ─────────────────────────────────────
app.get('/api/modulos', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, descricao FROM modulos WHERE excluido = 'N' AND liberado = 'S' ORDER BY descricao`
    );
    res.json({ modulos: rows });
  } catch (err) {
    res.json({ modulos: [] });
  }
});

// ─── Suas rotas de negócio vão aqui ─────────────────────────────────────────
// app.use('/api/clientes', authMiddleware, require('./routes/clientes'));
// app.use('/api/pedidos',  authMiddleware, require('./routes/pedidos'));
// app.use('/api/produtos', authMiddleware, require('./routes/produtos'));

// ─── Cadastros (perfis, grupos, usuários, empresas) ──────────────────────────
app.use('/api', authMiddleware, require('./routes/cadastros'));

// ─── Configurações do sistema e da API ───────────────────────────────────────
app.use('/api/config',    authMiddleware, require('./routes/config-sistema'));
app.use('/api/mobile',    authMiddleware, require('./routes/mobile'));
app.use('/api/whatsapp',  authMiddleware, require('./routes/whatsapp'));

// ─── Dashboard home (pedidos do mês) ────────────────────────────────────────
app.get('/api/dashboard/home', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT p.tipo_pedido, p.nome_cliente, p.nome_vendedor, p.vlrtotalpedido
       FROM pedidos p
       WHERE p.excluido = 'N'
         AND MONTH(p.data_abertura) = MONTH(CURDATE())
         AND YEAR(p.data_abertura) = YEAR(CURDATE())`
    ).catch(() => [[]]);

    // Agrupa por tipo_pedido
    const porTipo = {};
    const porCliente = {};
    const porVendedor = {};
    let totalGeral = 0;

    for (const r of rows) {
      const tipo = r.tipo_pedido || 'Outros';
      porTipo[tipo] = (porTipo[tipo] || 0) + parseFloat(r.vlrtotalpedido || 0);
      totalGeral += parseFloat(r.vlrtotalpedido || 0);

      const cli = r.nome_cliente || 'Sem nome';
      porCliente[cli] = (porCliente[cli] || 0) + 1;

      const vend = r.nome_vendedor || 'Sem nome';
      porVendedor[vend] = (porVendedor[vend] || 0) + 1;
    }

    // Top 10
    const topClientes = Object.entries(porCliente).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const topVendedores = Object.entries(porVendedor).sort((a,b)=>b[1]-a[1]).slice(0,8);

    res.json({
      totalGeral,
      qtdPedidos: rows.length,
      porTipo,
      topClientes,
      topVendedores,
      mes: new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    });
  } catch (err) {
    res.json({ totalGeral: 0, qtdPedidos: 0, porTipo: {}, topClientes: [], topVendedores: [], mes: '' });
  }
});

// ─── WhatsApp / EvolutionAPI — status do usuário logado (topbar) ─────────────
app.get('/api/whatsapp/config', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT w_apiglobal, w_urlplataforma FROM configuracao WHERE excluido='N' ORDER BY id DESC LIMIT 1`
    ).catch(() => [[]]);
    if (!rows[0]?.w_urlplataforma) return res.json({ configurado: false });
    res.json({ configurado: true, urlPlataforma: rows[0].w_urlplataforma, apiGlobal: rows[0].w_apiglobal });
  } catch {
    res.json({ configurado: false });
  }
});

// Nota: todas as rotas /api/whatsapp/* estão em routes/whatsapp.js

// 404 para API
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// SPA fallback — /pages/* nunca faz redirect (evita iframe recursion)
app.get('*', (req, res) => {
  const ext = path.extname(req.path);
  // Recursos estáticos não-HTML → 404
  if (ext && ext !== '.html') return res.status(404).end();
  // Rotas dentro de /pages/ que não existem → 404 (nunca redireciona para login)
  if (req.path.startsWith('/pages/')) return res.status(404).end();
  // Demais rotas HTML → login
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(PORT, () => {
  const installed = fs.existsSync(path.join(__dirname, '.installed'));
  console.log(`\n🚀 SysRepWeb rodando em http://localhost:${PORT}`);
  if (!installed) {
    console.log(`⚙️  Primeira execução — acesse http://localhost:${PORT}/setup.html`);
  }
});
