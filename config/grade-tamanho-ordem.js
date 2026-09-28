'use strict';

/** Ordem padrão de tamanhos alfabéticos (confecção) — fallback quando sequencial = 0. */
const LETRA_ORDEM = ['PP', 'P', 'M', 'G', 'GG', 'EG', 'XG', 'XXG', 'XXXG', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'];
const _letraRank = new Map(LETRA_ORDEM.map((k, i) => [k, i]));

function letraRank(t) {
  const k = String(t || '').trim().toUpperCase();
  return _letraRank.has(k) ? _letraRank.get(k) : null;
}

function isNumTam(t) {
  const s = String(t || '').trim();
  return /^\d+([.,]\d+)?$/.test(s) && Number.isFinite(parseFloat(s.replace(',', '.')));
}

function numTam(t) {
  return parseFloat(String(t).trim().replace(',', '.'));
}

function seqMapFromItens(itens, nomeKey) {
  const key = nomeKey || 'nome';
  const m = new Map();
  (itens || []).forEach((it) => {
    const n = String(it[key] || it.nome_grade || it.nome || '').trim();
    const s = parseInt(it.sequencial, 10);
    if (!n || !Number.isFinite(s) || s <= 0) return;
    const prev = m.get(n);
    if (prev == null || s < prev) m.set(n, s);
  });
  return m;
}

function cmpTamanhoGrade(a, b, seqMap) {
  const ka = String(a || '').trim();
  const kb = String(b || '').trim();
  const getSeq = (k) => {
    if (!seqMap) return null;
    if (seqMap instanceof Map) return seqMap.has(k) ? seqMap.get(k) : null;
    if (typeof seqMap === 'object' && seqMap[k] != null) {
      const s = parseInt(seqMap[k], 10);
      return Number.isFinite(s) && s > 0 ? s : null;
    }
    return null;
  };
  const sa = getSeq(ka);
  const sb = getSeq(kb);
  if (sa != null && sb != null && sa !== sb) return sa - sb;
  if (sa != null && sb == null) return -1;
  if (sa == null && sb != null) return 1;

  if (isNumTam(ka) && isNumTam(kb)) return numTam(ka) - numTam(kb);
  // Mapa unificado (44…54 + P/M/G): números antes das letras
  if (isNumTam(ka) && !isNumTam(kb)) return -1;
  if (!isNumTam(ka) && isNumTam(kb)) return 1;

  const ra = letraRank(ka);
  const rb = letraRank(kb);
  if (ra != null && rb != null && ra !== rb) return ra - rb;
  if (ra != null && rb == null) return -1;
  if (ra == null && rb != null) return 1;

  return ka.localeCompare(kb, 'pt-BR', { numeric: true, sensitivity: 'base' });
}

function ordenarItensGrade(itens, nomeKey) {
  const key = nomeKey || 'nome';
  const m = seqMapFromItens(itens, key);
  return (itens || []).slice().sort((a, b) =>
    cmpTamanhoGrade(
      String(a[key] || a.nome_grade || a.nome || ''),
      String(b[key] || b.nome_grade || b.nome || ''),
      m
    )
  );
}

function ordenarNomesTamanho(nomes, seqMap) {
  return (nomes || []).slice().sort((a, b) => cmpTamanhoGrade(a, b, seqMap));
}

/**
 * União de tamanhos de uma ou várias tipogrades.
 * Com mais de uma fonte (ex.: Masc 38–43 + Fem 34–39), o sequencial de cada
 * cadastro conflita (ambos começam em 1) e a ordem visual fica errada
 * (38…43 depois 34…37). Também falha quando só uma grade grava sequencial
 * e a outra não — os números sem seq vão para o fim.
 * Regra: tamanhos todos numéricos → sempre ordem natural (34…43).
 * Letras (P/M/G) numa grade só → mantém sequencial do cadastro.
 */
function ordenarNomesTamanhoUniao(nomes, seqItems, multiFonte) {
  const list = nomes || [];
  const allNum = list.length > 0 && list.every(isNumTam);
  if (allNum || multiFonte) {
    return ordenarNomesTamanho(list, null);
  }
  const seqMap = seqMapFromItens(seqItems || [], 'nome_grade');
  // Sequencial incompleto (parte dos tamanhos sem seq) → ordem natural
  if (seqMap && seqMap.size > 0 && seqMap.size < list.length) {
    return ordenarNomesTamanho(list, null);
  }
  return ordenarNomesTamanho(list, seqMap);
}

module.exports = {
  cmpTamanhoGrade,
  seqMapFromItens,
  ordenarItensGrade,
  ordenarNomesTamanho,
  ordenarNomesTamanhoUniao,
  letraRank,
};
