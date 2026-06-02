# Plano de Implementação — ACL Granular (Action-Level)

## Contexto
O sistema atual usa permissões por tela (screen-level): `perfil.acesso_X = 'S'|'N'`.
Dentro da tela, o usuário tem acesso total. O objetivo é adicionar controle por ação
(ver / criar / editar / excluir) por módulo.

---

## 1. Schema — Novas colunas na tabela `perfil`

Rodar via `routes/setup.js` (padrão do projeto — já tem `addColIfMissing`):

```sql
-- Pedidos
ALTER TABLE perfil ADD COLUMN pedidos_criar  CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN pedidos_editar CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN pedidos_excluir CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN pedidos_aprovar CHAR(1) DEFAULT 'S';

-- Clientes
ALTER TABLE perfil ADD COLUMN clientes_criar  CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN clientes_editar CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN clientes_excluir CHAR(1) DEFAULT 'S';

-- Produtos
ALTER TABLE perfil ADD COLUMN produtos_criar  CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN produtos_editar CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN produtos_excluir CHAR(1) DEFAULT 'S';

-- Fornecedores
ALTER TABLE perfil ADD COLUMN fornecedores_criar  CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN fornecedores_editar CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN fornecedores_excluir CHAR(1) DEFAULT 'S';

-- Visitas / CRM
ALTER TABLE perfil ADD COLUMN visitas_criar  CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN visitas_editar CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN visitas_excluir CHAR(1) DEFAULT 'S';

ALTER TABLE perfil ADD COLUMN leads_criar  CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN leads_editar CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN leads_excluir CHAR(1) DEFAULT 'S';

-- Financeiro
ALTER TABLE perfil ADD COLUMN financeiro_criar  CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN financeiro_editar CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN financeiro_excluir CHAR(1) DEFAULT 'S';

-- Cadastros (bancos, natureza, despesas, etc.)
ALTER TABLE perfil ADD COLUMN cadastros_criar  CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN cadastros_editar CHAR(1) DEFAULT 'S';
ALTER TABLE perfil ADD COLUMN cadastros_excluir CHAR(1) DEFAULT 'S';
```

**Todos com `DEFAULT 'S'`** — usuários existentes mantêm acesso total. Novas
restrições são configuradas manualmente por perfil após a migração.

---

## 2. Middleware — `middleware/auth.js`

### Função helper a adicionar:
```javascript
// Verifica permissão granular. modulo = 'pedidos', acao = 'criar'|'editar'|'excluir'|'aprovar'
function checkAcl(modulo, acao) {
  return (req, res, next) => {
    const u = req.user;
    // perfil 1 (admin) sempre passa
    if (u.perfil == 1) return next();
    // Verifica coluna `modulo_acao` no perfil
    const col = `${modulo}_${acao}`;
    if (u[col] === 'S') return next();
    return res.status(403).json({ error: `Sem permissão para ${acao} em ${modulo}` });
  };
}
module.exports.checkAcl = checkAcl;
```

### Como usar nas rotas:
```javascript
const { authMiddleware, checkAcl } = require('../middleware/auth');

router.post('/',           authMiddleware, checkAcl('pedidos','criar'),   handler);
router.put('/:id',         authMiddleware, checkAcl('pedidos','editar'),  handler);
router.delete('/:id',      authMiddleware, checkAcl('pedidos','excluir'), handler);
router.put('/:id/aprovar', authMiddleware, checkAcl('pedidos','aprovar'), handler);
```

---

## 3. Rotas que precisam de guarda (por prioridade)

### routes/pedidos.js
| Método | Rota | Permissão |
|--------|------|-----------|
| POST | / | pedidos_criar |
| PUT | /:id | pedidos_editar |
| DELETE | /:id | pedidos_excluir |
| PUT | /:id/situacao | pedidos_aprovar |
| POST | /:id/clonar | pedidos_criar |

### routes/clientes.js (ou modules/clientes/clientes.routes.js)
| Método | Rota | Permissão |
|--------|------|-----------|
| POST | / | clientes_criar |
| PUT | /:id | clientes_editar |
| DELETE | /:id | clientes_excluir |

### routes/produtos.js
| Método | Rota | Permissão |
|--------|------|-----------|
| POST | / | produtos_criar |
| PUT | /:id | produtos_editar |
| DELETE | /:id | produtos_excluir |

### routes/fornecedores.js
| Método | Rota | Permissão |
|--------|------|-----------|
| POST | / | fornecedores_criar |
| PUT | /:id | fornecedores_editar |
| DELETE | /:id | fornecedores_excluir |

### routes/visitas.js
| Método | Rota | Permissão |
|--------|------|-----------|
| POST | / | visitas_criar |
| PUT | /:id | visitas_editar |
| DELETE | /:id | visitas_excluir |

### routes/leads.js
| Método | Rota | Permissão |
|--------|------|-----------|
| POST | / | leads_criar |
| PUT | /:id | leads_editar |
| DELETE | /:id | leads_excluir |

### routes/pagar.js + routes/receber.js
| Método | Rota | Permissão |
|--------|------|-----------|
| POST | / | financeiro_criar |
| PUT | /:id | financeiro_editar |
| DELETE | /:id | financeiro_excluir |

### routes/cadastros.js (bancos, natureza, despesas, etc.)
| Método | Rota | Permissão |
|--------|------|-----------|
| POST | /*/  | cadastros_criar |
| PUT | /*/:id | cadastros_editar |
| DELETE | /*/:id | cadastros_excluir |

---

## 4. Backend — retornar permissões no login

Em `routes/auth.js`, no endpoint de login, incluir as colunas ACL no objeto retornado:

```javascript
// Já retorna o perfil — apenas garantir que as colunas _criar/_editar/_excluir
// estejam no SELECT que busca o usuário/perfil
const [rows] = await pool.query(
  `SELECT u.*, p.*
   FROM usuarios u
   LEFT JOIN perfil p ON p.id = u.perfil
   WHERE u.login = ?`, [login]
);
// O objeto req.user (e sessionStorage.user no frontend) já vai ter as colunas
```

---

## 5. Frontend — helper global

Criar `/public/assets/acl.js` (carregado em todas as páginas):

```javascript
window.ACL = {
  _perms: null,

  load() {
    try {
      this._perms = JSON.parse(sessionStorage.getItem('user') || '{}');
    } catch { this._perms = {}; }
  },

  // ACL.pode('pedidos','criar')  → true | false
  pode(modulo, acao) {
    if (!this._perms) this.load();
    const perfil = this._perms?.perfil;
    if (perfil == 1) return true; // admin
    const col = `${modulo}_${acao}`;
    return (this._perms[col] ?? 'S') === 'S';
  },

  // Oculta elementos com data-acl="pedidos:criar"
  aplicar() {
    this.load();
    document.querySelectorAll('[data-acl]').forEach(el => {
      const [mod, ac] = el.dataset.acl.split(':');
      if (!this.pode(mod, ac)) el.style.display = 'none';
    });
  }
};

document.addEventListener('DOMContentLoaded', () => ACL.aplicar());
```

### Uso nos HTMLs (botões):
```html
<!-- Botão Novo Pedido — some se não tem criar -->
<button data-acl="pedidos:criar" onclick="novoPedido()">Novo Pedido</button>

<!-- Botão Excluir na linha — some se não tem excluir -->
<button data-acl="pedidos:excluir" onclick="excluir(id)">Excluir</button>
```

### Verificação programática:
```javascript
if (ACL.pode('pedidos', 'aprovar')) {
  // mostra botão aprovar
}
```

---

## 6. Frontend — tela `perfis.html`

Adicionar seção de permissões granulares no formulário do perfil:

```html
<div class="form-section">
  <h3>Permissões por Ação</h3>
  <table class="acl-table">
    <thead>
      <tr>
        <th>Módulo</th>
        <th>Criar</th>
        <th>Editar</th>
        <th>Excluir</th>
        <th>Aprovar</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Pedidos</td>
        <td><input type="checkbox" name="pedidos_criar"  value="S"></td>
        <td><input type="checkbox" name="pedidos_editar" value="S"></td>
        <td><input type="checkbox" name="pedidos_excluir" value="S"></td>
        <td><input type="checkbox" name="pedidos_aprovar" value="S"></td>
      </tr>
      <!-- ... demais módulos ... -->
    </tbody>
  </table>
</div>
```

A função `salvar()` já existente envia o form — só precisa incluir os novos campos.

---

## 7. Ordem de execução na próxima sessão

1. `routes/setup.js` — adicionar `addColIfMissing` para todas as novas colunas
2. `middleware/auth.js` — adicionar função `checkAcl` e exportar
3. `routes/pedidos.js` — adicionar guardas (mais crítico)
4. `routes/clientes.js` + `routes/produtos.js` + `routes/fornecedores.js`
5. `routes/visitas.js` + `routes/leads.js`
6. `routes/pagar.js` + `routes/receber.js` + `routes/cadastros.js`
7. Criar `/public/assets/acl.js`
8. `public/pages/perfis.html` — adicionar tabela de permissões granulares
9. Testar: criar perfil restrito, verificar que botões somem e rotas retornam 403

---

## Notas importantes

- **Manter compatibilidade**: `DEFAULT 'S'` garante que nenhum usuário perde acesso na migração
- **Admin (perfil=1) sempre passa**: verificar `req.user.perfil == 1` antes de checar colunas
- **`acesso_X` existente**: manter as colunas de acesso à tela — ACL granular é complementar, não substituto
- **sessionStorage.user**: já é populado no login e contém as colunas do perfil — as novas colunas aparecem automaticamente sem mudar o auth flow
