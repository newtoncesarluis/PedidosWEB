/**
 * Seletor de cores (pai → filhos) para pedido / showroom / vitrine.
 * Com habilitapedidograde + tipograde: qtd por tamanho (grade) em cada cor.
 * Uso: ProdutoCoresPicker.open({ grupo, onConfirm, formatPreco?, titulo?, habilitaGrade?, fetchGrade?, fetchGradesProduto? })
 *      ProdutoCoresPicker.tryFromProdutoId(id, { fetchGrupo, onConfirm, ... })
 */
(function (global) {
  'use strict';

  const CSS_ID = 'sysrep-prod-cores-picker-css-v24';
  const MODAL_ID = 'sysrepProdCoresPicker';
  const MODAL_VER = '24';

  function ensureCss() {
    // Sempre recria o CSS (evita estilo antigo empilhando cards)
    document.querySelectorAll('[id^="sysrep-prod-cores-picker-css-"]').forEach((el) => el.remove());
    const s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
#${MODAL_ID}{position:fixed;inset:0;z-index:2147483645;display:none;align-items:center;justify-content:center;
  background:rgba(15,23,42,.5);padding:16px;box-sizing:border-box;
  padding-bottom:max(16px, env(safe-area-inset-bottom, 0px));
  -webkit-overflow-scrolling:touch}
#${MODAL_ID}.show{display:flex}
#${MODAL_ID} .pcp-card{background:var(--card,#fff);color:var(--text,#111);
  width:min(960px,100%);max-height:min(90vh,860px);border-radius:16px;border:1px solid var(--border,#e5e7eb);
  box-shadow:0 24px 64px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden}
#${MODAL_ID}.pcp-has-grade .pcp-card{width:min(1040px,100%)}
#${MODAL_ID} .pcp-head{padding:14px 18px 12px;border-bottom:1px solid var(--border,#e5e7eb);flex-shrink:0;display:flex;align-items:flex-start;gap:10px}
#${MODAL_ID} .pcp-head-text{flex:1;min-width:0}
#${MODAL_ID} .pcp-head h3{margin:0;font-size:16px;font-weight:800;letter-spacing:-.01em}
#${MODAL_ID} .pcp-head p{margin:4px 0 0;font-size:12px;color:var(--text2,#6b7280);line-height:1.35}
#${MODAL_ID} .pcp-close{flex-shrink:0;width:40px;height:40px;border:none;border-radius:10px;background:transparent;color:var(--text2,#6b7280);font-size:22px;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent}
#${MODAL_ID} .pcp-close:active{background:color-mix(in srgb, var(--text2,#6b7280) 12%, transparent)}

/* Flex wrap — CSS grid + aspect-ratio empilhava os cards */
#${MODAL_ID} .pcp-list{overflow:auto;padding:14px 16px;flex:1;min-height:0;-webkit-overflow-scrolling:touch;
  display:flex;flex-wrap:wrap;gap:12px;align-content:flex-start;align-items:flex-start;justify-content:flex-start}
#${MODAL_ID} .pcp-row{display:flex;flex-direction:column;flex:0 0 168px;width:168px;max-width:100%;
  position:static;float:none;padding:0;margin:0;box-sizing:border-box;
  border:1px solid var(--border,#e5e7eb);border-radius:12px;overflow:hidden;
  background:var(--card,#fff);transition:border-color .15s,box-shadow .15s;
  -webkit-tap-highlight-color:transparent;touch-action:manipulation;cursor:pointer}
#${MODAL_ID} .pcp-row.pcp-on{border-color:var(--accent,#0d9488);
  box-shadow:0 0 0 2px color-mix(in srgb, var(--accent,#0d9488) 28%, transparent)}
#${MODAL_ID} .pcp-row.pcp-off{background:color-mix(in srgb, var(--bg,#f8fafc) 55%, var(--card,#fff))}
#${MODAL_ID} .pcp-row.pcp-off:hover{border-color:color-mix(in srgb, var(--accent,#0d9488) 40%, var(--border,#e5e7eb))}

#${MODAL_ID} .pcp-row.pcp-row-grade.pcp-off .pcp-body{display:none}
#${MODAL_ID} .pcp-row.pcp-row-grade.pcp-on .pcp-body{display:block;padding:8px 10px 12px;
  border-top:1px solid var(--border,#e5e7eb);background:color-mix(in srgb, var(--accent,#0d9488) 5%, var(--card,#fff))}

#${MODAL_ID} .pcp-card-top{display:flex;flex-direction:column;width:100%;position:static;flex:0 0 auto}

/* Foto: altura FIXA, img em fluxo (sem absolute / sem aspect-ratio) */
#${MODAL_ID} .pcp-media{display:flex;align-items:center;justify-content:center;
  width:100%;height:132px;flex:0 0 132px;box-sizing:border-box;padding:10px;
  background:var(--bg,#f8fafc);border-bottom:1px solid var(--border,#e5e7eb);
  overflow:hidden;cursor:pointer;position:static}
#${MODAL_ID} .pcp-foto{display:block;max-width:100%;max-height:112px;width:auto;height:auto;
  object-fit:contain;object-position:center;border:none;background:transparent;cursor:pointer;position:static}
#${MODAL_ID} .pcp-foto-ph{display:flex;align-items:center;justify-content:center;
  width:100%;height:100%;margin:0;border:none;font-size:34px;color:var(--text2,#9ca3af);
  background:transparent;cursor:pointer;position:static}

#${MODAL_ID} .pcp-card-caption{padding:10px 10px 12px;display:flex;flex-direction:column;gap:4px;min-width:0}
#${MODAL_ID} .pcp-title-row{display:flex;align-items:flex-start;gap:8px;min-width:0}
#${MODAL_ID} .pcp-chk-wrap{position:static;display:flex;align-items:center;justify-content:center;
  padding:0;margin:1px 0 0;border-radius:0;background:transparent;box-shadow:none;flex-shrink:0}
#${MODAL_ID} .pcp-chk{width:18px;height:18px;accent-color:var(--accent,#0d9488);cursor:pointer;margin:0;flex-shrink:0}
#${MODAL_ID} .pcp-nome{flex:1;min-width:0;font-size:12px;font-weight:700;line-height:1.3;cursor:pointer;color:var(--text,#111);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#${MODAL_ID} .pcp-meta{font-size:11px;color:var(--text2,#6b7280);line-height:1.3;padding-left:26px}
#${MODAL_ID} .pcp-badges{display:flex;flex-wrap:wrap;gap:4px;padding-left:26px;min-width:0}
#${MODAL_ID} .pcp-badge{font-size:10px;font-weight:700;line-height:1.25;letter-spacing:.01em;
  padding:2px 7px;border-radius:6px;border:1px solid var(--border,#e5e7eb);
  background:var(--bg,#f8fafc);color:var(--text2,#4b5563);max-width:100%;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#${MODAL_ID} .pcp-badge-grade{color:var(--accent,#0d9488);border-color:color-mix(in srgb, var(--accent,#0d9488) 35%, var(--border,#e5e7eb));
  background:color-mix(in srgb, var(--accent,#0d9488) 10%, var(--card,#fff))}
#${MODAL_ID} .pcp-badge-faixa{color:var(--text,#111);border-color:var(--border,#d1d5db)}
#${MODAL_ID} .pcp-badge-load{color:var(--text2,#6b7280);font-weight:600}
#${MODAL_ID} .pcp-head-actions{display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:4px;
  margin-top:4px;padding-left:26px}
#${MODAL_ID} .pcp-head-pack{display:inline-flex;align-items:center;gap:5px;flex-wrap:wrap}
#${MODAL_ID} .pcp-grade-total{font-size:11px;font-weight:700;color:var(--text2,#6b7280);white-space:nowrap;margin:0}
#${MODAL_ID} .pcp-grade-total b{color:var(--accent,#0d9488);font-size:13px}
#${MODAL_ID} .pcp-grade-ok-mini{font-size:10px;font-weight:700;color:#15803d;white-space:nowrap}
#${MODAL_ID} .pcp-grade-aviso-mini{font-size:10px;font-weight:700;color:#b45309;white-space:nowrap;max-width:100%;line-height:1.2}
#${MODAL_ID} .pcp-pack-mini{display:inline-flex;align-items:center;gap:4px;
  padding:2px 2px 2px 6px;border-radius:8px;background:var(--bg,#f8fafc);border:1px solid var(--border,#e5e7eb)}
#${MODAL_ID} .pcp-pack-mini .pcp-pack-x{font-size:11px;font-weight:800;color:var(--text2,#6b7280)}
#${MODAL_ID} .pcp-pack-total{width:42px;height:26px;padding:0 4px;border:1px solid var(--border,#d1d5db);
  border-radius:5px;background:var(--card,#fff);color:var(--text,#111);font-size:12px;font-weight:700;text-align:center}
#${MODAL_ID} .pcp-pack-total:focus{border-color:var(--accent,#0d9488);outline:none}
#${MODAL_ID} .pcp-pack-aplicar{height:26px;min-width:26px;padding:0 8px;border:none;border-radius:5px;
  background:var(--accent,#0d9488);color:#fff;font-size:11px;font-weight:800;cursor:pointer;
  display:inline-flex;align-items:center;justify-content:center}
#${MODAL_ID} .pcp-pack-aplicar svg{width:12px;height:12px}
#${MODAL_ID} .pcp-qtd{width:100%;min-height:40px;padding:8px;border:1px solid var(--border,#d1d5db);border-radius:8px;
  background:var(--card,#fff);color:var(--text,#111);font-size:16px;text-align:center;margin-top:6px;box-sizing:border-box}
#${MODAL_ID} .pcp-grade-wrap{margin-top:0}
#${MODAL_ID} .pcp-grade-lbl{font-size:10px;font-weight:800;color:var(--text2,#6b7280);text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px}
#${MODAL_ID} .pcp-grade-sel{width:100%;height:36px;margin-bottom:8px;font-size:12px;font-weight:600;
  border:1.5px solid var(--accent,#0d9488);border-radius:8px;background:var(--card,#fff);color:var(--text,#111);padding:0 8px;cursor:pointer}
#${MODAL_ID} .pcp-grade-sel option{color:var(--text,#111);background:var(--card,#fff)}
#${MODAL_ID} .pcp-grade-unica{font-size:11px;font-weight:700;color:var(--accent,#0d9488);margin-bottom:6px;
  padding:5px 8px;border-radius:8px;background:color-mix(in srgb, var(--accent,#0d9488) 10%, transparent)}
#${MODAL_ID} .pcp-grade-aviso{font-size:11px;color:#b45309;margin-top:4px;line-height:1.35}
#${MODAL_ID} .pcp-sizes{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-start}
#${MODAL_ID} .pcp-size{display:flex;flex-direction:column;align-items:center;gap:3px;min-width:40px;flex:0 0 auto}
#${MODAL_ID} .pcp-size-lbl{font-size:10px;font-weight:700;color:var(--text2,#6b7280)}
#${MODAL_ID} .pcp-size-qtd{width:40px;min-height:36px;padding:4px 2px;border:1px solid var(--border,#d1d5db);border-radius:7px;
  background:var(--card,#fff);color:var(--text,#111);font-size:14px;text-align:center}
#${MODAL_ID} .pcp-grade-load{font-size:12px;color:var(--text2,#6b7280);padding:4px 0}
#${MODAL_ID} .pcp-foot{padding:12px 16px;padding-bottom:max(12px, env(safe-area-inset-bottom, 0px));
  border-top:1px solid var(--border,#e5e7eb);
  display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;flex-wrap:wrap;align-items:center}
#${MODAL_ID} .pcp-btn{border:none;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:600;cursor:pointer;min-height:42px}
#${MODAL_ID} .pcp-btn-todas{display:none;background:transparent;color:var(--accent,#0d9488);
  border:1px dashed var(--accent,#0d9488);font-size:12px;cursor:pointer}
#${MODAL_ID} .pcp-btn-todas.show{display:inline-flex;align-items:center}
#${MODAL_ID} .pcp-btn-todas.on{background:color-mix(in srgb, var(--accent,#0d9488) 14%, var(--card,#fff));border-style:solid}
#${MODAL_ID} .pcp-btn-sel{background:transparent;color:var(--text2,#6b7280);border:1px solid var(--border,#e5e7eb);
  font-size:12px;padding:8px 10px}
#${MODAL_ID} .pcp-sel-group{display:inline-flex;gap:6px;margin-right:auto;flex-wrap:wrap;align-items:center}
#${MODAL_ID} .pcp-btn-ghost{background:transparent;color:var(--text2,#6b7280);border:1px solid var(--border,#e5e7eb)}
#${MODAL_ID} .pcp-btn-ok{background:var(--accent,#0d9488);color:#fff}
#${MODAL_ID} .pcp-btn-ok:disabled{opacity:.5;cursor:not-allowed}
#${MODAL_ID} .pcp-err{
  display:none;order:0;width:100%;box-sizing:border-box;margin:0 0 4px;
  padding:10px 12px;border-radius:10px;font-size:12px;font-weight:600;line-height:1.4;
  background:#fff7ed;color:#9a3412;border:1px solid #fdba74}
#${MODAL_ID} .pcp-err.show{display:block}
#${MODAL_ID} .pcp-row.pcp-err-row{border-color:#ea580c;box-shadow:0 0 0 2px rgba(234,88,12,.28)}
#${MODAL_ID} .pcp-err-row .pcp-grade-aviso-mini{font-weight:800}

/* ===== Modo galeria (Showroom): miniaturas à esquerda + foto grande ===== */
#${MODAL_ID}.pcp-gal .pcp-card{width:min(1180px,100%);height:min(94vh,820px);height:min(94dvh,820px);max-height:94vh;
  display:grid;grid-template-columns:156px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto}
#${MODAL_ID}.pcp-gal .pcp-head,#${MODAL_ID}.pcp-gal .pcp-foot{grid-column:1/-1}
#${MODAL_ID} .pcp-thumbs{display:none}
#${MODAL_ID}.pcp-gal .pcp-thumbs{position:relative;display:flex;flex-direction:column;flex-wrap:nowrap;gap:8px;min-height:0;overflow:hidden;padding:10px;
  background:var(--bg,#eef1f5);border-right:1px solid var(--border,#e5e7eb)}
/* a coluna rola por SETAS (cima/baixo); a barra de rolagem fica escondida (toque/roda do mouse continuam funcionando) */
#${MODAL_ID} .pcp-th-sc{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column;gap:10px;
  overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch}
#${MODAL_ID} .pcp-th-sc::-webkit-scrollbar{display:none;width:0;height:0}
#${MODAL_ID} .pcp-th-arrow{position:absolute;left:10px;right:10px;z-index:3;height:30px;border:none;border-radius:10px;background:color-mix(in srgb,var(--card,#fff) 94%,transparent);color:var(--text,#111);cursor:pointer;
  display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(15,23,42,.14);-webkit-tap-highlight-color:transparent}
#${MODAL_ID} .pcp-th-up{top:10px}
#${MODAL_ID} .pcp-th-dn{bottom:10px}
#${MODAL_ID} .pcp-th-arrow[hidden]{display:none!important}
#${MODAL_ID} .pcp-thumb{scroll-margin:44px 0}
#${MODAL_ID} .pcp-th-arrow:hover{color:var(--accent,#0d9488)}
#${MODAL_ID} .pcp-th-arrow:active{transform:scale(.97)}
#${MODAL_ID} .pcp-th-arrow svg{width:18px;height:18px;pointer-events:none}
#${MODAL_ID} .pcp-thumb{position:relative;display:block;flex:0 0 auto;width:100%;height:auto;padding:0;box-sizing:border-box;
  border:2px solid transparent;border-radius:10px;background:var(--card,#fff);cursor:pointer;overflow:hidden;
  box-shadow:0 1px 2px rgba(15,23,42,.08);transition:border-color .15s,box-shadow .15s,background .15s}
/* cartão horizontal; a altura vem do padding (aspect-ratio deixava a linha menor e as miniaturas se sobrepunham) */
#${MODAL_ID} .pcp-thumb::before{content:'';display:block;padding-top:74%}
#${MODAL_ID} .pcp-thumb img{position:absolute;inset:4px;width:calc(100% - 8px);height:calc(100% - 8px);object-fit:contain;pointer-events:none}
#${MODAL_ID} .pcp-thumb-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:24px;color:var(--text2,#9ca3af);pointer-events:none}
#${MODAL_ID} .pcp-thumb:hover{border-color:color-mix(in srgb,var(--accent,#0d9488) 35%,transparent)}
#${MODAL_ID} .pcp-thumb.is-on{border-color:color-mix(in srgb,var(--accent,#0d9488) 55%,transparent);
  background:color-mix(in srgb,var(--accent,#0d9488) 5%,var(--card,#fff));
  box-shadow:inset 0 0 0 3px color-mix(in srgb,var(--accent,#0d9488) 14%,transparent),0 3px 12px rgba(15,23,42,.14)}
#${MODAL_ID} .pcp-thumb-qtd{position:absolute;left:4px;bottom:4px;min-width:20px;padding:1px 6px;border-radius:999px;
  background:var(--accent,#0d9488);color:#fff;font-size:11px;font-weight:800;line-height:1.5;text-align:center;pointer-events:none}
#${MODAL_ID}.pcp-gal .pcp-list{display:flex;flex-direction:column;grid-column:2;padding:12px 18px;overflow-y:auto;scrollbar-width:none;min-height:0}
#${MODAL_ID}.pcp-gal .pcp-row{display:none}
#${MODAL_ID}.pcp-gal .pcp-row.pcp-gal-on{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;width:100%;max-width:none;cursor:default;
  border:none;border-radius:0;box-shadow:none;background:transparent;overflow:visible}
#${MODAL_ID}.pcp-gal .pcp-row.pcp-gal-on.pcp-on,#${MODAL_ID}.pcp-gal .pcp-row.pcp-gal-on.pcp-off{box-shadow:none;background:transparent}
#${MODAL_ID}.pcp-gal .pcp-row.pcp-gal-on.pcp-err-row{box-shadow:0 0 0 2px rgba(234,88,12,.4);border-radius:12px}
#${MODAL_ID}.pcp-gal .pcp-card-top{flex:1 1 auto;min-height:0}
#${MODAL_ID}.pcp-gal .pcp-media{position:relative;height:auto;flex:1 1 0;min-height:140px;padding:0;
  background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:14px;cursor:default}
#${MODAL_ID}.pcp-gal .pcp-foto{position:absolute;inset:10px;width:calc(100% - 20px);height:calc(100% - 20px);max-width:none;max-height:none;object-fit:contain;cursor:default}
#${MODAL_ID}.pcp-gal .pcp-foto-ph{font-size:64px;cursor:default}
#${MODAL_ID} .pcp-angles{display:none}
#${MODAL_ID}.pcp-gal .pcp-angles{display:flex;gap:8px;position:absolute;left:10px;bottom:10px;max-width:calc(100% - 170px);overflow-x:auto;padding:2px}
#${MODAL_ID} .pcp-angle{flex:0 0 auto;width:58px;height:58px;padding:2px;box-sizing:border-box;background:var(--card,#fff);
  border:2px solid var(--border,#e5e7eb);border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;overflow:hidden}
#${MODAL_ID} .pcp-angle img{max-width:100%;max-height:100%;object-fit:contain;pointer-events:none}
#${MODAL_ID} .pcp-angle.is-on{border-color:var(--accent,#0d9488)}
#${MODAL_ID} .pcp-gal-price{display:none}
#${MODAL_ID}.pcp-gal .pcp-gal-price{display:flex;flex-direction:column;align-items:flex-end;position:absolute;right:10px;bottom:10px;
  padding:6px 14px;border-radius:12px;background:var(--card,#fff);border:1px solid var(--border,#e5e7eb);
  box-shadow:0 4px 14px rgba(15,23,42,.12);font-size:20px;font-weight:800;color:var(--text,#111);letter-spacing:-.02em;line-height:1.15}
#${MODAL_ID} .pcp-gal-price small{font-size:11px;font-weight:700;color:var(--text2,#6b7280);letter-spacing:0}
#${MODAL_ID}.pcp-gal .pcp-card-caption{padding:10px 2px 4px;gap:4px;flex:0 0 auto}
#${MODAL_ID}.pcp-gal .pcp-nome{font-size:16px;font-weight:800;-webkit-line-clamp:2}
#${MODAL_ID}.pcp-gal .pcp-chk{width:22px;height:22px}
#${MODAL_ID}.pcp-gal .pcp-meta,#${MODAL_ID}.pcp-gal .pcp-badges,#${MODAL_ID}.pcp-gal .pcp-head-actions{padding-left:30px}
#${MODAL_ID}.pcp-gal .pcp-meta{font-size:12.5px}
#${MODAL_ID}.pcp-gal .pcp-row.pcp-row-grade .pcp-body,
#${MODAL_ID}.pcp-gal .pcp-row.pcp-row-grade.pcp-off .pcp-body,
#${MODAL_ID}.pcp-gal .pcp-row.pcp-row-grade.pcp-on .pcp-body{display:block;flex:0 0 auto;padding:6px 4px 2px;border-top:none;background:transparent}
#${MODAL_ID}.pcp-gal .pcp-sizes{gap:8px}
#${MODAL_ID}.pcp-gal .pcp-size{min-width:54px}
#${MODAL_ID}.pcp-gal .pcp-size-lbl{font-size:11.5px}
#${MODAL_ID}.pcp-gal .pcp-size-qtd{width:54px;min-height:42px;font-size:16px;font-weight:800;border-radius:10px}
#${MODAL_ID}.pcp-gal .pcp-qtd{max-width:180px;min-height:46px;font-size:18px;font-weight:800;text-align:center;margin-top:4px}
@media (max-width: 900px) {
  #${MODAL_ID}.pcp-gal .pcp-card{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr) auto;height:min(96vh,980px);height:min(96dvh,980px);max-height:96vh}
  #${MODAL_ID}.pcp-gal .pcp-thumbs{flex-direction:row;overflow:hidden;border-right:none;border-bottom:1px solid var(--border,#e5e7eb);padding:8px 10px}
  #${MODAL_ID}.pcp-gal .pcp-th-sc{flex-direction:row;overflow-x:auto;overflow-y:hidden;gap:8px}
  #${MODAL_ID}.pcp-gal .pcp-th-arrow{display:none}
  #${MODAL_ID}.pcp-gal .pcp-thumb{width:86px;flex:0 0 86px}
  #${MODAL_ID}.pcp-gal .pcp-list{grid-column:1;padding:10px 12px}
  #${MODAL_ID}.pcp-gal .pcp-media{min-height:120px}
}
@media (min-width: 1100px) {
  #${MODAL_ID} .pcp-row{flex-basis:176px;width:176px}
  #${MODAL_ID} .pcp-media{height:140px;flex-basis:140px}
  #${MODAL_ID} .pcp-foto{max-height:120px}
}
/* Monitores grandes: aproveita a tela */
@media (min-width: 1600px) and (min-height: 900px) {
  #${MODAL_ID}.pcp-gal .pcp-card{width:min(1480px,94vw);height:min(94vh,980px);height:min(94dvh,980px);max-height:94vh}
  #${MODAL_ID}.pcp-gal .pcp-nome{font-size:18px}
}
@media (max-height: 760px) {
  #${MODAL_ID}.pcp-gal .pcp-head{padding:8px 16px 6px}
  #${MODAL_ID}.pcp-gal .pcp-foot{padding:8px 14px}
  #${MODAL_ID}.pcp-gal .pcp-btn{min-height:38px;padding:8px 12px}
  #${MODAL_ID}.pcp-gal .pcp-media{min-height:110px}
  #${MODAL_ID}.pcp-gal .pcp-size-qtd{min-height:38px}
}
@media (max-width: 900px) {
  #${MODAL_ID}{padding:10px;align-items:flex-end}
  #${MODAL_ID} .pcp-card,
  #${MODAL_ID}.pcp-has-grade .pcp-card{
    width:100%;max-width:100%;max-height:min(92dvh,920px);
    border-radius:16px 16px 10px 10px}
  #${MODAL_ID} .pcp-list{gap:10px;padding:12px}
  #${MODAL_ID} .pcp-row{flex-basis:148px;width:148px}
  #${MODAL_ID} .pcp-size-qtd{width:44px;min-height:40px}
}
/* Celular em pé: libera altura para a foto */
@media (max-width: 600px) {
  #${MODAL_ID}.pcp-gal .pcp-head p{display:none}
  #${MODAL_ID}.pcp-gal .pcp-sel-group{display:none}
  #${MODAL_ID}.pcp-gal .pcp-foot{grid-template-areas:"err err" "cancel ok"}
  #${MODAL_ID}.pcp-gal .pcp-thumbs{padding:6px 8px}
  #${MODAL_ID}.pcp-gal .pcp-thumb{width:72px;flex:0 0 72px}
  #${MODAL_ID}.pcp-gal .pcp-nome{font-size:15px}
  #${MODAL_ID}.pcp-gal .pcp-sizes{gap:4px}
  #${MODAL_ID}.pcp-gal .pcp-size{flex:1 1 calc(16.6% - 4px);min-width:0;max-width:56px}
  #${MODAL_ID}.pcp-gal .pcp-size-qtd{width:100%;min-height:38px;font-size:15px}
  #${MODAL_ID}.pcp-gal .pcp-card-caption{padding:8px 2px 2px}
}
/* Celular / tablet baixo DEITADO: miniaturas à esquerda e foto + tamanhos lado a lado */
@media (max-height: 520px) and (min-width: 480px) {
  #${MODAL_ID}.pcp-gal{padding:0;align-items:stretch;justify-content:stretch}
  #${MODAL_ID}.pcp-gal .pcp-card{width:100%;max-width:100%;height:100vh;height:100dvh;max-height:100vh;border-radius:0;border:none;
    grid-template-columns:98px minmax(0,1fr);grid-template-rows:auto minmax(0,1fr) auto}
  #${MODAL_ID}.pcp-gal .pcp-head{padding:6px 12px 4px}
  #${MODAL_ID}.pcp-gal .pcp-head h3{font-size:14px}
  #${MODAL_ID}.pcp-gal .pcp-head p{display:none}
  #${MODAL_ID}.pcp-gal .pcp-close{width:32px;height:32px}
  #${MODAL_ID}.pcp-gal .pcp-thumbs{flex-direction:column;overflow:hidden;border-right:1px solid var(--border,#e5e7eb);border-bottom:none;padding:6px}
  #${MODAL_ID}.pcp-gal .pcp-th-sc{flex-direction:column;overflow-x:hidden;overflow-y:auto;gap:8px}
  #${MODAL_ID}.pcp-gal .pcp-th-arrow{display:flex;height:24px;left:6px;right:6px}
  #${MODAL_ID}.pcp-gal .pcp-th-up{top:6px}
  #${MODAL_ID}.pcp-gal .pcp-th-dn{bottom:6px}
  #${MODAL_ID}.pcp-gal .pcp-thumb{scroll-margin:34px 0}
  #${MODAL_ID}.pcp-gal .pcp-thumb{width:100%;flex:0 0 auto}
  #${MODAL_ID}.pcp-gal .pcp-list{grid-column:2;padding:8px 12px}
  #${MODAL_ID}.pcp-gal .pcp-row.pcp-gal-on{flex-direction:row;gap:14px;align-items:stretch}
  #${MODAL_ID}.pcp-gal .pcp-card-top{flex:1 1 54%;min-width:0}
  #${MODAL_ID}.pcp-gal .pcp-media{min-height:90px}
  #${MODAL_ID}.pcp-gal .pcp-row.pcp-row-grade .pcp-body,
  #${MODAL_ID}.pcp-gal .pcp-row.pcp-row-grade.pcp-off .pcp-body,
  #${MODAL_ID}.pcp-gal .pcp-row.pcp-row-grade.pcp-on .pcp-body{flex:1 1 46%;min-width:0;overflow-y:auto;scrollbar-width:thin;padding:2px 2px 2px 0}
  #${MODAL_ID}.pcp-gal .pcp-row:not(.pcp-row-grade) .pcp-card-caption{justify-content:center}
  #${MODAL_ID}.pcp-gal .pcp-sizes{gap:5px}
  #${MODAL_ID}.pcp-gal .pcp-size{min-width:42px}
  #${MODAL_ID}.pcp-gal .pcp-size-lbl{font-size:10px}
  #${MODAL_ID}.pcp-gal .pcp-size-qtd{width:42px;min-height:32px;font-size:14px;border-radius:8px}
  #${MODAL_ID}.pcp-gal .pcp-card-caption{padding:6px 2px 2px;gap:2px}
  #${MODAL_ID}.pcp-gal .pcp-grade-unica{margin-bottom:3px;padding:3px 6px}
  #${MODAL_ID}.pcp-gal .pcp-foot{display:flex;flex-wrap:nowrap;position:static;padding:6px 12px;gap:8px;grid-template-areas:none}
  #${MODAL_ID}.pcp-gal .pcp-sel-group{display:none}
  #${MODAL_ID}.pcp-gal .pcp-err{grid-area:auto;width:auto;flex:1 1 auto;margin:0}
  #${MODAL_ID}.pcp-gal .pcp-btn,#${MODAL_ID}.pcp-gal .pcp-btn-ghost,#${MODAL_ID}.pcp-gal .pcp-btn-ok{width:auto;min-height:36px;padding:6px 16px;font-size:13px;grid-area:auto}
  #${MODAL_ID}.pcp-gal .pcp-foot .pcp-btn-ghost{margin-left:auto}
}
@media (max-width: 600px) {
  #${MODAL_ID}{padding:0;align-items:stretch;justify-content:flex-end}
  #${MODAL_ID} .pcp-card,
  #${MODAL_ID}.pcp-has-grade .pcp-card{
    width:100%;max-width:100%;max-height:100dvh;height:100dvh;
    border-radius:0;border:none;box-shadow:none}
  #${MODAL_ID} .pcp-head{padding:10px 12px 8px;padding-top:max(10px, env(safe-area-inset-top, 0px))}
  #${MODAL_ID} .pcp-head h3{font-size:15px}
  #${MODAL_ID} .pcp-head p{font-size:11px;margin-top:2px}
  #${MODAL_ID} .pcp-close{width:36px;height:36px}
  #${MODAL_ID} .pcp-list{gap:8px;padding:8px 10px 10px}
  #${MODAL_ID} .pcp-row{flex:1 1 calc(50% - 4px);width:calc(50% - 4px);max-width:calc(50% - 4px)}
  #${MODAL_ID} .pcp-chk{width:20px;height:20px}
  #${MODAL_ID} .pcp-nome{font-size:12px}
  #${MODAL_ID} .pcp-qtd{min-height:40px}
  #${MODAL_ID} .pcp-sizes{gap:4px}
  #${MODAL_ID} .pcp-size{min-width:0;flex:1 1 calc(25% - 4px);max-width:48px}
  #${MODAL_ID} .pcp-size-qtd{width:100%;min-height:36px;font-size:14px}
  #${MODAL_ID} .pcp-foot{
    display:grid;
    grid-template-columns:1fr 1fr;
    grid-template-areas:
      "err err"
      "sel sel"
      "cancel ok";
    gap:6px 8px;
    align-items:stretch;
    padding:8px 10px max(8px, env(safe-area-inset-bottom, 0px));
    position:sticky;bottom:0;background:var(--card,#fff);z-index:2;
    border-top:1px solid var(--border,#e5e7eb)}
  #${MODAL_ID} .pcp-err{grid-area:err;order:unset;margin:0;padding:8px 10px;font-size:11px}
  #${MODAL_ID} .pcp-sel-group{
    grid-area:sel;order:unset;margin:0;width:100%;
    display:flex;flex-wrap:nowrap;gap:6px;justify-content:stretch}
  #${MODAL_ID} .pcp-sel-group .pcp-btn{
    flex:1 1 0;width:auto;min-width:0;min-height:34px;padding:6px 6px;
    font-size:11px;line-height:1.2;white-space:normal}
  #${MODAL_ID} .pcp-btn-todas{display:none}
  #${MODAL_ID} .pcp-btn-todas.show{display:inline-flex;align-items:center;justify-content:center}
  #${MODAL_ID} .pcp-btn-ghost{
    grid-area:cancel;order:unset;width:100%;min-height:44px;font-size:14px;justify-content:center}
  #${MODAL_ID} .pcp-btn-ok{
    grid-area:ok;order:unset;width:100%;min-height:44px;font-size:14px;justify-content:center}
}
`;
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function labelCor(c) {
    const cor = String(c.cor1 || c.cor || '').trim();
    if (cor) return cor;
    const desc = String(c.descricao || c.desc_produto || '').trim();
    const fab = String(c.cod_fabricante || '').trim();
    if (desc && fab && desc.toUpperCase().includes(fab.toUpperCase())) return desc;
    if (cor) return cor;
    return desc || fab || ('#' + (c.id || c.cod_produto || ''));
  }

  function tipogradeDe(c, mae) {
    return parseInt(c?.tipograde, 10) || parseInt(mae?.tipograde, 10) || 0;
  }

  /** Nome curto da grade p/ badge (ex.: «… FEMININI» → Feminina). */
  function apelidoGrade(nome) {
    const n = String(nome || '').trim();
    if (!n) return '';
    if (/feminin/i.test(n)) return 'Feminina';
    if (/masculin/i.test(n)) return 'Masculina';
    if (/infantil|kids|crian/i.test(n)) return 'Infantil';
    if (/unissex/i.test(n)) return 'Unissex';
    const parts = n.split(/[-–|/]/).map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || n;
    return last.length > 14 ? last.slice(0, 12) + '…' : last;
  }

  function faixaTamanhos(itens) {
    const nums = (itens || [])
      .map((it) => parseFloat(String(it.nome || '').replace(',', '.')))
      .filter((n) => Number.isFinite(n));
    if (nums.length >= 2) return `${Math.min(...nums)}–${Math.max(...nums)}`;
    if (nums.length === 1) return String(nums[0]);
    const nomes = (itens || []).map((it) => String(it.nome || '').trim()).filter(Boolean);
    if (nomes.length >= 2) return `${nomes[0]}…${nomes[nomes.length - 1]}`;
    if (nomes.length === 1) return nomes[0];
    return '';
  }

  /** Só 2 chips: tipo da grade + faixa (Pack fica no topo ao selecionar). */
  function htmlBadgesCor(st) {
    if (!st || !st.usaGrade) return '';
    if (st.loading) {
      return `<div class="pcp-badges"><span class="pcp-badge pcp-badge-load">Carregando grade…</span></div>`;
    }
    const gMeta = (st.grades || []).find((x) => parseInt(x.id, 10) === parseInt(st.idGrade, 10))
      || (st.grades || [])[0];
    const chips = [];
    const apelido = apelidoGrade(gMeta?.nome);
    if (apelido) chips.push({ t: apelido, k: 'grade' });
    const faixa = faixaTamanhos(st.itens);
    if (faixa) chips.push({ t: faixa, k: 'faixa' });
    if (!chips.length) return '';
    return `<div class="pcp-badges">${chips.map((c) =>
      `<span class="pcp-badge pcp-badge-${c.k}">${esc(c.t)}</span>`
    ).join('')}</div>`;
  }

  function ensureModal() {
    ensureCss();
    let el = document.getElementById(MODAL_ID);
    if (el && (el.dataset.pcpVer !== MODAL_VER || !document.getElementById('pcpTodasGradesBtn') || !document.getElementById('pcpMarcarTodas') || !document.getElementById('pcpClose') || !document.getElementById('pcpErr') || !document.getElementById('pcpThumbs') || !document.getElementById('pcpThSc'))) {
      el.remove();
      el = null;
    }
    if (el) {
      el.dataset.msNativeModal = '1';
      return el;
    }
    el = document.createElement('div');
    el.id = MODAL_ID;
    el.dataset.pcpVer = MODAL_VER;
    // mobile-shell NÃO deve “consertar” este modal (focus + ms-modal-card
    // quebravam o sheet no iPhone — toque no Showroom parecia não abrir nada).
    el.dataset.msNativeModal = '1';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="pcp-card">
      <div class="pcp-head">
        <div class="pcp-head-text">
          <h3 id="pcpTitulo">Cores</h3>
          <p id="pcpSub"></p>
        </div>
        <button type="button" class="pcp-close" id="pcpClose" aria-label="Fechar">×</button>
      </div>
      <div class="pcp-thumbs" id="pcpThumbs">
        <button type="button" class="pcp-th-arrow pcp-th-up" id="pcpThUp" aria-label="Ver cores anteriores" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg></button>
        <div class="pcp-th-sc" id="pcpThSc"></div>
        <button type="button" class="pcp-th-arrow pcp-th-dn" id="pcpThDn" aria-label="Ver mais cores" hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>
      </div>
      <div class="pcp-list" id="pcpList"></div>
      <div class="pcp-foot">
        <div class="pcp-err" id="pcpErr" role="alert"></div>
        <div class="pcp-sel-group">
          <button type="button" class="pcp-btn pcp-btn-todas" id="pcpTodasGradesBtn" aria-pressed="false">Incluir todas as grades</button>
          <button type="button" class="pcp-btn pcp-btn-sel" id="pcpMarcarTodas" title="Marcar todas as cores">Marcar todas</button>
          <button type="button" class="pcp-btn pcp-btn-sel" id="pcpDesmarcarTodas" title="Desmarcar todas as cores">Limpar</button>
        </div>
        <button type="button" class="pcp-btn pcp-btn-ghost" id="pcpCancel">Cancelar</button>
        <button type="button" class="pcp-btn pcp-btn-ok" id="pcpOk">Adicionar ao pedido</button>
      </div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target === el) close();
    });
    el.querySelector('#pcpThumbs').addEventListener('click', onThumbClick);
    el.querySelector('#pcpThSc').addEventListener('scroll', galFades, { passive: true });
    return el;
  }

  let _galeria = false;
  let _galIdx = 0;
  let _galLast = -1;
  let _fetchImagens = null;
  const _imgCache = new Map();
  const _imgPend = new Set();
  const _imgSel = {};
  let _onConfirm = null;
  let _cores = [];
  let _mae = null;
  let _habilitaGrade = false;
  let _fetchGrade = null;
  let _fetchGradesProduto = null;
  let _incluirTodas = false;
  let _gradesMae = [];
  /** @type {Array<{selecionada:boolean, usaGrade:boolean, idGrade:number|null, grades:Array, itens:Array, modo:string, multiplo:number, qtdBySize:Record<number,number>, loading:boolean}>} */
  let _rowState = [];
  const _gradeCache = new Map();
  const _gradesListCache = new Map();

  function close() {
    // Remove aviso SysRepConfirm residual (no mobile deixava overlay invisível travando a tela)
    try {
      document.querySelectorAll('[data-sysrep-confirm]').forEach((n) => n.remove());
    } catch (_) {}
    const tip = document.getElementById('pcpToastFallback');
    if (tip) tip.remove();
    const el = document.getElementById(MODAL_ID);
    if (el) {
      el.classList.remove('show');
      el.classList.remove('pcp-has-grade');
      el.classList.remove('pcp-gal');
      const th = document.getElementById('pcpThSc');
      if (th) th.innerHTML = '';
      const err = document.getElementById('pcpErr');
      if (err) { err.classList.remove('show'); err.textContent = ''; }
    }
    _galeria = false;
    _galIdx = 0;
    _galLast = -1;
    _fetchImagens = null;
    _imgCache.clear();
    _imgPend.clear();
    Object.keys(_imgSel).forEach((k) => delete _imgSel[k]);
    _onConfirm = null;
    _cores = [];
    _mae = null;
    _rowState = [];
    _habilitaGrade = false;
    _fetchGrade = null;
    _fetchGradesProduto = null;
    _incluirTodas = false;
    _gradesMae = [];
    _gradeCache.clear();
    _gradesListCache.clear();
  }

  function limparAvisosTravados() {
    try {
      document.querySelectorAll('[data-sysrep-confirm]').forEach((n) => n.remove());
    } catch (_) {}
  }

  /**
   * Aviso DENTRO do modal — nunca SysRepConfirm por cima (no celular o 2º diálogo
   * piscava «Grade fechada» e deixava a tela travada).
   */
  function mostrarErroPicker(mensagem, idxHighlight) {
    limparAvisosTravados();
    const err = document.getElementById('pcpErr');
    if (err) {
      err.textContent = mensagem;
      err.classList.add('show');
    }
    document.querySelectorAll('.pcp-row.pcp-err-row').forEach((r) => r.classList.remove('pcp-err-row'));
    if (idxHighlight >= 0) {
      const row = document.querySelector(`#pcpList .pcp-row[data-idx="${idxHighlight}"]`);
      if (row) {
        row.classList.add('pcp-err-row');
        try { row.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
      }
    }
  }

  function limparErroPicker() {
    const err = document.getElementById('pcpErr');
    if (err) { err.classList.remove('show'); err.textContent = ''; }
    document.querySelectorAll('.pcp-row.pcp-err-row').forEach((r) => r.classList.remove('pcp-err-row'));
  }

  async function avisarPicker(titulo, mensagem, idxHighlight) {
    // Sempre inline no picker — SysRepConfirm por cima trava o Showroom no celular
    const txt = titulo && mensagem && !String(mensagem).startsWith(titulo)
      ? `${titulo}: ${mensagem}`
      : (mensagem || titulo || '');
    mostrarErroPicker(txt, idxHighlight == null ? -1 : idxHighlight);
  }

  function somaGrade(st) {
    if (!st || !st.usaGrade) return 0;
    return Object.values(st.qtdBySize || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }

  /** Linha com quantidade preenchida (grade ou qtd simples). */
  function linhaTemQtd(st, row) {
    if (!st) return false;
    if (st.usaGrade) return somaGrade(st) > 0;
    return (parseFloat(row?.querySelector('.pcp-qtd')?.value) || 0) > 0;
  }

  /**
   * Só marca cor que o usuário digitou qtd sem clicar no checkbox
   * (não reativa cores que ele desmarcou — ao desmarcar a qtd é limpa).
   */
  function sincronizarSelecaoPorQtd() {
    const list = document.getElementById('pcpList');
    let mudou = false;
    _rowState.forEach((st, i) => {
      if (!st || st.selecionada) return;
      const row = list?.querySelector(`.pcp-row[data-idx="${i}"]`);
      if (!linhaTemQtd(st, row)) return;
      st.selecionada = true;
      mudou = true;
      if (row) {
        row.classList.add('pcp-on');
        row.classList.remove('pcp-off');
        const chk = row.querySelector('.pcp-chk');
        if (chk) chk.checked = true;
      }
    });
    if (mudou) syncOkBtn();
    return mudou;
  }

  /** Ao desmarcar: zera qtd para não ir para a cesta nem “remarcar” no OK. */
  function limparQtdLinha(idx) {
    const st = _rowState[idx];
    if (!st) return;
    st.qtdBySize = {};
    const list = document.getElementById('pcpList');
    const row = list?.querySelector(`.pcp-row[data-idx="${idx}"]`);
    const qtdInp = row?.querySelector('.pcp-qtd');
    if (qtdInp) qtdInp.value = '';
  }

  /** Preenche pack da grade fechada (1× qtd_minima). force=true ignora qtds já digitadas. */
  function aplicarPackFechada(st, { force = false } = {}) {
    if (!st || !st.usaGrade || !st.itens.length) return false;
    if (String(st.modo || 'A').toUpperCase() !== 'F') return false;
    if (!force) {
      const temQtd = Object.values(st.qtdBySize || {}).some((v) => (parseFloat(v) || 0) > 0);
      if (temQtd) return false;
    }
    if (typeof global.SysRepGradePack === 'undefined') return false;
    const sug = force
      ? global.SysRepGradePack.packBaseFechada(st.itens, 'F')
      : global.SysRepGradePack.sugerirQtdPackFechada(st.itens, 'F', {});
    if (!sug) return false;
    st.qtdBySize = { ...sug };
    return true;
  }

  function aplicarPackSeVazio(st) {
    return aplicarPackFechada(st, { force: false });
  }

  function aplicarTotalPack(st, totalDesejado) {
    if (!st || !st.usaGrade || typeof global.SysRepGradePack === 'undefined') return false;
    const map = global.SysRepGradePack.distribuirTotalPackFechada(
      st.itens, st.modo, totalDesejado, st.multiplo
    );
    if (!map) return false;
    st.qtdBySize = map;
    return true;
  }

  function rerenderGradeLinha(idx) {
    const list = document.getElementById('pcpList');
    const row = list?.querySelector(`.pcp-row[data-idx="${idx}"]`);
    if (!row) return;
    const head = row.querySelector('.pcp-head-actions');
    if (head) head.innerHTML = renderTopoGradeHtml(idx);
    const caption = row.querySelector('.pcp-card-caption');
    if (caption) {
      const old = caption.querySelector('.pcp-badges');
      if (old) old.remove();
      const badges = htmlBadgesCor(_rowState[idx]);
      if (badges) {
        const meta = caption.querySelector('.pcp-meta');
        if (meta) meta.insertAdjacentHTML('afterend', badges);
        else caption.insertAdjacentHTML('afterbegin', badges);
      }
    }
    const body = row.querySelector('.pcp-body');
    if (!body) return;
    const gradeHost = body.querySelector('.pcp-grade-wrap, .pcp-grade-load, .pcp-grade-aviso');
    if (gradeHost) gradeHost.outerHTML = renderSizesHtml(idx);
    else body.innerHTML = renderSizesHtml(idx);
  }

  function setSelecionada(idx, on, { fillPack = true, rerender = true } = {}) {
    const st = _rowState[idx];
    if (!st) return;
    st.selecionada = !!on;
    if (st.selecionada && fillPack) aplicarPackSeVazio(st);
    if (!st.selecionada) limparQtdLinha(idx);
    if (rerender) {
      const list = document.getElementById('pcpList');
      const row = list?.querySelector(`.pcp-row[data-idx="${idx}"]`);
      if (row) {
        row.classList.toggle('pcp-on', st.selecionada);
        row.classList.toggle('pcp-off', !st.selecionada);
        const chk = row.querySelector('.pcp-chk');
        if (chk) chk.checked = st.selecionada;
        // Pack novo ou limpeza ao desmarcar → redesenha tamanhos
        if (st.usaGrade && (fillPack || !st.selecionada)) rerenderGradeLinha(idx);
      }
    }
    syncOkBtn();
  }

  function marcarTodasCores(on) {
    _rowState.forEach((st, i) => {
      if (!st) return;
      setSelecionada(i, !!on, { fillPack: !!on, rerender: true });
    });
  }

  function coletarSelecoes() {
    const list = document.getElementById('pcpList');
    if (!list) return [];
    const maeFab = String(_mae?.cod_fabricante || '').trim();
    const out = [];
    list.querySelectorAll('.pcp-row').forEach((row) => {
      const idx = parseInt(row.dataset.idx, 10);
      const c = _cores[idx];
      const st = _rowState[idx];
      if (!c || !st || !st.selecionada) return;

      const prodComMae = Object.assign({}, c, {
        cod_fabricante_mae: maeFab || String(c.cod_fabricante_mae || '').trim(),
      });

      if (st && st.usaGrade) {
        const grade_qtd = (st.itens || [])
          .filter((g) => (parseFloat(st.qtdBySize[g.id]) || 0) > 0)
          .map((g) => ({
            id_descricao_grade: g.id,
            sequencial: g.sequencial,
            nome_grade: g.nome,
            quantidade: parseFloat(st.qtdBySize[g.id]) || 0,
          }));
        const qtd = grade_qtd.reduce((s, g) => s + (parseFloat(g.quantidade) || 0), 0);
        if (qtd <= 0) return;
        const gMeta = (st.grades || []).find((x) => parseInt(x.id, 10) === parseInt(st.idGrade, 10));
        out.push({
          cod_produto: parseInt(c.id || c.cod_produto, 10),
          qtd,
          grade_qtd,
          id_grade: st.idGrade || tipogradeDe(c, _mae) || null,
          tipo_grade: gMeta?.nome || (st.idGrade ? String(st.idGrade) : null),
          modo_grade: st.modo,
          multiplo_grade: st.multiplo,
          cor: labelCor(c),
          cor1: String(c.cor1 || '').trim(),
          cod_fabricante_mae: maeFab,
          prod: prodComMae,
        });
        return;
      }

      const qtd = parseFloat(row.querySelector('.pcp-qtd')?.value) || 0;
      if (qtd <= 0) return;
      out.push({
        cod_produto: parseInt(c.id || c.cod_produto, 10),
        qtd,
        grade_qtd: [],
        id_grade: null,
        cor: labelCor(c),
        cor1: String(c.cor1 || '').trim(),
        cod_fabricante_mae: maeFab,
        prod: prodComMae,
      });
    });
    return out;
  }

  function montarGradeQtd(itens, qtdMap) {
    return (itens || [])
      .filter((g) => (parseFloat(qtdMap[g.id]) || 0) > 0)
      .map((g) => ({
        id_descricao_grade: g.id,
        sequencial: g.sequencial,
        nome_grade: g.nome,
        quantidade: parseFloat(qtdMap[g.id]) || 0,
      }));
  }

  function copiarQtdPorNomeTamanho(itensDestino, gradeQtdOrigem) {
    const byNome = new Map();
    (gradeQtdOrigem || []).forEach((g) => {
      const n = String(g.nome_grade || '').trim().toUpperCase();
      const q = parseFloat(g.quantidade) || 0;
      if (n && q > 0) byNome.set(n, q);
    });
    const map = {};
    (itensDestino || []).forEach((it) => {
      const n = String(it.nome || '').trim().toUpperCase();
      const q = byNome.get(n);
      if (q > 0) map[it.id] = q;
    });
    return map;
  }

  function uniaoGradesConhecidas(st) {
    const map = new Map();
    const push = (g) => {
      const id = parseInt(g?.id, 10) || 0;
      if (id > 0 && !map.has(id)) map.set(id, g);
    };
    (_gradesMae || []).forEach(push);
    (st?.grades || []).forEach(push);
    _rowState.forEach((row) => (row?.grades || []).forEach(push));
    return [...map.values()];
  }

  async function expandirTodasGrades(base) {
    const out = [];
    for (const sel of base) {
      const idx = _cores.findIndex((c) => parseInt(c.id || c.cod_produto, 10) === parseInt(sel.cod_produto, 10));
      const st = idx >= 0 ? _rowState[idx] : null;
      const grades = uniaoGradesConhecidas(st);
      if (grades.length < 2) {
        out.push(sel);
        continue;
      }
      for (const g of grades) {
        const gid = parseInt(g.id, 10);
        if (gid === parseInt(sel.id_grade, 10)) {
          out.push({ ...sel, tipo_grade: g.nome || sel.tipo_grade });
          continue;
        }
        const d = await carregarDadosGrade(gid);
        if (!d || !d.itens.length) continue;
        const modo = (d.modo_grade === 'F' || g.modo_grade === 'F') ? 'F' : 'A';
        let qtdMap = {};
        if (typeof global.SysRepGradePack !== 'undefined') {
          const sug = global.SysRepGradePack.sugerirQtdPackFechada(d.itens, modo, {});
          if (sug) qtdMap = sug;
        }
        if (!Object.values(qtdMap).some((v) => (parseFloat(v) || 0) > 0)) {
          qtdMap = copiarQtdPorNomeTamanho(d.itens, sel.grade_qtd);
        }
        const grade_qtd = montarGradeQtd(d.itens, qtdMap);
        const qtd = grade_qtd.reduce((s, x) => s + (parseFloat(x.quantidade) || 0), 0);
        if (qtd <= 0) continue;
        out.push({
          ...sel,
          qtd,
          grade_qtd,
          id_grade: gid,
          tipo_grade: g.nome || String(gid),
          modo_grade: modo,
          multiplo_grade: parseInt(d.multiplo_grade ?? g.multiplo_grade, 10) || 0,
        });
      }
    }
    return out.length ? out : base;
  }

  /** Galeria: mostra as setas ↑/↓ da coluna de miniaturas só quando há mais cores para rolar. */
  function galFades() {
    const sc = document.getElementById('pcpThSc');
    const up = document.getElementById('pcpThUp');
    const dn = document.getElementById('pcpThDn');
    if (!sc || !up || !dn) return;
    const vertical = getComputedStyle(sc).flexDirection === 'column';
    const max = sc.scrollHeight - sc.clientHeight;
    up.hidden = !(vertical && max > 4 && sc.scrollTop > 4);
    dn.hidden = !(vertical && max > 4 && sc.scrollTop < max - 4);
  }

  /** Galeria: fotos extras (ângulos) da cor aberta — carrega sob demanda e guarda em cache. */
  function galAngulos() {
    if (!_galeria) return;
    const idx = _galIdx;
    const c = _cores[idx];
    if (!c) return;
    const list = document.getElementById('pcpList');
    const media = list?.querySelector(`.pcp-row[data-idx="${idx}"] .pcp-media`);
    if (!media) return;
    const cod = String(c.cod_produto || c.id || '');
    const urls = _imgCache.get(cod);
    if (!urls) {
      if (_fetchImagens && cod && !_imgPend.has(cod)) {
        _imgPend.add(cod);
        Promise.resolve(_fetchImagens(cod)).then((arr) => {
          const base = c.foto_principal ? [c.foto_principal] : [];
          const todas = [...new Set([...base, ...(Array.isArray(arr) ? arr : [])].filter(Boolean))];
          _imgCache.set(cod, todas);
        }).catch(() => {
          _imgCache.set(cod, c.foto_principal ? [c.foto_principal] : []);
        }).finally(() => {
          _imgPend.delete(cod);
          if (_galeria && _galIdx === idx) galAngulos();
        });
      }
      return;
    }
    media.querySelector('.pcp-angles')?.remove();
    if (urls.length < 2) return;
    const sel = Math.min(_imgSel[idx] || 0, urls.length - 1);
    let foto = media.querySelector('.pcp-foto');
    if (!foto) {
      const ph = media.querySelector('.pcp-foto-ph');
      if (ph) {
        ph.outerHTML = '<img class="pcp-foto" alt="" decoding="async">';
        foto = media.querySelector('.pcp-foto');
      }
    }
    if (foto && foto.getAttribute('src') !== urls[sel]) foto.setAttribute('src', urls[sel]);
    media.insertAdjacentHTML('beforeend', `<div class="pcp-angles">${urls.map((u, k) =>
      `<button type="button" class="pcp-angle${k === sel ? ' is-on' : ''}" data-ang="${k}" aria-label="Foto ${k + 1}"><img src="${esc(u)}" alt="" loading="lazy" decoding="async"></button>`
    ).join('')}</div>`);
  }

  /** Galeria: miniaturas à esquerda + só a cor ativa visível. */
  function galSync() {
    if (!_galeria) return;
    const list = document.getElementById('pcpList');
    const th = document.getElementById('pcpThSc');
    if (!list || !th) return;
    const scroll = th.scrollTop;
    th.innerHTML = _cores.map((c, i) => {
      const st = _rowState[i] || {};
      const row = list.querySelector(`.pcp-row[data-idx="${i}"]`);
      let q = 0;
      if (st.usaGrade) q = somaGrade(st);
      else q = parseFloat(row?.querySelector('.pcp-qtd')?.value) || 0;
      const foto = c.foto_principal || '';
      const img = foto
        ? `<img src="${esc(foto)}" alt="" loading="lazy" decoding="async" onerror="this.outerHTML='<span class=\\'pcp-thumb-ph\\'>📷</span>'">`
        : '<span class="pcp-thumb-ph">📷</span>';
      return `<button type="button" class="pcp-thumb${i === _galIdx ? ' is-on' : ''}" data-gal="${i}" title="${esc(labelCor(c))}" aria-label="${esc(labelCor(c))}">${img}${q > 0 ? `<span class="pcp-thumb-qtd">${q}</span>` : ''}</button>`;
    }).join('');
    th.scrollTop = scroll;
    if (_galLast !== _galIdx) {
      _galLast = _galIdx;
      const on = th.querySelector('.is-on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    galFades();
    list.querySelectorAll('.pcp-row').forEach((r) => {
      r.classList.toggle('pcp-gal-on', parseInt(r.dataset.idx, 10) === _galIdx);
    });
    galAngulos();
  }

  function onThumbClick(e) {
    const arrow = e.target.closest && e.target.closest('.pcp-th-arrow');
    if (arrow) {
      const sc = document.getElementById('pcpThSc');
      if (sc) sc.scrollBy({ top: (arrow.id === 'pcpThUp' ? -1 : 1) * Math.max(120, sc.clientHeight * 0.8), behavior: 'smooth' });
      return;
    }
    const b = e.target.closest && e.target.closest('.pcp-thumb');
    if (!b) return;
    const i = parseInt(b.dataset.gal, 10);
    if (!(i >= 0) || i === _galIdx) return;
    _galIdx = i;
    galSync();
    const list = document.getElementById('pcpList');
    if (list) list.scrollTop = 0;
  }

  function syncOkBtn() {
    const ok = document.getElementById('pcpOk');
    if (!ok) return;
    const list = document.getElementById('pcpList');
    let tem = false;
    for (let i = 0; i < _rowState.length; i++) {
      const st = _rowState[i];
      if (!st) continue;
      const row = list?.querySelector(`.pcp-row[data-idx="${i}"]`);
      if (st.selecionada && linhaTemQtd(st, row)) { tem = true; break; }
      if (!st.selecionada && linhaTemQtd(st, row)) { tem = true; break; }
    }
    ok.disabled = !tem;
    galSync();
  }

  function syncTodasGradesUi() {
    const btn = document.getElementById('pcpTodasGradesBtn');
    if (!btn) return;
    const n = uniaoGradesConhecidas(_rowState[0] || null).length;
    const temVarias = n > 1;
    if (!temVarias) _incluirTodas = false;
    btn.classList.toggle('show', temVarias);
    btn.classList.toggle('on', !!_incluirTodas);
    btn.setAttribute('aria-pressed', _incluirTodas ? 'true' : 'false');
    btn.textContent = temVarias
      ? (_incluirTodas ? `✓ Incluir todas as ${n} grades` : `Incluir todas as ${n} grades`)
      : 'Incluir todas as grades';
    btn.title = _incluirTodas
      ? `ATIVO: ao adicionar, cada cor marcada entra com as ${n} grades. Clique para desativar.`
      : `Clique para ativar: cada cor marcada entra com as ${n} grades. Sem isso, só a grade escolhida no combo.`;
  }

  function toggleIncluirTodasGrades() {
    const n = uniaoGradesConhecidas(_rowState[0] || null).length;
    if (n < 2) return;
    _incluirTodas = !_incluirTodas;
    syncTodasGradesUi();
  }

  function renderTopoGradeHtml(idx) {
    const st = _rowState[idx];
    if (!st || !st.usaGrade) return '';
    const total = somaGrade(st);
    let status = '';
    if (st.modo === 'F' && st.multiplo >= 2 && total > 0) {
      const ok = Math.abs(total % st.multiplo) < 0.0001;
      status = ok
        ? `<span class="pcp-grade-ok-mini">fechada · ×${st.multiplo} ✓</span>`
        : `<span class="pcp-grade-aviso-mini">precisa múltiplo de ${st.multiplo}</span>`;
    }
    const pack = (st.modo === 'F')
      ? `<span class="pcp-pack-mini" title="${st.multiplo >= 2 ? `Digite o total (múltiplo de ${st.multiplo}) e aplique` : 'Digite o total e aplique'}">
           <span class="pcp-pack-x">×</span>
           <input type="number" class="pcp-pack-total" data-idx="${idx}"
             min="${Math.max(1, st.multiplo || 1)}" step="${st.multiplo >= 2 ? st.multiplo : 1}"
             inputmode="numeric" placeholder="${st.multiplo >= 2 ? st.multiplo : '12'}"
             value="" aria-label="Qtd total da grade">
           <button type="button" class="pcp-pack-aplicar" data-idx="${idx}" title="Distribuir no pack">
             <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.8" d="M5 13l4 4L19 7"/></svg>
           </button>
         </span>`
      : '';
    return `<div class="pcp-head-pack">
        <span class="pcp-grade-total">Total <b>${total || 0}</b></span>
        ${pack}
      </div>
      ${status}`;
  }

  function renderSizesHtml(idx) {
    const st = _rowState[idx];
    if (!st) return '';
    if (st.loading) return `<div class="pcp-grade-load">Carregando tamanhos…</div>`;
    if (!st.itens.length) {
      return `<div class="pcp-grade-aviso">Não foi possível carregar os tamanhos desta grade.</div>`;
    }
    const escolha = (st.grades && st.grades.length > 1)
      ? `<div class="pcp-grade-lbl">Escolher grade (${st.grades.length})</div>
         <select class="pcp-grade-sel" data-idx="${idx}" aria-label="Escolher grade">
          ${st.grades.map((g) => {
            const lbl = (g.nome || ('Grade #' + g.id))
              + (g.padrao ? ' (padrão)' : '')
              + (g.modo_grade === 'F' ? ' · fechada' : '');
            const sel = String(g.id) === String(st.idGrade) ? ' selected' : '';
            return `<option value="${g.id}"${sel}>${esc(lbl)}</option>`;
          }).join('')}
        </select>`
      : (st.grades && st.grades[0]
        ? `<div class="pcp-grade-unica">${esc(st.grades[0].nome || 'Grade')}${st.grades[0].modo_grade === 'F' ? ' · fechada' : ''}</div>`
        : '');
    const sizes = st.itens.map((g) => {
      const q = st.qtdBySize[g.id] || '';
      return `<div class="pcp-size">
        <span class="pcp-size-lbl">${esc(g.nome)}</span>
        <input type="number" class="pcp-size-qtd" data-idx="${idx}" data-gid="${g.id}"
          min="0" step="1" inputmode="decimal" placeholder="0" value="${q === 0 ? '' : esc(q)}"
          aria-label="Qtd ${esc(g.nome)}">
      </div>`;
    }).join('');
    return `<div class="pcp-grade-wrap" data-idx="${idx}">
      ${escolha}
      <div class="pcp-sizes">${sizes}</div>
    </div>`;
  }

  function atualizarRodapeGrade(list, idx) {
    const row = list?.querySelector(`.pcp-row[data-idx="${idx}"]`);
    const st = _rowState[idx];
    if (!row || !st) return;
    const head = row.querySelector('.pcp-head-actions');
    if (head) head.innerHTML = renderTopoGradeHtml(idx);
  }

  function onListInput(e) {
    const t = e.target;
    if (!t) return;
    const list = document.getElementById('pcpList');
    if (!list || !list.contains(t)) return;
    limparErroPicker();
    if (t.classList.contains('pcp-qtd')) {
      const row = t.closest('.pcp-row');
      const idx = parseInt(row?.dataset.idx, 10);
      const qtd = parseFloat(t.value) || 0;
      if (idx >= 0 && qtd > 0) setSelecionada(idx, true, { fillPack: false, rerender: true });
      else syncOkBtn();
      return;
    }
    if (t.classList.contains('pcp-size-qtd')) {
      const idx = parseInt(t.dataset.idx, 10);
      const gid = parseInt(t.dataset.gid, 10);
      const st = _rowState[idx];
      if (!st) return;
      st.qtdBySize[gid] = parseFloat(t.value) || 0;
      if (somaGrade(st) > 0 && !st.selecionada) setSelecionada(idx, true, { fillPack: false, rerender: true });
      else atualizarRodapeGrade(list, idx);
      syncOkBtn();
    }
  }

  function aplicarTotalNaLinha(idx, rawTotal) {
    const st = _rowState[idx];
    if (!st || !st.usaGrade) return;
    const total = parseInt(rawTotal, 10) || 0;
    if (total <= 0) {
      aplicarPackFechada(st, { force: true });
    } else if (!aplicarTotalPack(st, total)) {
      aplicarPackFechada(st, { force: true });
    }
    if (somaGrade(st) > 0) st.selecionada = true;
    rerenderGradeLinha(idx);
    const list = document.getElementById('pcpList');
    const row = list?.querySelector(`.pcp-row[data-idx="${idx}"]`);
    if (row) {
      row.classList.toggle('pcp-on', st.selecionada);
      row.classList.toggle('pcp-off', !st.selecionada);
      const chk = row.querySelector('.pcp-chk');
      if (chk) chk.checked = st.selecionada;
    }
    syncOkBtn();
  }

  function onListClick(e) {
    const t = e.target;
    if (!t) return;
    const list = document.getElementById('pcpList');
    if (!list || !list.contains(t)) return;
    if (t.classList.contains('pcp-pack-aplicar') || t.closest('.pcp-pack-aplicar')) {
      const btn = t.classList.contains('pcp-pack-aplicar') ? t : t.closest('.pcp-pack-aplicar');
      const idx = parseInt(btn.dataset.idx, 10);
      const inp = list.querySelector(`.pcp-pack-total[data-idx="${idx}"]`);
      aplicarTotalNaLinha(idx, inp?.value);
      return;
    }
    if (t.classList.contains('pcp-chk')) {
      const idx = parseInt(t.dataset.idx, 10);
      if (idx >= 0) setSelecionada(idx, t.checked, { fillPack: true, rerender: true });
      return;
    }
    const ang = t.closest ? t.closest('.pcp-angle') : null;
    if (ang) {
      const row = ang.closest('.pcp-row');
      const i = parseInt(row?.dataset.idx, 10);
      if (i >= 0) {
        _imgSel[i] = parseInt(ang.dataset.ang, 10) || 0;
        const foto = row.querySelector('.pcp-foto');
        const urls = _imgCache.get(String(_cores[i]?.cod_produto || _cores[i]?.id || '')) || [];
        if (foto && urls[_imgSel[i]]) foto.setAttribute('src', urls[_imgSel[i]]);
        row.querySelectorAll('.pcp-angle').forEach((b) => b.classList.toggle('is-on', b === ang));
      }
      return;
    }
    // Galeria: foto grande não alterna seleção (só o checkbox / digitar a qtd)
    if (_galeria && t.closest('.pcp-media')) return;
    // Controles de digitação / grade / checkbox: não alterna seleção pelo card
    if (t.closest('input, select, button, a, textarea, label, .pcp-chk-wrap, .pcp-sizes, .pcp-pack-mini, .pcp-grade-wrap, .pcp-body')) return;
    // No celular o toque cai em badge/meta/caption — marca/desmarca a cor inteira
    const row = t.closest('.pcp-row');
    const idx = parseInt(row?.dataset.idx, 10);
    const st = _rowState[idx];
    if (!(idx >= 0) || !st) return;
    e.preventDefault();
    setSelecionada(idx, !st.selecionada, { fillPack: true, rerender: true });
  }

  async function onListChange(e) {
    const t = e.target;
    if (!t) return;
    const list = document.getElementById('pcpList');
    if (!list || !list.contains(t)) return;
    if (t.classList.contains('pcp-grade-sel')) {
      const idx = parseInt(t.dataset.idx, 10);
      const idGrade = parseInt(t.value, 10) || 0;
      if (!(idx >= 0) || !idGrade) return;
      const jaSel = !!_rowState[idx]?.selecionada;
      // Troca de grade: só repõe pack se a cor já estava marcada
      await aplicarGradeNaLinha(idx, idGrade, { fillPack: jaSel });
      rerenderGradeLinha(idx);
      syncOkBtn();
      return;
    }
  }

  function onListKeydown(e) {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!t) return;
    if (t.classList.contains('pcp-pack-total')) {
      e.preventDefault();
      const idx = parseInt(t.dataset.idx, 10);
      aplicarTotalNaLinha(idx, t.value);
      return;
    }
    if (!t.classList.contains('pcp-qtd') && !t.classList.contains('pcp-size-qtd')) return;
    e.preventDefault();
    document.getElementById('pcpOk')?.click();
  }

  function ensureListDelegation(list) {
    if (!list || list.dataset.pcpBound === '2') return;
    if (list.dataset.pcpBound === '1') {
      list.removeEventListener('input', onListInput);
      list.removeEventListener('change', onListChange);
      list.removeEventListener('keydown', onListKeydown);
    }
    list.dataset.pcpBound = '2';
    list.addEventListener('input', onListInput);
    list.addEventListener('change', onListChange);
    list.addEventListener('keydown', onListKeydown);
    list.addEventListener('click', onListClick);
  }

  async function carregarDadosGrade(idGrade) {
    const gid = parseInt(idGrade, 10) || 0;
    if (!(gid > 0)) return null;
    if (_gradeCache.has(gid)) return _gradeCache.get(gid);
    if (typeof _fetchGrade !== 'function') return null;
    try {
      const d = await _fetchGrade(gid);
      const payload = {
        itens: Array.isArray(d?.itens) ? d.itens : [],
        modo_grade: d?.modo_grade === 'F' ? 'F' : 'A',
        multiplo_grade: parseInt(d?.multiplo_grade, 10) || 0,
        nome: d?.nome || '',
      };
      _gradeCache.set(gid, payload);
      return payload;
    } catch (_) {
      return null;
    }
  }

  async function listarGradesDaCor(c) {
    const pid = parseInt(c?.id || c?.cod_produto || c?.ID, 10) || 0;
    const maeId = parseInt(_mae?.id || _mae?.cod_produto || _mae?.ID, 10) || 0;
    const tipog = tipogradeDe(c, _mae);
    const map = new Map();
    const pushAll = (arr) => {
      (arr || []).forEach((g) => {
        const id = parseInt(g.id, 10) || 0;
        if (id > 0 && !map.has(id)) map.set(id, g);
      });
    };
    async function fetchGrades(idProd) {
      if (!(idProd > 0) || typeof _fetchGradesProduto !== 'function') return [];
      if (_gradesListCache.has(idProd)) return _gradesListCache.get(idProd);
      try {
        const d = await _fetchGradesProduto(idProd);
        const list = Array.isArray(d?.grades) ? d.grades : (Array.isArray(d) ? d : []);
        _gradesListCache.set(idProd, list);
        return list;
      } catch (_) {
        _gradesListCache.set(idProd, []);
        return [];
      }
    }
    pushAll(_gradesMae);
    pushAll(await fetchGrades(pid));
    if (maeId > 0 && maeId !== pid) pushAll(await fetchGrades(maeId));
    let grades = [...map.values()];
    if (!grades.length && tipog > 0) {
      grades = [{
        id: tipog,
        nome: c?.tipoprodutograde || _mae?.tipoprodutograde || '',
        padrao: true,
        modo_grade: 'A',
        multiplo_grade: 0,
      }];
    }
    return grades;
  }

  async function aplicarGradeNaLinha(idx, idGrade, { fillPack = true } = {}) {
    const st = _rowState[idx];
    if (!st) return;
    st.loading = true;
    st.idGrade = idGrade;
    st.qtdBySize = {};
    const d = await carregarDadosGrade(idGrade);
    st.loading = false;
    if (!d) {
      st.itens = [];
      st.modo = 'A';
      st.multiplo = 0;
      return;
    }
    st.itens = d.itens;
    st.modo = d.modo_grade;
    st.multiplo = d.multiplo_grade;
    const gMeta = (st.grades || []).find((x) => parseInt(x.id, 10) === idGrade);
    if (gMeta) {
      if (gMeta.modo_grade === 'F') st.modo = 'F';
      if (parseInt(gMeta.multiplo_grade, 10) > 0) st.multiplo = parseInt(gMeta.multiplo_grade, 10);
    }
    // Pack só quando o usuário marca a cor (fillPack) — nunca auto-marca ao carregar.
    if (fillPack) {
      aplicarPackFechada(st, { force: true });
    }
  }

  async function prepararLinhasComGrade() {
    const jobs = _cores.map(async (c, i) => {
      const tipog = tipogradeDe(c, _mae);
      const usaGrade = _habilitaGrade && tipog > 0 && typeof _fetchGrade === 'function';
      if (!usaGrade) {
        _rowState[i] = {
          selecionada: false,
          usaGrade: false,
          idGrade: null,
          grades: [],
          itens: [],
          modo: 'A',
          multiplo: 0,
          qtdBySize: {},
          loading: false,
        };
        return;
      }
      _rowState[i] = {
        selecionada: false,
        usaGrade: true,
        idGrade: null,
        grades: [],
        itens: [],
        modo: 'A',
        multiplo: 0,
        qtdBySize: {},
        loading: true,
      };
      const grades = await listarGradesDaCor(c);
      _rowState[i].grades = grades;
      const padrao = grades.find((g) => g.padrao) || grades[0];
      const idUsar = (padrao && padrao.id) || tipog;
      // Ao abrir: carrega tamanhos vazios — usuário marca a cor e o pack preenche
      await aplicarGradeNaLinha(i, idUsar, { fillPack: false });
    });
    await Promise.all(jobs);
    const uniao = (() => {
      const map = new Map();
      const push = (g) => {
        const id = parseInt(g?.id, 10) || 0;
        if (id > 0 && !map.has(id)) map.set(id, g);
      };
      (_gradesMae || []).forEach(push);
      _rowState.forEach((st) => (st?.grades || []).forEach(push));
      return [...map.values()];
    })();
    if (uniao.length > 1) {
      _rowState.forEach((st) => {
        if (st && st.usaGrade) st.grades = uniao;
      });
    }
  }

  function renderLista() {
    const list = document.getElementById('pcpList');
    if (!list) return;
    const fmt = _formatPreco;
    list.innerHTML = _cores.map((c, i) => {
      const foto = c.foto_principal || '';
      const preco = parseFloat(c.vlr_venda) || 0;
      const precoTxt = fmt ? fmt(preco) : (preco ? preco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '');
      const fabRaw = (() => {
        const maeFab = String(_mae?.cod_fabricante || '').trim();
        const useMae = typeof window.pedidoUsaRefMae === 'function' && window.pedidoUsaRefMae();
        if (useMae && maeFab) return maeFab;
        return String(c.cod_fabricante || '').trim();
      })();
      const fab = fabRaw ? esc(fabRaw) : '';
      const st = _rowState[i] || {};
      const on = !!st.selecionada;
      const fotoHtml = foto
        ? `<img class="pcp-foto" src="${esc(foto)}" alt="" loading="lazy" decoding="async" title="Clique para marcar/desmarcar" onerror="this.outerHTML='<div class=\\'pcp-foto-ph\\' data-pcp-toggle=\\'1\\'>📷</div>'">`
        : `<div class="pcp-foto-ph" data-pcp-toggle="1" title="Clique para marcar/desmarcar">📷</div>`;
      const badgesHtml = htmlBadgesCor(st);
      const chkHtml = `<label class="pcp-chk-wrap" title="Incluir esta cor no pedido">
        <input type="checkbox" class="pcp-chk" data-idx="${i}" ${on ? 'checked' : ''} aria-label="Selecionar ${esc(labelCor(c))}">
      </label>`;
      const usaGrade = st && st.usaGrade;
      const rowCls = `pcp-row${usaGrade ? ' pcp-row-grade' : ''}${on ? ' pcp-on' : ' pcp-off'}${_galeria && i === _galIdx ? ' pcp-gal-on' : ''}`;
      const precoTag = (_galeria && precoTxt)
        ? `<div class="pcp-gal-price">${esc(precoTxt)}${fab ? `<small>${fab}</small>` : ''}</div>`
        : '';
      const titleBlock = `<div class="pcp-title-row">
            ${chkHtml}
            <div class="pcp-nome" data-pcp-toggle="1" title="Clique para marcar/desmarcar">${esc(labelCor(c))}</div>
          </div>
          <div class="pcp-meta">${fab}${fab && precoTxt ? ' · ' : ''}${esc(precoTxt)}</div>
          ${badgesHtml}`;
      if (usaGrade) {
        return `<div class="${rowCls}" data-idx="${i}">
          <div class="pcp-card-top">
            <div class="pcp-media" data-pcp-toggle="1">${fotoHtml}${precoTag}</div>
            <div class="pcp-card-caption">
              ${titleBlock}
              <div class="pcp-head-actions">${renderTopoGradeHtml(i)}</div>
            </div>
          </div>
          <div class="pcp-body">${renderSizesHtml(i)}</div>
        </div>`;
      }
      return `<div class="${rowCls}" data-idx="${i}">
        <div class="pcp-card-top">
          <div class="pcp-media" data-pcp-toggle="1">${fotoHtml}${precoTag}</div>
          <div class="pcp-card-caption">
            ${titleBlock}
            <input type="number" class="pcp-qtd" min="0" step="1" inputmode="decimal" placeholder="Qtd" value="" aria-label="Quantidade ${esc(labelCor(c))}">
          </div>
        </div>
      </div>`;
    }).join('');
    ensureListDelegation(list);
    galSync();
  }

  let _formatPreco = null;

  /**
   * @param {{ grupo: object, onConfirm: Function, formatPreco?: Function, titulo?: string, okTexto?: string,
   *   habilitaGrade?: string|boolean, fetchGrade?: Function, fetchGradesProduto?: Function }} opts
   * @returns {Promise<boolean>}
   */
  async function open(opts) {
    const grupo = opts && opts.grupo;
    if (!grupo || !grupo.mae) return false;
    const cores = Array.isArray(grupo.cores) ? grupo.cores.slice() : [];
    if (!cores.length) return false;

    _cores = cores;
    _mae = grupo.mae;
    _onConfirm = typeof opts.onConfirm === 'function' ? opts.onConfirm : null;
    _formatPreco = typeof opts.formatPreco === 'function' ? opts.formatPreco : null;
    _habilitaGrade = opts.habilitaGrade === true || String(opts.habilitaGrade || '').toUpperCase() === 'S';
    _fetchGrade = typeof opts.fetchGrade === 'function' ? opts.fetchGrade : null;
    _fetchGradesProduto = typeof opts.fetchGradesProduto === 'function' ? opts.fetchGradesProduto : null;
    _rowState = [];
    _incluirTodas = false;
    _gradesMae = [];
    _gradesListCache.clear();
    _galeria = opts.estilo === 'galeria';
    _galIdx = 0;
    _fetchImagens = typeof opts.fetchImagens === 'function' ? opts.fetchImagens : null;

    const el = ensureModal();
    el.classList.toggle('pcp-gal', _galeria);
    const mae = grupo.mae;
    const sku = mae.cod_fabricante || mae.id || '';
    const nome = mae.descricao || mae.desc_produto || '';
    document.getElementById('pcpTitulo').textContent = opts.titulo || 'Escolher cores';
    document.getElementById('pcpOk').textContent = opts.okTexto || 'Adicionar ao pedido';

    const temAlgumaGrade = _habilitaGrade && cores.some((c) => tipogradeDe(c, mae) > 0);
    el.classList.toggle('pcp-has-grade', temAlgumaGrade);
    document.getElementById('pcpSub').textContent = temAlgumaGrade
      ? (sku ? sku + ' — ' : '') + nome + ' · marque as cores e informe a qtd por tamanho'
      : (sku ? sku + ' — ' : '') + nome + ' · marque as cores e informe a quantidade';

    // Skeleton rápido (qtd simples) enquanto carrega grades
    _rowState = cores.map((c) => {
      const tipog = tipogradeDe(c, mae);
      const usa = temAlgumaGrade && tipog > 0;
      return {
        selecionada: false,
        usaGrade: usa,
        idGrade: null,
        grades: [],
        itens: [],
        modo: 'A',
        multiplo: 0,
        qtdBySize: {},
        loading: !!usa,
      };
    });
    renderLista();

    document.getElementById('pcpCancel').onclick = () => close();
    const btnClose = document.getElementById('pcpClose');
    if (btnClose) btnClose.onclick = () => close();
    const btnTodas = document.getElementById('pcpTodasGradesBtn');
    if (btnTodas) {
      btnTodas.onclick = () => toggleIncluirTodasGrades();
    }
    const btnMarcar = document.getElementById('pcpMarcarTodas');
    const btnLimpar = document.getElementById('pcpDesmarcarTodas');
    if (btnMarcar) btnMarcar.onclick = () => marcarTodasCores(true);
    if (btnLimpar) btnLimpar.onclick = () => marcarTodasCores(false);
    document.getElementById('pcpOk').onclick = async () => {
      limparErroPicker();
      limparAvisosTravados();
      // Pack auto-preenchido sem checkbox → sincroniza antes de coletar
      sincronizarSelecaoPorQtd();
      let sel = coletarSelecoes();
      if (!sel.length) {
        await avisarPicker(
          '',
          'Marque ao lado as cores que deseja incluir e informe as quantidades (múltiplo da grade fechada).'
        );
        return;
      }
      // Soft-check grade fechada — só nas cores marcadas (aviso DENTRO do modal)
      for (let i = 0; i < _rowState.length; i++) {
        const st = _rowState[i];
        if (!st || !st.selecionada || !st.usaGrade || st.modo !== 'F' || st.multiplo < 2) continue;
        const total = somaGrade(st);
        if (total > 0 && Math.abs(total % st.multiplo) >= 0.0001) {
          const nome = labelCor(_cores[i]);
          await avisarPicker(
            '',
            `«${nome}» tem total ${total}, mas a grade fechada exige múltiplo de ${st.multiplo}. Ajuste a quantidade (ex.: ${st.multiplo} ou ${st.multiplo * 2}) ou desmarque essa cor.`,
            i
          );
          return;
        }
      }
      // Só multiplica grades se o usuário ativou o botão «Incluir todas as N grades»
      if (_incluirTodas) {
        try {
          sel = await expandirTodasGrades(sel);
        } catch (_) { /* segue com a seleção visível */ }
      }
      const cb = _onConfirm;
      close();
      if (cb) {
        try {
          await cb(sel, grupo);
        } catch (err) {
          console.warn('[ProdutoCoresPicker] onConfirm', err);
          // Modal já fechou — toast simples
          if (typeof global.toast === 'function') {
            global.toast(err?.message || 'Não foi possível adicionar', 'err');
          }
        }
      }
    };

    syncOkBtn();
    // Mostra o modal NA HORA — no celular aguardar a API de grade antes do .show
    // fazia parecer que o toque «não fez nada» (só a capa ficava na tela).
    el.classList.add('show');
    if (_galeria) { galFades(); requestAnimationFrame(galFades); }

    if (temAlgumaGrade) {
      try {
        _gradesMae = await listarGradesDaCor(_mae);
        syncTodasGradesUi();
        await prepararLinhasComGrade();
        renderLista();
        syncTodasGradesUi();
        syncOkBtn();
      } catch (err) {
        console.warn('[ProdutoCoresPicker] grades', err);
      }
    }

    // No iOS, focus() em input dentro de display:none quebra o modal — só foca se visível e com mouse fino
    setTimeout(() => {
      const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
      if (!fine) return;
      const list = document.getElementById('pcpList');
      const first = list?.querySelector('.pcp-row.pcp-on .pcp-size-qtd, .pcp-row.pcp-on .pcp-qtd, .pcp-row:not(.pcp-row-grade) .pcp-qtd');
      if (first && first.offsetParent !== null) first.focus();
    }, 50);
    return true;
  }

  /**
   * Busca variações; se for pai com cores, abre o picker.
   * @returns {Promise<boolean>} true se abriu o picker (caller não deve seguir o fluxo normal)
   */
  async function tryFromProdutoId(id, opts) {
    const prodId = parseInt(id, 10);
    if (!(prodId > 0) || typeof opts?.fetchGrupo !== 'function') return false;
    let grupo;
    try {
      grupo = await opts.fetchGrupo(prodId);
    } catch (_) {
      return false;
    }
    if (!grupo || grupo.papel !== 'mae' || !(grupo.cores && grupo.cores.length)) return false;
    return open({
      grupo,
      onConfirm: opts.onConfirm,
      formatPreco: opts.formatPreco,
      titulo: opts.titulo,
      okTexto: opts.okTexto,
      habilitaGrade: opts.habilitaGrade,
      fetchGrade: opts.fetchGrade,
      fetchGradesProduto: opts.fetchGradesProduto,
    });
  }

  global.ProdutoCoresPicker = { open, tryFromProdutoId, close, labelCor };
})(typeof window !== 'undefined' ? window : globalThis);
