const path = require('path');
const fs = require('fs');

/** Mesmo padrão de fornecedores/usuários: grava em process.cwd() (tenant PM2 / .exe). */
const EMP_LOGO_BASE = path.join(process.cwd(), 'public', 'uploads', 'empresas');

function empLogoBaseDirs() {
  const dirs = [EMP_LOGO_BASE];
  const legacy = path.join(__dirname, '..', 'public', 'uploads', 'empresas');
  if (legacy !== EMP_LOGO_BASE) dirs.push(legacy);
  return dirs;
}

function webPathEmpresaLogo(idEmpresa, filename) {
  return `/uploads/empresas/${idEmpresa}/${filename}`;
}

function fsPathFromLogoRelatorio(rel) {
  if (!rel || typeof rel !== 'string') return null;
  const m = rel.match(/^\/uploads\/empresas\/(\d+)\/([^/]+)$/);
  if (!m) return null;
  for (const base of empLogoBaseDirs()) {
    const fp = path.join(base, m[1], m[2]);
    if (fs.existsSync(fp)) return fp;
  }
  return path.join(EMP_LOGO_BASE, m[1], m[2]);
}

/** Corrige logo_relatorio quando o arquivo do banco não existe mais (404 no browser). */
function resolveEmpresaLogoRelatorio(idEmpresa, relFromDb) {
  const id = String(idEmpresa);
  const fp = fsPathFromLogoRelatorio(relFromDb);
  if (fp && fs.existsSync(fp)) return relFromDb || null;

  for (const base of empLogoBaseDirs()) {
    const dir = path.join(base, id);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f))
      .sort((a, b) => b.localeCompare(a));
    if (!files.length) continue;
    return webPathEmpresaLogo(id, files[0]);
  }
  return null;
}

function tryUnlinkLogoFile(rel) {
  const fp = fsPathFromLogoRelatorio(rel);
  if (fp && fs.existsSync(fp)) {
    try { fs.unlinkSync(fp); } catch (_) {}
  }
}

/** Garante arquivo no CWD do tenant (onde o express.static serve /uploads). */
function ensureLogoInTenantDir(idEmpresa, rel) {
  if (!rel) return rel;
  const m = rel.match(/^\/uploads\/empresas\/(\d+)\/([^/]+)$/);
  if (!m) return rel;
  const fileName = m[2];
  const dest = path.join(EMP_LOGO_BASE, String(idEmpresa), fileName);
  if (fs.existsSync(dest)) return rel;

  let src = null;
  for (const base of empLogoBaseDirs()) {
    const candidate = path.join(base, String(idEmpresa), fileName);
    if (fs.existsSync(candidate)) {
      src = candidate;
      break;
    }
  }
  if (!src || src === dest) return rel;

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  } catch (_) {}
  return rel;
}

async function sanitizeEmpresaRow(pool, row) {
  if (!row || row.id_empresa == null) return row;
  const original = row.logo_relatorio || null;
  let resolved = resolveEmpresaLogoRelatorio(row.id_empresa, original);
  if (resolved) {
    resolved = ensureLogoInTenantDir(row.id_empresa, resolved);
    row.logo_relatorio = resolved;
    if (pool && resolved !== original) {
      await pool.query(
        `UPDATE empresa SET logo_relatorio=? WHERE id_empresa=? AND COALESCE(NULLIF(TRIM(excluido), ''), 'N') = 'N'`,
        [resolved, row.id_empresa]
      ).catch(() => {});
    }
  }
  // Arquivo ausente no disco: mantém o caminho gravado no banco (não zera logo_relatorio).
  return row;
}

module.exports = {
  EMP_LOGO_BASE,
  empLogoBaseDirs,
  webPathEmpresaLogo,
  fsPathFromLogoRelatorio,
  resolveEmpresaLogoRelatorio,
  tryUnlinkLogoFile,
  ensureLogoInTenantDir,
  sanitizeEmpresaRow,
};
