"""Ações de IA do editor. Cada ação monta o prompt, chama o provedor e valida a resposta.

Todas devolvem um dicionário pronto para o editor aplicar como PRÉVIA
(o professor aceita ou descarta). Nada é gravado aqui.
"""
from __future__ import annotations

import base64
import json
import os
import re

from . import provedores
from motor import render, validar

PROMPTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")
USO = {"entrada": 0, "saida": 0, "chamadas": 0}


def _ler(nome: str) -> str:
    return open(os.path.join(PROMPTS, nome), encoding="utf-8").read()


def _descrever(campos: list) -> str:
    partes = []
    for c in campos:
        t = c["tipo"]
        if t == "selecao":
            t = "um de: " + ", ".join('"%s"' % k for k in c["opcoes"])
        elif t == "itens":
            t = "lista de objetos {%s}" % ", ".join(s["nome"] for s in c["subcampos"])
        elif t in ("blocos",):
            t = "lista de blocos"
        elif t == "colunas":
            t = "lista de colunas (cada uma, lista de blocos)"
        elif t == "lista":
            t = "lista de textos"
        elif t == "tabela":
            t = "lista de linhas (cada linha, lista de células)"
        partes.append('"%s" (%s)' % (c["nome"], t))
    return ", ".join(partes)


def formato() -> str:
    cat = render.catalogo()
    lay = "\n".join('- "%s": %s Campos: %s' % (k, v["descricao"], _descrever(v["campos"]))
                    for k, v in cat["layouts"].items() if k not in ("html", "imagem"))
    blo = "\n".join('- "%s" (%s): %s' % (k, v["rotulo"], _descrever(v["campos"]))
                    for k, v in cat["blocos"].items() if k != "html")
    return _ler("formato_slides.md").replace("{{LAYOUTS}}", lay).replace("{{BLOCOS}}", blo)


def _json(texto: str):
    t = texto.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t)
    try:
        return json.loads(t)
    except ValueError:
        m = re.search(r"\{.*\}", t, re.S)
        if m:
            return json.loads(m.group(0))
        raise


def _modelo_da_acao(acao: str, prov: str | None, modelo: str | None, cfg: dict) -> tuple:
    prov = prov or cfg.get("padrao")
    if modelo:
        return prov, modelo
    nivel = cfg.get("acoes", {}).get(acao, "forte")
    return prov, cfg["provedores"][prov]["modelos"].get(nivel)


def _chamar(acao, sistema, usuario, prov, modelo, validar_fn=None, imagens=None):
    cfg = provedores.config()
    prov, modelo = _modelo_da_acao(acao, prov, modelo, cfg)
    tentativas, ultimo_erro = 0, None
    while tentativas < 2:
        tentativas += 1
        texto, uso, prov_u, modelo_u = provedores.chamar(prov, modelo, sistema, usuario, True, imagens, cfg)
        USO["entrada"] += uso.get("entrada", 0)
        USO["saida"] += uso.get("saida", 0)
        USO["chamadas"] += 1
        try:
            obj = _json(texto)
        except ValueError:
            ultimo_erro = "a resposta não é um JSON válido"
        else:
            erros = validar_fn(obj) if validar_fn else []
            if not erros:
                return obj, {"provedor": prov_u, "modelo": modelo_u, "uso_sessao": dict(USO)}
            ultimo_erro = "; ".join(erros[:8])
        usuario = usuario + "\n\nSua resposta anterior tinha problemas: %s. Corrija e responda novamente apenas com o JSON." % ultimo_erro
    raise provedores.ErroLLM("O modelo não devolveu um resultado válido: %s" % ultimo_erro)


def _contexto_aula(dados: dict) -> str:
    meta = dados.get("meta") or {}
    tits = [render.titulo_slide(s) for s in dados.get("slides") or []]
    return "Aula: %s\nSlides atuais: %s" % (meta.get("titulo", ""), " | ".join(tits[:40]))


def _slides_ok(obj, chave="slides"):
    lst = obj.get(chave) if isinstance(obj, dict) else None
    if not isinstance(lst, list) or not lst:
        return ["o JSON deve ter a chave '%s' com uma lista de slides" % chave]
    cat = render.catalogo()
    erros = []
    for i, s in enumerate(lst):
        erros += validar.validar_slide(s, cat, "slides[%d]" % i)
    return erros


def _slide_ok(obj):
    if not isinstance(obj, dict) or not isinstance(obj.get("slide"), dict):
        return ["o JSON deve ter a chave 'slide' com um objeto de slide"]
    return validar.validar_slide(obj["slide"])


# ------------------------------------------------------------------ ações
def gerar_aula(e: dict, prov=None, modelo=None) -> dict:
    sistema = _ler("sistema.md") + "\n\n" + formato()
    usuario = ("Monte uma apresentação completa.\nTema: {tema}\nPúblico: {publico}\nQuantidade aproximada de slides: {n}\n"
               "Duração da aula (min): {dur}\nRoteiro/tópicos do professor:\n{roteiro}\n\nObservações: {obs}\n\n"
               'Responda com {{"titulo": "...", "slides": [ ... ]}}. Comece com uma capa e termine com um slide "secao" de encerramento. '
               "Inclua \"notas\" em todos os slides.").format(
        tema=e.get("tema", ""), publico=e.get("publico", "estudantes do ensino técnico"), n=e.get("n_slides", 10),
        dur=e.get("duracao", 50), roteiro=e.get("roteiro", "(livre)"), obs=e.get("observacoes", ""))
    obj, info = _chamar("gerar_aula", sistema, usuario, prov, modelo, _slides_ok)
    return {"titulo": obj.get("titulo"), "slides": [validar.normalizar_slide(s) for s in obj["slides"]], **info}


def gerar_slide(e: dict, prov=None, modelo=None) -> dict:
    sistema = _ler("sistema.md") + "\n\n" + formato()
    usuario = "%s\n\nCrie UM slide para: %s\n\nResponda com {\"slide\": {...}}." % (_contexto_aula(e.get("dados") or {}), e.get("pedido", ""))
    obj, info = _chamar("gerar_slide", sistema, usuario, prov, modelo, _slide_ok)
    return {"slide": validar.normalizar_slide(obj["slide"]), **info}


INSTRUCOES = {
    "reescrever": "Reescreva com mais clareza, mantendo o sentido e o tamanho aproximado.",
    "resumir": "Resuma para caber num slide: frases curtas, no máximo metade do tamanho.",
    "didatico": "Deixe mais didático para o público, com exemplos concretos e linguagem acessível, sem aumentar muito o tamanho.",
    "corrigir": "Corrija ortografia, gramática e pontuação, sem mudar o estilo.",
    "topicos": "Transforme em tópicos curtos (<ul><li>), no máximo 5 itens.",
}


def reescrever(e: dict, prov=None, modelo=None) -> dict:
    instr = INSTRUCOES.get(e.get("modo"), e.get("instrucao") or INSTRUCOES["reescrever"])
    sistema = _ler("sistema.md")
    usuario = ("Texto (HTML) de um slide:\n%s\n\nTarefa: %s\nPreserve as marcações HTML simples. "
               'Responda com {"html": "..."}.') % (e.get("html", ""), instr)
    obj, info = _chamar("reescrever", sistema, usuario, prov, modelo,
                        lambda o: [] if isinstance(o, dict) and isinstance(o.get("html"), str) else ["falta a chave 'html'"])
    return {"html": validar.limpar_html(obj["html"]), **info}


def roteiro(e: dict, prov=None, modelo=None) -> dict:
    sistema = _ler("sistema.md")
    usuario = ("Conteúdo do slide (HTML ou JSON):\n%s\n\nContexto: %s\n\nEscreva o roteiro de fala do professor para este slide "
               "(o que dizer, perguntas para a turma, transição para o próximo). Estime o tempo. "
               'Responda com {"notas": "<strong>~N min.</strong> ...", "tempo_seg": N}.') % (
        e.get("slide", ""), _contexto_aula(e.get("dados") or {}))
    obj, info = _chamar("roteiro", sistema, usuario, prov, modelo,
                        lambda o: [] if isinstance(o, dict) and o.get("notas") else ["falta a chave 'notas'"])
    return {"notas": validar.limpar_html(obj["notas"]), "tempo_seg": obj.get("tempo_seg"), **info}


def alt(e: dict, prov=None, modelo=None) -> dict:
    sistema = _ler("sistema.md")
    imagens = None
    caminho = e.get("arquivo")
    if caminho and os.path.isfile(caminho) and os.path.getsize(caminho) < 4_000_000:
        ext = os.path.splitext(caminho)[1].lower().lstrip(".")
        mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp"}.get(ext)
        if mime:
            imagens = [(mime, base64.b64encode(open(caminho, "rb").read()).decode())]
    usuario = ("Escreva um texto alternativo (alt) curto e descritivo (até 120 caracteres) para uma imagem de slide.\n"
               "Nome do arquivo: %s\nContexto do slide: %s\n%s"
               'Responda com {"alt": "..."}.') % (
        os.path.basename(e.get("src", "")), e.get("contexto", ""),
        "A imagem está anexada.\n" if imagens else "Você não vê a imagem: deduza pelo nome do arquivo e pelo contexto.\n")
    obj, info = _chamar("alt", sistema, usuario, prov, modelo,
                        lambda o: [] if isinstance(o, dict) and o.get("alt") else ["falta a chave 'alt'"], imagens)
    return {"alt": re.sub(r"<[^>]+>", "", obj["alt"]).strip(), **info}


def converter(e: dict, prov=None, modelo=None) -> dict:
    """HTML livre (ou slide estruturado) → slide estruturado do catálogo."""
    sistema = _ler("sistema.md") + "\n\n" + formato()
    extra = e.get("instrucao") or "Preserve todo o conteúdo textual, as imagens (mesmos caminhos em src) e o roteiro (.nt → notas)."
    usuario = ("Converta este slide para o formato JSON estruturado, escolhendo o layout e os blocos que melhor representam o conteúdo.\n"
               "%s\n\nSlide atual:\n%s\n\nResponda com {\"slide\": {...}}.") % (extra, e.get("slide", ""))
    obj, info = _chamar("converter", sistema, usuario, prov, modelo, _slide_ok)
    return {"slide": validar.normalizar_slide(obj["slide"]), **info}


def slide_legado(e: dict, prov=None, modelo=None) -> dict:
    """Novo slide em HTML no MESMO estilo de uma aula importada (usa slides existentes como exemplo)."""
    sistema = _ler("sistema.md")
    exemplos = "\n\n".join(e.get("exemplos") or [])[:12000]
    usuario = ("Abaixo estão slides de uma aula existente (HTML com classes CSS próprias). Crie UM novo slide no mesmo padrão "
               "de marcação, reutilizando apenas classes que aparecem nos exemplos. O slide deve ser um único "
               '<div class="sl" id="..."> com cabeçalho .slhd (quando os exemplos usam), conteúdo e roteiro em <div class="nt"> se os exemplos tiverem.\n\n'
               "Exemplos:\n%s\n\nPedido do professor: %s\n\nResponda com {\"html\": \"<div class=\\\"sl\\\" ...>...</div>\"}.") % (
        exemplos, e.get("pedido", ""))

    def ok(o):
        h = o.get("html") if isinstance(o, dict) else None
        return [] if isinstance(h, str) and re.match(r'\s*<div[^>]*class="sl[\s"]', h) else ['"html" deve começar com <div class="sl">']
    obj, info = _chamar("slide_legado", sistema, usuario, prov, modelo, ok)
    return {"html": validar.limpar_html(obj["html"]).strip(), **info}


ACOES = {"gerar_aula": gerar_aula, "gerar_slide": gerar_slide, "reescrever": reescrever, "roteiro": roteiro,
         "alt": alt, "converter": converter, "slide_legado": slide_legado}
