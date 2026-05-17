require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { logError, logInfo } = require('./config/logger');

// Captura erros não tratados globalmente
process.on('uncaughtException',  err => logError('uncaughtException',  err));
process.on('unhandledRejection', err => logError('unhandledRejection', err));

const app = express();
const PORT = process.env.PORT || 30100;

// Atrás de Nginx/proxy: req.ip deve refletir o cliente real (X-Forwarded-For) para rate-limit do painel /licencas
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// Middlewares
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());

/**
 * Favicon: PNG válido (muitos browsers ignoram SVG em GET /favicon.ico e retornavam 404).
 * 1×1 px — só para silenciar o pedido automático; use /favicon.svg no <link> para ícone nítido.
 */
const FAVICON_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
app.get('/favicon.ico', (req, res) => {
  res.type('image/png');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send(FAVICON_PNG);
});

app.get('/home.html', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'home.html'), { etag: false, lastModified: false });
});

app.get('/mobile-shell.html', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'mobile-shell.html'), { etag: false, lastModified: false });
});

/** Legado: favoritos / links antigos apontavam para mobile.html */
app.get('/mobile.html', (req, res) => {
  const i = req.originalUrl.indexOf('?');
  const q = i >= 0 ? req.originalUrl.slice(i) : '';
  res.redirect(302, '/mobile-shell.html' + q);
});

// login.html — sem cache para garantir verificação de licença sempre atualizada
app.get('/login.html', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Painel de licenças — rota explícita (evita CDN/proxy entregar SPA ou login por engano)
app.get('/licencas.html', (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'licencas.html'));
});

app.get('/licencas', (req, res) => {
  const q = req.url.indexOf('?');
  res.redirect(302, '/licencas.html' + (q >= 0 ? req.url.slice(q) : ''));
});

// Arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Rotas de setup (sem autenticação nem licença)
app.use('/api/setup',    require('./routes/setup'));
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/dbconfig', require('./routes/dbconfig'));

// Redireciona raiz
app.get('/', (req, res) => {
  const installed = fs.existsSync(path.join(__dirname, '.installed'));
  if (!installed) return res.redirect('/setup.html');
  res.redirect('/login.html');
});

// ─── Licença e autenticação para rotas protegidas ───────────────────────────
const { licenseMiddleware } = require('./middleware/license');
const { authMiddleware } = require('./middleware/auth');

// GET /api/license/check — verificação pública (sem auth) usada pelo login.html
app.get('/api/license/check', async (req, res) => {
  try {
    const LicenseService = require('./services/license-service');
    const result = await LicenseService.checkLocal();
    res.json({
      valid:           result.valid,
      status:          result.status,
      mensagem:        result.mensagem  || null,
      diasRestantes:   result.diasRestantes || null,
      aviso:           result.aviso     || false,
      demo:            result.demo      || false,
      suporte_whatsapp: process.env.SUPORTE_WHATSAPP || '',
      suporte_nome:     process.env.SUPORTE_NOME     || 'Suporte Técnico',
      suporte_email:    process.env.SUPORTE_EMAIL    || '',
      pix_chave:        process.env.PIX_CHAVE        || '',
      pix_tipo:         process.env.PIX_TIPO         || '',
      pix_nome:         process.env.PIX_NOME         || '',
      pix_descricao:    process.env.PIX_DESCRICAO    || '',
    });
  } catch (err) {
    res.json({ valid: true, status: 'erro_verificacao' });
  }
});

// GET /api/license/ping — testa conexão com banco remoto de licenças (público)
app.get('/api/license/ping', async (req, res) => {
  try {
    const { getLicensePool } = require('./config/db-license');
    const licPool = getLicensePool();
    const [[row]] = await licPool.query('SELECT COUNT(*) as total FROM sistema_licencas');
    res.json({
      ok: true,
      host:     process.env.LICENSE_DB_HOST || '(não definido)',
      porta:    process.env.LICENSE_DB_PORT || '3306',
      banco:    process.env.LICENSE_DB_NAME || '(não definido)',
      usuario:  process.env.LICENSE_DB_USER || '(não definido)',
      total_licencas: row.total,
    });
  } catch (err) {
    res.json({
      ok: false,
      host:    process.env.LICENSE_DB_HOST || '(não definido)',
      porta:   process.env.LICENSE_DB_PORT || '3306',
      banco:   process.env.LICENSE_DB_NAME || '(não definido)',
      usuario: process.env.LICENSE_DB_USER || '(não definido)',
      erro:    err.message,
    });
  }
});

app.use('/api', licenseMiddleware);

/** Logs do browser (mobile-shell / iframe) → console do Node + logs/errors.log */
app.use('/api/client-log', require('./routes/client-log'));

// GET /api/license/status — info da licença (protegida só por auth)
app.get('/api/license/status', authMiddleware, async (req, res) => {
  const LicenseService = require('./services/license-service');
  const result = await LicenseService.checkLocal();
  res.json(result);
});

// POST /api/license/activate — pública (usada na tela de login antes do auth)
app.post('/api/license/activate', async (req, res) => {
  const { chave } = req.body;
  if (!chave) return res.status(400).json({ error: 'Chave não informada' });
  const LicenseService = require('./services/license-service');
  const { invalidateLicenseCache } = require('./middleware/license');
  const result = await LicenseService.activateLicense(chave);
  if (result.sucesso) invalidateLicenseCache();
  res.json(result);
});

// POST /api/license/demo — ativa modo demo por 30 dias
app.post('/api/license/demo', authMiddleware, async (req, res) => {
  const LicenseService = require('./services/license-service');
  const { invalidateLicenseCache } = require('./middleware/license');
  const result = await LicenseService.activateDemo();
  invalidateLicenseCache();
  res.json(result);
});

// POST /api/license/sync — sincroniza com base remota
app.post('/api/license/sync', authMiddleware, async (req, res) => {
  const LicenseService = require('./services/license-service');
  const { invalidateLicenseCache } = require('./middleware/license');
  const status = await LicenseService.checkLocal();
  if (!status.dados?.chave_licenca) return res.status(400).json({ error: 'Nenhuma licença ativa para sincronizar' });
  const result = await LicenseService.syncWithRemote(status.dados.chave_licenca);
  if (result.sucesso) invalidateLicenseCache();
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

// ─── Portal de gestão de licenças (sem licenseMiddleware, sem authMiddleware) ─
app.use('/api/licencas', require('./routes/licencas'));

// ─── Webhooks públicos (sem auth — Meta, etc.) ───────────────────────────────
app.use('/api/webhooks', require('./routes/webhooks'));

// ─── Suas rotas de negócio vão aqui ─────────────────────────────────────────
app.use('/api/clientes',     authMiddleware, require('./modules/clientes/clientes.routes'));
app.use('/api/fornecedores',     authMiddleware, require('./routes/fornecedores'));
app.use('/api/transportadoras',   authMiddleware, require('./routes/transportadoras'));
app.use('/api/familia-produtos',  authMiddleware, require('./routes/familia-produtos'));
app.use('/api/grades',            authMiddleware, require('./routes/grades'));
app.use('/api/cores',             authMiddleware, require('./routes/cores'));
app.use('/api/produtos',     authMiddleware, require('./routes/produtos'));
app.use('/api/lookups',      authMiddleware, require('./routes/lookups'));
app.use('/api/tabela-precos', authMiddleware, require('./routes/tabela-precos'));
app.use('/api/importacao-precos',       authMiddleware, require('./routes/importacao-precos'));
app.use('/api/importacao-clientes',    authMiddleware, require('./routes/importacao-clientes'));
app.use('/api/importacao-fornecedores',authMiddleware, require('./routes/importacao-fornecedores'));
app.use('/api/leads',        authMiddleware, require('./routes/leads'));
app.use('/api/visitas',      authMiddleware, require('./routes/visitas'));
app.use('/api/geocoding',    authMiddleware, require('./routes/geocoding'));
app.use('/api/geolocalizacao', authMiddleware, require('./routes/geolocalizacao'));
app.use('/api/user-prefs',    authMiddleware, require('./routes/user-prefs'));

// ─── GET /api/grupos-fab — grupos de fornecedores (tabela: grupos) ──────────
app.get('/api/grupos-fab', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, descricao FROM grupos
       WHERE excluido = 'N' AND ativo = 'SIM'
       ORDER BY descricao DESC`
    );
    res.json(rows);
  } catch (err) {
    res.json([]); // silencioso se tabela não existir
  }
});

// ─── GET /api/categorias — segmentos de clientes ─────────────────────────────
app.get('/api/categorias', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, descricao FROM categoria
       WHERE excluido = 'N' AND status = 'A'
       ORDER BY descricao`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/vendedores — acesso global para outros módulos ─────────────────
app.get('/api/vendedores', authMiddleware, async (req, res) => {
  try {
    const svc = require('./modules/clientes/clientes.service');
    const dados = await svc.listarAuxiliares('vendedores', req.user);
    res.json({ vendedores: dados });
  } catch (err) {
    res.json({ vendedores: [] });
  }
});
app.use('/api/pedidos',   authMiddleware, require('./routes/pedidos'));
app.use('/api/xml',       authMiddleware, require('./routes/xml'));
app.use('/api/excel',     authMiddleware, require('./routes/excel'));
app.use('/api/analytics', authMiddleware, require('./routes/analytics'));
app.use('/api/comissoes', authMiddleware, require('./routes/comissoes'));
app.use('/api/pagar',     authMiddleware, require('./routes/pagar'));
app.use('/api/receber',   authMiddleware, require('./routes/receber'));
app.use('/api/financeiro', authMiddleware, require('./routes/financeiro'));


// ─── Cadastros (perfis, grupos, usuários, empresas) ──────────────────────────
app.use('/api', authMiddleware, require('./routes/cadastros'));

// ─── Configurações do sistema e da API ───────────────────────────────────────
app.use('/api/config',    authMiddleware, require('./routes/config-sistema'));
app.use('/api/parametro-locais', authMiddleware, require('./routes/parametro-locais'));
app.use('/api/whatsapp',  authMiddleware, require('./routes/whatsapp'));
app.use('/api/anotacoes', authMiddleware, require('./routes/anotacoes'));

// ─── Dashboard home (Visão Executiva Diamond Flow) ───────────────────────────
app.get('/api/dashboard/home', authMiddleware, async (req, res) => {
  try {
    const { getPool } = require('./config/database');
    const pool = getPool();

    // 1. Determinar permissões de visualização
    const isAdmin = req.user.perfil == 1 || req.user.acessartodosclientes === 'S';
    let whereUser = isAdmin ? "" : " AND p.id_usuario = " + pool.escape(req.user.id);
    let whereUserLogs = isAdmin ? "" : " AND l.id_usuario = " + pool.escape(req.user.id);

    // 2. Pedidos do Mês Atual e Anterior (para comparativos)
    const [rows] = await pool.query(`
      SELECT 
        p.tipo_pedido, p.nome_cliente, p.nome_vendedor, p.nome_fornecedor, 
        p.vlrtotalpedido, p.data_abertura, p.situacao_pedido, p.id_usuario
      FROM pedidos p
      WHERE p.excluido = 'N'
        AND p.data_abertura >= DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')
        ${whereUser}
    `).catch(() => [[]]);

    const hoje = new Date();
    const mesAtual = hoje.getMonth() + 1;
    const anoAtual = hoje.getFullYear();
    const mesAnt   = mesAtual === 1 ? 12 : mesAtual - 1;
    const anoAnt   = mesAtual === 1 ? anoAtual - 1 : anoAtual;

    let totalGeral = 0, qtdPedidos = 0;
    let totalMesAnt = 0, qtdMesAnt = 0;
    
    const porTipo = {};
    const porCliente = {};
    const porVendedor = {};
    const porFabrica = {};
    const evolucaoDiaria = {};

    for (const r of rows) {
      const dt = new Date(r.data_abertura);
      const m = dt.getMonth() + 1;
      const y = dt.getFullYear();
      const vlr = parseFloat(r.vlrtotalpedido || 0);

      // Mês Atual
      if (m === mesAtual && y === anoAtual) {
        totalGeral += vlr;
        qtdPedidos++;

        const tipo = r.tipo_pedido || 'Outros';
        porTipo[tipo] = (porTipo[tipo] || 0) + vlr;

        const cli = r.nome_cliente || 'Sem nome';
        porCliente[cli] = (porCliente[cli] || 0) + vlr;

        const vend = r.nome_vendedor || 'Sem nome';
        porVendedor[vend] = (porVendedor[vend] || 0) + vlr;

        const fab = r.nome_fornecedor || 'Sem nome';
        porFabrica[fab] = (porFabrica[fab] || 0) + vlr;

        const dia = dt.getDate();
        evolucaoDiaria[dia] = (evolucaoDiaria[dia] || 0) + vlr;
      } 
      // Mês Anterior
      else if (m === mesAnt && y === anoAnt) {
        totalMesAnt += vlr;
        qtdMesAnt++;
      }
    }

    // 2. Ranking Formatado (Top 5 por Valor)
    const topClientes = Object.entries(porCliente).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const topVendedores = Object.entries(porVendedor).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const topFabricas = Object.entries(porFabrica).sort((a,b)=>b[1]-a[1]).slice(0,5);

    // Cálculos de Tendência
    const tendenciaVendas = totalMesAnt > 0 ? (((totalGeral - totalMesAnt) / totalMesAnt) * 100).toFixed(1) : 0;
    const tendenciaPedidos = qtdMesAnt > 0 ? (((qtdPedidos - qtdMesAnt) / qtdMesAnt) * 100).toFixed(1) : 0;

    // 3. Atividades Recentes (Logs) filtradas por permissão
    const [logs] = await pool.query(`
      SELECT l.*, u.nome as nome_usuario
      FROM logs_pedidos l
      LEFT JOIN usuarios u ON l.id_usuario = u.idusuario
      WHERE 1=1 ${whereUserLogs}
      ORDER BY l.data_hora DESC
      LIMIT 10
    `).catch(() => [[]]);

    // 4. Visitas e Atividades Reais (Nova Tabela)
    const [visitas] = await pool.query(`
      SELECT 
        v.id, v.data_visita, v.hora_visita, v.status, v.id_cliente,
        c.nome as nome_cliente, m.descricao as motivo
      FROM visitas v
      LEFT JOIN clientes c ON v.id_cliente = c.id
      LEFT JOIN motivo_visitas m ON v.id_motivo = m.id
      WHERE v.id_vendedor = ? OR ? = 1
      ORDER BY v.data_visita DESC, v.hora_visita DESC
      LIMIT 10
    `, [req.user.id, req.user.perfil]).catch(() => [[]]);

    res.json({
      totalGeral,
      qtdPedidos,
      totalMesAnt,
      tendenciaVendas,
      tendenciaPedidos,
      porTipo,
      topClientes,
      topVendedores,
      topFabricas,
      evolucaoDiaria,
      logs,
      visitas,
      mesNome: hoje.toLocaleDateString('pt-BR', { month: 'long' }).toUpperCase()
    });
  } catch (err) {
    console.error('Dash Error:', err);
    res.status(500).json({ error: 'Erro ao processar dashboard' });
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

// Middleware de log de erros Express (captura next(err))
app.use((err, req, res, next) => {
  logError(`${req.method} ${req.path}`, err);
  res.status(500).json({ error: err.message });
});

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
  // Nunca substituir páginas reais pelo shell de login (proxy estático pode não servir o arquivo)
  if (req.path === '/licencas.html' || req.path === '/setup.html') {
    const fn = req.path === '/licencas.html' ? 'licencas.html' : 'setup.html';
    return res.sendFile(path.join(__dirname, 'public', fn));
  }
  // Demais rotas HTML → login
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

const { initCustomerDatabase, customerDbFromLicense, readLicenseBinding } = require('./config/database');

initCustomerDatabase()
  .then(() => {
    app.listen(PORT, () => {
      const installed = fs.existsSync(path.join(__dirname, '.installed'));
      console.log(`\n🚀 SysRepWeb rodando em http://localhost:${PORT}`);
      if (!installed) {
        console.log(`⚙️  Primeira execução — acesse http://localhost:${PORT}/setup.html`);
      }
      if (customerDbFromLicense() && readLicenseBinding()) {
        console.log('📎 CUSTOMER_DB_FROM_LICENSE: banco operacional amarrado à chave em data/license-binding.json');
      }
    });
  })
  .catch((err) => {
    console.error('[DB] Falha ao inicializar conexão com banco cliente:', err.message);
    process.exit(1);
  });
