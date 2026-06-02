<?php
$file = 'c:/xampp/htdocs/SysRepWeb/public/pages/pedidos.html';
$content = file_get_contents($file);

$funcRender = '
function renderProdutosAvancado(lista) {
  const tbody = document.getElementById("bus_prod_tbody");
  if (!tbody) return;
  const countEl = document.getElementById("bus_prod_count");
  if (countEl) countEl.textContent = lista.length;
  if (lista.length === 0) {
    tbody.innerHTML = "<tr><td colspan=8 style=\'text-align:center; padding:40px; color:var(--text2)\'>Nenhum produto encontrado</td></tr>";
    return;
  }
  tbody.innerHTML = lista.map(p => {
    const vlr = typeof fmtCur === "function" ? fmtCur(p.vlr_venda) : "R$ " + p.vlr_venda;
    return `
    <tr onclick="selecionarProdutoAvancado(${p.cod_produto})" style="cursor:pointer">
      <td style="font-weight:700; color:var(--accent)">${p.cod_produto}</td>
      <td>
        <div style="font-weight:700">${p.desc_produto}</div>
        <div style="font-size:10px; color:var(--text2)">${p.grupo_descricao || "Sem Grupo"}</div>
      </td>
      <td>
        <div class="badge-soft">${p.cod_fabricante || "—"}</div>
        ${p.cod_barras ? "<div style=\'font-size:10px; color:var(--text2); margin-top:2px\'>EAN: " + p.cod_barras + "</div>" : ""}
      </td>
      <td style="text-align:center"><span class="badge-soft" style="background:var(--bg)">${p.unidade}</span></td>
      <td style="text-align:right; font-weight:800; color:var(--success)">${vlr}</td>
      <td style="text-align:right">${p.comissao ? p.comissao.toFixed(2) + "%" : "—"}</td>
      <td style="text-align:right">${p.ipi ? p.ipi.toFixed(2) + "%" : "—"}</td>
      <td style="text-align:center">
        <button class="btn-acoes"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width:16px;height:16px"><path d="M9 5l7 7-7 7"/></svg></button>
      </td>
    </tr>`;
  }).join("");
}
';

$funcSelect = '
function selecionarProdutoAvancado(id) {
  const prod = _produtosAvancadoCache.find(p => p.cod_produto == id);
  if (!prod) return;

  const inputSearch = document.getElementById("sub_prod_search");
  const inputHidden = document.getElementById("sub_prod");
  
  if (inputSearch && inputHidden) {
    inputHidden.value = prod.cod_produto;
    inputSearch.value = prod.desc_produto;
    
    // Preenche campos no drawer de itens
    if(document.getElementById("sub_vlr")) document.getElementById("sub_vlr").value = prod.vlr_venda || 0;
    if(document.getElementById("sub_ipi")) document.getElementById("sub_ipi").value = prod.ipi || 0;
    if(document.getElementById("sub_comissao")) document.getElementById("sub_comissao").value = prod.comissao || 0;
    if(document.getElementById("sub_puxada")) document.getElementById("sub_puxada").value = prod.valor_puxada || 0;
    if(document.getElementById("sub_foto")) document.getElementById("sub_foto").value = prod.foto_principal || "";
    
    setTimeout(() => {
      const qInput = document.getElementById("sub_qtd");
      if (qInput) qInput.focus();
    }, 100);
    
    if(typeof calcSubItem === "function") calcSubItem();
    if(typeof closeModal === "function") closeModal("modalBuscaAvancada");
    if(typeof toast === "function") toast("Produto selecionado!", "ok");
  }
}
';

// Inject functions at the end of the script block (before </script>)
$content = str_replace('// ── INITIALIZATION ──', "$funcRender\n$funcSelect\n\n// ── INITIALIZATION ──", $content);

if (file_put_contents($file, $content)) {
    echo "SUCCESS: Functions injected and search fixed.";
} else {
    echo "ERROR: Failed to update file.";
}
?>
