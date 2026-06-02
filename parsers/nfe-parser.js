const { XMLParser } = require('fast-xml-parser');

const _parser = new XMLParser({
  ignoreAttributes:    false,
  attributeNamePrefix: '@_',
  parseAttributeValue: true,
  parseTagValue:       true,
  trimValues:          true,
  isArray: name => name === 'det'   // det pode ser único ou múltiplo
});

// ─── Extrai % de ICMS de qualquer variante (ICMS00, ICMS10, ICMS20…) ──────────
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

// ─── Extrai IPI (IPITrib = tributado; IPINT = não tributado) ─────────────────
function _ipiDados(ipiNode) {
  if (!ipiNode) return { pIPI: 0, vIPI: 0 };
  const trib = ipiNode.IPITrib ?? {};
  return {
    pIPI: parseFloat(trib.pIPI ?? 0),
    vIPI: parseFloat(trib.vIPI ?? ipiNode.vIPI ?? 0)
  };
}

/**
 * Recebe o Buffer do arquivo XML e retorna os dados estruturados da NF-e.
 * Lança Error em caso de XML inválido ou estrutura não reconhecida.
 */
function parseNFe(xmlBuffer) {
  let parsed;
  try {
    parsed = _parser.parse(xmlBuffer.toString('utf8'));
  } catch (e) {
    throw new Error(`Falha ao ler o XML: ${e.message}`);
  }

  // Suporta nfeProc (com protocolo SEFAZ) e NFe (sem protocolo)
  const nfe    = parsed.nfeProc?.NFe ?? parsed.NFe;
  if (!nfe) throw new Error('Estrutura NF-e não reconhecida no XML enviado.');

  const infNFe  = nfe.infNFe;
  const infProt = parsed.nfeProc?.protNFe?.infProt;

  // Chave de acesso: preferencialmente do protocolo; fallback do atributo Id
  let chave = String(infProt?.chNFe ?? '');
  if (!chave) {
    const idAttr = infNFe['@_Id'] ?? '';
    chave = idAttr.startsWith('NFe') ? idAttr.slice(3) : idAttr;
  }

  const ide = infNFe.ide ?? {};
  const dets = Array.isArray(infNFe.det) ? infNFe.det : (infNFe.det ? [infNFe.det] : []);

  const items = dets.map((det, idx) => {
    const prod = det.prod  ?? {};
    const imp  = det.imposto ?? {};

    const { pIPI, vIPI } = _ipiDados(imp.IPI);
    const pICMS           = _icmsPct(imp.ICMS);

    const qCom   = parseFloat(prod.qCom   ?? 0);
    const vUnCom = parseFloat(prod.vUnCom ?? 0);
    const vProd  = parseFloat(prod.vProd  ?? 0);

    return {
      sequencial:          idx + 1,
      cod_fabricante:      String(prod.cProd  ?? ''),
      cod_barras:          String(prod.cEAN   ?? ''),
      descricao:           String(prod.xProd  ?? ''),
      cod_desc_prod:       `${prod.cProd} - ${prod.xProd}`,
      ncm:                 String(prod.NCM    ?? ''),
      cfop:                String(prod.CFOP   ?? ''),
      unidade:             String(prod.uCom   ?? ''),
      quantidade:          qCom,
      valor_unitario:      vUnCom,
      vlrvenda_original:   vUnCom,
      vlr_produtosemdesc:  vUnCom,
      valor_semdesconto:   vUnCom,
      total_produtos:      vProd,
      vlrbruto:            vUnCom,
      vlrtotalbruto:       vUnCom * qCom,
      icms:                pICMS,
      ipi:                 pIPI,
      vlr_ipi:             vIPI
    };
  });

  return {
    chave,
    data_emissao: String(ide.dhEmi ?? ide.dEmi ?? ''),
    numero:       String(ide.nNF   ?? ''),
    serie:        String(ide.serie ?? ''),
    natureza:     String(ide.natOp ?? ''),
    items
  };
}

module.exports = { parseNFe };
