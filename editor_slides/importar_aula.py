#!/usr/bin/env python3
"""Importa aulas feitas à mão para o editor, sem tocar nos arquivos originais.

Para cada aula cria um ``apresentacao.json`` AO LADO do HTML. O JSON guarda:
  * ``legado.antes``  — tudo antes do primeiro slide (head, barra, <div class="sc">);
  * ``slides[]``      — cada slide como HTML livre, exatamente como está no arquivo,
                        com o trecho que o precede (comentários/espaços) em ``prefixo``;
  * ``legado.depois`` — tudo depois do último slide (controles, script…).

Remontar antes + prefixo/slides + depois reproduz o arquivo byte a byte; a
importação confere isso e recusa o resultado se não bater. A aula fica no
estado "importada": ``make gerar`` não a reescreve até você assumi-la no editor.

Uso:
    python3 editor_slides/importar_aula.py --todas
    python3 editor_slides/importar_aula.py caminho/aula03.html
    python3 editor_slides/importar_aula.py --todas --forcar   # refaz JSONs já existentes
"""
from __future__ import annotations

import argparse
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "scripts"))
from motor import render  # noqa: E402

TAG = re.compile(r"<!--.*?-->|<script\b.*?</script>|<style\b.*?</style>|<(/?)div\b[^>]*>", re.S | re.I)
COMPONENTES = ["capa", "slhd", "divisor", "card", "tb2", "fig", "kpi", "chips", "cd", "ca", "bege", "passos", "rev",
               "abas", "painel", "fluxo", "nt", "ref", "ftx", "scr", "duelo", "evo", "lin", "faixa-az", "pergunta"]


def fim_div(texto: str, inicio: int) -> int:
    """Posição logo após o </div> que fecha o <div> que começa em ``inicio``."""
    prof = 0
    for m in TAG.finditer(texto, inicio):
        if m.group(0).startswith("<!--") or m.group(0)[:7].lower() in ("<script", "<style"):
            continue
        prof += -1 if m.group(1) else 1
        if prof == 0:
            return m.end()
    raise ValueError("div sem fechamento a partir da posição %d" % inicio)


def dividir(texto: str) -> dict:
    m = re.search(r'<div\b[^>]*\bclass="sc"[^>]*>', texto)
    if not m:
        raise ValueError('não encontrei <div class="sc">')
    fim_sc = fim_div(texto, m.start())
    fecha_sc = texto.rfind("</div>", 0, fim_sc)
    pos = m.end()
    slides = []
    ultimo = pos
    while True:
        prox = None
        for t in TAG.finditer(texto, pos, fecha_sc):
            g = t.group(0)
            if g.startswith("<!--") or g[:7].lower() in ("<script", "<style"):
                continue
            if t.group(1):
                continue
            prox = t
            break
        if not prox:
            break
        fim = fim_div(texto, prox.start())
        abre = prox.group(0)
        classe = re.search(r'class="([^"]*)"', abre)
        if classe and re.match(r"sl(\s|$)", classe.group(1)):
            mid = re.search(r'\bid="([^"]*)"', abre)
            slides.append({"layout": "html", "id": mid.group(1) if mid else None,
                           "prefixo": texto[ultimo:prox.start()], "html": texto[prox.start():fim]})
            ultimo = fim
        pos = fim
    return {"antes": texto[:m.end()], "slides": slides, "depois": texto[ultimo:]}


def componentes(html: str) -> list:
    classes = set()
    for c in re.findall(r'class="([^"]*)"', html):
        classes.update(c.split())
    return [c for c in COMPONENTES if c in classes]


def importar(caminho_html: str, forcar: bool = False) -> tuple:
    pasta = os.path.dirname(os.path.abspath(caminho_html))
    destino = os.path.join(pasta, "apresentacao.json")
    if os.path.exists(destino) and not forcar:
        return destino, None, "já existe (use --forcar para refazer)"
    texto = open(caminho_html, encoding="utf-8", newline="").read()
    partes = dividir(texto)
    tit = re.search(r"<title>(.*?)</title>", texto, re.S)
    css = re.search(r'<link[^>]+href="([^"]+\.css)"', partes["antes"])
    js = re.search(r'<script[^>]+src="([^"]+\.js)"', partes["depois"])
    dados = {
        "versao": render.VERSAO_FORMATO,
        "motor": "legado",
        "estado": "importada",
        "meta": {"titulo": render._txt(tit.group(1)) if tit else os.path.basename(caminho_html),
                 "arquivo": os.path.basename(caminho_html)},
        "tema": {"base": None, "vars": {}},
        "legado": {"antes": partes["antes"], "depois": partes["depois"],
                   "css": css.group(1) if css else None, "js": js.group(1) if js else None},
        "slides": partes["slides"],
    }
    if render.render_legado(dados) != texto:
        return destino, None, "ERRO: a remontagem não reproduz o original — nada foi gravado"
    render.gravar_json(destino, dados)
    return destino, dados, "ok"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("arquivos", nargs="*")
    ap.add_argument("--todas", action="store_true")
    ap.add_argument("--forcar", action="store_true")
    ap.add_argument("--relatorio", default=os.path.join(AQUI, "relatorio_importacao.md"))
    a = ap.parse_args()
    alvos = [os.path.abspath(x) for x in a.arquivos]
    if a.todas or not alvos:
        from gerar_index import procurar_aulas
        alvos = [os.path.join(render.RAIZ, x["rel"]) for x in procurar_aulas(render.RAIZ)]
    linhas = ["# Relatório de importação", "",
              "Cada slide foi importado como **HTML livre** (markup original preservado).",
              "A coluna *componentes* lista os elementos visuais reconhecidos no slide; o editor permite",
              "editar o texto direto no palco ou pedir ao LLM a conversão para blocos estruturados.", ""]
    erros = 0
    for h in alvos:
        destino, dados, msg = importar(h, a.forcar)
        r = os.path.relpath(h, render.RAIZ)
        print("%-90s %s" % (r, msg))
        if dados is None:
            erros += msg.startswith("ERRO")
            continue
        ok, verif = render.verificar_legado(destino)
        linhas += ["## " + r, "", "- slides: **%d** · remontagem: **%s**" % (len(dados["slides"]), verif), "",
                   "| # | título | componentes |", "|---|---|---|"]
        for i, s in enumerate(dados["slides"]):
            linhas.append("| %d | %s | %s |" % (i + 1, render.titulo_slide(s).replace("|", "/"), ", ".join(componentes(s["html"])) or "—"))
        linhas.append("")
    if len(linhas) > 6:
        render.gravar_texto(a.relatorio, "\n".join(linhas) + "\n")
        print("Relatório: " + os.path.relpath(a.relatorio, render.RAIZ))
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
