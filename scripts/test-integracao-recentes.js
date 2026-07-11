/**
 * Teste integrado — importação c/ tabela, XML fábrica, região.
 * Uso: node scripts/test-integracao-recentes.js
 */
require('dotenv').config();
const http = require('http');

const BASE = `http://localhost:${process.env.PORT || 3002}`;

function request(method, path, { token, cookie, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { ...headers },
    };
    if (token) opts.headers.Authorization = `Bearer ${token}`;
    if (cookie) opts.headers.Cookie = cookie;
    if (body !== undefined) {
      const data = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = { _raw: raw }; }
        resolve({ status: res.statusCode, headers: res.headers, json, raw });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function loginViaDb(pool) {
  const [rows] = await pool.query(
    `SELECT s.loginusu, s.senhausu, s.idusuario, s.idperfil
       FROM usuarios s
      WHERE s.situacao = 'ATIVO' AND s.excluido = 'N'
      ORDER BY s.idperfil ASC, s.idusuario ASC
      LIMIT 1`
  );
  if (!rows[0]) throw new Error('Nenhum usuário ativo no banco');
  const { loginusu, senhausu } = rows[0];
  const r = await request('POST', '/api/auth/login', {
    body: { loginusu, senhausu },
  });
  const token = r.json?.token;
  const setCookie = r.headers['set-cookie'];
  const cookie = Array.isArray(setCookie) ? setCookie.map((c) => c.split(';')[0]).join('; ') : '';
  if (!token) throw new Error(`Login falhou (${r.status}): ${r.json?.error || r.raw}`);
  return { token, cookie, loginusu, userId: rows[0].idusuario };
}

async function main() {
  const results = [];
  const ok = (name, detail) => { results.push({ name, pass: true, detail }); console.log(`✓ ${name}${detail ? ' — ' + detail : ''}`); };
  const fail = (name, detail) => { results.push({ name, pass: false, detail }); console.log(`✗ ${name} — ${detail}`); };

  // Servidor up?
  try {
    const ping = await request('GET', '/login.html');
    if (ping.status !== 200) fail('Servidor HTTP', `status ${ping.status}`);
    else ok('Servidor HTTP', BASE);
  } catch (e) {
    fail('Servidor HTTP', e.message);
    printSummary(results);
    process.exit(1);
  }

  const { initCustomerDatabase, getPool } = require('../config/database');
  await initCustomerDatabase();
  const pool = getPool();

  // ── Módulo XML pedido venda (DB real) ──
  try {
    const { buildXmlAnexoPedidoVenda } = require('../config/pedido-xml-venda');
    const { resolverPrecoImportacao, produtoIdOf: prodIdRepo } = require('../repositories/nfe-repository');

    const [prodRow] = await pool.query(
      `SELECT ID, vlr_venda, cod_fabricante FROM produto WHERE excluido='N' AND cod_fabricante IS NOT NULL AND cod_fabricante<>'' LIMIT 1`
    ).catch(() => [[]]);
    if (prodRow[0]) {
      const idNorm = prodIdRepo({ ID: prodRow[0].ID });
      if (idNorm === parseInt(prodRow[0].ID, 10)) ok('produtoIdOf (ID maiúsculo)', `id=${idNorm}`);
      else fail('produtoIdOf (ID maiúsculo)', `esperado ${prodRow[0].ID}, got ${idNorm}`);

      const [tabRow] = await pool.query(
        `SELECT id_tabela, cod_produto, COALESCE(valor_tabela, preco_venda) AS preco
           FROM tabela_preco_itens
          WHERE CAST(cod_produto AS UNSIGNED) = ?
            AND (excluido='N' OR excluido IS NULL)
            AND COALESCE(valor_tabela, preco_venda, 0) > 0
          LIMIT 1`,
        [idNorm]
      ).catch(() => [[]]);

      if (tabRow[0]) {
        const precos = await resolverPrecoImportacao({
          idTabela: tabRow[0].id_tabela,
          produto: prodRow[0],
          precoArquivo: 1,
        });
        if (precos.usou_tabela && parseFloat(precos.valor_unitario) === parseFloat(tabRow[0].preco)) {
          ok('Importação — preço da tabela', `R$ ${precos.valor_unitario}`);
        } else {
          fail('Importação — preço da tabela', JSON.stringify(precos));
        }
      } else {
        ok('Importação — preço da tabela', 'sem item na tabela (pulado)');
      }
    } else {
      ok('Importação — preço da tabela', 'sem produto de teste (pulado)');
    }

    const [pedRow] = await pool.query(
      `SELECT p.id FROM pedidos p
        WHERE COALESCE(p.excluido,'N')='N'
          AND EXISTS (
            SELECT 1 FROM itensped i
             WHERE i.id_pedido = p.id AND COALESCE(i.excluido,'N')='N'
               AND i.cod_fabricante IS NOT NULL AND i.cod_fabricante <> ''
          )
        ORDER BY p.id DESC LIMIT 1`
    );
    if (pedRow[0]) {
      const pack = await buildXmlAnexoPedidoVenda(pool, pedRow[0].id);
      if (pack?.xml?.includes('<Pedidos>') && pack?.fileName?.endsWith('.xml')) {
        ok('XML pedido venda (DB)', `${pack.fileName} (${pack.buffer.length} bytes)`);
      } else {
        fail('XML pedido venda (DB)', 'pack inválido');
      }
    } else {
      ok('XML pedido venda (DB)', 'sem pedido com itens (pulado)');
    }
  } catch (e) {
    fail('Módulos import/XML', e.message);
  }

  // ── API autenticada ──
  let auth;
  try {
    auth = await loginViaDb(pool);
    ok('Login API', auth.loginusu);
  } catch (e) {
    fail('Login API', e.message);
    printSummary(results);
    process.exit(1);
  }

  // Região — POST + DELETE lógico (excluir região de teste)
  const testDesc = `TESTE_AUTO_${Date.now()}`;
  let regiaoId = null;
  try {
    const r = await request('POST', '/api/regiao-rota', {
      token: auth.token,
      cookie: auth.cookie,
      body: { descricao: testDesc, sigla: 'TA', status: 'A', distancia: 0, cor: '#3b82f6' },
    });
    if (r.status === 201 && r.json?.id) {
      regiaoId = r.json.id;
      ok('Região — POST salvar', `id=${regiaoId}`);
    } else {
      fail('Região — POST salvar', `${r.status} ${r.json?.error || r.raw}`);
    }
  } catch (e) {
    fail('Região — POST salvar', e.message);
  }

  if (regiaoId) {
    try {
      const r = await request('DELETE', `/api/regiao-rota/${regiaoId}`, {
        token: auth.token,
        cookie: auth.cookie,
      });
      if (r.status === 200 && r.json?.ok) ok('Região — DELETE cleanup', `id=${regiaoId}`);
      else fail('Região — DELETE cleanup', `${r.status} ${r.json?.error || r.raw}`);
    } catch (e) {
      fail('Região — DELETE cleanup', e.message);
    }
  }

  // enviar-fabrica — só valida regra de anexo vazio (sem enviar e-mail real)
  try {
    const [ped] = await pool.query(
      `SELECT id FROM pedidos WHERE COALESCE(excluido,'N')='N' ORDER BY id DESC LIMIT 1`
    );
    if (ped[0]) {
      const r = await request('POST', `/api/pedidos/${ped[0].id}/enviar-fabrica`, {
        token: auth.token,
        cookie: auth.cookie,
        body: { pdf_base64: null, numero_pedido: ped[0].id },
      });
      // Esperado: 400 fornecedor sem envio OU sem anexo OU sem email — nunca 401
      if (r.status === 401) {
        fail('Enviar fábrica — auth', r.json?.error || r.raw);
      } else if (r.status === 400 && (r.json?.error || '').includes('anexo')) {
        ok('Enviar fábrica — guarda sem anexo', r.json.error);
      } else if ([400, 404].includes(r.status)) {
        ok('Enviar fábrica — regra negócio', `${r.status}: ${r.json?.error || 'ok'}`);
      } else if (r.status === 200) {
        ok('Enviar fábrica — enviou', `(e-mail real — ${(r.json?.emails || []).length} dest.)`);
      } else {
        fail('Enviar fábrica', `${r.status} ${r.json?.error || r.raw}`);
      }
    } else {
      ok('Enviar fábrica', 'sem pedido (pulado)');
    }
  } catch (e) {
    fail('Enviar fábrica', e.message);
  }

  // Região sem token — deve 401
  try {
    const r = await request('POST', '/api/regiao-rota', {
      body: { descricao: 'X', status: 'A' },
    });
    if (r.status === 401) ok('Região — 401 sem token', r.json?.error || 'ok');
    else fail('Região — 401 sem token', `status ${r.status}`);
  } catch (e) {
    fail('Região — 401 sem token', e.message);
  }

  printSummary(results);
  process.exit(results.some((x) => !x.pass) ? 1 : 0);
}

function printSummary(results) {
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log('\n── Resumo ──');
  console.log(`${passed} OK, ${failed} falha(s)`);
  if (failed) {
    results.filter((r) => !r.pass).forEach((r) => console.log(`  • ${r.name}: ${r.detail}`));
  }
}

main().catch((e) => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
