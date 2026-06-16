# Deploy & Versionamento — SysRepWeb

## Versão do app (`version.json`)

Formato: **MAJOR.MINOR.RELEASE.SEQUENCIAL** (ex.: `1.1.2.0`)

| Segmento | Significado | Quando subir |
|---|---|---|
| MAJOR | versão | mudança grande / quebra |
| MINOR | melhorias menores | novas features |
| RELEASE | release | conjunto de ajustes |
| SEQUENCIAL | sequencial | a cada deploy/correção |

Fonte única: **`version.json`** na raiz. Exposto em **`GET /api/version`** → `{ v: <BUILD_ID>, versao: "1.1.2.0" }` (rota **pública**, antes do `authMiddleware`).

### Subir a versão (script)
`scripts/bump-version.js` (preserva o `_comment`):

```
node scripts/bump-version.js            # +1 SEQUENCIAL
node scripts/bump-version.js release    # +1 RELEASE, zera seq
node scripts/bump-version.js minor      # +1 MINOR, zera release+seq
node scripts/bump-version.js major      # +1 MAJOR, zera o resto
node scripts/bump-version.js 1.2.0.0    # define exata
node scripts/bump-version.js show       # só imprime (não altera)
```

## Deploy (Hostinger / Oracle)

`.bat`: `C:\Documentos\Projetos WEB\Estudos\Hostinger\Servidor_Projetos.bat`
Menu **[A] SysRepWeb** → **[1] Hostinger**, **[2] Oracle**, **[3] AMBOS**.

Todos chamam `:FN_GERAR_PACOTE`, que **antes de empacotar** pergunta a versão:

```
VERSAO DO APP (version.json)
 Versao atual: 1.1.2.0
 [Enter] = +1 sequencial | release | minor | major | X.Y.Z.W (exata)
 Acao/versao: _
```

Fluxo do deploy:
1. Bump do `version.json` (Enter = +1 sequencial).
2. `tar.gz` (exclui `.git`, `node_modules`, `.env`, `*.bat`, etc. — `version.json` **vai** junto).
3. SCP → servidor → extrai em `/root/pedidosweb` (Hostinger) ou `/home/ubuntu/pedidosweb` (Oracle).
4. `npm install --omit=dev` + `pm2 reload pedidosweb` + restart dos `sysrep-*`.

> Fallback: se o `node` não estiver no PATH, o `.bat` pula o bump e o deploy segue normal.

## Atualização forçada do PWA (banner)

- A cada **restart do servidor (= deploy)** o `server.js` gera novo **`BUILD_ID`** (timestamp) → muda o nome do cache do Service Worker → `activate` purga o cache antigo.
- O `mobile-shell.html` guarda o `BUILD_ID` da sessão e reconsulta `/api/version` (ao retomar o app, no foco e a cada 90s). Se mudou, exibe o banner **"Nova versão disponível → Atualizar"**.
- Botão **Atualizar**: limpa os caches `pedidosweb-*` e recarrega → versão nova garantida.
- Versão exibida no menu **"Mais"** do app (`v1.1.2.0`) e no rodapé do **login**.

## Checklist de release
1. `git pull` / código pronto.
2. Rodar deploy no `.bat` → escolher a versão (Enter p/ sequencial).
3. Conferir no app: banner "Atualizar" aparece; versão nova no menu "Mais".
4. Commitar o `version.json` atualizado no git.

> ⚠️ Se empacotar com **pkg** (`dist/SysRepWeb.exe`), incluir `version.json` nos assets do pkg.
