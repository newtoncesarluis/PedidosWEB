const express = require('express');
const router  = express.Router();
const { getPool, runWithRequestPool } = require('../config/database');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// ─── Multer: upload de fotos do cliente ───────────────────────────────────────
const _uploadsBase = path.join(process.cwd(), 'public', 'uploads', 'clientes');
const _storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(_uploadsBase, String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${base}${ext}`);
  }
});
const upload = multer({
  storage: _storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(jpg|jpeg|png|gif|webp|bmp|svg|pdf)$/i.test(file.originalname);
    cb(ok ? null : new Error('Tipo de arquivo não permitido'), ok);
  }
});

function _permCli(req) {
  const isAdmin = req.user?.perfil == 1;
  const p = req.user?.permissoes || {};
  const s = (k) => (isAdmin ? 'S' : (p[k] || 'N'));
  return {
    isAdmin,
    ver: s('gtela_clientes'),
    incluir: s('incluir_clientes'),
    alterar: s('alterar_clientes'),
    excluir: s('excluir_clientes'),
  };
}

function _negarCli(res, msg) {
  return res.status(403).json({ error: msg || 'Sem permissão' });
}

let _temClienteFotos = null;

async function temClienteFotos(pool) {
  if (_temClienteFotos !== null) return _temClienteFotos;
  try {
    const [r] = await pool.query("SHOW TABLES LIKE 'cliente_fotos'");
    _temClienteFotos = r.length > 0;
  } catch {
    _temClienteFotos = false;
  }
  return _temClienteFotos;
}

function normalizarCaminhoFoto(caminho) {
  if (!caminho) return null;
  const cam = String(caminho).trim();
  if (!cam) return null;
  return cam.startsWith('/') ? cam : '/' + cam;
}

const FOTO_CLIENTE_SUBQUERY = `(SELECT cf.caminho
     FROM cliente_fotos cf
    WHERE cf.cod_cliente = c.id
      AND (cf.excluido = 'N' OR cf.excluido IS NULL OR cf.excluido = '')
      AND cf.caminho IS NOT NULL AND cf.caminho <> ''
    ORDER BY (UPPER(COALESCE(cf.tipo_imagem, '')) = 'LOGO') DESC,
             (cf.principal = 'S') DESC, cf.id ASC
    LIMIT 1) AS foto_principal`;

async function resolveClienteFotoPrincipal(pool, idCliente) {
  if (!(await temClienteFotos(pool))) return null;
  try {
    const [rows] = await pool.query(
      `SELECT caminho, tipo_imagem, principal
       FROM cliente_fotos
       WHERE cod_cliente = ? AND (excluido = 'N' OR excluido IS NULL OR excluido = '')
         AND caminho IS NOT NULL AND caminho <> ''
       ORDER BY (UPPER(COALESCE(tipo_imagem, '')) = 'LOGO') DESC,
                (principal = 'S') DESC, id ASC
       LIMIT 1`,
      [idCliente]
    );
    return normalizarCaminhoFoto(rows[0]?.caminho);
  } catch {
    return null;
  }
}

async function salvarVinculosTabelas(pool, clienteId, tabelasPreco) {
  if (!Array.isArray(tabelasPreco)) return;
  try {
    await pool.query(
      `DELETE FROM tabela_preco_vinculo WHERE id_entidade = ? AND tipo_entidade = 'CLIENTE'`,
      [clienteId]
    );
    for (const t of tabelasPreco) {
      if (t.check) {
        await pool.query(
          `INSERT INTO tabela_preco_vinculo (id_entidade, id_tabela, tipo_entidade, excluido) VALUES (?, ?, 'CLIENTE', 'N')`,
          [clienteId, t.id_tabela || t.id]
        );
      }
    }
  } catch(e) {}
}

// ─── GET /api/clientes ────────────────────────────────────────────────────────
// Query params: q (busca), status (A|I|todos), limit, offset
router.get('/', async (req, res) => {
  try {
    const pool   = getPool();
    const { q = '', status = 'A', limit = 100, offset = 0,
            tipo_cliente = '', cidade = '', sem_compra_dias = '', suspensa = '',
            id_regiao = '', lat, lng, raio = 50 } = req.query;

    let where = [`(c.excluido = 'N' OR c.excluido IS NULL OR c.excluido = '')`];
    const vals = [];

    // ── Filtro de visibilidade por perfil ─────────────────────────────────────
    const userId  = req.user?.id;
    const perm    = req.user?.permissoes || {};
    const isAdmin = req.user?.perfil == 1;
    const acessaTodos   = isAdmin ? 'S' : (perm.acessartodosclientes || '');
    const eGerente      = !isAdmin && perm.gerentecomercial === 'S';

    if (!isAdmin && acessaTodos === 'N') {
      if (eGerente) {
        // Gerente vê os próprios clientes + clientes da equipe subordinada
        where.push(`(c.cod_vendedor = ? OR c.cod_vendedor IN (SELECT idusuario FROM usuarios WHERE id_gerente = ? AND excluido = 'N'))`);
        vals.push(userId, userId);
      } else {
        // Vendedor padrão: só seus clientes (ou sem vínculo)
        where.push(`(c.cod_vendedor IS NULL OR c.cod_vendedor = '' OR c.cod_vendedor = ?)`);
        vals.push(userId);
      }
    }
    // acessaTodos = 'S' ou '' → sem filtro adicional

    if (status === 'A') { where.push(`(c.status = 'A' OR c.status IS NULL OR c.status = '')`); }
    else if (status === 'I') { where.push(`c.status = 'I'`); }

    if (q.trim()) {
      where.push(`(LOWER(c.nome) LIKE ? OR LOWER(c.apelido) LIKE ? OR c.cpf LIKE ? OR c.foneprincipal LIKE ? OR LOWER(c.cidade) LIKE ? OR LOWER(c.bairro) LIKE ?)`);
      const like = `%${q.trim().toLowerCase()}%`;
      vals.push(like, like, like, like, like, like);
    }

    if (tipo_cliente.trim()) {
      where.push(`LOWER(c.tipo_cliente) LIKE ?`);
      vals.push(`%${tipo_cliente.trim().toLowerCase()}%`);
    }

    if (cidade.trim()) {
      where.push(`LOWER(c.cidade) LIKE ?`);
      vals.push(`%${cidade.trim().toLowerCase()}%`);
    }

    if (sem_compra_dias && parseInt(sem_compra_dias) > 0) {
      const dtLimite = new Date();
      dtLimite.setDate(dtLimite.getDate() - parseInt(sem_compra_dias));
      where.push(`(c.dtultimacompra IS NULL OR c.dtultimacompra < ?)`);
      vals.push(dtLimite.toISOString().slice(0,10));
    }

    if (suspensa === 'S') {
      where.push(`c.venda_suspensa = 'S'`);
    }

    if (id_regiao && parseInt(id_regiao) > 0) {
      where.push(`c.regiao = ?`);
      vals.push(parseInt(id_regiao));
    }

    let distanceCol = "";
    let selectVals = [];
    if (lat && lng) {
      distanceCol = `, (6371 * acos(cos(radians(?)) * cos(radians(c.latitude)) * cos(radians(c.longitude) - radians(?)) + sin(radians(?)) * sin(radians(c.latitude)))) AS distancia`;
      selectVals = [lat, lng, lat];
      
      where.push(`(6371 * acos(cos(radians(?)) * cos(radians(c.latitude)) * cos(radians(c.longitude) - radians(?)) + sin(radians(?)) * sin(radians(c.latitude)))) <= ?`);
      vals.push(lat, lng, lat, parseFloat(raio));
    }

    const whereClause = where.join(' AND ');
    const comFotos = await temClienteFotos(pool);
    const fotoCol = comFotos ? `, ${FOTO_CLIENTE_SUBQUERY}` : '';

    const [rows] = await pool.query(
      `SELECT c.id, c.nome, c.apelido, c.tipo_pessoa, c.cpf, c.foneprincipal, c.fonesecundario,
              c.email, c.cidade, c.uf, c.bairro, c.status, c.dtultimacompra, c.dtcadastro,
              c.tipo_cliente, c.segmento, c.cod_vendedor, u.nomeusu AS nome_vendedor,
              c.credito, c.desconto, c.conceitocliente, c.venda_suspensa,
              (SELECT COUNT(p.id) FROM pedidos p WHERE p.cod_cliente = c.id AND COALESCE(p.excluido, 'N') = 'N') as total_pedidos
              ${fotoCol}
              ${distanceCol}
        FROM clientes c
       LEFT JOIN usuarios u ON u.idusuario = c.cod_vendedor AND u.excluido = 'N'
       WHERE ${whereClause}
       ORDER BY ${lat && lng ? 'distancia ASC' : 'c.nome'}
       LIMIT ? OFFSET ?`,
      [...selectVals, ...vals, parseInt(limit), parseInt(offset)]
    );

    if (comFotos) {
      rows.forEach(r => { r.foto_principal = normalizarCaminhoFoto(r.foto_principal); });
    }

    const [total] = await pool.query(
      `SELECT COUNT(*) AS total FROM clientes c WHERE ${whereClause}`,
      vals
    );

    res.json({ clientes: rows, total: total[0].total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/check-cnpj ────────────────────────────────────────────
// Query params: cpf (obrigatório), excluir_id (opcional — id do cliente em edição)
// Retorna: { permiteDuplicado, duplicado, cliente }
router.get('/check-cnpj', async (req, res) => {
  try {
    const pool  = getPool();
    const { cpf, excluir_id } = req.query;

    if (!cpf?.trim()) return res.status(400).json({ error: 'CPF/CNPJ obrigatório' });

    // Verifica parâmetro gpermitecnpjduplicadoclientes na tabela sistemas
    const [sysRows] = await pool.query(
      `SELECT gpermitecnpjduplicadoclientes FROM sistemas ORDER BY id DESC LIMIT 1`
    ).catch(() => [[]]);

    const permite = (sysRows[0]?.gpermitecnpjduplicadoclientes || 'S').toUpperCase();

    // Se permite duplicados, não precisa checar
    if (permite === 'S') {
      return res.json({ permiteDuplicado: true, duplicado: false, cliente: null });
    }

    // Busca cliente com mesmo CPF/CNPJ (excluindo o próprio em caso de edição)
    const docLimpo = cpf.replace(/\D/g, '');
    let sql    = `SELECT id, nome, apelido, cpf, foneprincipal, cidade, uf, status
                  FROM clientes
                  WHERE REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),'/','') = ?
                    AND (excluido = 'N' OR excluido IS NULL OR excluido = '')`;
    const vals = [docLimpo];

    if (excluir_id) {
      sql += ` AND id <> ?`;
      vals.push(parseInt(excluir_id, 10));
    }

    sql += ` LIMIT 1`;

    const [rows] = await pool.query(sql, vals);

    if (rows[0]) {
      return res.json({ permiteDuplicado: false, duplicado: true, cliente: rows[0] });
    }

    res.json({ permiteDuplicado: false, duplicado: false, cliente: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/lookup/vendedores ──────────────────────────────────────
router.get('/lookup/vendedores', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT idusuario AS id, nomeusu AS nome FROM usuarios WHERE excluido='N' AND vendedor='S' ORDER BY nomeusu`
    ).catch(() => [[]]);
    res.json({ vendedores: rows });
  } catch (err) {
    res.json({ vendedores: [] });
  }
});

// ─── GET /api/clientes/notificacoes ──────────────────────────────────────────
router.get('/notificacoes', async (req, res) => {
  try {
    const pool = getPool();
    const hoje = new Date();
    const dias90 = new Date(hoje); dias90.setDate(dias90.getDate() - 90);
    const proximos7 = new Date(hoje); proximos7.setDate(hoje.getDate() + 7);

    const [inat90] = await pool.query(`
      SELECT COUNT(*) AS total FROM clientes
      WHERE (excluido='N' OR excluido IS NULL OR excluido='')
        AND (status='A' OR status IS NULL OR status='')
        AND (dtultimacompra IS NULL OR dtultimacompra < ?)
    `, [dias90.toISOString().slice(0,10)]).catch(() => [[{total:0}]]);

    const mesH = hoje.getMonth() + 1;
    const diaH = hoje.getDate();
    const mesP = proximos7.getMonth() + 1;
    const diaP = proximos7.getDate();
    let aniSql, aniVals;
    if (mesH === mesP) {
      aniSql  = `SELECT id, nome, dtnascimento FROM clientes WHERE (excluido='N' OR excluido IS NULL OR excluido='') AND dtnascimento IS NOT NULL AND MONTH(dtnascimento)=? AND DAY(dtnascimento) BETWEEN ? AND ? ORDER BY DAY(dtnascimento) LIMIT 20`;
      aniVals = [mesH, diaH, diaP];
    } else {
      aniSql  = `SELECT id, nome, dtnascimento FROM clientes WHERE (excluido='N' OR excluido IS NULL OR excluido='') AND dtnascimento IS NOT NULL AND ((MONTH(dtnascimento)=? AND DAY(dtnascimento)>=?) OR (MONTH(dtnascimento)=? AND DAY(dtnascimento)<=?)) ORDER BY MONTH(dtnascimento),DAY(dtnascimento) LIMIT 20`;
      aniVals = [mesH, diaH, mesP, diaP];
    }
    const [aniversarios] = await pool.query(aniSql, aniVals).catch(() => [[]]);

    const [novos] = await pool.query(`
      SELECT COUNT(*) AS total FROM clientes
      WHERE (excluido='N' OR excluido IS NULL OR excluido='') AND dtcadastro >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
    `).catch(() => [[{total:0}]]);

    res.json({
      inativos90dias: inat90[0]?.total || 0,
      aniversarios: aniversarios || [],
      novos7dias: novos[0]?.total || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/aniversariantes ───────────────────────────────────────
router.get('/aniversariantes', async (req, res) => {
  try {
    const pool = getPool();
    const dias = Math.min(Math.max(parseInt(req.query.dias || 30, 10), 1), 90);
    const hoje = new Date();
    const fim = new Date(hoje);
    fim.setDate(hoje.getDate() + dias);

    const mesH = hoje.getMonth() + 1, diaH = hoje.getDate();
    const mesF = fim.getMonth() + 1, diaF = fim.getDate();

    let sql, vals;
    if (mesH === mesF) {
      sql  = `SELECT id, nome, apelido, dtnascimento, foneprincipal AS celular, cidade, uf
              FROM clientes
              WHERE (excluido='N' OR excluido IS NULL OR excluido='')
                AND dtnascimento IS NOT NULL
                AND MONTH(dtnascimento)=? AND DAY(dtnascimento) BETWEEN ? AND ?
              ORDER BY DAY(dtnascimento) LIMIT 100`;
      vals = [mesH, diaH, diaF];
    } else {
      sql  = `SELECT id, nome, apelido, dtnascimento, foneprincipal AS celular, cidade, uf
              FROM clientes
              WHERE (excluido='N' OR excluido IS NULL OR excluido='')
                AND dtnascimento IS NOT NULL
                AND ((MONTH(dtnascimento)=? AND DAY(dtnascimento)>=?)
                  OR (MONTH(dtnascimento)=? AND DAY(dtnascimento)<=?))
              ORDER BY MONTH(dtnascimento), DAY(dtnascimento) LIMIT 100`;
      vals = [mesH, diaH, mesF, diaF];
    }

    const [rows] = await pool.query(sql, vals);
    const hoje_mes = mesH, hoje_dia = diaH;
    const result = rows.map(r => {
      const dt = r.dtnascimento ? new Date(r.dtnascimento) : null;
      const mes = dt ? dt.getUTCMonth() + 1 : null;
      const dia = dt ? dt.getUTCDate() : null;
      const hoje_aniver = mes === hoje_mes && dia === hoje_dia;
      const dias_faltam = (() => {
        if (!dt) return null;
        const thisYear = hoje.getFullYear();
        let aniver = new Date(thisYear, mes - 1, dia);
        if (aniver < hoje) aniver = new Date(thisYear + 1, mes - 1, dia);
        return Math.round((aniver - hoje) / 86400000);
      })();
      return { ...r, hoje_aniver, dias_faltam };
    });
    res.json({ clientes: result, total: result.length, dias });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/:id ────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM clientes WHERE id = ? AND (excluido = 'N' OR excluido IS NULL OR excluido = '') LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Cliente não encontrado' });
    const row = rows[0];
    row.foto_principal = await resolveClienteFotoPrincipal(pool, row.id);
    let tabelasPreco = [];
    try {
      const [vinc] = await pool.query(
        `SELECT id_tabela FROM tabela_preco_vinculo WHERE id_entidade = ? AND tipo_entidade = 'CLIENTE' AND excluido = 'N'`,
        [req.params.id]
      );
      tabelasPreco = vinc;
    } catch(e) {}
    res.json({ ...row, tabelasPreco });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/clientes ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const pc = _permCli(req);
    if (pc.incluir !== 'S') return _negarCli(res, 'Sem permissão para incluir clientes');
    const pool  = getPool();
    const body  = req.body;

    // Campos essenciais
    if (!body.nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });

    const campos = [
      'tipo_pessoa','tipo_cadastro','codigo_cliente',
      'nome','apelido','cpf','rg','sexo','dtnascimento',
      'cep','endereco','numero_end','bairro','cidade','uf','complemento',
      'foneprincipal','fonesecundario','celularcomprador','contato','email',
      'tipo_cliente','segmento','cod_segmento','zonavenda',
      'conceitocliente','diapgt','cod_vendedor',
      'credito','desconto','status','obsendereco','obsgerais',
      'venda_suspensa','skype','site','instragam','facebook','linkedin',
      'cobrast','icms','ipi','regiao',
      'formapagto','condicaopagto','prazopagto',
      'endereco_faturamento','bairro_faturamento','cidade_faturamento',
      'cep_faturamento','uf_faturamento',
      'telefone1_faturamento','telefone2_faturamento',
      'contato_recebedor','contato_financeiro',
      'clienteprincipal','cod_clienteprincipal','nomeclienteprincipal',
      'lembrete','possuilembrete',
      'id_ramoatividades','ramoatividades',
      'tipodocumento','id_empresa',
      'latitude','longitude',
      'data_situacaocnpj','data_abertura','porte','tipo_cnpj','natureza',
      'capital_social','atividadeprincipal','atividadesecundaria','quadrosocios',
      'numsocios','numalteracoes','dt_ultialteracoes','rj_comercial',
      'numerosulframa','imprimirsuframaped','descontoIPIsuframaped','calcularipiimpressao'
    ].filter(c => body[c] !== undefined);

    if (campos.length === 0) return res.status(400).json({ error: 'Nenhum campo enviado' });

    const colNames  = campos.map(c => `\`${c}\``).join(', ');
    const placeholders = campos.map(() => '?').join(', ');
    const values  = campos.map(c => body[c] !== undefined ? body[c] : null);

    // Garante status padrão
    const statusIdx = campos.indexOf('status');
    let newId;
    if (statusIdx === -1) {
      campos.push('status');
      const finalCols  = campos.map(c => `\`${c}\``).join(', ');
      const finalPH    = campos.map(() => '?').join(', ');
      values.push('A');
      const [result] = await pool.query(
        `INSERT INTO clientes (${finalCols}, excluido, dtcadastro) VALUES (${finalPH}, 'N', CURDATE())`,
        values
      );
      newId = result.insertId;
    } else {
      const [result] = await pool.query(
        `INSERT INTO clientes (${colNames}, excluido, dtcadastro) VALUES (${placeholders}, 'N', CURDATE())`,
        values
      );
      newId = result.insertId;
    }
    await salvarVinculosTabelas(pool, newId, body.tabelasPreco);
    res.status(201).json({ ok: true, id: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/clientes/:id ────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const pc = _permCli(req);
    if (pc.alterar !== 'S') return _negarCli(res, 'Sem permissão para alterar clientes');
    const pool  = getPool();
    const body  = req.body;
    const { id } = req.params;

    // Verifica se o registro existe antes de atualizar
    const [existing] = await pool.query(
      `SELECT id FROM clientes WHERE id = ? AND (excluido = 'N' OR excluido IS NULL OR excluido = '') LIMIT 1`,
      [id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'Cliente não encontrado' });

    if (!body.nome?.trim()) return res.status(400).json({ error: 'Nome obrigatório' });

    const campos = [
      'tipo_pessoa','tipo_cadastro','codigo_cliente',
      'nome','apelido','cpf','rg','sexo','dtnascimento',
      'cep','endereco','numero_end','bairro','cidade','uf','complemento',
      'foneprincipal','fonesecundario','celularcomprador','contato','email',
      'tipo_cliente','segmento','cod_segmento','zonavenda',
      'conceitocliente','diapgt','cod_vendedor',
      'credito','desconto','status','obsendereco','obsgerais',
      'venda_suspensa','skype','site','instragam','facebook','linkedin',
      'cobrast','icms','ipi','regiao',
      'formapagto','condicaopagto','prazopagto',
      'endereco_faturamento','bairro_faturamento','cidade_faturamento',
      'cep_faturamento','uf_faturamento',
      'telefone1_faturamento','telefone2_faturamento',
      'contato_recebedor','contato_financeiro',
      'clienteprincipal','cod_clienteprincipal','nomeclienteprincipal',
      'lembrete','possuilembrete',
      'id_ramoatividades','ramoatividades',
      'tipodocumento','id_empresa',
      'latitude','longitude',
      'data_situacaocnpj','data_abertura','porte','tipo_cnpj','natureza',
      'capital_social','atividadeprincipal','atividadesecundaria','quadrosocios',
      'numsocios','numalteracoes','dt_ultialteracoes','rj_comercial',
      'numerosulframa','imprimirsuframaped','descontoIPIsuframaped','calcularipiimpressao'
    ].filter(c => body[c] !== undefined);

    if (campos.length === 0) return res.status(400).json({ error: 'Nenhum campo para atualizar' });

    const setClause = campos.map(c => `\`${c}\`=?`).join(', ');
    const values    = [...campos.map(c => body[c] !== undefined ? body[c] : null), id];

    await pool.query(
      `UPDATE clientes SET ${setClause}, dtalterado=NOW() WHERE id=?`,
      values
    );
    await salvarVinculosTabelas(pool, id, body.tabelasPreco);
    res.json({ ok: true, id: parseInt(id, 10) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/clientes/:id/ativar ─────────────────────────────────────────────
router.put('/:id/ativar', async (req, res) => {
  try {
    const pc = _permCli(req);
    if (pc.alterar !== 'S') return _negarCli(res, 'Sem permissão para alterar clientes');
    const pool = getPool();
    await pool.query(`UPDATE clientes SET status='A', dtalterado=NOW() WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /api/clientes/:id/inativar ──────────────────────────────────────────
router.put('/:id/inativar', async (req, res) => {
  try {
    const pc = _permCli(req);
    if (pc.alterar !== 'S') return _negarCli(res, 'Sem permissão para alterar clientes');
    const pool = getPool();
    await pool.query(`UPDATE clientes SET status='I', dtalterado=NOW() WHERE id=?`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/clientes/:id (soft delete) ───────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const pc = _permCli(req);
    if (pc.excluir !== 'S') return _negarCli(res, 'Sem permissão para excluir clientes');
    const pool = getPool();
    await pool.query(
      `UPDATE clientes SET excluido='S', status='E', dtalterado=NOW() WHERE id=?`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/:id/financeiro ─────────────────────────────────────────
router.get('/:id/financeiro', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT r.status, r.vencimento, r.valor, p.forma_pagto, p.data_abertura, p.numero as pedido
      FROM receber r
      INNER JOIN pedidos p ON r.numero = p.numero
      WHERE p.cod_cliente = ? AND (p.excluido = 'N' OR p.excluido IS NULL)
      ORDER BY r.vencimento DESC
      LIMIT 50
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PATCH /api/clientes/:id — atualiza campos pontuais (dnd, etc.) ───────────
const PATCH_CAMPOS_PERMITIDOS = new Set(['dnd', 'venda_suspensa']);
router.patch('/:id', async (req, res) => {
  try {
    const pc = _permCli(req);
    if (pc.alterar !== 'S') return _negarCli(res, 'Sem permissão para alterar clientes');
    const pool = getPool();
    const campos = Object.keys(req.body).filter(k => PATCH_CAMPOS_PERMITIDOS.has(k));
    if (!campos.length) return res.status(400).json({ error: 'Nenhum campo permitido informado' });
    const sets = campos.map(k => `\`${k}\` = ?`).join(', ');
    const vals = campos.map(k => req.body[k]);
    await pool.query(
      `UPDATE clientes SET ${sets}, dtalterado = NOW() WHERE id = ?`,
      [...vals, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/:id/ligacoes ──────────────────────────────────────────
router.get('/:id/ligacoes', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT ch.id, ch.data_hora_inicio, ch.data_hora_fim, ch.duracao_seg,
             ch.resultado, ch.observacao, ch.id_pedido, ch.id_lead,
             tc.nome AS nome_campanha,
             u.nomeusu AS nome_operador
      FROM tele_chamadas ch
      LEFT JOIN tele_campanhas tc ON tc.id = ch.id_campanha
      LEFT JOIN usuarios u ON u.idusuario = ch.id_operador
      WHERE ch.id_cliente = ?
      ORDER BY ch.data_hora_inicio DESC
      LIMIT 50
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/:id/historico ──────────────────────────────────────────
router.get('/:id/historico', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`
      SELECT id, numero, data_abertura, situacao_pedido, vlrtotalpedido, tipo_pedido
      FROM pedidos
      WHERE cod_cliente = ? AND (excluido = 'N' OR excluido IS NULL)
      ORDER BY data_abertura DESC, id DESC
      LIMIT 20
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/clientes/:id/fotos ─────────────────────────────────────────────
router.get('/:id/fotos', async (req, res) => {
  try {
    if (!(await temClienteFotos(getPool()))) return res.json([]);
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT id, descricao, tipo_imagem AS tipo, principal, caminho
       FROM cliente_fotos
       WHERE cod_cliente = ? AND COALESCE(excluido, 'N') = 'N'
       ORDER BY (UPPER(COALESCE(tipo_imagem, '')) = 'LOGO') DESC,
                (COALESCE(principal, 'N') = 'S') DESC,
                id ASC`,
      [req.params.id]
    ).catch(() => [[]]);
    const out = rows.map((r) => {
      let cam = String(r.caminho || '').trim();
      if (cam && !cam.startsWith('/')) cam = '/' + cam;
      return { ...r, caminho: cam };
    });
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/clientes/:id/fotos — upload de arquivo ────────────────────────
router.post('/:id/fotos', upload.single('arquivo'), async (req, res) => {
  const handler = async () => {
    try {
      const pc = _permCli(req);
      if (pc.alterar !== 'S') return _negarCli(res, 'Sem permissão para alterar clientes');
      if (!req.file) return res.status(400).json({ error: 'Arquivo não enviado' });
      const pool = getPool();
      if (!(await temClienteFotos(pool))) {
        return res.status(503).json({ error: 'Tabela cliente_fotos indisponível. Reinicie o servidor para aplicar migrations.' });
      }
      const { id } = req.params;
      const { descricao, tipo_imagem, principal } = req.body;
      const caminho = `uploads/clientes/${id}/${req.file.filename}`;
      const [result] = await pool.query(
        `INSERT INTO cliente_fotos (cod_cliente, descricao, tipo_imagem, principal, caminho, excluido, dtcadastro)
         VALUES (?, ?, ?, ?, ?, 'N', CURDATE())`,
        [id, descricao || req.file.originalname, tipo_imagem || '', principal || 'N', caminho]
      );
      res.status(201).json({ ok: true, id: result.insertId, caminho: '/' + caminho });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
  try {
    return runWithRequestPool(req, handler);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/clientes/:id/fotos/:fotoId — soft delete ────────────────────
router.delete('/:id/fotos/:fotoId', async (req, res) => {
  try {
    const pc = _permCli(req);
    if (pc.alterar !== 'S') return _negarCli(res, 'Sem permissão para alterar clientes');
    if (!(await temClienteFotos(getPool()))) return res.json({ ok: true });
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT caminho FROM cliente_fotos WHERE id = ? AND cod_cliente = ? AND excluido = 'N' LIMIT 1`,
      [req.params.fotoId, req.params.id]
    );
    if (rows[0]?.caminho) {
      const rel = String(rows[0].caminho).replace(/^\//, '');
      const abs = path.join(process.cwd(), 'public', rel.replace(/\//g, path.sep));
      fs.unlink(abs, () => {});
    }
    await pool.query(`UPDATE cliente_fotos SET excluido = 'S' WHERE id = ?`, [req.params.fotoId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
