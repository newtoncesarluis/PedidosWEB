'use strict';

/**
 * Provedor de WhatsApp "externo" ativo no tenant (plataforma hospedada, sem instância/QR):
 *   EuAtendo  → config/euatendo.js
 *   Meta      → config/meta-whatsapp.js  (API oficial — WhatsApp Cloud API)
 * Quando nenhum dos dois está ativo devolve null e o chamador segue o fluxo da Evolution API (instância do usuário).
 *
 * Um único ponto de decisão evita repetir "if euatendo … else if meta … else evolution" em cada rota.
 */

const { euatendoAtivo, enviarTextoEuAtendo, enviarMediaEuAtendo } = require('./euatendo');
const { metaAtivo, enviarTextoMeta, enviarMediaMeta } = require('./meta-whatsapp');

const NOMES = {
  EUATENDO: 'ApiChat EuAtendo',
  META: 'Meta (API oficial)',
  EVOLUTION: 'Evolution API',
};

/** Nome amigável do provedor para mensagens/toasts. */
function nomeProvedor(tipo) {
  return NOMES[String(tipo || '').toUpperCase()] || (tipo || 'API WhatsApp');
}

/**
 * @returns {Promise<null | {
 *   tipo: 'EUATENDO'|'META', nome: string, cfg: object,
 *   enviarTexto: (numero:string, texto:string, opts?:object) => Promise<object>,
 *   enviarMedia: (numero:string, arquivo:{buffer,filename,mimetype,caption}) => Promise<object>
 * }>}
 */
async function provedorExterno(pool) {
  const meta = await metaAtivo(pool).catch(() => null);
  if (meta) {
    return {
      tipo: 'META',
      nome: NOMES.META,
      cfg: meta,
      enviarTexto: (numero, texto, opts) => enviarTextoMeta(meta, numero, texto, opts),
      enviarMedia: (numero, arquivo) => enviarMediaMeta(meta, numero, arquivo),
    };
  }
  const ea = await euatendoAtivo(pool).catch(() => null);
  if (ea) {
    return {
      tipo: 'EUATENDO',
      nome: NOMES.EUATENDO,
      cfg: ea,
      enviarTexto: (numero, texto, opts) => enviarTextoEuAtendo(ea, numero, texto, opts),
      enviarMedia: (numero, arquivo) => enviarMediaEuAtendo(ea, numero, arquivo),
    };
  }
  return null;
}

module.exports = { provedorExterno, nomeProvedor, NOMES };
