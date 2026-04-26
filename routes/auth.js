const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { getPool } = require('../config/database');

// POST /api/auth/login
// Lógica baseada no Delphi: SELECT p.*, s.* FROM usuarios s INNER JOIN perfil p ON p.id = s.idperfil
// WHERE s.SITUACAO = 'ATIVO' AND s.excluido = 'N' AND s.loginusu = ? AND s.senhausu = ?
router.post('/login', async (req, res) => {
  const { loginusu, senhausu, id_empresa } = req.body;

  if (!loginusu || !senhausu) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }

  try {
    const pool = getPool();

    // Query idêntica à do Delphi (case-insensitive via UPPER)
    const [rows] = await pool.query(
      `SELECT p.*, s.*
       FROM usuarios s
       INNER JOIN perfil p ON p.id = s.idperfil
       WHERE UPPER(s.loginusu) = UPPER(?)
         AND s.situacao = 'ATIVO'
         AND s.excluido = 'N'
       LIMIT 1`,
      [loginusu]
    );

    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    // Validação de senha case-insensitive (igual ao Delphi: UpperCase = UpperCase)
    if (user.senhausu.toUpperCase() !== senhausu.toUpperCase()) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    // Verifica mensalidade antes de liberar acesso
    const licCheck = await checkMensalidade(pool);
    if (licCheck.bloqueado) {
      return res.status(402).json({
        error: 'Sistema bloqueado por inadimplência',
        bloqueado: true,
        diasAtraso: licCheck.diasAtraso
      });
    }

    // Carrega permissões (igual ao PermissaoOperacao do Delphi)
    const permissoes = buildPermissoes(user);

    // Carrega dados da empresa selecionada
    let empresaData = null;
    if (id_empresa) {
      const [emp] = await pool.query(
        `SELECT e.* FROM empresa e WHERE e.id_empresa = ? AND e.excluido = 'N' LIMIT 1`,
        [id_empresa]
      );
      empresaData = emp[0] || null;
    }

    // Registra acesso do terminal (InformacoesMaquina)
    const userAgent = req.headers['user-agent'] || '';
    const clientIp = req.ip || req.connection.remoteAddress;
    await registrarTerminal(pool, clientIp, userAgent, user.idusuario, id_empresa);

    // Atualiza último acesso
    await pool.query(
      `UPDATE usuarios SET dt_ultimoacesso = NOW() WHERE idusuario = ?`,
      [user.idusuario]
    ).catch(() => {}); // silencioso se campo não existir

    const tokenPayload = {
      id: user.idusuario,
      name: user.nomeusu,
      login: user.loginusu,
      perfil: user.idperfil,
      role: user.idperfil == 1 ? 'admin' : 'user',
      id_empresa: id_empresa || null,
      permissoes
    };

    const token = jwt.sign(tokenPayload, process.env.JWT_SECRET, { expiresIn: '8h' });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000
    });

    res.json({
      ok: true,
      token,
      user: {
        id: user.idusuario,
        nome: user.nomeusu,
        login: user.loginusu,
        perfil: user.idperfil,
        role: user.idperfil == 1 ? 'admin' : 'user',
        email: user.email,
        rota_vendedor: user.rota_vendedor,
        acessartodosclientes: user.acessartodosclientes,
        permissoes
      },
      empresa: empresaData,
      licenca: licCheck
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// POST /api/auth/empresas-usuario
// Valida credenciais e retorna empresas do usuário (EmpresasUsuarios do Delphi)
// Chamado ao sair do campo senha — antes do botão Entrar
router.post('/empresas-usuario', async (req, res) => {
  const { loginusu, senhausu } = req.body;
  if (!loginusu || !senhausu) return res.json({ ok: false, empresas: [] });

  try {
    const pool = getPool();

    // 1. Valida credenciais básicas
    const [rows] = await pool.query(
      `SELECT s.idusuario, s.senhausu, s.empresapadrao, s.idperfil
       FROM usuarios s
       WHERE UPPER(s.loginusu) = UPPER(?)
         AND s.situacao = 'ATIVO'
         AND s.excluido = 'N'
       LIMIT 1`,
      [loginusu]
    );

    const user = rows[0];
    if (!user || user.senhausu.toUpperCase() !== senhausu.toUpperCase()) {
      return res.json({ ok: false, empresas: [] });
    }

    // 2. Busca mudarempresa do perfil
    const [perfRows] = await pool.query(
      `SELECT mudarempresa, alterarservidor FROM perfil WHERE id = ? LIMIT 1`,
      [user.idperfil]
    ).catch(() => [[]]);

    const perf = perfRows[0] || {};

    // 3. Carrega empresas vinculadas ao usuário (EmpresasUsuarios do Delphi)
    // id_usuario é varchar(15) na tabela, por isso converte para string
    const [empresas] = await pool.query(
      `SELECT e.id_empresa, e.Razao_empresa
       FROM usuario_empresas t
       INNER JOIN empresa e ON e.id_empresa = t.cod_empresa
       WHERE t.excluido = 'N'
         AND t.status = 'SIM'
         AND t.id_usuario = ?
       ORDER BY e.Razao_empresa`,
      [String(user.idusuario)]
    );

    res.json({
      ok: true,
      empresas,
      empresapadrao:   user.empresapadrao   || null,
      mudarempresa:    perf.mudarempresa    || 'S',
      alterarservidor: perf.alterarservidor || 'N',
    });
  } catch (err) {
    console.error('empresas-usuario error:', err.message);
    res.json({ ok: false, empresas: [], erro: err.message });
  }
});

// GET /api/auth/mensalidade — verifica status da licença (VerificaMensalidade do Delphi)
router.get('/mensalidade', async (req, res) => {
  try {
    const pool = getPool();
    const result = await checkMensalidade(pool);
    res.json(result);
  } catch (err) {
    res.json({ bloqueado: false, aviso: false });
  }
});

// POST /api/auth/liberar — insere código de liberação (btnConfirmar1Click do Delphi)
router.post('/liberar', async (req, res) => {
  const { codigo_liberacao } = req.body;
  if (!codigo_liberacao) return res.status(400).json({ error: 'Código obrigatório' });

  try {
    const pool = getPool();
    const [result] = await pool.query(
      `UPDATE liberacoes SET data_pagto = CURDATE(), situacao = 'PAGO'
       WHERE codigo_liberacao = ?`,
      [codigo_liberacao]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Código não encontrado' });
    }
    res.json({ ok: true, message: 'Licença liberada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ user: decoded });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

// GET /api/auth/minhas-permissoes
// Retorna permissões completas do usuário logado (incluindo acessar_configuracoes)
router.get('/minhas-permissoes', async (req, res) => {
  const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT p.acessar_configuracoes, p.alterar_configuracoes, p.manutencaocadastros,
              p.acessogerenciais, p.acessoperfil, p.mudarempresa, p.tela_usuarios,
              p.alterardatapedido, p.trocarvendedorpedido, p.p_vender
       FROM usuarios u
       INNER JOIN perfil p ON p.id = u.idperfil
       WHERE u.idusuario = ? AND u.excluido = 'N' LIMIT 1`,
      [decoded.id]
    );
    const perm = rows[0] || {};
    // idperfil == 1 é admin, tem tudo
    const isAdmin = decoded.perfil == 1;
    res.json({
      acessar_configuracoes:  isAdmin ? 'S' : (perm.acessar_configuracoes || 'N'),
      alterar_configuracoes:  isAdmin ? 'S' : (perm.alterar_configuracoes || 'N'),
      manutencaocadastros:    isAdmin ? 'S' : (perm.manutencaocadastros   || 'N'),
      gtela_usuarios:         isAdmin ? 'S' : (perm.tela_usuarios         || 'N'),
      mudarempresa:           isAdmin ? 'S' : (perm.mudarempresa          || 'N'),
      alterardatapedido:      isAdmin ? 'S' : (perm.alterardatapedido     || 'N'),
      trocarvendedorpedido:   isAdmin ? 'S' : (perm.trocarvendedorpedido  || 'N'),
      p_vender:               isAdmin ? 'S' : (perm.p_vender              || 'N'),
      isAdmin
    });
  } catch {
    res.status(401).json({ error: 'Token inválido' });
  }
});

// ─── Funções auxiliares ────────────────────────────────────────────────────

async function checkMensalidade(pool) {
  try {
    // Verifica se tabela existe
    const [tables] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'liberacoes'`
    );
    if (!tables[0]?.cnt) return { bloqueado: false, aviso: false, tabela: false };

    // Query idêntica ao Delphi: verifica mensalidades em aberto do mês atual e anterior
    const [rows] = await pool.query(
      `SELECT l.*,
              DATEDIFF(CURDATE(), l.data) AS dias_diferenca,
              CASE WHEN DATEDIFF(CURDATE(), l.data) > 30 THEN 'SIM' ELSE '' END AS sistema_bloqueado,
              CASE WHEN DATEDIFF(CURDATE(), l.data) <= 30 THEN 30 - DATEDIFF(CURDATE(), l.data) ELSE 0 END AS dias_para_bloqueio
       FROM liberacoes l
       WHERE l.data <= CURDATE()
         AND l.situacao = 'AGUARDANDO'
         AND (
           (YEAR(l.data) = YEAR(CURDATE()) AND MONTH(l.data) = MONTH(CURDATE()))
           OR
           (YEAR(l.data) = YEAR(CURDATE()) AND MONTH(l.data) = MONTH(CURDATE()) - 1)
         )`
    );

    if (rows.length === 0) return { bloqueado: false, aviso: false };

    const bloqueado = rows.some(r => r.sistema_bloqueado === 'SIM');
    const maxDias = Math.max(...rows.map(r => r.dias_diferenca || 0));

    return {
      bloqueado,
      aviso: true,
      diasAtraso: maxDias,
      parcelas: rows.length,
      diasParaBloqueio: rows[0]?.dias_para_bloqueio || 0
    };
  } catch {
    return { bloqueado: false, aviso: false };
  }
}

async function registrarTerminal(pool, ip, userAgent, userId, empresaId) {
  try {
    const hostname = `web-${ip.replace(/[.:]/g, '-')}`;
    const [existing] = await pool.query(
      `SELECT id FROM terminais WHERE host_name = ? AND excluido = 'N' LIMIT 1`,
      [hostname]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE terminais SET dt_ultimoacesso = CURDATE(), hora_ultimoacesso = TIME(NOW()),
         empresalogada = ? WHERE host_name = ?`,
        [empresaId || null, hostname]
      );
    } else {
      await pool.query(
        `INSERT INTO terminais (host_name, ip, versao, dt_ultimoacesso, hora_ultimoacesso, empresalogada, excluido)
         VALUES (?, ?, '1.0.0', CURDATE(), TIME(NOW()), ?, 'N')`,
        [hostname, ip, empresaId || null]
      );
    }
  } catch { /* silencioso */ }
}

// Constrói objeto de permissões (PermissaoOperacao do Delphi)
function buildPermissoes(user) {
  const isAdmin = user.idperfil == 1;
  const s = (field) => isAdmin ? 'S' : (user[field] || 'N');

  return {
    // Pedidos de venda
    incluir_pedvendas: s('incluir_pedvendas'),
    alterar_pedvendas: s('alterar_pedvendas'),
    excluir_pedvendas: s('excluir_pedvendas'),
    // Clientes
    incluir_clientes: s('incluir_clientes'),
    alterar_clientes: s('alterar_clientes'),
    excluir_clientes: s('exclui_clientes'),
    // Fornecedores
    incluir_fornecedor: s('incluir_fornecedor'),
    alterar_fornecedor: s('alterar_fornecedor'),
    excluir_fornecedor: s('excluir_fornecedor'),
    // Produtos
    incluir_produtos: s('incluir_produtos'),
    alterar_produtos: s('alterar_produtos'),
    excluir_produtos: s('excluir_produtos'),
    // Gerais
    p_vender: s('p_vender'),
    p_comprar: isAdmin ? 'S' : (user.p_comprar || 'N'),
    acessogerenciais: s('acessogerenciais'),
    manutencaocadastros: s('manutencaocadastros'),
    acessartodosclientes: s('acessartodosclientes'),
    mudarempresa: isAdmin ? 'S' : (user.mudarempresa || 'N'),
    alterarbase: isAdmin ? 'S' : (user.alterarbase || 'N'),
    acesso_financeiro: isAdmin ? 'S' : (user.acesso_financeiro || 'N'),
    acessoperfil: isAdmin ? 'S' : (user.acessoperfil || 'N'),
    gtela_usuarios: s('tela_usuarios'),
    // Pedidos — permissões adicionais
    alteraprecovenda: isAdmin ? 'S' : (user.alteraprecovenda || 'S'),
    alertarpainelempresapedvenda: s('alertarpainelempresapedvenda'),
    habilitapuxada: isAdmin ? 'S' : (user.habilitapuxada || 'N'),
  };
}

module.exports = router;
module.exports.checkMensalidade = checkMensalidade;
