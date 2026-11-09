"""Exporta o PDF de uma aula gerada (o mesmo PDF do botão "Exportar PDF"), usando o
Chrome/Chromium/Edge instalado em modo headless. Nada é instalado: se nenhum
navegador for encontrado, o PDF simplesmente não é gerado (e a aula no celular
cai na versão web).

O PDF fica ao lado do HTML (aulaNN.pdf) e é o que o celular abre.
Variável de ambiente CHROME=/caminho/do/navegador força um executável.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import urllib.parse

CANDIDATOS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]
NOMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"]


def navegador() -> str | None:
    env = os.environ.get("CHROME")
    if env and os.path.isfile(env):
        return env
    for c in CANDIDATOS:
        if os.path.isfile(c):
            return c
    for n in NOMES:
        p = shutil.which(n)
        if p:
            return p
    return None


def exportar(caminho_html: str, caminho_pdf: str, tempo_ms: int = 9000) -> tuple:
    """Gera o PDF. Devolve (ok, mensagem)."""
    exe = navegador()
    if not exe:
        return False, "Chrome/Chromium/Edge não encontrado (defina CHROME=/caminho) — PDF não gerado"
    url = "file://" + urllib.parse.quote(os.path.abspath(caminho_html)) + "?pdf=1"
    tmp = tempfile.mkdtemp(prefix="slides-pdf-")
    saida = os.path.join(tmp, "saida.pdf")
    # (sem --user-data-dir: um perfil novo faz o Chrome travar esperando o primeiro uso)
    cmd = [exe, "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer", "--hide-scrollbars",
           "--no-first-run", "--window-size=1280,720", "--virtual-time-budget=%d" % tempo_ms, "--print-to-pdf=" + saida, url]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
        if not os.path.isfile(saida) or os.path.getsize(saida) < 1000:
            return False, "o navegador não gerou o PDF (%s)" % (r.stderr or r.stdout or "sem saída").strip()[-300:]
        novo = open(saida, "rb").read()
        if os.path.isfile(caminho_pdf) and _sem_datas(open(caminho_pdf, "rb").read()) == _sem_datas(novo):
            os.utime(caminho_pdf, None)  # marca como atualizado (evita reexportar a cada geração)
            return True, "PDF sem mudanças"
        shutil.move(saida, caminho_pdf)
        return True, "PDF gerado"
    except (OSError, subprocess.TimeoutExpired) as e:
        return False, "falha ao gerar o PDF (%s)" % e
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _sem_datas(b: bytes) -> bytes:
    """Ignora metadados de data/ID ao comparar PDFs (evita commit à toa)."""
    import re
    return re.sub(rb"/(CreationDate|ModDate)\s*\([^)]*\)|/ID\s*\[[^\]]*\]", b"", b)
