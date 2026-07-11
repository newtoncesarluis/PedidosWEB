'use strict';
/**
 * Migra itenspedgrade → itensped (formato web) em nc_jardim.
 *
 * - Copia só campos comuns (não cria colunas grade1/grade2…)
 * - Monta grade_resumo (P:5 M:5 …) a partir de grade{N} + descricao_grades
 * - Grava detalhe em itensped_grade_qtd
 * - Preenche id_pedido via pedidos.numero
 * - INSERT em lote (rápido)
 * - Não apaga itenspedgrade
 *
 * Uso:
 *   node scripts/migrar-itenspedgrade-jardim.js --dry-run
 *   node scripts/migrar-itenspedgrade-jardim.js --exec
 */
const mysql = require('mysql2/promise');

const DRY = !process.argv.includes('--exec');
const BATCH = 300;

const CFG = {
  host: process.env.MIG_HOST || '127.0.0.1',
  port: Number(process.env.MIG_PORT || 3308),
  user: process.env.MIG_USER || 'app_pedidosweb',
  password: process.env.MIG_PASSWORD || 'kzf010557f@2025',
  database: process.env.MIG_DB || 'nc_jardim',
};

const CAMPOS_COMUNS = [
  'numpedido', 'cod_produto', 'cod_fabricante', 'desc_prod', 'unidade',
  'kilo_embalagem', 'quantidade', 'valor_kilo', 'valor_unitario', 'vlrtotal_itens',
  'vlrbruto', 'vlrtotalbruto', 'alterado', 'valor_puxada', 'valor_totalpuxada',
  'comissao', 'total_peso', 'vlr_comissao',
  'icms', 'vlr_icms', 'vlr_total_icms',
  'ipi', 'vlr_ipi', 'vlr_total_ipi',
  'st', 'vlr_st', 'vlr_total_st',
  'solado', 'tipo_grade', 'id_grade', 'kilo', 'excluido', 'id_tipopedido',
];

function parseNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function sliceStr(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function montarGradeQtd(row, descByGrade) {
  const idGrade = String(row.id_grade || '').trim();
  const descs = descByGrade.get(idGrade) || [];
  const out = [];
  for (const d of descs) {
    const seq = Number(d.sequencial) || 0;
    if (seq < 1) continue;
    const qtd = parseFloat(row[`grade${seq}`]) || 0;
    if (qtd <= 0) continue;
    out.push({
      id_descricao_grade: d.id,
      sequencial: seq,
      nome_grade: String(d.nome || '').trim().slice(0, 25),
      quantidade: qtd,
    });
  }
  return out;
}

function montarGradeResumo(gradeQtd, resumogrande) {
  if (gradeQtd.length) {
    return gradeQtd.map((g) => `${g.nome_grade}:${g.quantidade}`).join(' ').slice(0, 300);
  }
  const raw = String(resumogrande || '').trim();
  if (!raw) return null;
  const parts = [];
  const re = /GRADE\s+([^\-\|]+?)\s*-\s*Qtde:\s*([\d.,]+)/gi;
  let m;
  while ((m = re.exec(raw))) {
    const nome = m[1].trim();
    const qtd = m[2].replace(',', '.');
    if (nome && parseFloat(qtd) > 0) parts.push(`${nome}:${qtd}`);
  }
  if (parts.length) return parts.join(' ').slice(0, 300);
  return raw.slice(0, 300);
}

function mapCampo(c, row) {
  const v = row[c];
  if (c === 'cod_produto' || c === 'id_grade') {
    const n = parseNum(v);
    return n != null ? Math.trunc(n) : null;
  }
  if (c === 'desc_prod') return sliceStr(v, 100);
  if (c === 'unidade') return sliceStr(v, 20);
  if (c === 'cod_fabricante') return sliceStr(v, 25);
  if (c === 'solado') return sliceStr(v, 50);
  if (c === 'tipo_grade') return sliceStr(v, 200);
  if (c === 'excluido') return v === 'S' ? 'S' : 'N';
  return v;
}

async function main() {
  console.log(`\n=== Migração itenspedgrade → itensped (${CFG.database}) ===`);
  console.log(`Modo: ${DRY ? 'DRY-RUN (não grava)' : 'EXEC (grava de verdade)'}\n`);

  const conn = await mysql.createConnection({ ...CFG, multipleStatements: false });
  console.log('Conectado.');

  for (const t of ['itenspedgrade', 'itensped', 'pedidos', 'descricao_grades']) {
    const [ex] = await conn.query(`SHOW TABLES LIKE '${t}'`);
    if (!ex.length) throw new Error(`Tabela ${t} não encontrada`);
  }

  const [colsG] = await conn.query('DESCRIBE itenspedgrade');
  const [colsI] = await conn.query('DESCRIBE itensped');
  const setG = new Set(colsG.map((c) => c.Field.toLowerCase()));
  const setI = new Set(colsI.map((c) => c.Field.toLowerCase()));
  const campos = CAMPOS_COMUNS.filter(
    (c) => setG.has(c.toLowerCase()) && setI.has(c.toLowerCase())
  );
  const temGradeResumo = setI.has('grade_resumo');
  const temIdPedido = setI.has('id_pedido');
  const temTipoPreco = setI.has('tipo_preco');
  const temVlrtotalComImp = setI.has('vlrtotalcomimposto');
  const temSincronizar = setI.has('sincronizar');
  const temGradeQtd = (await conn.query("SHOW TABLES LIKE 'itensped_grade_qtd'"))[0].length > 0;

  console.log(`Campos comuns a copiar: ${campos.length}`);
  console.log(`grade_resumo=${temGradeResumo} id_pedido=${temIdPedido} itensped_grade_qtd=${temGradeQtd}`);

  const [descs] = await conn.query(
    `SELECT id, nome, id_grade, sequencial
     FROM descricao_grades
     WHERE COALESCE(excluido,'N') <> 'S'
     ORDER BY id_grade, sequencial`
  );
  const descByGrade = new Map();
  for (const d of descs) {
    const k = String(d.id_grade);
    if (!descByGrade.has(k)) descByGrade.set(k, []);
    descByGrade.get(k).push(d);
  }
  console.log(`descricao_grades: ${descs.length} tamanhos em ${descByGrade.size} grades`);

  const [peds] = await conn.query(
    `SELECT id, numero FROM pedidos WHERE COALESCE(excluido,'N') <> 'S'`
  );
  const pedByNumero = new Map();
  for (const p of peds) {
    pedByNumero.set(String(p.numero), p.id);
    const n = String(p.numero).replace(/^0+/, '') || '0';
    if (!pedByNumero.has(n)) pedByNumero.set(n, p.id);
  }
  console.log(`pedidos ativos: ${peds.length}`);

  const [[totG]] = await conn.query(
    `SELECT COUNT(*) AS n FROM itenspedgrade WHERE COALESCE(excluido,'N') <> 'S'`
  );
  const [[totI]] = await conn.query(
    `SELECT COUNT(*) AS n FROM itensped WHERE COALESCE(excluido,'N') <> 'S'`
  );
  const [[jaTem]] = await conn.query(
    `SELECT COUNT(*) AS n
     FROM itenspedgrade g
     WHERE COALESCE(g.excluido,'N') <> 'S'
       AND EXISTS (
         SELECT 1 FROM itensped i
         WHERE CAST(i.numpedido AS CHAR) = CAST(g.numpedido AS CHAR)
           AND COALESCE(i.excluido,'N') <> 'S'
       )`
  );
  const aMigrar = totG.n - jaTem.n;
  console.log(`\nitenspedgrade ativos: ${totG.n}`);
  console.log(`itensped ativos:      ${totI.n}`);
  console.log(`já cobertos (skip):   ${jaTem.n}`);
  console.log(`a migrar:             ${aMigrar}`);

  if (aMigrar <= 0) {
    console.log('\nNada a migrar.');
    await conn.end();
    return;
  }

  const gradeCols = colsG.map((c) => c.Field).filter((f) => /^grade\d+$/i.test(f));
  const selectUnique = [...new Set([
    'id',
    ...campos,
    ...(setG.has('resumogrande') ? ['resumogrande'] : []),
    ...gradeCols,
  ])];

  // Colunas finais do INSERT (fixas para o lote)
  const insertCols = [...campos];
  if (temIdPedido) insertCols.push('id_pedido');
  if (temGradeResumo) insertCols.push('grade_resumo');
  if (temTipoPreco) insertCols.push('tipo_preco');
  if (temSincronizar) insertCols.push('sincronizar');
  if (temVlrtotalComImp) insertCols.push('vlrtotalcomimposto');

  const [pedComItens] = await conn.query(
    `SELECT DISTINCT CAST(numpedido AS CHAR) AS numpedido
     FROM itensped WHERE COALESCE(excluido,'N') <> 'S'`
  );
  const skipPedidos = new Set(pedComItens.map((r) => String(r.numpedido)));

  let lastId = 0;
  let migrated = 0;
  let skipped = 0;
  let gradeQtdRows = 0;
  let semPedido = 0;
  let erros = 0;
  const t0 = Date.now();

  while (true) {
    const [rows] = await conn.query(
      `SELECT ${selectUnique.map((c) => `\`${c}\``).join(', ')}
       FROM itenspedgrade
       WHERE COALESCE(excluido,'N') <> 'S' AND id > ?
       ORDER BY id
       LIMIT ?`,
      [lastId, BATCH]
    );
    if (!rows.length) break;
    lastId = rows[rows.length - 1].id;

    const batchVals = [];
    const batchGradeMeta = []; // grade_qtd por posição no batch

    for (const row of rows) {
      const num = String(row.numpedido ?? '');
      if (skipPedidos.has(num)) {
        skipped++;
        continue;
      }

      const gradeQtd = montarGradeQtd(row, descByGrade);
      const gradeResumo = temGradeResumo
        ? montarGradeResumo(gradeQtd, row.resumogrande)
        : null;

      let idPedido = null;
      if (temIdPedido) {
        idPedido = pedByNumero.get(num);
        if (idPedido == null) {
          const n2 = num.replace(/^0+/, '') || '0';
          idPedido = pedByNumero.get(n2) ?? null;
        }
        if (idPedido == null) semPedido++;
      }

      const vals = campos.map((c) => mapCampo(c, row));
      if (temIdPedido) vals.push(idPedido);
      if (temGradeResumo) vals.push(gradeResumo);
      if (temTipoPreco) vals.push('venda');
      if (temSincronizar) vals.push('N');
      if (temVlrtotalComImp) {
        const base = parseFloat(row.vlrtotal_itens) || 0;
        const st = parseFloat(row.vlr_st) || 0;
        const ipi = parseFloat(row.vlr_ipi) || 0;
        vals.push(Math.round((base + st + ipi) * 1000) / 1000);
      }

      batchVals.push(vals);
      batchGradeMeta.push(gradeQtd);
    }

    if (!batchVals.length) {
      process.stdout.write(
        `\rlastId=${lastId} | migrados=${migrated} skip=${skipped} (${((Date.now() - t0) / 1000).toFixed(1)}s)   `
      );
      continue;
    }

    if (DRY) {
      migrated += batchVals.length;
      for (const gq of batchGradeMeta) gradeQtdRows += gq.length;
    } else {
      try {
        const phRow = `(${insertCols.map(() => '?').join(',')})`;
        const sql = `INSERT INTO itensped (${insertCols.map((c) => `\`${c}\``).join(',')}) VALUES ${batchVals.map(() => phRow).join(',')}`;
        const flat = batchVals.flat();
        const [res] = await conn.query(sql, flat);
        const firstId = res.insertId;
        migrated += batchVals.length;

        if (temGradeQtd && firstId) {
          const gqValues = [];
          for (let i = 0; i < batchGradeMeta.length; i++) {
            const itemId = firstId + i;
            for (const g of batchGradeMeta[i]) {
              gqValues.push([
                itemId,
                g.id_descricao_grade,
                g.sequencial,
                g.nome_grade || '',
                g.quantidade,
              ]);
            }
          }
          if (gqValues.length) {
            // lotes de 500 no grade_qtd
            for (let i = 0; i < gqValues.length; i += 500) {
              const chunk = gqValues.slice(i, i + 500);
              await conn.query(
                `INSERT INTO itensped_grade_qtd
                  (id_item_ped, id_descricao_grade, sequencial, nome_grade, quantidade)
                 VALUES ?`,
                [chunk]
              );
            }
            gradeQtdRows += gqValues.length;
          }
        }
      } catch (e) {
        erros++;
        console.error(`\nErro no lote lastId=${lastId}:`, e.message);
        // fallback item a item neste lote
        for (let i = 0; i < batchVals.length; i++) {
          try {
            const ph = insertCols.map(() => '?').join(',');
            const [r] = await conn.query(
              `INSERT INTO itensped (${insertCols.map((c) => `\`${c}\``).join(',')}) VALUES (${ph})`,
              batchVals[i]
            );
            migrated++;
            const gq = batchGradeMeta[i];
            if (temGradeQtd && gq.length && r.insertId) {
              await conn.query(
                `INSERT INTO itensped_grade_qtd
                  (id_item_ped, id_descricao_grade, sequencial, nome_grade, quantidade)
                 VALUES ?`,
                [gq.map((g) => [r.insertId, g.id_descricao_grade, g.sequencial, g.nome_grade || '', g.quantidade])]
              );
              gradeQtdRows += gq.length;
            }
          } catch (e2) {
            erros++;
            if (erros <= 15) console.error('  item:', e2.message);
          }
        }
      }
    }

    process.stdout.write(
      `\rlastId=${lastId} | migrados=${migrated} skip=${skipped} erros=${erros} (${((Date.now() - t0) / 1000).toFixed(1)}s)   `
    );
  }

  console.log('\n');
  console.log('── Resultado ──');
  console.log(`Migrados:              ${migrated}`);
  console.log(`Pulados (já em itensped): ${skipped}`);
  console.log(`Sem match pedidos.id:  ${semPedido}`);
  console.log(`Linhas grade_qtd:      ${gradeQtdRows}`);
  console.log(`Erros:                 ${erros}`);
  console.log(`Tempo:                 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (!DRY) {
    const [[depois]] = await conn.query(
      `SELECT COUNT(*) AS n FROM itensped WHERE COALESCE(excluido,'N') <> 'S'`
    );
    const [[gq]] = await conn.query(`SELECT COUNT(*) AS n FROM itensped_grade_qtd`).catch(() => [[{ n: 0 }]]);
    console.log(`\nitensped após:         ${depois.n}`);
    console.log(`itensped_grade_qtd:    ${gq.n}`);

    // amostra
    const [amostra] = await conn.query(`
      SELECT id, numpedido, cod_produto, LEFT(desc_prod,30) AS desc_prod,
             quantidade, valor_unitario, LEFT(grade_resumo,60) AS grade_resumo, id_pedido
      FROM itensped ORDER BY id DESC LIMIT 5
    `);
    console.log('\nAmostra itensped (5 mais recentes):');
    console.table(amostra);
  } else {
    console.log('\nDRY-RUN concluído. Para gravar:');
    console.log('  node scripts/migrar-itenspedgrade-jardim.js --exec');
  }

  await conn.end();
}

main().catch((e) => {
  console.error('\nFALHA:', e.message);
  process.exit(1);
});
