const path = require('path');
const fs = require('fs');

const EMP_LOGO_BASE = path.join(__dirname, '..', 'public', 'uploads', 'empresas');

function webPathEmpresaLogo(idEmpresa, filename) {
  return `/uploads/empresas/${idEmpresa}/${filename}`;
}

function fsPathFromLogoRelatorio(rel) {
  if (!rel || typeof rel !== 'string') return null;
  const m = rel.match(/^\/uploads\/empresas\/(\d+)\/([^/]+)$/);
  if (!m) return null;
  return path.join(EMP_LOGO_BASE, m[1], m[2]);
}

/** Corrige logo_relatorio quando o arquivo do banco não existe mais (404 no browser). */
function resolveEmpresaLogoRelatorio(idEmpresa, relFromDb) {
  const id = String(idEmpresa);
  const fp = fsPathFromLogoRelatorio(relFromDb);
  if (fp && fs.existsSync(fp)) return relFromDb || null;

  const dir = path.join(EMP_LOGO_BASE, id);
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir)
    .filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f))
    .sort((a, b) => b.localeCompare(a));
  if (!files.length) return null;
  return webPathEmpresaLogo(id, files[0]);
}

function tryUnlinkLogoFile(rel) {
  const fp = fsPathFromLogoRelatorio(rel);
  if (fp && fs.existsSync(fp)) {
    try { fs.unlinkSync(fp); } catch (_) {}
  }
}

async function sanitizeEmpresaRow(pool, row) {
  if (!row || row.id_empresa == null) return row;
  const resolved = resolveEmpresaLogoRelatorio(row.id_empresa, row.logo_relatorio);
  if (resolved !== (row.logo_relatorio || null)) {
    row.logo_relatorio = resolved;
    if (pool) {
      await pool.query(
        `UPDATE empresa SET logo_relatorio=? WHERE id_empresa=? AND COALESCE(NULLIF(TRIM(excluido), ''), 'N') = 'N'`,
        [resolved, row.id_empresa]
      ).catch(() => {});
    }
  }
  return row;
}

module.exports = {
  EMP_LOGO_BASE,
  webPathEmpresaLogo,
  fsPathFromLogoRelatorio,
  resolveEmpresaLogoRelatorio,
  tryUnlinkLogoFile,
  sanitizeEmpresaRow,
};
