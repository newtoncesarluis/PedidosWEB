const express = require('express');
const router = express.Router();
const { getPool } = require('../config/database');

const CAMPOS_DATA = new Set([
  'dt_cadastro', 'dt_atualizacao', 'dt_validade', 'dt_vencimento',
  'data_cadastro', 'data_atualizacao', 'data_nascimento', 'dt_nascimento',
  'dtnascimento', 'data_abertura', 'data_situacaocnpj',
  'dtcadastro', 'dtalterado',
]);
const _MESES = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
function normalizarData(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const ano = new Date().getFullYear();
  const m1 = s.match(/^(?:[A-Za-z]{3}\s+)?([A-Za-z]{3})\s+(\d{1,2})(?:\s+(\d{4}))?$/);
  if (m1) {
    const mi = _MESES.indexOf(m1[1].toLowerCase());
    if (mi >= 0) {
      const y  = m1[3] ? parseInt(m1[3]) : ano;
      const mm = String(mi + 1).padStart(2, '0');
      const dd = String(parseInt(m1[2])).padStart(2, '0');
      return `${y}-${mm}-${dd}`;
    }
  }
  const m2 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m2) {
    return `${m2[3]}-${m2[2].padStart(2,'0')}-${m2[1].padStart(2,'0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  return null;
}

/** Colunas numéricas no BD (após mapeamento de aliases) */
const CAMPOS_NUMERICOS = new Set([
  'cod_vendedor', 'credito', 'diapgt', 'prazopagto', 'desconto', 'capital_social',
]);

/** nome_campo na tela campos_importacao → coluna real em `clientes` (legado vs núcleo Delphi) */
const IMPORT_PARA_COLUNA_CLIENTE = {
  numero: 'numero_end',
  observacoes: 'obsgerais',
  limite_credito: 'credito',
  prazo_pagamento: 'diapgt',
};

function resolverColunaCliente(nomeImport, colunasReais) {
  if (!nomeImport) return null;
  const temDescribe = colunasReais && colunasReais.size > 0;
  if (!temDescribe) return nomeImport;
  if (colunasReais.has(nomeImport)) return nomeImport;
  const alvo = IMPORT_PARA_COLUNA_CLIENTE[nomeImport];
  if (alvo && colunasReais.has(alvo)) return alvo;
  if (nomeImport === 'prazo_pagamento' && colunasReais.has('prazopagto')) return 'prazopagto';
  return null;
}

/** Só filtra colunas contra o DESCRIBE quando ele retornou algo */
function colunaExisteNoBd(c, colunasReais) {
  return !colunasReais?.size || colunasReais.has(c);
}

const DEFAULT_CAMPOS = [
  // ── Identificação principal ──────────────────────────────────────────────────
  { nome_campo: 'nome',                  apelido: 'Nome / Razão Social',        tipo: 'texto',   ordem: 1,  obrigatorio: 'S' },
  { nome_campo: 'apelido',               apelido: 'Apelido / Nome Fantasia',    tipo: 'texto',   ordem: 2,  obrigatorio: 'N' },
  { nome_campo: 'cpf',                   apelido: 'CPF / CNPJ',                 tipo: 'texto',   ordem: 3,  obrigatorio: 'S' },
  { nome_campo: 'rg',                    apelido: 'RG / Insc. Estadual',        tipo: 'texto',   ordem: 4,  obrigatorio: 'N' },
  { nome_campo: 'tipo_pessoa',           apelido: 'Tipo Pessoa (F/J)',           tipo: 'texto',   ordem: 5,  obrigatorio: 'N' },
  { nome_campo: 'tipo_cadastro',         apelido: 'Tipo Cadastro',               tipo: 'texto',   ordem: 6,  obrigatorio: 'N' },
  { nome_campo: 'sexo',                  apelido: 'Sexo',                        tipo: 'texto',   ordem: 7,  obrigatorio: 'N' },
  { nome_campo: 'dtnascimento',          apelido: 'Data de Nascimento',          tipo: 'data',    ordem: 8,  obrigatorio: 'N' },
  { nome_campo: 'data_abertura',         apelido: 'Data de Abertura',            tipo: 'data',    ordem: 9,  obrigatorio: 'N' },
  { nome_campo: 'codigo_cliente',        apelido: 'Código do Cliente',           tipo: 'texto',   ordem: 10, obrigatorio: 'N' },
  // ── Contato ──────────────────────────────────────────────────────────────────
  { nome_campo: 'foneprincipal',         apelido: 'Fone Principal',              tipo: 'texto',   ordem: 11, obrigatorio: 'N' },
  { nome_campo: 'fonesecundario',        apelido: 'Fone Secundário',             tipo: 'texto',   ordem: 12, obrigatorio: 'N' },
  { nome_campo: 'telefone',              apelido: 'Telefone',                    tipo: 'texto',   ordem: 13, obrigatorio: 'N' },
  { nome_campo: 'celularcomprador',      apelido: 'Celular Comprador',           tipo: 'texto',   ordem: 14, obrigatorio: 'N' },
  { nome_campo: 'email',                 apelido: 'E-mail',                      tipo: 'texto',   ordem: 15, obrigatorio: 'N' },
  { nome_campo: 'contato',              apelido: 'Contato',                      tipo: 'texto',   ordem: 16, obrigatorio: 'N' },
  { nome_campo: 'site',                  apelido: 'Site',                        tipo: 'texto',   ordem: 17, obrigatorio: 'N' },
  { nome_campo: 'skype',                 apelido: 'Skype',                       tipo: 'texto',   ordem: 18, obrigatorio: 'N' },
  { nome_campo: 'instragam',             apelido: 'Instagram',                   tipo: 'texto',   ordem: 19, obrigatorio: 'N' },
  { nome_campo: 'facebook',              apelido: 'Facebook',                    tipo: 'texto',   ordem: 20, obrigatorio: 'N' },
  { nome_campo: 'linkedin',              apelido: 'LinkedIn',                    tipo: 'texto',   ordem: 21, obrigatorio: 'N' },
  // ── Endereço principal ───────────────────────────────────────────────────────
  { nome_campo: 'cep',                   apelido: 'CEP',                         tipo: 'texto',   ordem: 22, obrigatorio: 'N' },
  { nome_campo: 'endereco',              apelido: 'Endereço',                    tipo: 'texto',   ordem: 23, obrigatorio: 'N' },
  { nome_campo: 'numero',                apelido: 'Número',                      tipo: 'texto',   ordem: 24, obrigatorio: 'N' },
  { nome_campo: 'bairro',                apelido: 'Bairro',                      tipo: 'texto',   ordem: 25, obrigatorio: 'N' },
  { nome_campo: 'cidade',                apelido: 'Cidade',                      tipo: 'texto',   ordem: 26, obrigatorio: 'N' },
  { nome_campo: 'uf',                    apelido: 'UF',                          tipo: 'texto',   ordem: 27, obrigatorio: 'N' },
  { nome_campo: 'obsendereco',           apelido: 'Obs. Endereço',               tipo: 'texto',   ordem: 28, obrigatorio: 'N' },
  // ── Endereço de faturamento ──────────────────────────────────────────────────
  { nome_campo: 'cnpj_faturamento',      apelido: 'CNPJ Faturamento',            tipo: 'texto',   ordem: 29, obrigatorio: 'N' },
  { nome_campo: 'razao_faturamento',     apelido: 'Razão Social Faturamento',    tipo: 'texto',   ordem: 30, obrigatorio: 'N' },
  { nome_campo: 'fantasia_faturamento',  apelido: 'Fantasia Faturamento',        tipo: 'texto',   ordem: 31, obrigatorio: 'N' },
  { nome_campo: 'insc_faturamento',      apelido: 'Insc. Estadual Faturamento',  tipo: 'texto',   ordem: 32, obrigatorio: 'N' },
  { nome_campo: 'endereco_faturamento',  apelido: 'Endereço Faturamento',        tipo: 'texto',   ordem: 33, obrigatorio: 'N' },
  { nome_campo: 'bairro_faturamento',    apelido: 'Bairro Faturamento',          tipo: 'texto',   ordem: 34, obrigatorio: 'N' },
  { nome_campo: 'cidade_faturamento',    apelido: 'Cidade Faturamento',          tipo: 'texto',   ordem: 35, obrigatorio: 'N' },
  { nome_campo: 'cep_faturamento',       apelido: 'CEP Faturamento',             tipo: 'texto',   ordem: 36, obrigatorio: 'N' },
  { nome_campo: 'uf_faturamento',        apelido: 'UF Faturamento',              tipo: 'texto',   ordem: 37, obrigatorio: 'N' },
  { nome_campo: 'telefone1_faturamento', apelido: 'Tel. 1 Faturamento',          tipo: 'texto',   ordem: 38, obrigatorio: 'N' },
  { nome_campo: 'telefone2_faturamento', apelido: 'Tel. 2 Faturamento',          tipo: 'texto',   ordem: 39, obrigatorio: 'N' },
  { nome_campo: 'contato_recebedor',     apelido: 'Contato Recebedor',           tipo: 'texto',   ordem: 40, obrigatorio: 'N' },
  { nome_campo: 'contato_financeiro',    apelido: 'Contato Financeiro',          tipo: 'texto',   ordem: 41, obrigatorio: 'N' },
  // ── Classificação comercial ──────────────────────────────────────────────────
  { nome_campo: 'cod_vendedor',          apelido: 'Cód. Vendedor',               tipo: 'texto',   ordem: 42, obrigatorio: 'N' },
  { nome_campo: 'segmento',              apelido: 'Segmento',                    tipo: 'texto',   ordem: 43, obrigatorio: 'N' },
  { nome_campo: 'cod_segmento',          apelido: 'Cód. Segmento',               tipo: 'texto',   ordem: 44, obrigatorio: 'N' },
  { nome_campo: 'regiao',                apelido: 'Região',                      tipo: 'texto',   ordem: 45, obrigatorio: 'N' },
  { nome_campo: 'zonavenda',             apelido: 'Zona de Venda',               tipo: 'texto',   ordem: 46, obrigatorio: 'N' },
  { nome_campo: 'tipo_cliente',          apelido: 'Tipo Cliente',                tipo: 'texto',   ordem: 47, obrigatorio: 'N' },
  { nome_campo: 'conceitocliente',       apelido: 'Conceito do Cliente',         tipo: 'texto',   ordem: 48, obrigatorio: 'N' },
  { nome_campo: 'ramoatividades',        apelido: 'Ramo de Atividades',          tipo: 'texto',   ordem: 49, obrigatorio: 'N' },
  // ── Financeiro ───────────────────────────────────────────────────────────────
  { nome_campo: 'limite_credito',        apelido: 'Limite de Crédito',           tipo: 'decimal', ordem: 50, obrigatorio: 'N' },
  { nome_campo: 'desconto',              apelido: 'Desconto (%)',                 tipo: 'decimal', ordem: 51, obrigatorio: 'N' },
  { nome_campo: 'diapgt',                apelido: 'Dia de Pagamento',             tipo: 'numero',  ordem: 52, obrigatorio: 'N' },
  { nome_campo: 'condicaopagto',         apelido: 'Condição de Pagamento',       tipo: 'texto',   ordem: 53, obrigatorio: 'N' },
  { nome_campo: 'formapagto',            apelido: 'Forma de Pagamento',          tipo: 'texto',   ordem: 54, obrigatorio: 'N' },
  { nome_campo: 'prazopagto',            apelido: 'Prazo de Pagamento',          tipo: 'texto',   ordem: 55, obrigatorio: 'N' },
  { nome_campo: 'cobrast',               apelido: 'Cobr. ST (S/N)',               tipo: 'texto',   ordem: 56, obrigatorio: 'N' },
  { nome_campo: 'ipi',                   apelido: 'IPI (S/N)',                    tipo: 'texto',   ordem: 57, obrigatorio: 'N' },
  { nome_campo: 'icms',                  apelido: 'ICMS',                        tipo: 'texto',   ordem: 58, obrigatorio: 'N' },
  { nome_campo: 'calcularipiimpressao',  apelido: 'Calc. IPI Impressão (S/N)',    tipo: 'texto',   ordem: 59, obrigatorio: 'N' },
  // ── Fiscal / Suframa ─────────────────────────────────────────────────────────
  { nome_campo: 'tipodocumento',         apelido: 'Tipo Documento',              tipo: 'texto',   ordem: 60, obrigatorio: 'N' },
  { nome_campo: 'porte',                 apelido: 'Porte',                       tipo: 'texto',   ordem: 61, obrigatorio: 'N' },
  { nome_campo: 'tipo_cnpj',             apelido: 'Tipo CNPJ',                   tipo: 'texto',   ordem: 62, obrigatorio: 'N' },
  { nome_campo: 'natureza',              apelido: 'Natureza Jurídica',            tipo: 'texto',   ordem: 63, obrigatorio: 'N' },
  { nome_campo: 'capital_social',        apelido: 'Capital Social',              tipo: 'decimal', ordem: 64, obrigatorio: 'N' },
  { nome_campo: 'situacaocnpj',          apelido: 'Situação CNPJ',               tipo: 'texto',   ordem: 65, obrigatorio: 'N' },
  { nome_campo: 'data_situacaocnpj',     apelido: 'Data Situação CNPJ',          tipo: 'data',    ordem: 66, obrigatorio: 'N' },
  { nome_campo: 'atividadeprincipal',    apelido: 'Atividade Principal',         tipo: 'texto',   ordem: 67, obrigatorio: 'N' },
  { nome_campo: 'atividadesecundaria',   apelido: 'Atividade Secundária',        tipo: 'texto',   ordem: 68, obrigatorio: 'N' },
  { nome_campo: 'quadrosocios',          apelido: 'Quadro de Sócios',            tipo: 'texto',   ordem: 69, obrigatorio: 'N' },
  { nome_campo: 'numsocios',             apelido: 'Nº de Sócios',                tipo: 'texto',   ordem: 70, obrigatorio: 'N' },
  { nome_campo: 'numalteracoes',         apelido: 'Nº de Alterações',            tipo: 'texto',   ordem: 71, obrigatorio: 'N' },
  { nome_campo: 'imprimirsuframaped',    apelido: 'Imprimir Suframa no Ped. (S/N)', tipo: 'texto', ordem: 72, obrigatorio: 'N' },
  { nome_campo: 'descontoIPIsuframaped', apelido: 'Desc. IPI Suframa (S/N)',     tipo: 'texto',   ordem: 73, obrigatorio: 'N' },
  { nome_campo: 'numerosulframa',        apelido: 'Nº Suframa',                  tipo: 'texto',   ordem: 74, obrigatorio: 'N' },
  { nome_campo: 'ufpadraocadastros',     apelido: 'UF Padrão Cadastros',         tipo: 'texto',   ordem: 75, obrigatorio: 'N' },
  { nome_campo: 'rj_comercial',          apelido: 'Referência Comercial',        tipo: 'texto',   ordem: 76, obrigatorio: 'N' },
  // ── Relacionamento entre clientes ────────────────────────────────────────────
  { nome_campo: 'clienteprincipal',      apelido: 'É Cliente Principal (S/N)',    tipo: 'texto',   ordem: 77, obrigatorio: 'N' },
  { nome_campo: 'cod_clienteprincipal',  apelido: 'Cód. Cliente Principal',      tipo: 'texto',   ordem: 78, obrigatorio: 'N' },
  { nome_campo: 'nomeclienteprincipal',  apelido: 'Nome Cliente Principal',      tipo: 'texto',   ordem: 79, obrigatorio: 'N' },
  // ── Observações / Geral ──────────────────────────────────────────────────────
  { nome_campo: 'observacoes',           apelido: 'Observações Gerais',          tipo: 'texto',   ordem: 80, obrigatorio: 'N' },
  { nome_campo: 'venda_suspensa',        apelido: 'Venda Suspensa (S/N)',        tipo: 'texto',   ordem: 81, obrigatorio: 'N' },
  { nome_campo: 'status',                apelido: 'Status (A/I)',                tipo: 'texto',   ordem: 82, obrigatorio: 'N' },
  { nome_campo: 'latitude',              apelido: 'Latitude',                    tipo: 'texto',   ordem: 83, obrigatorio: 'N' },
  { nome_campo: 'longitude',             apelido: 'Longitude',                   tipo: 'texto',   ordem: 84, obrigatorio: 'N' },
];

async function ensureDefaultCampos(pool) {
  for (const c of DEFAULT_CAMPOS) {
    await pool.query(
      `INSERT INTO campos_importacao (tabela, nome_campo, apelido, tipo, ordem, obrigatorio, excluido)
       SELECT 'cliente', ?, ?, ?, ?, ?, 'N' FROM DUAL
       WHERE NOT EXISTS (
         SELECT 1 FROM campos_importacao WHERE tabela = 'cliente' AND nome_campo = ?
       )`,
      [c.nome_campo, c.apelido, c.tipo, c.ordem, c.obrigatorio, c.nome_campo]
    ).catch(() => {});
  }
}

// GET /campos-importacao
router.get('/campos-importacao', async (req, res) => {
  try {
    const pool = getPool();
    await ensureDefaultCampos(pool);
    const [campos] = await pool.query(
      `SELECT * FROM campos_importacao WHERE tabela = 'cliente' AND excluido = 'N' ORDER BY ordem ASC, id ASC`
    ).catch(() => [[]]);
    res.json({ ok: true, campos });
  } catch (err) {
    console.error('[importacao-clientes/campos-importacao]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// POST /verificar-lote
router.post('/verificar-lote', async (req, res) => {
  const rows = req.body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.json({ ok: false, msg: 'Nenhuma linha enviada.' });
  }
  try {
    const pool = getPool();
    const resultado = [];

    const cpfsLimpos = rows.map(r => String(r.cpf ?? '').trim().replace(/[.\-\/\s]/g, ''));
    const uniq = [...new Set(cpfsLimpos.filter(Boolean))];

    if (uniq.length === 0) {
      for (const r of rows) {
        resultado.push({ idx: r.idx, status_cadastro: 'N', status: 'SC', cod_registro: '', msg: 'CPF/CNPJ vazio' });
      }
      return res.json({ ok: true, resultado });
    }

    const placeholders = uniq.map(() => '?').join(',');
    const [dbRows] = await pool.query(
      `SELECT id, REPLACE(REPLACE(REPLACE(COALESCE(cpf,''), '.', ''), '-', ''), '/', '') AS cpf_limpo
       FROM clientes
       WHERE (excluido = 'N' OR excluido IS NULL)
       AND REPLACE(REPLACE(REPLACE(COALESCE(cpf,''), '.', ''), '-', ''), '/', '') IN (${placeholders})`,
      uniq
    ).catch(() => [[]]);

    const mapa = {};
    for (const row of dbRows) {
      mapa[String(row.cpf_limpo).trim()] = row;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const cpfLimpo = cpfsLimpos[i];
      if (!cpfLimpo) {
        resultado.push({ idx: r.idx, status_cadastro: 'N', status: 'SC', cod_registro: '', msg: 'CPF/CNPJ vazio' });
        continue;
      }
      const existe = Object.prototype.hasOwnProperty.call(mapa, cpfLimpo);
      resultado.push({
        idx: r.idx,
        status_cadastro: existe ? 'S' : 'N',
        status: existe ? 'A' : 'SC',
        cod_registro: existe ? String(mapa[cpfLimpo].id) : '',
        msg: ''
      });
    }

    res.json({ ok: true, resultado });
  } catch (err) {
    console.error('[importacao-clientes/verificar-lote]', err);
    res.status(500).json({ ok: false, msg: err.message });
  }
});

// POST /importar-linha
router.post('/importar-linha', async (req, res) => {
  const status_cadastro = String(req.body.status_cadastro ?? 'N').trim();
  const cod_registro    = String(req.body.cod_registro ?? '').trim();

  let campos = req.body.campos;
  if (typeof campos === 'string') {
    try { campos = JSON.parse(campos); } catch { campos = {}; }
  }
  if (!campos || typeof campos !== 'object') {
    return res.json({ ok: false, msg: 'Nenhum campo mapeado para importar.' });
  }

  const pool = getPool();
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [validRows] = await conn.query(
      `SELECT nome_campo FROM campos_importacao WHERE tabela = 'cliente' AND excluido = 'N'`
    ).catch(() => [[]]);
    const camposValidos = validRows.map(r => r.nome_campo);

    const [descRows] = await conn.query('DESCRIBE clientes').catch(() => [[]]);
    const colunasReais = new Set(descRows.map(r => r.Field));

    const dados = {};
    for (const [campo, valor] of Object.entries(campos)) {
      if (!camposValidos.includes(campo)) continue;
      const colBd = resolverColunaCliente(campo, colunasReais);
      if (!colBd) continue;
      dados[colBd] = valor == null ? '' : String(valor).toUpperCase();
    }

    for (const cn of CAMPOS_NUMERICOS) {
      if (Object.prototype.hasOwnProperty.call(dados, cn) && dados[cn] === '') {
        dados[cn] = '0';
      }
    }
    for (const cd of CAMPOS_DATA) {
      if (Object.prototype.hasOwnProperty.call(dados, cd)) {
        const norm = normalizarData(dados[cd]);
        if (norm) dados[cd] = norm;
        else delete dados[cd];
      }
    }

    if (dados.numerosulframa && String(dados.numerosulframa).trim() !== '') {
      if (!dados.imprimirsuframaped || dados.imprimirsuframaped === 'N') dados.imprimirsuframaped = 'S';
      if (!dados.descontoIPIsuframaped || dados.descontoIPIsuframaped === 'N') dados.descontoIPIsuframaped = 'S';
    }

    if (status_cadastro === 'S' && cod_registro) {
      const cols = Object.keys(dados).filter(c => c !== 'id' && colunaExisteNoBd(c, colunasReais));
      if (cols.length === 0) {
        await conn.rollback(); conn.release();
        return res.json({ ok: false, msg: 'Nenhum campo válido para salvar (verifique se as colunas existem na tabela clientes).' });
      }
      const setParts = cols.map(c => `\`${c}\` = ?`);
      const vals = [...cols.map(c => dados[c]), cod_registro];
      let sqlUpd = `UPDATE clientes SET ${setParts.join(', ')}`;
      if (colunaExisteNoBd('dtalterado', colunasReais)) sqlUpd += ', dtalterado = NOW()';
      sqlUpd += ' WHERE id = ?';
      await conn.query(sqlUpd, vals);
      await conn.commit(); conn.release();
      return res.json({ ok: true, operacao: 'UPDATE', msg: 'Cliente atualizado.' });
    }

    if (Object.keys(dados).length === 0) {
      await conn.rollback(); conn.release();
      return res.json({
        ok: false,
        msg: 'Nenhum campo válido para salvar. Os nomes mapeados podem não existir em `clientes` (ex.: use CPF/nome compatíveis com o banco ou ajuste em Configurar Campos).',
      });
    }

    if (!dados.status) dados.status = 'A';
    dados.excluido = 'N';

    if (colunaExisteNoBd('id_empresa', colunasReais)) {
      const v = dados.id_empresa;
      if (v === undefined || v === null || String(v).trim() === '') {
        const ie = req.user?.id_empresa;
        if (ie != null && String(ie).trim() !== '') dados.id_empresa = String(ie);
      }
    }

    const insertCols = Object.keys(dados).filter(c => colunaExisteNoBd(c, colunasReais));
    if (insertCols.length === 0) {
      await conn.rollback(); conn.release();
      return res.json({ ok: false, msg: 'Nenhuma coluna da importação existe na tabela `clientes`.' });
    }

    let colListStr = insertCols.map(c => `\`${c}\``).join(', ');
    let phList = insertCols.map(() => '?').join(', ');
    const valsIns = insertCols.map(c => dados[c]);

    if (colunaExisteNoBd('dtcadastro', colunasReais) && !insertCols.includes('dtcadastro')) {
      colListStr += ', `dtcadastro`';
      phList += ', CURDATE()';
    }

    const [ins] = await conn.query(
      `INSERT INTO clientes (${colListStr}) VALUES (${phList})`,
      valsIns
    );

    await conn.commit(); conn.release();
    res.json({ ok: true, operacao: 'INSERT', novo_id: ins.insertId, msg: 'Cliente inserido.' });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (_) {} conn.release(); }
    console.error('[importacao-clientes/importar-linha]', err);
    res.json({ ok: false, msg: err.message });
  }
});

module.exports = router;
