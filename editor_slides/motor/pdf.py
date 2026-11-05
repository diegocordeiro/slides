"""Extração de aulas em PDF (texto, imagens e páginas sem texto) com PyMuPDF.

O PDF e tudo o que sai dele ficam em editor_slides/.cache/pdf/<token>/ (fora do
git) e são apagados depois da conversão. Nada aqui chama o LLM.

Instalação (só para esta função): ``pip3 install pymupdf``
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time

from . import render

CACHE = os.path.join(render.EDITOR, ".cache", "pdf")
MIN_LADO = 80          # px: imagens menores são ícones/enfeites
MIN_AREA = 140 * 140
MAX_TEXTO_PAG = 5000   # caracteres por página enviados ao LLM
LARGURA_RENDER = 1600  # px das páginas sem texto (viram slide "imagem inteira")


def _modulo():
    try:
        import pymupdf  # noqa: F401
        return pymupdf
    except ImportError:
        try:
            import fitz  # versões antigas do PyMuPDF
            return fitz
        except ImportError:
            return None


def disponivel() -> tuple:
    m = _modulo()
    if m:
        return True, "PyMuPDF " + str(getattr(m, "VersionBind", getattr(m, "__version__", "")))
    return False, "Instale o PyMuPDF para importar PDFs: pip3 install pymupdf  (ou: make instalar-pdf)"


def pasta(token: str) -> str:
    if not re.fullmatch(r"[0-9a-f]{16}", token or ""):
        raise ValueError("token de PDF inválido")
    return os.path.join(CACHE, token)


def limpar_antigos(horas: float = 24) -> None:
    if not os.path.isdir(CACHE):
        return
    limite = time.time() - horas * 3600
    for nome in os.listdir(CACHE):
        p = os.path.join(CACHE, nome)
        if os.path.isdir(p) and os.path.getmtime(p) < limite:
            shutil.rmtree(p, ignore_errors=True)


def apagar(token: str) -> None:
    shutil.rmtree(pasta(token), ignore_errors=True)


def _texto(t: str) -> str:
    t = t.replace("­", "").replace("\r", "")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def _salvar_imagem(fz, doc, xref: int, smask: int, destino_sem_ext: str) -> str | None:
    """Grava a imagem como .png ou .jpg; devolve o caminho ou None."""
    try:
        info = doc.extract_image(xref)
    except Exception:  # noqa: BLE001
        info = None
    if info and not smask and info.get("ext") in ("png", "jpeg", "jpg"):
        ext = "jpg" if info["ext"] in ("jpeg", "jpg") else "png"
        caminho = destino_sem_ext + "." + ext
        with open(caminho, "wb") as f:
            f.write(info["image"])
        return caminho
    try:
        pix = fz.Pixmap(doc, xref)
        if smask:
            pix = fz.Pixmap(pix, fz.Pixmap(doc, smask))
        if pix.n - pix.alpha >= 4:  # CMYK → RGB
            pix = fz.Pixmap(fz.csRGB, pix)
        caminho = destino_sem_ext + ".png"
        pix.save(caminho)
        return caminho
    except Exception:  # noqa: BLE001
        return None


def extrair(dados_pdf: bytes, nome: str = "aula.pdf") -> dict:
    """Extrai o PDF para o cache e devolve o resumo (também gravado em extracao.json)."""
    fz = _modulo()
    if not fz:
        raise RuntimeError(disponivel()[1])
    limpar_antigos()
    token = hashlib.sha1(dados_pdf + str(time.time()).encode()).hexdigest()[:16]
    dest = pasta(token)
    os.makedirs(dest, exist_ok=True)
    try:
        doc = fz.open(stream=dados_pdf, filetype="pdf")
    except Exception as e:  # noqa: BLE001
        shutil.rmtree(dest, ignore_errors=True)
        raise RuntimeError("Não consegui abrir o PDF (%s)" % e)
    if doc.needs_pass:
        shutil.rmtree(dest, ignore_errors=True)
        raise RuntimeError("O PDF está protegido por senha.")

    # 1ª passada: em quantas páginas cada imagem aparece (logos repetidas são descartadas)
    ocorrencias: dict = {}
    for pg in doc:
        for im in pg.get_images(full=True):
            ocorrencias.setdefault(im[0], set()).add(pg.number)
    n_pags = len(doc)
    repetidas = {x for x, pags in ocorrencias.items() if n_pags >= 3 and len(pags) >= max(3, n_pags * 0.5)}

    paginas, vistos = [], {}
    total_chars = 0
    for pg in doc:
        num = pg.number + 1
        texto = _texto(pg.get_text("text", sort=True))
        area_pag = abs(pg.rect.width * pg.rect.height) or 1
        imagens = []
        sem_texto = len(re.sub(r"\s", "", texto)) < 25
        for k, im in enumerate([] if sem_texto else pg.get_images(full=True), 1):
            xref, smask, w, h = im[0], im[1], im[2], im[3]
            if xref in repetidas or min(w, h) < MIN_LADO or w * h < MIN_AREA:
                continue
            try:
                rects = pg.get_image_rects(xref)
            except Exception:  # noqa: BLE001
                rects = []
            frac = sum(abs(r.width * r.height) for r in rects) / area_pag if rects else 0
            if rects and frac < 0.02:  # aparece minúscula na página
                continue
            if xref in vistos:  # mesma imagem em outra página: reaproveita o arquivo
                imagens.append(dict(vistos[xref], pagina=num))
                continue
            base = os.path.join(dest, "pdf-p%02d-%d" % (num, k))
            arq = _salvar_imagem(fz, doc, xref, smask, base)
            if not arq:
                continue
            reg = {"arquivo": os.path.basename(arq), "largura": w, "altura": h, "fracao": round(frac, 3), "pagina": num}
            vistos[xref] = reg
            imagens.append(reg)
        render_arq = None
        if sem_texto:  # página escaneada ou só imagem → vira slide "imagem inteira"
            zoom = LARGURA_RENDER / max(pg.rect.width, 1)
            pix = pg.get_pixmap(matrix=fz.Matrix(zoom, zoom), alpha=False)
            render_arq = "pdf-pagina-%02d.png" % num
            pix.save(os.path.join(dest, render_arq))
        texto = texto[:MAX_TEXTO_PAG]
        total_chars += len(texto)
        primeira = next((l.strip() for l in texto.splitlines() if l.strip()), "")
        paginas.append({"numero": num, "texto": texto, "titulo": primeira[:90], "imagens": imagens,
                        "sem_texto": sem_texto, "render": render_arq})
    meta = doc.metadata or {}
    doc.close()
    with open(os.path.join(dest, "original.pdf"), "wb") as f:
        f.write(dados_pdf)
    resumo = {"token": token, "nome": nome, "titulo": (meta.get("title") or "").strip(), "paginas": paginas,
              "total_paginas": n_pags, "total_caracteres": total_chars,
              "tokens_estimados": int(total_chars / 3.2) + 1500 * max(1, (n_pags + 7) // 8)}
    with open(os.path.join(dest, "extracao.json"), "w", encoding="utf-8") as f:
        json.dump(resumo, f, ensure_ascii=False)
    return resumo


def carregar(token: str) -> dict:
    with open(os.path.join(pasta(token), "extracao.json"), encoding="utf-8") as f:
        return json.load(f)


def planejar(resumo: dict, paginas: list, max_paginas: int = 8, max_chars: int = 14000) -> list:
    """Divide as páginas escolhidas em lotes de texto (para o LLM) e páginas-imagem (direto)."""
    por_num = {p["numero"]: p for p in resumo["paginas"]}
    lotes, atual, chars = [], [], 0
    for n in sorted(set(int(x) for x in paginas if int(x) in por_num)):
        p = por_num[n]
        if p["sem_texto"]:
            if atual:
                lotes.append({"tipo": "texto", "paginas": atual})
                atual, chars = [], 0
            lotes.append({"tipo": "imagem", "pagina": n, "arquivo": p["render"]})
            continue
        if atual and (len(atual) >= max_paginas or chars + len(p["texto"]) > max_chars):
            lotes.append({"tipo": "texto", "paginas": atual})
            atual, chars = [], 0
        atual.append(n)
        chars += len(p["texto"])
    if atual:
        lotes.append({"tipo": "texto", "paginas": atual})
    return lotes


def copiar_para_aula(token: str, pasta_aula: str, arquivos: list) -> dict:
    """Copia as imagens usadas para <aula>/img/. Devolve {nome_cache: 'img/nome_final'}."""
    origem = pasta(token)
    destino = os.path.join(pasta_aula, "img")
    os.makedirs(destino, exist_ok=True)
    mapa = {}
    for nome in sorted(set(arquivos)):
        if not re.fullmatch(r"pdf-[\w-]+\.(png|jpg)", nome or ""):
            continue
        src = os.path.join(origem, nome)
        if not os.path.isfile(src):
            continue
        bruto = open(src, "rb").read()
        base, ext = os.path.splitext(nome)
        alvo, k = os.path.join(destino, nome), 2
        while os.path.exists(alvo) and open(alvo, "rb").read() != bruto:
            alvo = os.path.join(destino, "%s-%d%s" % (base, k, ext))
            k += 1
        with open(alvo, "wb") as f:
            f.write(bruto)
        mapa[nome] = "img/" + os.path.basename(alvo)
    return mapa
