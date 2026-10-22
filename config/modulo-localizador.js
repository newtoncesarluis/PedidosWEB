'use strict';

/**
 * Gate do módulo Localizador (mapa de prospecção: busca de comércios, busca profunda por CNAE,
 * 1º/2º/3º toque no WhatsApp, integração com o Buscador). Mesmo desenho do módulo Marketplace:
 * a flag mora em `sistema_licencas.modulo_localizador` (banco REMOTO de licenças), só o painel
 * do desenvolvedor liga/desliga, e qualquer falha de consulta = módulo bloqueado (falha fechada).
 * Sem o módulo, o cliente usa o mapa simples (`/pages/mapa-clientes-simples.html`).
 */

const { getLicensePool } = require('./db-license');
const { chaveDoRequest } = require('./modulo-marketplace');

const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map();   // chave_licenca → { valor, expira }
let _colunaOk = false;

async function ensureColunaModuloLocalizador(licPool) {
  if (_colunaOk) return;
  try {
    const [cols] = await licPool.query(`SHOW COLUMNS FROM sistema_licencas LIKE 'modulo_localizador'`);
    if (!cols.length) {
      await licPool.query(
        `ALTER TABLE sistema_licencas
           ADD COLUMN modulo_localizador TINYINT(1) NOT NULL DEFAULT 0
           COMMENT 'Add-on Localizador (mapa de prospecção) liberado pelo desenvolvedor'`
      );
    }
    _colunaOk = true;
  } catch { /* sem DDL / servidor fora: a leitura falha fechada */ }
}

/** O módulo Localizador está liberado para esta licença? */
async function localizadorHabilitado(chaveLicenca) {
  const chave = String(chaveLicenca || '').trim().toUpperCase();
  if (!chave) return false;
  const hit = _cache.get(chave);
  if (hit && hit.expira > Date.now()) return hit.valor;

  let valor = false;
  try {
    const licPool = getLicensePool();
    await ensureColunaModuloLocalizador(licPool);
    const [[row]] = await licPool.query(
      `SELECT modulo_localizador FROM sistema_licencas WHERE chave_licenca = ? AND ativo = 1 LIMIT 1`, [chave]
    );
    valor = Number(row && row.modulo_localizador) === 1;
  } catch { valor = false; }
  _cache.set(chave, { valor, expira: Date.now() + CACHE_TTL_MS });
  return valor;
}

function resetCacheModuloLocalizador(chaveLicenca) {
  if (chaveLicenca) _cache.delete(String(chaveLicenca).trim().toUpperCase());
  else _cache.clear();
}

/** Middleware: 403 com `modulo: 'LOCALIZADOR'` (contratação, não permissão de usuário). */
async function exigeModuloLocalizador(req, res, next) {
  if (await localizadorHabilitado(chaveDoRequest(req))) return next();
  return res.status(403).json({
    error: 'O módulo Localizador não está habilitado para esta licença.',
    modulo: 'LOCALIZADOR',
    contato: 'Entre em contato com o suporte para contratar o módulo.',
  });
}

module.exports = { localizadorHabilitado, exigeModuloLocalizador, resetCacheModuloLocalizador, ensureColunaModuloLocalizador };
