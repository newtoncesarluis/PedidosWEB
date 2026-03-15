const express = require('express');
const router  = express.Router();
const { getPool } = require('../config/database');

// ─────────────────────────────────────────────────────────────────────────────
// PERFIS  (tabela: perfil)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/perfis', async (req, res) => {
  try {
    const pool = getPool();
    // Tenta filtrar por excluido se a coluna existir
    const [rows] = await pool.query(
      `SELECT * FROM perfil WHERE COALESCE(excluido,'N') = 'N' ORDER BY descricao`
    ).catch(() => pool.query(`SELECT * FROM perfil ORDER BY descricao`));
    res.json({ perfis: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/perfis', async (req, res) => {
  try {
    const pool = getPool();
    const n = v => v === 'S' ? 'S' : 'N';
    const {
      descricao,
      incluir_pedvendas, alterar_pedvendas, excluir_pedvendas,
      incluir_clientes, alterar_clientes, exclui_clientes,
      incluir_fornecedor, alterar_fornecedor, excluir_fornecedor,
      incluir_produtos, alterar_produtos, excluir_produtos,
      p_vender, p_comprar, acessogerenciais, manutencaocadastros,
      acessartodosclientes, mudarempresa, alterarbase,
      acesso_financeiro, acessoperfil
    } = req.body;
    const [r] = await pool.query(
      `INSERT INTO perfil (descricao,
        incluir_pedvendas,alterar_pedvendas,excluir_pedvendas,
        incluir_clientes,alterar_clientes,exclui_clientes,
        incluir_fornecedor,alterar_fornecedor,excluir_fornecedor,
        incluir_produtos,alterar_produtos,excluir_produtos,
        p_vender,p_comprar,acessogerenciais,manutencaocadastros,
        acessartodosclientes,mudarempresa,alterarbase,
        acesso_financeiro,acessoperfil,excluido)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'N')`,
      [descricao||null,
       n(incluir_pedvendas),n(alterar_pedvendas),n(excluir_pedvendas),
       n(incluir_clientes),n(alterar_clientes),n(exclui_clientes),
       n(incluir_fornecedor),n(alterar_fornecedor),n(excluir_fornecedor),
       n(incluir_produtos),n(alterar_produtos),n(excluir_produtos),
       n(p_vender),n(p_comprar),n(acessogerenciais),n(manutencaocadastros),
       n(acessartodosclientes),n(mudarempresa),n(alterarbase),
       n(acesso_financeiro),n(acessoperfil)]
    );
    res.status(201).json({ ok:true, id:r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/perfis/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT * FROM perfil WHERE id=? LIMIT 1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error:'Perfil não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/perfis/:id', async (req, res) => {
  try {
    const pool = getPool();
    const n = v => v === 'S' ? 'S' : 'N';
    const {
      descricao,
      incluir_pedvendas, alterar_pedvendas, excluir_pedvendas,
      incluir_clientes, alterar_clientes, exclui_clientes,
      incluir_fornecedor, alterar_fornecedor, excluir_fornecedor,
      incluir_produtos, alterar_produtos, excluir_produtos,
      p_vender, p_comprar, acessogerenciais, manutencaocadastros,
      acessartodosclientes, mudarempresa, alterarbase,
      acesso_financeiro, acessoperfil
    } = req.body;
    await pool.query(
      `UPDATE perfil SET descricao=?,
        incluir_pedvendas=?,alterar_pedvendas=?,excluir_pedvendas=?,
        incluir_clientes=?,alterar_clientes=?,exclui_clientes=?,
        incluir_fornecedor=?,alterar_fornecedor=?,excluir_fornecedor=?,
        incluir_produtos=?,alterar_produtos=?,excluir_produtos=?,
        p_vender=?,p_comprar=?,acessogerenciais=?,manutencaocadastros=?,
        acessartodosclientes=?,mudarempresa=?,alterarbase=?,
        acesso_financeiro=?,acessoperfil=?
       WHERE id=?`,
      [descricao||null,
       n(incluir_pedvendas),n(alterar_pedvendas),n(excluir_pedvendas),
       n(incluir_clientes),n(alterar_clientes),n(exclui_clientes),
       n(incluir_fornecedor),n(alterar_fornecedor),n(excluir_fornecedor),
       n(incluir_produtos),n(alterar_produtos),n(excluir_produtos),
       n(p_vender),n(p_comprar),n(acessogerenciais),n(manutencaocadastros),
       n(acessartodosclientes),n(mudarempresa),n(alterarbase),
       n(acesso_financeiro),n(acessoperfil),req.params.id]
    );
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/perfis/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE perfil SET excluido='S' WHERE id=?`, [req.params.id])
      .catch(() => pool.query(`DELETE FROM perfil WHERE id=?`, [req.params.id]));
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GRUPOS  (tabela: grupo_usuarios)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/grupos', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      `CREATE TABLE IF NOT EXISTS grupo_usuarios (
         id INT AUTO_INCREMENT PRIMARY KEY,
         descricao VARCHAR(100),
         excluido VARCHAR(1) DEFAULT 'N'
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`
    ).catch(()=>{});
    const [rows] = await pool.query(
      `SELECT * FROM grupo_usuarios WHERE COALESCE(excluido,'N')='N' ORDER BY descricao`
    );
    res.json({ grupos: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/grupos', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao } = req.body;
    if (!descricao) return res.status(400).json({ error:'descricao obrigatório' });
    const [r] = await pool.query(
      `INSERT INTO grupo_usuarios (descricao,excluido) VALUES(?,'N')`, [descricao]
    );
    res.status(201).json({ ok:true, id:r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/grupos/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(`SELECT * FROM grupo_usuarios WHERE id=? LIMIT 1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error:'Grupo não encontrado' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/grupos/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { descricao } = req.body;
    if (!descricao) return res.status(400).json({ error:'descricao obrigatório' });
    await pool.query(`UPDATE grupo_usuarios SET descricao=? WHERE id=?`, [descricao, req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/grupos/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE grupo_usuarios SET excluido='S' WHERE id=?`, [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// USUÁRIOS  (tabela: usuarios)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/usuarios', async (req, res) => {
  try {
    const pool = getPool();
    // SELECT * evita erros por colunas opcionais; whatsapp_configurado calculado
    const [rows] = await pool.query(
      `SELECT u.*,
              (u.instancia IS NOT NULL AND u.instancia <> '') AS whatsapp_configurado
       FROM usuarios u
       WHERE u.excluido = 'N'
       ORDER BY u.nomeusu`
    );
    // Remove campos sensíveis da listagem
    rows.forEach(r => {
      delete r.instancia; delete r.chave; delete r.data_conexao;
    });
    res.json({ usuarios: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/usuarios/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT u.*,
              (u.instancia IS NOT NULL AND u.instancia <> '') AS whatsapp_configurado
       FROM usuarios u WHERE u.idusuario=? AND u.excluido='N' LIMIT 1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error:'Usuário não encontrado' });
    delete rows[0].instancia; delete rows[0].chave; delete rows[0].data_conexao;
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios', async (req, res) => {
  try {
    const pool = getPool();
    const { nomeusu, loginusu, senhausu, SITUACAO, idperfil, email } = req.body;
    if (!nomeusu || !loginusu || !senhausu)
      return res.status(400).json({ error:'nomeusu, loginusu e senhausu são obrigatórios' });

    // INSERT com campos base que sempre existem
    const [r] = await pool.query(
      `INSERT INTO usuarios (nomeusu,loginusu,senhausu,SITUACAO,excluido,idperfil,email)
       VALUES(?,?,?,?,  'N',?,?)`,
      [nomeusu, loginusu, senhausu, SITUACAO||'ATIVO', idperfil||null, email||null]
    );
    const newId = r.insertId;

    // Campos opcionais: tenta UPDATE silencioso para cada grupo
    await _updateUsuarioOpcional(pool, newId, req.body);

    res.status(201).json({ ok:true, id:newId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/usuarios/:id', async (req, res) => {
  try {
    const pool = getPool();
    const { nomeusu, loginusu, senhausu, SITUACAO, idperfil, email } = req.body;

    // Campos base garantidos
    const base = [`nomeusu=?`,`loginusu=?`,`SITUACAO=?`,`idperfil=?`,`email=?`];
    const vals = [nomeusu||null, loginusu||null, SITUACAO||'ATIVO', idperfil||null, email||null];
    if (senhausu) { base.push(`senhausu=?`); vals.push(senhausu); }
    vals.push(req.params.id);
    await pool.query(`UPDATE usuarios SET ${base.join(',')} WHERE idusuario=? AND excluido='N'`, vals);

    // Campos opcionais
    await _updateUsuarioOpcional(pool, req.params.id, req.body);

    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Atualiza campos opcionais de usuarios sem quebrar se coluna não existir
async function _updateUsuarioOpcional(pool, id, body) {
  const n = v => v === 'S' ? 'S' : 'N';
  const sets = [];
  const vals = [];

  const opt = {
    rota_vendedor: body.rota_vendedor||null,
    acessartodosclientes: n(body.acessartodosclientes),
    empresapadrao: body.empresapadrao||null,
    cod_grupo: body.cod_grupo||null,
    // Email
    email_smtp: body.email_smtp||null,
    email_port: body.email_port||null,
    email_username: body.email_username||null,
    email_password: body.email_password||null,
    email_nome_exibicao: body.email_nome_exibicao||null,
    // Permissões
    incluir_pedvendas: n(body.incluir_pedvendas),
    alterar_pedvendas: n(body.alterar_pedvendas),
    excluir_pedvendas: n(body.excluir_pedvendas),
    incluir_clientes:  n(body.incluir_clientes),
    alterar_clientes:  n(body.alterar_clientes),
    exclui_clientes:   n(body.exclui_clientes),
    incluir_fornecedor: n(body.incluir_fornecedor),
    alterar_fornecedor: n(body.alterar_fornecedor),
    excluir_fornecedor: n(body.excluir_fornecedor),
    incluir_produtos:  n(body.incluir_produtos),
    alterar_produtos:  n(body.alterar_produtos),
    excluir_produtos:  n(body.excluir_produtos),
    p_vender: n(body.p_vender), p_comprar: n(body.p_comprar),
    acessogerenciais: n(body.acessogerenciais),
    manutencaocadastros: n(body.manutencaocadastros),
    mudarempresa: n(body.mudarempresa), alterarbase: n(body.alterarbase),
    acesso_financeiro: n(body.acesso_financeiro), acessoperfil: n(body.acessoperfil),
  };

  for (const [col, val] of Object.entries(opt)) {
    sets.push(`${col}=?`); vals.push(val);
  }
  vals.push(id);
  await pool.query(`UPDATE usuarios SET ${sets.join(',')} WHERE idusuario=?`, vals)
    .catch(()=>{}); // silencioso — colunas podem não existir
}

router.delete('/usuarios/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE usuarios SET excluido='S' WHERE idusuario=? AND excluido='N'`, [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Empresas vinculadas ao usuário
router.get('/usuarios/:id/empresas', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(
      `CREATE TABLE IF NOT EXISTS usuario_empresa (
         id INT AUTO_INCREMENT PRIMARY KEY,
         idusuario INT NOT NULL, id_empresa INT NOT NULL,
         UNIQUE KEY uk_usr_emp (idusuario,id_empresa)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb3`
    ).catch(()=>{});

    // Retorna todas as empresas marcando quais estão vinculadas
    const [todas] = await pool.query(
      `SELECT e.id_empresa, e.Razao_empresa, e.cnpj,
              IF(ue.id IS NOT NULL, 1, 0) AS vinculado
       FROM empresa e
       LEFT JOIN usuario_empresa ue
         ON ue.id_empresa = e.id_empresa AND ue.idusuario = ?
       WHERE e.excluido = 'N'
       ORDER BY e.Razao_empresa`,
      [req.params.id]
    );
    res.json({ empresas: todas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/usuarios/:id/empresas', async (req, res) => {
  try {
    const pool = getPool();
    const { id_empresas } = req.body;
    if (!Array.isArray(id_empresas))
      return res.status(400).json({ error:'id_empresas deve ser array' });

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query(`DELETE FROM usuario_empresa WHERE idusuario=?`, [req.params.id]);
      if (id_empresas.length > 0) {
        await conn.query(
          `INSERT INTO usuario_empresa (idusuario,id_empresa) VALUES ?`,
          [id_empresas.map(e => [req.params.id, e])]
        );
      }
      await conn.commit();
      res.json({ ok:true, vinculadas:id_empresas.length });
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// EMPRESAS  (tabela: empresa — colunas reais do CREATE TABLE fornecido)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/empresas', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM empresa WHERE excluido='N' ORDER BY Razao_empresa`
    );
    res.json({ empresas: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/empresas/:id', async (req, res) => {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT * FROM empresa WHERE id_empresa=? AND excluido='N' LIMIT 1`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error:'Empresa não encontrada' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/empresas', async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    if (!b.Razao_empresa) return res.status(400).json({ error:'Razao_empresa obrigatório' });
    const [r] = await pool.query(
      `INSERT INTO empresa (
        Razao_empresa, nome_fantasia, cnpj, ins_estadual, ins_muncipal,
        tipo_pessoa, endereco, numero, bairro, cidade, uf, cep,
        telefone, telefone2, fax, site, email, email_nf,
        responsavel, responsavel_cpf, responsavel_telefone, responsavel_email,
        ipservidor,
        email_nomeexibicao, email_smtp, email_username, email_password,
        email_port, email_assinatura, email_emaildiretor,
        compartilhatudo, compartilhaproduto, compartilhacliente,
        compartilhafornecedor, muda_empresa, gempresapermite_trocarbase,
        ativo, excluido
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SIM','N')`,
      [
        b.Razao_empresa, b.nome_fantasia||null, b.cnpj||null,
        b.ins_estadual||null, b.ins_muncipal||null,
        b.tipo_pessoa||'JURIDICA',
        b.endereco||null, b.numero||null, b.bairro||null,
        b.cidade||null, b.uf||null, b.cep||null,
        b.telefone||null, b.telefone2||null, b.fax||null,
        b.site||null, b.email||null, b.email_nf||null,
        b.responsavel||null, b.responsavel_cpf||null,
        b.responsavel_telefone||null, b.responsavel_email||null,
        b.ipservidor||null,
        b.email_nomeexibicao||null, b.email_smtp||null,
        b.email_username||null, b.email_password||null,
        b.email_port||null, b.email_assinatura||null, b.email_emaildiretor||null,
        b.compartilhatudo||'S', b.compartilhaproduto||'S',
        b.compartilhacliente||'S', b.compartilhafornecedor||'S',
        b.muda_empresa||'N', b.gempresapermite_trocarbase||'N',
        b.ativo||'SIM'
      ]
    );
    res.status(201).json({ ok:true, id:r.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/empresas/:id', async (req, res) => {
  try {
    const pool = getPool();
    const b = req.body;
    await pool.query(
      `UPDATE empresa SET
        Razao_empresa=?, nome_fantasia=?, cnpj=?, ins_estadual=?, ins_muncipal=?,
        tipo_pessoa=?, endereco=?, numero=?, bairro=?, cidade=?, uf=?, cep=?,
        telefone=?, telefone2=?, fax=?, site=?, email=?, email_nf=?,
        responsavel=?, responsavel_cpf=?, responsavel_telefone=?, responsavel_email=?,
        ipservidor=?,
        email_nomeexibicao=?, email_smtp=?, email_username=?, email_password=?,
        email_port=?, email_assinatura=?, email_emaildiretor=?,
        compartilhatudo=?, compartilhaproduto=?, compartilhacliente=?,
        compartilhafornecedor=?, muda_empresa=?, gempresapermite_trocarbase=?,
        ativo=?
       WHERE id_empresa=? AND excluido='N'`,
      [
        b.Razao_empresa||null, b.nome_fantasia||null, b.cnpj||null,
        b.ins_estadual||null, b.ins_muncipal||null,
        b.tipo_pessoa||'JURIDICA',
        b.endereco||null, b.numero||null, b.bairro||null,
        b.cidade||null, b.uf||null, b.cep||null,
        b.telefone||null, b.telefone2||null, b.fax||null,
        b.site||null, b.email||null, b.email_nf||null,
        b.responsavel||null, b.responsavel_cpf||null,
        b.responsavel_telefone||null, b.responsavel_email||null,
        b.ipservidor||null,
        b.email_nomeexibicao||null, b.email_smtp||null,
        b.email_username||null, b.email_password||null,
        b.email_port||null, b.email_assinatura||null, b.email_emaildiretor||null,
        b.compartilhatudo||'S', b.compartilhaproduto||'S',
        b.compartilhacliente||'S', b.compartilhafornecedor||'S',
        b.muda_empresa||'N', b.gempresapermite_trocarbase||'N',
        b.ativo||'SIM',
        req.params.id
      ]
    );
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/empresas/:id', async (req, res) => {
  try {
    const pool = getPool();
    await pool.query(`UPDATE empresa SET excluido='S' WHERE id_empresa=? AND excluido='N'`, [req.params.id]);
    res.json({ ok:true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
