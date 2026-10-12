'use strict';

/**
 * Sanitiza HTML da observação do pedido (permite formatação simples tipo Word).
 * Tags: b/strong, i/em, u, span, br, div, p, font
 * Atributos: style só com color; face/size/color em font (legado).
 */

const TAG_OK = /^(b|strong|i|em|u|span|br|div|p|font)$/i;

function _somenteCorStyle(styleAttr) {
  if (!styleAttr) return '';
  const raw = String(styleAttr)
    .replace(/^\s*style\s*=\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
  const m = raw.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  if (!m) return '';
  const cor = String(m[1] || '').trim().slice(0, 40);
  if (!cor || /expression|url\s*\(|javascript/i.test(cor)) return '';
  return ` style="color:${cor}"`;
}

function sanitizeObsPedidoHtml(input) {
  if (input == null) return '';
  let s = String(input);
  if (!s.trim()) return '';

  // Remove blocos perigosos inteiros
  s = s.replace(/<(script|iframe|object|embed|link|style|meta|base|svg|math)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(script|iframe|object|embed|link|style|meta|base|svg|math)[^>]*\/?>/gi, '');
  s = s.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/javascript\s*:/gi, '');

  // Se não tem tag, mantém texto puro (preserva \n)
  if (!/<[a-z]/i.test(s)) return s;

  // Reescreve tags: remove as não permitidas (mantém conteúdo) e limpa atributos
  s = s.replace(/<\/?([a-z0-9]+)(\s[^>]*)?>/gi, (full, tag, attrs) => {
    const t = String(tag || '').toLowerCase();
    const fecha = full.startsWith('</');
    if (!TAG_OK.test(t)) return '';
    if (fecha) return t === 'br' ? '' : `</${t}>`;
    if (t === 'br') return '<br>';
    let outAttrs = '';
    if (t === 'span' || t === 'font' || t === 'p' || t === 'div') {
      const styleM = (attrs || '').match(/\sstyle\s*=\s*("[^"]*"|'[^']*')/i);
      if (styleM) outAttrs += _somenteCorStyle(styleM[0]);
      if (t === 'font') {
        const colorM = (attrs || '').match(/\scolor\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i);
        if (colorM && !outAttrs) {
          const c = colorM[1].replace(/^["']|["']$/g, '').slice(0, 40);
          if (c && !/expression|url\s*\(|javascript/i.test(c)) outAttrs += ` style="color:${c}"`;
        }
      }
    }
    return `<${t}${outAttrs}>`;
  });

  return s.trim();
}

function obsPedidoTemHtml(s) {
  return /<\s*(b|strong|i|em|u|span|br|div|p|font)\b/i.test(String(s || ''));
}

module.exports = {
  sanitizeObsPedidoHtml,
  obsPedidoTemHtml,
};
