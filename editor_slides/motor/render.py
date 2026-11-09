"""Motor de renderização: apresentacao.json → HTML/CSS/JS da aula.

Fonte única da verdade da renderização. O editor (navegador) pede a prévia
ao servidor, que usa estas mesmas funções; o ``gerar_slides.py`` também.

Dois motores:
  * ``editor``  — aula criada no editor: tema + base.css + runtime.js.
  * ``legado``  — aula importada: o HTML original é remontado a partir dos
                  trechos guardados (antes + slides + depois). Slides não
                  editados voltam byte a byte iguais ao original.
"""
from __future__ import annotations

import html as _html
import json
import os
import re
import shutil

AQUI = os.path.dirname(os.path.abspath(__file__))
EDITOR = os.path.dirname(AQUI)
RAIZ = os.path.dirname(EDITOR)
MODELO = os.path.join(EDITOR, "modelo")
TEMAS = os.path.join(EDITOR, "temas")
FONTE = "inter-latin-var.woff2"

VERSAO_FORMATO = 1


# ------------------------------------------------------------------ util
def esc(t) -> str:
    return _html.escape("" if t is None else str(t), quote=True)


def _txt(h: str) -> str:
    """HTML → texto simples (para títulos de lista e <title>)."""
    t = re.sub(r"<[^>]+>", " ", h or "")
    return re.sub(r"\s+", " ", _html.unescape(t)).strip()


def ler_json(caminho: str) -> dict:
    with open(caminho, encoding="utf-8") as f:
        return json.load(f)


def gravar_texto(caminho: str, conteudo: str) -> None:
    os.makedirs(os.path.dirname(caminho) or ".", exist_ok=True)
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(conteudo)
    os.replace(tmp, caminho)


def gravar_json(caminho: str, dados: dict) -> None:
    gravar_texto(caminho, json.dumps(dados, ensure_ascii=False, indent=2) + "\n")


def catalogo() -> dict:
    return ler_json(os.path.join(EDITOR, "componentes.json"))


# ------------------------------------------------------------------ temas
def listar_temas() -> list:
    temas = []
    for nome in sorted(os.listdir(TEMAS)):
        p = os.path.join(TEMAS, nome, "tema.json")
        if os.path.isfile(p):
            t = ler_json(p)
            t["nome"] = nome
            temas.append(t)
    return temas


def carregar_tema(nome: str | None) -> dict:
    p = os.path.join(TEMAS, nome or "", "tema.json")
    if not nome or not os.path.isfile(p):
        p = os.path.join(TEMAS, "ppgcc", "tema.json")
        nome = "ppgcc"
    t = ler_json(p)
    t["nome"] = nome
    return t


def vars_efetivas(dados: dict) -> dict:
    tema = carregar_tema((dados.get("tema") or {}).get("base"))
    v = dict(tema.get("vars", {}))
    v.update((dados.get("tema") or {}).get("vars") or {})
    return v


def logos_efetivas(dados: dict) -> dict:
    """Logos da apresentação; vazias = usa a do tema (que por padrão também é vazia)."""
    tema = carregar_tema((dados.get("tema") or {}).get("base"))
    proprias = (dados.get("tema") or {}).get("logos") or {}
    res = {}
    for k in ("barra", "capa", "rodape", "marca"):
        if k in proprias:  # None explícito = sem logo
            res[k] = proprias[k] or None
        elif (tema.get("logos") or {}).get(k):
            res[k] = "img/tema/" + os.path.basename(tema["logos"][k])
        else:
            res[k] = None
    return res


def css_vars(v: dict) -> str:
    linhas = ["    %s: %s;" % (k, val) for k, val in v.items() if k.startswith("--")]
    return ":root {\n" + "\n".join(linhas) + "\n}\n"


def css_aula(dados: dict) -> str:
    tema = carregar_tema((dados.get("tema") or {}).get("base"))
    base = open(os.path.join(MODELO, "base.css"), encoding="utf-8").read()
    partes = [
        "/* Gerado pelo editor de slides — não edite à mão (edite o apresentacao.json). */\n",
        "/* Tema: %s */\n" % tema.get("rotulo", tema["nome"]),
        css_vars(vars_efetivas(dados)),
        base,
    ]
    extra = (dados.get("css_extra") or "").strip()
    if extra:
        partes.append("\n/* ===== CSS específico desta apresentação ===== */\n" + extra + "\n")
    return "\n".join(partes)


# ------------------------------------------------------------------ blocos
class Ctx:
    """Contexto de renderização: modo editor liga os atributos data-e/data-b."""

    def __init__(self, ed: bool = False):
        self.ed = ed

    def e(self, caminho: str) -> str:
        return ' data-e="%s"' % caminho if self.ed else ""

    def b(self, caminho: str) -> str:
        return ' data-b="%s"' % caminho if self.ed else ""

    def img(self, caminho: str) -> str:
        return ' data-img="%s"' % caminho if self.ed else ""


def _youtube(url: str) -> str:
    m = re.search(r"(?:youtu\.be/|v=|embed/|shorts/)([\w-]{6,})", url or "")
    return "https://www.youtube.com/embed/%s" % m.group(1) if m else (url or "")


def render_bloco(b: dict, p: str, c: Ctx) -> str:
    t = b.get("tipo", "texto")
    g = b.get
    if t == "texto":
        return '<div class="txt-bloco"%s%s>%s</div>' % (c.b(p), c.e(p + "/html"), g("html", ""))
    if t == "titulo":
        return '<h3 class="tit-bloco"%s%s>%s</h3>' % (c.b(p), c.e(p + "/texto"), g("texto", ""))
    if t == "lista":
        tag = "ol" if g("numerada") else "ul"
        cls = ' class="passos"' if g("numerada") else ""
        itens = "".join('<li%s>%s</li>' % (c.e("%s/itens/%d" % (p, i)), it) for i, it in enumerate(g("itens") or []))
        return "<%s%s%s>%s</%s>" % (tag, cls, c.b(p), itens, tag)
    if t == "card":
        cls = " ".join(x for x in ["card", g("variante") or "", "grow" if g("crescer") else ""] if x)
        h = ['<div class="%s"%s>' % (cls, c.b(p))]
        if g("titulo"):
            h.append('<h3%s>%s</h3>' % (c.e(p + "/titulo"), g("titulo")))
        if g("destaque"):
            h.append('<div class="big"%s>%s</div>' % (c.e(p + "/destaque"), g("destaque")))
        if g("html"):
            h.append('<div class="txt-bloco"%s>%s</div>' % (c.e(p + "/html"), g("html")))
        if g("blocos"):
            h.append(render_lista(g("blocos"), p + "/blocos", c))
        if g("itens"):
            h.append("<ul>%s</ul>" % "".join('<li%s>%s</li>' % (c.e("%s/itens/%d" % (p, i)), it) for i, it in enumerate(g("itens"))))
        if g("stat_valor"):
            h.append('<div class="stat"><b%s>%s</b><span%s>%s</span></div>' % (
                c.e(p + "/stat_valor"), g("stat_valor"), c.e(p + "/stat_texto"), g("stat_texto", "")))
        if g("rodape"):
            h.append('<div class="rod"%s>%s</div>' % (c.e(p + "/rodape"), g("rodape")))
        h.append("</div>")
        return "".join(h)
    if t == "destaque":
        est = g("estilo") or "cd"
        h = '<div class="%s"%s>' % (esc(est), c.b(p))
        if g("titulo"):
            h += '<h3%s>%s</h3>' % (c.e(p + "/titulo"), g("titulo"))
        return h + '<div class="txt-bloco"%s>%s</div></div>' % (c.e(p + "/html"), g("html", ""))
    if t == "chips":
        return '<div class="chips"%s>%s</div>' % (c.b(p), "".join(
            '<span%s>%s</span>' % (c.e("%s/itens/%d" % (p, i)), it) for i, it in enumerate(g("itens") or [])))
    if t == "pergunta":
        sm = '<small%s>%s</small>' % (c.e(p + "/rotulo"), g("rotulo")) if g("rotulo") else ""
        return '<div class="pergunta"%s>%s<span%s>%s</span></div>' % (c.b(p), sm, c.e(p + "/html"), g("html", ""))
    if t == "tabela":
        cls = "tb2 fill" if g("preencher") else "tb2"
        h = ['<table class="%s"%s>' % (cls, c.b(p))]
        cab = g("cabecalho") or []
        if cab:
            h.append("<tr>%s</tr>" % "".join('<th%s>%s</th>' % (c.e("%s/cabecalho/%d" % (p, i)), x) for i, x in enumerate(cab)))
        lc = g("linhas_classe") or []
        cc = g("celulas_classe") or {}
        for r, linha in enumerate(g("linhas") or []):
            k = lc[r] if r < len(lc) and lc[r] else ""
            h.append("<tr%s>%s</tr>" % (' class="%s"' % esc(k) if k else "", "".join(
                '<td%s%s>%s</td>' % (' class="%s"' % esc(cc["%d,%d" % (r, j)]) if cc.get("%d,%d" % (r, j)) else "",
                                     c.e("%s/linhas/%d/%d" % (p, r, j)), x) for j, x in enumerate(linha))))
        h.append("</table>")
        return "".join(h)
    if t == "kpis":
        itens = g("itens") or []
        n = max(1, len(itens))
        est = ("grid-template-rows:repeat(%d,1fr);" if g("direcao") == "vertical" else "grid-template-columns:repeat(%d,1fr);") % n
        return '<div class="kpi" style="%s"%s>%s</div>' % (est, c.b(p), "".join(
            '<div><b%s>%s</b><span%s>%s</span></div>' % (
                c.e("%s/itens/%d/valor" % (p, i)), it.get("valor", ""), c.e("%s/itens/%d/texto" % (p, i)), it.get("texto", ""))
            for i, it in enumerate(itens)))
    if t == "faixa":
        cls = "faixa-az fim" if g("fim") else "faixa-az"
        return '<div class="%s"%s><span%s>%s</span></div>' % (cls, c.b(p), c.e(p + "/html"), g("html", ""))
    if t == "figura":
        h = '<div class="fig"%s><img src="%s" alt="%s"%s></div>' % (c.b(p), esc(g("src", "")), esc(g("alt", "")), c.img(p + "/src"))
        if g("legenda"):
            h += '<div class="cap"%s>%s</div>' % (c.e(p + "/legenda"), g("legenda"))
        return h
    if t == "duelo":
        tt = '<div class="tt"%s>%s</div>' % (c.e(p + "/titulo"), g("titulo")) if g("titulo") else ""
        return ('<div class="duelo"%s>%s<div><small%s>%s</small><b%s>%s</b></div>'
                '<div class="rf"><small%s>%s</small><b%s>%s</b></div></div>') % (
            c.b(p), tt, c.e(p + "/antes_rotulo"), g("antes_rotulo", ""), c.e(p + "/antes_valor"), g("antes_valor", ""),
            c.e(p + "/depois_rotulo"), g("depois_rotulo", ""), c.e(p + "/depois_valor"), g("depois_valor", ""))
    if t == "lins":
        return '<div class="lins"%s>%s</div>' % (c.b(p), "".join(
            '<div class="lin"><div><b%s>%s</b><span%s>%s</span></div></div>' % (
                c.e("%s/itens/%d/titulo" % (p, i)), it.get("titulo", ""), c.e("%s/itens/%d/html" % (p, i)), it.get("html", ""))
            for i, it in enumerate(g("itens") or [])))
    if t == "evo":
        h = '<div class="evo%s"%s><div class="t"%s>%s</div>' % (" rf" if g("verde") else "", c.b(p), c.e(p + "/titulo"), g("titulo", ""))
        for i, ln in enumerate(g("linhas") or []):
            h += '<div class="r"><span%s>%s</span><b class="%s"%s>%s</b></div>' % (
                c.e("%s/linhas/%d/rotulo" % (p, i)), ln.get("rotulo", ""), esc(ln.get("tendencia", "eq")),
                c.e("%s/linhas/%d/valor" % (p, i)), ln.get("valor", ""))
        if g("obs"):
            h += '<div class="v"%s>%s</div>' % (c.e(p + "/obs"), g("obs"))
        return h + "</div>"
    if t == "revelar":
        return '<div class="rev" onclick="rv(this)"%s><span%s>%s</span><div class="resp"%s>%s</div></div>' % (
            c.b(p), c.e(p + "/pergunta"), g("pergunta", ""), c.e(p + "/resposta"), g("resposta", ""))
    if t == "codigo":
        return '<pre class="pc"%s>%s</pre>' % (c.b(p), esc(g("codigo", "")))
    if t == "video":
        return '<iframe class="video" src="%s" title="Vídeo" allowfullscreen loading="lazy"%s></iframe>' % (esc(_youtube(g("url", ""))), c.b(p))
    if t == "grade":
        cols = g("colunas") or [[]]
        prop = g("proporcao") or " ".join(["1fr"] * len(cols))
        return '<div class="grade" style="grid-template-columns:%s"%s>%s</div>' % (esc(prop), c.b(p), "".join(
            '<div class="col">%s</div>' % render_lista(col, "%s/colunas/%d" % (p, i), c) for i, col in enumerate(cols)))
    if t == "html":
        return '<div style="display:contents"%s>%s</div>' % (c.b(p), g("html", ""))
    return "<!-- bloco desconhecido: %s -->" % esc(t)


def render_lista(blocos: list, p: str, c: Ctx) -> str:
    return "".join(render_bloco(b, "%s/%d" % (p, i), c) for i, b in enumerate(blocos or []))


def _faixa(blocos: list, prop: str | None, p: str, c: Ctx) -> str:
    if not blocos:
        return ""
    if len(blocos) == 1:
        return render_bloco(blocos[0], p + "/0", c)
    prop = prop or "repeat(%d,1fr)" % len(blocos)
    return '<div class="grade" style="grid-template-columns:%s;align-items:center">%s</div>' % (esc(prop), render_lista(blocos, p, c))


# ------------------------------------------------------------------ slides
def _notas(sl: dict, i: int, c: Ctx) -> str:
    n = sl.get("notas")
    return '\n      <div class="nt"%s>%s</div>' % (c.e("slides/%d/notas" % i), n) if n else ""


def render_slide(sl: dict, i: int, dados: dict, c: Ctx, sid: str | None = None) -> str:
    lay = sl.get("layout", "conteudo")
    sid = sid or "s%d" % (i + 1)
    p = "slides/%d" % i
    ds = ' data-slide="%d"' % i if c.ed else ""
    logos = logos_efetivas(dados)
    if lay == "html":
        h = sl.get("html", "")
        if dados.get("motor") != "legado":  # o runtime do editor navega por id="sN"
            if re.match(r'\s*<div\b[^>]*\bid="', h):
                h = re.sub(r'^(\s*<div\b[^>]*?\bid=")[^"]*"', r'\g<1>%s"' % sid, h, count=1)
            else:
                h = re.sub(r"^(\s*<div\b)", r'\1 id="%s"' % sid, h, count=1)
        if c.ed:
            h = re.sub(r"^(\s*<div\b)", r'\1 data-slide="%d"' % i, h, count=1)
        return h
    if lay == "capa":
        img = sl.get("imagem") or logos.get("capa")
        if img:
            marca = '<img class="marca" src="%s" alt="">' % esc(logos["marca"]) if logos.get("marca") else ""
            dir_ = '<div class="dir"><img src="%s" alt=""%s>%s</div>' % (esc(img), c.img(p + "/imagem"), marca)
        elif sl.get("selo"):
            dir_ = '<div class="dir"><div class="selo"%s>%s</div></div>' % (c.e(p + "/selo"), sl["selo"])
        else:
            dir_ = ""
        subs = "".join('\n          <div class="sub"%s>%s</div>' % (c.e("%s/subtitulos/%d" % (p, k)), s)
                       for k, s in enumerate(sl.get("subtitulos") or []))
        eti = sl.get("etiquetas") or []
        meta = ('\n          <div class="meta">%s</div>' % "".join(
            '<span%s>%s</span>' % (c.e("%s/etiquetas/%d" % (p, k)), e) for k, e in enumerate(eti))) if eti else ""
        rot = '<div class="rot"%s>%s</div>' % (c.e(p + "/rotulo"), sl.get("rotulo", "")) if sl.get("rotulo") else ""
        return ('<div class="sl" id="%s"%s>\n      <div class="capa%s">\n        <div class="esq">\n          %s\n'
                '          <h1%s>%s</h1>\n          <div class="faixa"></div>%s%s\n        </div>\n        %s\n      </div>%s\n    </div>') % (
            sid, ds, "" if dir_ else " sem-dir", rot, c.e(p + "/titulo"), sl.get("titulo", ""), subs, meta, dir_, _notas(sl, i, c))
    if lay == "secao":
        bg = '<img class="bg" src="%s" alt=""%s>' % (esc(sl["imagem"]), c.img(p + "/imagem")) if sl.get("imagem") else ""
        rot = '<div class="rot"%s>%s</div>' % (c.e(p + "/rotulo"), sl.get("rotulo")) if sl.get("rotulo") else ""
        txt = '<div class="txt-bloco"%s>%s</div>' % (c.e(p + "/texto"), sl.get("texto")) if sl.get("texto") else ""
        return ('<div class="sl" id="%s"%s>\n      <div class="secao-slide"><div class="divisor">%s<div class="ov"></div>'
                '<div class="in">%s<h1%s>%s</h1>%s</div></div></div>%s\n    </div>') % (
            sid, ds, bg, rot, c.e(p + "/titulo"), sl.get("titulo", ""), txt, _notas(sl, i, c))
    if lay == "imagem":
        return '<div class="sl slimg" id="%s"%s><img src="%s" alt="%s"%s>%s\n    </div>' % (
            sid, ds, esc(sl.get("imagem", "")), esc(sl.get("alt", "")), c.img(p + "/imagem"), _notas(sl, i, c))
    # conteudo
    numerar = (dados.get("meta") or {}).get("numerar", True) and not sl.get("sem_numero")
    num = '<span class="num">%d</span>' % (i + 1) if numerar else ""
    topo = _faixa(sl.get("topo") or [], sl.get("topo_proporcao"), p + "/topo", c)
    rod = _faixa(sl.get("rodape") or [], sl.get("rodape_proporcao"), p + "/rodape", c)
    cols = sl.get("colunas") or [[]]
    prop = sl.get("proporcao") or " ".join(["1fr"] * len(cols))
    grade = '<div class="grade" style="grid-template-columns:%s">%s</div>' % (esc(prop), "".join(
        '\n          <div class="col">%s</div>' % render_lista(col, "%s/colunas/%d" % (p, k), c) for k, col in enumerate(cols)))
    linhas = (["auto"] if topo else []) + ["1fr"] + (["auto"] if rod else [])
    corpo = "".join("\n        " + x for x in (topo, grade, rod) if x)
    return ('<div class="sl" id="%s"%s>\n      <div class="slhd">%s<h2%s>%s</h2></div>\n'
            '      <div class="slbd g" style="grid-template-rows:%s;">%s\n      </div>%s\n    </div>') % (
        sid, ds, num, c.e(p + "/titulo"), sl.get("titulo", ""), " ".join(linhas), corpo, _notas(sl, i, c))


def titulo_slide(sl: dict) -> str:
    """Rótulo curto do slide para listas (editor e relatórios)."""
    if sl.get("layout") == "html":
        h = sl.get("html", "")
        m = re.search(r'class="slhd".*?<h2[^>]*>(.*?)</h2>', h, re.S) or re.search(r"<h1[^>]*>(.*?)</h1>", h, re.S) \
            or re.search(r"<h2[^>]*>(.*?)</h2>", h, re.S)
        return _txt(m.group(1)) if m else "(slide HTML)"
    return _txt(sl.get("titulo", "")) or sl.get("layout", "")


# ------------------------------------------------------------------ páginas
def nomes(dados: dict) -> tuple:
    arq = (dados.get("meta") or {}).get("arquivo") or "aula.html"
    base = arq[:-5] if arq.endswith(".html") else arq
    return arq, base


ESTILO_EDITOR_LEGADO = """<style id="estilo-editor">
.tb,.fita,.ctrl-wrap,.ctr,.ft,.progress-wrap{display:none!important}
html,body{width:1280px!important;height:720px!important;overflow:hidden!important}
.sc{zoom:1!important}
.sl .slbd{animation:none!important}
</style>"""


def render_pagina(dados: dict, ed: bool = False, base_href: str | None = None) -> str:
    """HTML completo da aula. ``ed`` = prévia do editor (sem scripts, com marcações)."""
    if dados.get("motor") == "legado":
        return render_legado(dados, ed, base_href)
    c = Ctx(ed)
    meta = dados.get("meta") or {}
    arq, base = nomes(dados)
    logos = logos_efetivas(dados)
    slides = dados.get("slides") or []
    n = len(slides)
    titulo = meta.get("titulo") or "Apresentação"
    barra = meta.get("titulo_barra") or _txt(titulo)
    logo_barra = '<img src="%s" class="tb-logo" alt="">\n      ' % esc(logos["barra"]) if logos.get("barra") else ""
    corpo = "\n\n    ".join("<!-- SLIDE %d — %s -->\n    %s" % (i + 1, esc(titulo_slide(s)).replace("--", "—"), render_slide(s, i, dados, c))
                             for i, s in enumerate(slides))
    rod = ""
    if meta.get("rodape") or logos.get("rodape"):
        im = '<img src="%s" alt="">' % esc(logos["rodape"]) if logos.get("rodape") else ""
        rod = '\n  <footer class="ft">\n    %s<span class="txt">%s</span>\n  </footer>' % (im, meta.get("rodape", ""))
    cab_ed = ""
    if ed:
        cab_ed = ('\n  <base href="%s">' % esc(base_href) if base_href else "") + '\n  <link rel="stylesheet" href="/editor/palco.css">'
    pdf = ('\n    <button class="bp" id="bexp" onclick="exportarPDF()" title="Exportar os slides em PDF — na janela de impressão '
           'escolha \'Salvar como PDF\', margens \'Nenhuma\' e mantenha \'Gráficos de fundo\'">Exportar PDF</button>') if meta.get("mostrar_pdf", True) else ""
    lim = meta.get("cronometro_min") or 10
    script = "" if ed else '\n  <script src="%s.js"></script>' % esc(base)
    estilo = '<style>%s</style>' % css_aula(dados) if ed else '<link rel="stylesheet" href="%s.css">' % esc(base)
    # celular/tablet: liga o "modo rolagem" antes de desenhar (mesma regra do runtime.js)
    movel = "" if ed else ("\n  <script>try{if(!/[?&]modo=apresentador/.test(location.search)&&matchMedia("
                           "'(max-width: 820px), (max-height: 500px) and (pointer: coarse)').matches)"
                           "document.documentElement.classList.add('movel')}catch(e){}</script>")
    lim_txt = "%02d:%02d" % (int(lim), round((float(lim) % 1) * 60))
    return f"""<!DOCTYPE html>
<html lang="{esc(meta.get('lang') or 'pt-BR')}">

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="generator" content="editor_slides">{cab_ed}
  <title>{esc(_txt(titulo))}</title>
  {estilo}{movel}
</head>

<body data-limite="{esc(lim)}"{' class="modo-editor"' if ed else ''}>
  <header class="tb">
    <div class="tb-left">
      {logo_barra}<h2>{barra}</h2>
    </div>
    <div class="tb-right">
      <div class="fz" aria-label="Tamanho do texto">
        <button onclick="fz(-1)" title="Diminuir tamanho da fonte">A−</button>
        <span id="fzpct">100%</span>
        <button onclick="fz(1)" title="Aumentar tamanho da fonte">A+</button>
      </div>
      <button class="bpb" id="bnt" onclick="toggleNotas()" title="Mostrar/ocultar roteiro de fala (tecla N)">Roteiro</button>
      <button class="tmr" id="tmr" onclick="if(event.shiftKey){{tmrDefinirLimite()}}else{{toggleTimer()}}" ondblclick="resetTimer()" title="Iniciar/pausar (T) · duplo clique zera · Shift+clique define o limite">00:00 / {lim_txt}</button>
      <button class="bpb" id="bp" onclick="openPresenter()">Modo apresentador</button>
      <span class="ct" id="ctr">1 / {n}</span>
      <span class="modo-tag">APRESENTAÇÃO</span>
    </div>
  </header>
  <div class="fita"></div>
  <div class="sc">

    {corpo}

  </div>{rod}
  <nav class="ctr" aria-label="Navegação da apresentação">
    <button class="bz" id="bprev" onclick="pv()">Anterior</button>
    <div class="dots" id="dots" role="group" aria-label="Ir para o slide"></div>
    <button class="bv" id="bnext" onclick="nx()">Próximo</button>{pdf}
  </nav>{script}
</body>

</html>
"""


# ------------------------------------------------------------------ legado
def _injetar_head(antes: str, trecho: str) -> str:
    i = antes.lower().find("</head>")
    return antes[:i] + trecho + "\n" + antes[i:] if i >= 0 else trecho + antes


def render_legado(dados: dict, ed: bool = False, base_href: str | None = None) -> str:
    leg = dados.get("legado") or {}
    antes, depois = leg.get("antes", ""), leg.get("depois", "")
    c = Ctx(ed)
    partes = []
    for i, sl in enumerate(dados.get("slides") or []):
        pre = sl.get("prefixo")
        if pre is None:
            pre = "\n\n  <!-- SLIDE (editor) — %s -->\n  " % esc(titulo_slide(sl)).replace("--", "—")
        corpo = render_slide(sl, i, dados, c, sid=sl.get("id") or "s_ed%d" % (i + 1))
        partes.append(pre + corpo)
    tv = (dados.get("tema") or {}).get("vars") or {}
    if tv:
        antes = _injetar_head(antes, '<style id="tema-editor">\n' + css_vars(tv) + "</style>")
    if ed:
        antes = re.sub(r"<script\b[^>]*>.*?</script>", "", antes, flags=re.S | re.I)
        depois = re.sub(r"<script\b[^>]*>.*?</script>", "", depois, flags=re.S | re.I)
        antes = _injetar_head(antes, ('<base href="%s">\n' % esc(base_href) if base_href else "") +
                              ESTILO_EDITOR_LEGADO + '\n<link rel="stylesheet" href="/editor/palco.css">')
    return antes + "".join(partes) + depois


# ------------------------------------------------------------------ gerar
def _copiar(origem: str, destino: str, escritos: list) -> None:
    if not os.path.isfile(origem):
        return
    if os.path.isfile(destino) and open(origem, "rb").read() == open(destino, "rb").read():
        return
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    shutil.copyfile(origem, destino)
    escritos.append(destino)


def _gravar_se_mudou(caminho: str, conteudo: str, escritos: list) -> None:
    if os.path.isfile(caminho):
        with open(caminho, encoding="utf-8", newline="") as f:
            if f.read() == conteudo:
                return
    gravar_texto(caminho, conteudo)
    escritos.append(caminho)


def gerar(caminho_json: str, forcar: bool = False) -> list:
    """Grava os arquivos da aula ao lado do apresentacao.json. Devolve os arquivos alterados."""
    dados = ler_json(caminho_json)
    pasta = os.path.dirname(os.path.abspath(caminho_json))
    arq, base = nomes(dados)
    escritos: list = []
    if dados.get("motor") == "legado":
        if dados.get("estado") != "editor" and not forcar:
            return []
        _gravar_se_mudou(os.path.join(pasta, arq), render_legado(dados), escritos)
        return escritos
    _gravar_se_mudou(os.path.join(pasta, arq), render_pagina(dados), escritos)
    _gravar_se_mudou(os.path.join(pasta, base + ".css"), css_aula(dados), escritos)
    _copiar(os.path.join(MODELO, "runtime.js"), os.path.join(pasta, base + ".js"), escritos)
    _copiar(os.path.join(MODELO, FONTE), os.path.join(pasta, "fonts", FONTE), escritos)
    tema = carregar_tema((dados.get("tema") or {}).get("base"))
    for k, v in (tema.get("logos") or {}).items():
        if v and not ((dados.get("tema") or {}).get("logos") or {}).get(k):
            _copiar(os.path.join(TEMAS, tema["nome"], v), os.path.join(pasta, "img", "tema", os.path.basename(v)), escritos)
    return escritos


def verificar_legado(caminho_json: str) -> tuple:
    """Para aulas importadas: o HTML remontado é idêntico ao arquivo publicado?"""
    dados = ler_json(caminho_json)
    pasta = os.path.dirname(os.path.abspath(caminho_json))
    arq, _ = nomes(dados)
    alvo = os.path.join(pasta, arq)
    atual = open(alvo, encoding="utf-8", newline="").read() if os.path.isfile(alvo) else ""
    novo = render_legado(dados)
    if novo == atual:
        return True, "idêntico ao publicado"
    # primeira diferença, para diagnóstico
    k = next((i for i, (a, b) in enumerate(zip(novo, atual)) if a != b), min(len(novo), len(atual)))
    linha = atual.count("\n", 0, k) + 1
    return False, "difere do publicado a partir da linha %d" % linha


def procurar_projetos(raiz: str = RAIZ, com_exemplos: bool = False) -> list:
    """Todos os apresentacao.json do repositório."""
    achados = []
    for pasta, subpastas, arquivos in os.walk(raiz):
        subpastas[:] = sorted(d for d in subpastas if not d.startswith(".") and d not in ("_site", "node_modules", "__pycache__")
                              and (com_exemplos or os.path.join(pasta, d) != os.path.join(raiz, "editor_slides")))
        if "apresentacao.json" in arquivos:
            achados.append(os.path.join(pasta, "apresentacao.json"))
    return achados
