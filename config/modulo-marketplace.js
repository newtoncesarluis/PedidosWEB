'use strict';

/**
 * Gate do módulo Marketplace — liberação exclusiva do desenvolvedor.
 *
 * A flag mora em `sistema_licencas.modulo_marketplace` (banco REMOTO de
 * licenças), não no banco do cliente. Isso é proposital: o admin do tenant
 * não consegue se auto-liberar mexendo em Configuração do Sistema — só quem
 * tem acesso ao painel de licenças habilita.
 *
 * Regra de acesso ao módulo = módulo liberado na licença  E  permissão do
 * usuário. As duas coisas são independentes: a licença diz se o CLIENTE
 * comprou, a permissão diz se aquele USUÁRIO pode ver.
 *
 * Falha fechada: erro de rede/consulta = módulo bloqueado. Nunca liberar
 * por acidente quando o servidor de licenças está fora do ar.
 */

const { getLicensePool } = require('./db-license');
const { getBoundChave }  = require('./database');

const CACHE_TTL_MS = 5 * 60 * 1000;   // 5 min — libera/bloqueia sem reiniciar
const _cache = new Map();             // chave_licenca → { valor, expira }
let _colunaOk = false;

/** Cria a coluna no banco de licenças, uma vez por processo. */
async function ensureColunaModuloMarketplace(licPool) {
  if (_colunaOk) return;
  try {
    const [cols] = await licPool.query(
      `SHOW COLUMNS FROM sistema_licencas LIKE 'modulo_marketplace'`
    );
    if (!cols.length) {
      await licPool.query(
        `ALTER TABLE sistema_licencas
           ADD COLUMN modulo_marketplace TINYINT(1) NOT NULL DEFAULT 0
           COMMENT 'Add-on Marketplace liberado pelo desenvolvedor'`
      );
    }
    _colunaOk = true;
  } catch {
    // Sem permissão de DDL ou servidor fora — segue e falha fechada na leitura
  }
}

/** Resolve a chave de licença do request (instância bound ou multi-tenant). */
function chaveDoRequest(req) {
  const chave = req?.user?.chave_licenca || getBoundChave() || null;
  return chave ? String(chave).trim().toUpperCase() : null;
}

/**
 * O módulo Marketplace está liberado para esta licença?
 * @returns {Promise<boolean>}
 */
async function marketplaceHabilitado(chaveLicenca) {
  const chave = String(chaveLicenca || '').trim().toUpperCase();
  if (!chave) return false;

  const hit = _cache.get(chave);
  if (hit && hit.expira > Date.now()) return hit.valor;

  let valor = false;
  try {
    const licPool = getLicensePool();
    await ensureColunaModuloMarketplace(licPool);
    const [[row]] = await licPool.query(
      `SELECT modulo_marketplace FROM sistema_licencas
        WHERE chave_licenca = ? AND ativo = 1 LIMIT 1`,
      [chave]
    );
    valor = Number(row?.modulo_marketplace) === 1;
  } catch {
    valor = false; // falha fechada
  }

  _cache.set(chave, { valor, expira: Date.now() + CACHE_TTL_MS });
  return valor;
}

/** Limpa o cache — chamado quando o desenvolvedor altera a flag. */
function resetCacheModuloMarketplace(chaveLicenca) {
  if (chaveLicenca) _cache.delete(String(chaveLicenca).trim().toUpperCase());
  else _cache.clear();
}

/**
 * Middleware: bloqueia a rota se o módulo não estiver liberado na licença.
 * Responde 403 com `modulo: 'MARKETPLACE'` para o frontend saber que é
 * questão de contratação, não de permissão de usuário.
 */
async function exigeModuloMarketplace(req, res, next) {
  const chave = chaveDoRequest(req);
  if (await marketplaceHabilitado(chave)) return next();
  return res.status(403).json({
    error:  'Módulo Marketplace não está habilitado para esta licença.',
    modulo: 'MARKETPLACE',
    contato: 'Entre em contato com o suporte para contratar o módulo.'
  });
}

module.exports = {
  marketplaceHabilitado,
  exigeModuloMarketplace,
  resetCacheModuloMarketplace,
  ensureColunaModuloMarketplace,
  chaveDoRequest,
};
