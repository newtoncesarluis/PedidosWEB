from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    PageBreak,
    KeepTogether,
)
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "guia_vitrine_digital.pdf"


def register_fonts():
    candidates = [
        (Path("C:/Windows/Fonts/segoeui.ttf"), "SegoeUI"),
        (Path("C:/Windows/Fonts/segoeuib.ttf"), "SegoeUI-Bold"),
    ]
    for path, name in candidates:
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))
    return "SegoeUI" if "SegoeUI" in pdfmetrics.getRegisteredFontNames() else "Helvetica"


BASE_FONT = register_fonts()
BOLD_FONT = "SegoeUI-Bold" if "SegoeUI-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle",
    fontName=BOLD_FONT,
    fontSize=25,
    leading=30,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#0f766e"),
    spaceAfter=12,
))
styles.add(ParagraphStyle(
    name="CoverSub",
    fontName=BASE_FONT,
    fontSize=11,
    leading=16,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#475569"),
))
styles.add(ParagraphStyle(
    name="H1Guide",
    fontName=BOLD_FONT,
    fontSize=15,
    leading=19,
    textColor=colors.HexColor("#0f766e"),
    spaceBefore=13,
    spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="BodyGuide",
    fontName=BASE_FONT,
    fontSize=9.5,
    leading=14,
    textColor=colors.HexColor("#1f2937"),
    spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="BulletGuide",
    fontName=BASE_FONT,
    fontSize=9.5,
    leading=13,
    leftIndent=14,
    firstLineIndent=-8,
    textColor=colors.HexColor("#1f2937"),
    spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="CodeGuide",
    fontName="Courier",
    fontSize=8.4,
    leading=11.5,
    textColor=colors.HexColor("#0f172a"),
    backColor=colors.HexColor("#f1f5f9"),
    borderColor=colors.HexColor("#dbe3ee"),
    borderWidth=0.5,
    borderPadding=5,
    leftIndent=4,
    rightIndent=4,
    spaceBefore=3,
    spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="Small",
    fontName=BASE_FONT,
    fontSize=8,
    leading=10,
    textColor=colors.HexColor("#64748b"),
))


def esc(text):
    return (
        str(text)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def inline_markup(text):
    text = esc(text)
    text = re.sub(r"`([^`]+)`", r"<font name='Courier'>\1</font>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", rf"<font name='{BOLD_FONT}'>\1</font>", text)
    return text


def para(text, style="BodyGuide"):
    return Paragraph(inline_markup(text), styles[style])


def code_block(lines):
    text = "<br/>".join(esc(line) for line in lines)
    return Paragraph(text, styles["CodeGuide"])


def note_box(title, body):
    data = [[Paragraph(f"<font name='{BOLD_FONT}'>{esc(title)}</font><br/>{inline_markup(body)}", styles["BodyGuide"])]]
    t = Table(data, colWidths=[16.7 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#ecfdf5")),
        ("BOX", (0, 0), (-1, -1), 0.8, colors.HexColor("#99f6e4")),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def build_story():
    story = []
    story.append(Spacer(1, 2.4 * cm))
    story.append(Paragraph("Guia de Uso e Instalação", styles["CoverTitle"]))
    story.append(Paragraph("Vitrine Digital Demo", styles["CoverTitle"]))
    story.append(Paragraph("Como configurar, executar e demonstrar o pacote estudo_vitrine", styles["CoverSub"]))
    story.append(Spacer(1, 1.2 * cm))
    story.append(note_box(
        "Objetivo do pacote",
        "Demonstrar a vitrine sem o SysRepWeb completo: clientes, produtos, tabela de preço, link público, carrinho e pedidos."
    ))
    story.append(Spacer(1, 0.6 * cm))
    info = [
        ["Pasta", r"C:\xampp\htdocs\estudo_vitrine"],
        ["Painel", "http://localhost:3090"],
        ["Vitrine demo", "http://localhost:3090/vitrine/demo-loja-centro"],
        ["Banco", "estudo_vitrine"],
    ]
    tbl = Table([[Paragraph(f"<font name='{BOLD_FONT}'>{esc(a)}</font>", styles["BodyGuide"]), para(b)] for a, b in info],
                colWidths=[4 * cm, 12.7 * cm])
    tbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dbe3ee")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tbl)
    story.append(PageBreak())

    def h(text):
        story.append(Paragraph(esc(text), styles["H1Guide"]))

    def bullets(items):
        for item in items:
            story.append(Paragraph("• " + inline_markup(item), styles["BulletGuide"]))

    h("1. Requisitos")
    bullets([
        "Node.js 18 ou superior.",
        "MySQL ou MariaDB ativo.",
        "phpMyAdmin ou outro cliente para importar SQL.",
        "Terminal PowerShell ou Prompt de Comando."
    ])

    h("2. Arquivos principais")
    files = [
        ["server.js", "Inicia o servidor da demonstração."],
        [r"public\vitrine.html", "Página pública acessada pelo cliente."],
        [r"public\admin.html", "Painel para gerar links e ver pedidos."],
        [r"routes\vitrine.js", "API de token, catálogo, carrinho e pedidos."],
        [r"sql\01_schema.sql", "Criação do banco e das tabelas."],
        [r"sql\02_seed_demo.sql", "Dados básicos para demonstração."],
    ]
    tbl = Table([[para(a), para(b)] for a, b in files], colWidths=[5.5 * cm, 11.2 * cm])
    tbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dbe3ee")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(tbl)

    h("3. Configurar o banco")
    story.append(para("No phpMyAdmin, importe os SQLs nesta ordem:"))
    story.append(code_block([
        r"C:\xampp\htdocs\estudo_vitrine\sql\01_schema.sql",
        r"C:\xampp\htdocs\estudo_vitrine\sql\02_seed_demo.sql",
    ]))
    story.append(para("O primeiro arquivo cria o banco `estudo_vitrine`. O segundo insere empresa, representante, clientes, fornecedores, produtos, tabela de preço, vínculos e um token demo."))

    h("4. Conferir o .env")
    story.append(para(r"Abra `C:\xampp\htdocs\estudo_vitrine\.env` e ajuste usuário, senha ou porta se necessário."))
    story.append(code_block([
        "PORT=3090",
        "DB_HOST=localhost",
        "DB_PORT=3306",
        "DB_USER=root",
        "DB_PASSWORD=",
        "DB_NAME=estudo_vitrine",
    ]))

    h("5. Instalar dependências e iniciar")
    story.append(code_block([
        r"cd C:\xampp\htdocs\estudo_vitrine",
        "npm install",
        "npm start",
    ]))
    story.append(para("Quando estiver funcionando, o terminal mostra:"))
    story.append(code_block(["Estudo Vitrine rodando em http://localhost:3090"]))

    h("6. Usar a demonstração")
    bullets([
        "Abra `http://localhost:3090` para acessar o painel.",
        "Mostre clientes, produtos, tabelas e pedidos.",
        "Escolha um cliente e clique em `Gerar link`.",
        "Abra o link gerado para visualizar a vitrine.",
        "Adicione produtos ao carrinho e envie o pedido.",
        "Volte ao painel e clique em `Atualizar pedidos`."
    ])

    h("7. Link pronto para teste")
    story.append(para("Após importar o seed, este link já fica disponível:"))
    story.append(code_block(["http://localhost:3090/vitrine/demo-loja-centro"]))

    h("8. Como os produtos aparecem")
    story.append(para("A vitrine exibe somente produtos que atendem a todas estas condições:"))
    bullets([
        "produto ativo em `produto`, com `situacao = 'A'` e `excluido = 'N'`;",
        "produto com preço em `tabela_preco_itens`;",
        "tabela ativa em `tabela_preco_cabecalho`;",
        "cliente vinculado à tabela em `tabela_preco_vinculo`."
    ])

    h("9. Onde o pedido é salvo")
    story.append(para("Ao enviar o carrinho, a API grava:"))
    bullets([
        "`pedidos`: cabeçalho do pedido.",
        "`itensped`: itens do pedido.",
        "origem `VITRINE`, situação `PENDENTE` e tipo `ORCAMENTO VITRINE`."
    ])

    story.append(PageBreak())
    h("10. Problemas comuns")
    problems = [
        ["Sem produtos na vitrine", "Verifique vínculo em tabela_preco_vinculo, tabela ativa, itens com preço e produtos ativos."],
        ["Erro de banco", "Confira DB_HOST, DB_PORT, DB_USER, DB_PASSWORD e DB_NAME no .env. Confirme se o MySQL está ligado."],
        ["Porta em uso", "Troque PORT=3090 para outra porta, como PORT=3091, e reinicie o servidor."],
        ["npm install falha", "Confirme Node.js e npm com node -v e npm -v."],
    ]
    tbl = Table([[para(a), para(b)] for a, b in problems], colWidths=[5.3 * cm, 11.4 * cm])
    tbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dbe3ee")),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#fff7ed")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tbl)

    h("11. Roteiro de apresentação ao cliente")
    bullets([
        "Abrir o painel e mostrar os cadastros básicos.",
        "Gerar um link de vitrine para o cliente.",
        "Abrir a vitrine como se fosse o cliente final.",
        "Montar um carrinho e enviar o pedido.",
        "Mostrar o pedido entrando no painel como pendente.",
        "Explicar que, em produção, o representante confirma e dá sequência ao atendimento."
    ])

    h("12. Resumo técnico do fluxo")
    steps = [
        "Painel chama `POST /api/vitrine/gerar`.",
        "API grava token em `vitrine_tokens`.",
        "Cliente acessa `/vitrine/:token`.",
        "Vitrine busca catálogo em `GET /api/vitrine/:token`.",
        "Carrinho é enviado para `POST /api/vitrine/:token/pedido`.",
        "API grava `pedidos` e `itensped`.",
        "Painel lista pedidos em `GET /api/demo/pedidos`."
    ]
    for idx, item in enumerate(steps, 1):
        story.append(Paragraph(f"{idx}. {inline_markup(item)}", styles["BodyGuide"]))

    return story


def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont(BASE_FONT, 8)
    canvas.setFillColor(colors.HexColor("#64748b"))
    canvas.drawString(1.7 * cm, 1.1 * cm, "Vitrine Digital Demo - Guia de uso e instalação")
    canvas.drawRightString(19.3 * cm, 1.1 * cm, f"Página {doc.page}")
    canvas.restoreState()


def main():
    doc = SimpleDocTemplate(
        str(OUT),
        pagesize=A4,
        rightMargin=1.7 * cm,
        leftMargin=1.7 * cm,
        topMargin=1.55 * cm,
        bottomMargin=1.55 * cm,
        title="Guia de uso e instalação - Vitrine Digital Demo",
        author="PedidosWeb"
    )
    doc.build(build_story(), onFirstPage=footer, onLaterPages=footer)
    print(OUT)


if __name__ == "__main__":
    main()
