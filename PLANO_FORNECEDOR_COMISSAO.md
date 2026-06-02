# Plano — Campos de Imposto/Comissão no Cadastro de Fornecedor

Referência: tela de cadastro de representada do Mercos.

---

## 1. Novas colunas na tabela `fornecedores`

```sql
-- Impostos
ALTER TABLE fornecedores ADD COLUMN ipi_frete_base     CHAR(1) DEFAULT 'N'; -- frete compõe base IPI

-- Comissão
ALTER TABLE fornecedores ADD COLUMN com_sobre_ipi      CHAR(1) DEFAULT 'S'; -- paga comissão sobre IPI
ALTER TABLE fornecedores ADD COLUMN com_sobre_st       CHAR(1) DEFAULT 'S'; -- paga comissão sobre ST
ALTER TABLE fornecedores ADD COLUMN com_tipo           VARCHAR(20) DEFAULT 'PARCELADA';
-- com_tipo: 'PARCELADA' = liquidez do pedido | 'UNICA' = parcela única
```

Adicionar via `addColIfMissing` em `routes/setup.js` (padrão do projeto).

---

## 2. `routes/fornecedores.js`

- Incluir as 4 colunas no SELECT de leitura
- Incluir no INSERT e UPDATE (já usa spread/colunas explícitas — só acrescentar)

---

## 3. `public/pages/fornecedores.html`

Adicionar seção no formulário, após os dados comerciais:

```html
<!-- ── Impostos ── -->
<div class="form-section-title">Impostos</div>
<div class="form-row">
  <label class="checkbox-label">
    <input type="checkbox" id="ipi_frete_base" name="ipi_frete_base">
    Considerar o valor do frete na base de cálculo do IPI
  </label>
</div>

<!-- ── Comissão ── -->
<div class="form-section-title">Comissão</div>
<div class="form-row">
  <label class="checkbox-label">
    <input type="checkbox" id="com_sobre_ipi" name="com_sobre_ipi" checked>
    Paga comissão sobre IPI
    <span class="field-hint">Desmarque se a representada desconta o IPI ao calcular comissão</span>
  </label>
</div>
<div class="form-row">
  <label class="checkbox-label">
    <input type="checkbox" id="com_sobre_st" name="com_sobre_st" checked>
    Paga comissão sobre ST
    <span class="field-hint">Desmarque se a representada desconta o ST ao calcular comissão</span>
  </label>
</div>
<div class="form-row">
  <span class="field-label">Forma de pagamento da comissão</span>
  <label class="radio-label">
    <input type="radio" name="com_tipo" value="PARCELADA" checked>
    Parcelada na liquidez do pedido
  </label>
  <label class="radio-label">
    <input type="radio" name="com_tipo" value="UNICA">
    Parcela única
  </label>
</div>
```

Lógica de leitura/escrita (já no padrão do formulário existente):
```javascript
// Ao carregar fornecedor:
document.getElementById('ipi_frete_base').checked = (f.ipi_frete_base === 'S');
document.getElementById('com_sobre_ipi').checked  = (f.com_sobre_ipi !== 'N');
document.getElementById('com_sobre_st').checked   = (f.com_sobre_st  !== 'N');
document.querySelector(`input[name="com_tipo"][value="${f.com_tipo || 'PARCELADA'}"]`).checked = true;

// Ao salvar:
body.ipi_frete_base = document.getElementById('ipi_frete_base').checked ? 'S' : 'N';
body.com_sobre_ipi  = document.getElementById('com_sobre_ipi').checked  ? 'S' : 'N';
body.com_sobre_st   = document.getElementById('com_sobre_st').checked   ? 'S' : 'N';
body.com_tipo       = document.querySelector('input[name="com_tipo"]:checked').value;
```

---

## 4. Impacto no cálculo de comissão

Quando uma comissão for gerada para um pedido (pagtocomissao), aplicar as regras do fornecedor:

### Base de cálculo da comissão (`routes/comissoes.js` ou onde o valor é calculado):

```javascript
// vlr_pedido = vlrtotalpedido do pedido
// ipi_pedido = soma do IPI dos itens
// st_pedido  = soma do ST dos itens
// comissao_pct = percentual de comissão do vendedor

let base = vlr_pedido;

if (fornecedor.com_sobre_ipi !== 'S') base -= ipi_pedido;
if (fornecedor.com_sobre_st  !== 'S') base -= st_pedido;

const vlr_comissao = base * (comissao_pct / 100);
```

### Forma de pagamento (`com_tipo`):
- `PARCELADA`: a comissão é liberada conforme as parcelas do pedido são liquidadas
  - Já existe lógica de `status='P'` (pendente) → `'C'` (confirmado) em `pagtocomissao`
  - Verificar se o fluxo atual já faz isso ou se paga tudo de uma vez
- `UNICA`: paga a comissão inteira quando o pedido é aprovado (comportamento atual)

### Onde implementar:
- `routes/comissoes.js` — função que cria/recalcula comissões do pedido
- Ao aprovar pedido em `routes/pedidos.js` (PUT /:id/situacao) — buscar fornecedor e aplicar regras

---

## 5. Ordem de execução na próxima sessão

1. `routes/setup.js` — 4 colunas via `addColIfMissing`
2. `routes/fornecedores.js` — incluir colunas no SELECT/INSERT/UPDATE
3. `public/pages/fornecedores.html` — adicionar seção no form
4. Testar: salvar fornecedor com configurações, verificar no banco
5. `routes/comissoes.js` — aplicar `com_sobre_ipi`, `com_sobre_st` na base de cálculo
6. `routes/pedidos.js` (aprovação) — respeitar `com_tipo` ao gerar comissão

---

## Notas
- `com_sobre_ipi` e `com_sobre_st` default `'S'` = comportamento atual mantido
- `com_tipo = 'PARCELADA'` default = verificar se atual já é parcelado ou único
- Mercos chama de "representada" — aqui é "fornecedor" com `tipo='FABRICA'`
