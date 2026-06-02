<?php
$file = 'c:/xampp/htdocs/SysRepWeb/public/pages/pedidos.html';
$content = file_get_contents($file);

$func = '
function renderProdutosAvancado(lista) {
  const tbody = document.getElementById("bus_prod_tbody");
  if (!tbody) return;
  const countEl = document.getElementById("bus_prod_count");
  if (countEl) countEl.textContent = lista.length;
  if (lista.length === 0) {
    tbody.innerHTML = "<tr><td colspan=8 style=\'text-align:center; padding:40px; color:var(--text2)\'>Nenhum produto encontrado</td></tr>";
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr onclick="selecionarProdutoAvancado(${p.cod_produto})" style="cursor:pointer">
      <td style="font-weight:700; color:var(--accent)">${p.cod_produto}</td>
      <td>
        <div style="font-weight:700">${p.desc_produto}</div>
      </td>
      <td>
        <div class="badge-soft">${p.cod_fabricante || "—"}</div>
      </td>
      <td style="text-align:center"><span class="badge-soft">${p.unidade}</span></td>
      <td style="text-align:right; font-weight:800; color:var(--success)">R$ ${p.vlr_venda}</td>
      <td style="text-align:center">
        <button class="btn-acoes">></button>
      </td>
    </tr>
  `).join("");
}
';

// Add the function before </body>
$newContent = str_replace('</body>', "<script>$func</script>\n</body>", $content);

if (file_put_contents($file, $newContent)) {
    echo "SUCCESS: File updated.";
} else {
    echo "ERROR: Failed to update file.";
}
?>
