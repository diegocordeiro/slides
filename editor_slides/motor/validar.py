"""Validação dos slides estruturados (usada no gerador e nas respostas do LLM)."""
from __future__ import annotations

import re

from . import render

_SCRIPT = re.compile(r"<script\b.*?</script>", re.S | re.I)
_ON = re.compile(r"\son[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)


def limpar_html(v: str) -> str:
    """Remove <script> e atributos on* de HTML vindo do LLM."""
    return _ON.sub("", _SCRIPT.sub("", v or ""))


def _limpar(obj):
    if isinstance(obj, str):
        return limpar_html(obj)
    if isinstance(obj, list):
        return [_limpar(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _limpar(v) for k, v in obj.items()}
    return obj


def _blocos(lista, cat, onde, erros):
    if not isinstance(lista, list):
        erros.append("%s: deveria ser uma lista de blocos" % onde)
        return
    for i, b in enumerate(lista):
        o = "%s[%d]" % (onde, i)
        if not isinstance(b, dict) or b.get("tipo") not in cat["blocos"]:
            erros.append("%s: tipo de bloco inválido (%r). Use um destes: %s" % (
                o, b.get("tipo") if isinstance(b, dict) else b, ", ".join(cat["blocos"])))
            continue
        if b["tipo"] == "grade":
            for j, col in enumerate(b.get("colunas") or []):
                _blocos(col, cat, "%s.colunas[%d]" % (o, j), erros)
        if b["tipo"] == "card" and b.get("blocos"):
            _blocos(b["blocos"], cat, o + ".blocos", erros)
        if b["tipo"] == "tabela":
            if not isinstance(b.get("linhas", []), list) or any(not isinstance(r, list) for r in b.get("linhas", [])):
                erros.append(o + ": 'linhas' deve ser lista de listas")


def validar_slide(sl, cat=None, onde="slide") -> list:
    cat = cat or render.catalogo()
    erros = []
    if not isinstance(sl, dict):
        return ["%s: deveria ser um objeto" % onde]
    lay = sl.get("layout")
    if lay not in cat["layouts"]:
        return ["%s: layout inválido (%r). Use um destes: %s" % (onde, lay, ", ".join(cat["layouts"]))]
    for campo in cat["layouts"][lay]["campos"]:
        if campo.get("obrigatorio") and not sl.get(campo["nome"]):
            erros.append("%s: campo obrigatório ausente: %s" % (onde, campo["nome"]))
    if lay == "conteudo":
        for k in ("topo", "rodape"):
            if sl.get(k):
                _blocos(sl[k], cat, "%s.%s" % (onde, k), erros)
        cols = sl.get("colunas")
        if not isinstance(cols, list) or not cols:
            erros.append(onde + ": 'colunas' deve ser uma lista com ao menos uma coluna (lista de blocos)")
        else:
            for j, col in enumerate(cols):
                _blocos(col, cat, "%s.colunas[%d]" % (onde, j), erros)
            prop = sl.get("proporcao")
            if prop and len(prop.split()) != len(cols):
                sl["proporcao"] = " ".join(["1fr"] * len(cols))
    return erros


def normalizar_slide(sl: dict) -> dict:
    return _limpar(sl)


def validar_dados(dados: dict) -> list:
    cat = render.catalogo()
    erros = []
    for i, s in enumerate(dados.get("slides") or []):
        erros += validar_slide(s, cat, "slide %d" % (i + 1))
    return erros
