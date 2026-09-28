'use strict';

const { XMLParser } = require('fast-xml-parser');

const _parser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  parseTagValue:       true,
  trimValues:          true,
  isArray: (name) => ['det', 'dup', 'detPag', 'NFref'].includes(name),
});

function _icmsPct(icmsNode) {
  if (!icmsNode) return 0;
  for (const key of Object.keys(icmsNode)) {
    if (key.startsWith('ICMS') || key.startsWith('icms')) {
      const v = parseFloat(icmsNode[key]?.pICMS ?? 0);
      if (!isNaN(v)) return v;
    }
  }
  return 0;
}

function _ipiDados(ipiNode) {
  if (!ipiNode) return { pIPI: 0, vIPI: 0 };
  const trib = ipiNode.IPITrib ?? {};
  return {
    pIPI: parseFloat(trib.pIPI ?? 0),
    vIPI: parseFloat(trib.vIPI ?? ipiNode.vIPI ?? 0),
  };
}

function _asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function _onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

function _dataIsoNFe(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // 2024-08-14T10:00:00-03:00 ou 2024-08-14
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  // 14/08/2024
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return s.slice(0, 10);
}

function _parseEmit(emit) {
  if (!emit) return { nome: '', cnpj: '', cpf: '', ie: '', fantasia: '' };
  return {
    nome: String(emit.xNome || '').trim(),
    fantasia: String(emit.xFant || '').trim(),
    cnpj: _onlyDigits(emit.CNPJ),
    cpf: _onlyDigits(emit.CPF),
    ie: String(emit.IE || '').trim(),
  };
}

function _parseTotal(total) {
  const icmsTot = total?.ICMSTot || {};
  return {
    vProd: parseFloat(icmsTot.vProd) || 0,
    vFrete: parseFloat(icmsTot.vFrete) || 0,
    vSeg: parseFloat(icmsTot.vSeg) || 0,
    vDesc: parseFloat(icmsTot.vDesc) || 0,
    vII: parseFloat(icmsTot.vII) || 0,
    vIPI: parseFloat(icmsTot.vIPI) || 0,
    vPIS: parseFloat(icmsTot.vPIS) || 0,
    vCOFINS: parseFloat(icmsTot.vCOFINS) || 0,
    vOutro: parseFloat(icmsTot.vOutro) || 0,
    vNF: parseFloat(icmsTot.vNF) || 0,
  };
}

/**
 * Duplicatas de cobrança (cobr/dup). Se não houver, tenta detPag.
 * Sempre retorna ao menos 1 parcela com o total da NF se nada for encontrado.
 */
function _parseDuplicatas(infNFe, totalNF, dataEmissao) {
  const cobr = infNFe.cobr || {};
  const dups = _asArray(cobr.dup);
  const out = [];

  for (const d of dups) {
    const venc = _dataIsoNFe(d.dVenc);
    const vlr = parseFloat(d.vDup) || 0;
    if (vlr <= 0) continue;
    out.push({
      numero: String(d.nDup || out.length + 1),
      vencimento: venc || dataEmissao || '',
      valor: Math.round(vlr * 100) / 100,
    });
  }

  if (out.length) return out;

  // Fallback: pagamentos à vista / detPag
  const pag = infNFe.pag || {};
  const dets = _asArray(pag.detPag);
  for (const p of dets) {
    const vlr = parseFloat(p.vPag) || 0;
    if (vlr <= 0) continue;
    out.push({
      numero: String(out.length + 1),
      vencimento: dataEmissao || '',
      valor: Math.round(vlr * 100) / 100,
      forma: String(p.tPag || ''),
    });
  }

  if (out.length) return out;

  const vlr = parseFloat(totalNF) || 0;
  if (vlr > 0) {
    return [{
      numero: '1',
      vencimento: dataEmissao || '',
      valor: Math.round(vlr * 100) / 100,
      unica_parcela_total: true,
    }];
  }
  return [];
}

/**
 * Recebe o Buffer do arquivo XML e retorna os dados estruturados da NF-e.
 * Lança Error em caso de XML inválido ou estrutura não reconhecida.
 */
function parseNFe(xmlBuffer) {
  let parsed;
  let xmlText;
  try {
    xmlText = Buffer.isBuffer(xmlBuffer) ? xmlBuffer.toString('utf8') : String(xmlBuffer || '');
    // Remove BOM e lixo antes do <?xml / <nfeProc / <NFe
    xmlText = xmlText.replace(/^\uFEFF/, '').replace(/^[\s\S]*?(?=<\?xml|<nfeProc|<NFe)/i, '');
    parsed = _parser.parse(xmlText);
  } catch (e) {
    throw new Error(`Falha ao ler o XML: ${e.message}`);
  }

  const nfe = parsed.nfeProc?.NFe ?? parsed.NFe;
  if (!nfe) throw new Error('Estrutura NF-e não reconhecida no XML enviado.');

  const infNFe = nfe.infNFe;
  if (!infNFe) throw new Error('XML sem bloco infNFe.');
  const infProt = parsed.nfeProc?.protNFe?.infProt;

  let chave = String(infProt?.chNFe ?? '');
  if (!chave) {
    const idAttr = infNFe['@_Id'] ?? '';
    chave = idAttr.startsWith('NFe') ? idAttr.slice(3) : idAttr;
  }

  const ide = infNFe.ide ?? {};
  const emit = _parseEmit(infNFe.emit);
  const total = _parseTotal(infNFe.total);
  const dataEmissao = _dataIsoNFe(ide.dhEmi ?? ide.dEmi);
  const dets = _asArray(infNFe.det);

  const items = dets.map((det, idx) => {
    const prod = det.prod ?? {};
    const imp = det.imposto ?? {};
    const { pIPI, vIPI } = _ipiDados(imp.IPI);
    const pICMS = _icmsPct(imp.ICMS);
    const qCom = parseFloat(prod.qCom ?? 0);
    const vUnCom = parseFloat(prod.vUnCom ?? 0);
    const vProd = parseFloat(prod.vProd ?? 0);
    const ean = [prod.cEAN, prod.cEANTrib]
      .map((v) => String(v || '').trim())
      .find((v) => v && v !== 'SEM GTIN') || '';

    return {
      sequencial: idx + 1,
      cod_fabricante: String(prod.cProd ?? ''),
      cod_barras: ean,
      descricao: String(prod.xProd ?? ''),
      cod_desc_prod: `${prod.cProd} - ${prod.xProd}`,
      ncm: String(prod.NCM ?? ''),
      cfop: String(prod.CFOP ?? ''),
      unidade: String(prod.uCom ?? ''),
      quantidade: qCom,
      valor_unitario: vUnCom,
      vlrvenda_original: vUnCom,
      vlr_produtosemdesc: vUnCom,
      valor_semdesconto: vUnCom,
      total_produtos: vProd,
      vlrbruto: vUnCom,
      vlrtotalbruto: vUnCom * qCom,
      icms: pICMS,
      ipi: pIPI,
      vlr_ipi: vIPI,
    };
  });

  const duplicatas = _parseDuplicatas(infNFe, total.vNF || total.vProd, dataEmissao);

  return {
    chave,
    data_emissao: dataEmissao,
    numero: String(ide.nNF ?? ''),
    serie: String(ide.serie ?? ''),
    natureza: String(ide.natOp ?? ''),
    emitente: emit,
    total,
    duplicatas,
    items,
  };
}

module.exports = { parseNFe };
