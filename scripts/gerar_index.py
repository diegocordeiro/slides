#!/usr/bin/env python3
"""Gera a página inicial (index.html) do site de slides.

Varre o repositório procurando apresentações — qualquer arquivo .html que
contenha slides (``<div class="sl``) — agrupa por área/disciplina e monta uma
página estática com a mesma identidade visual das aulas.

Convenção das aulas (basta criar a pasta, o índice se atualiza sozinho):

    <área>/<disciplina>/aula-NN/aulaNN.html   (+ css, js e img/ na mesma pasta)

Uso:
    python3 scripts/gerar_index.py                      # gera ./index.html
    python3 scripts/gerar_index.py --saida _site/index.html
    python3 scripts/gerar_index.py --raiz . --saida _site/index.html
"""
from __future__ import annotations

import argparse
import html
import os
import re
from datetime import datetime

# Pastas que nunca entram na varredura
PASTAS_IGNORADAS = {".git", ".github", "scripts", "_site", "node_modules", "__pycache__"}

# Um arquivo é considerado apresentação quando tem pelo menos dois slides
PADRAO_SLIDE = re.compile(r'<div class="sl(?:\s|")')
PADRAO_TITULO = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)
PADRAO_H1 = re.compile(r"<h1[^>]*>(.*?)</h1>", re.IGNORECASE | re.DOTALL)

ESTILO = """
:root {
    --ve: #34805C;
    --vee: #1C5A3E;
    --veex: #173E2E;
    --ves: #EAF3EE;
    --bg: #F7FAF8;
    --papel: #FFFFFF;
    --tinta: #24282B;
    --tinta-2: #4A5651;
    --linha: #C9D6CE;
}

* { box-sizing: border-box; margin: 0; padding: 0 }

body {
    font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
    background: var(--bg);
    color: var(--tinta);
    line-height: 1.55
}

.wrap {
    width: min(1100px, 100% - 2 * clamp(14px, 4vw, 32px));
    margin: 0 auto
}

.topo {
    background: linear-gradient(135deg, var(--veex), var(--vee) 55%, var(--ve));
    color: #FFF;
    padding: clamp(26px, 5vw, 52px) 0 clamp(22px, 4vw, 40px)
}

.topo .rot {
    display: inline-block;
    font-size: .82rem;
    font-weight: 700;
    letter-spacing: .09em;
    text-transform: uppercase;
    background: rgba(255, 255, 255, .16);
    border: 1px solid rgba(255, 255, 255, .38);
    border-radius: 999px;
    padding: 4px 12px;
    margin-bottom: 14px
}

.topo h1 {
    font-family: 'Montserrat', 'Segoe UI', Arial, sans-serif;
    font-size: clamp(1.6rem, 4.4vw, 2.6rem);
    line-height: 1.15
}

.topo p { margin-top: 10px; max-width: 62ch; color: #E4F0E9 }

.topo .linhas {
    margin-top: 14px;
    display: grid;
    gap: 2px;
    max-width: 70ch;
    color: #E4F0E9
}

.topo .linhas strong { color: #FFF }

.topo .linhas a { color: #FFF; font-weight: 700 }

.aviso {
    margin: clamp(20px, 3vw, 30px) 0 0;
    background: var(--papel);
    border: 1px solid var(--linha);
    border-left: 6px solid var(--ve);
    border-radius: 0 12px 12px 0;
    padding: 16px clamp(16px, 2vw, 22px)
}

.aviso h2 {
    font-family: 'Montserrat', 'Segoe UI', Arial, sans-serif;
    font-size: 1rem;
    color: var(--vee);
    margin-bottom: 10px
}

.aviso ul {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
    gap: 5px 26px
}

.aviso li {
    position: relative;
    padding-left: 16px;
    font-size: .9rem;
    color: var(--tinta-2)
}

.aviso li::before {
    content: '•';
    position: absolute;
    left: 2px;
    color: var(--ve);
    font-weight: 700
}

.aviso kbd {
    font-family: inherit;
    font-size: .86em;
    font-weight: 700;
    color: var(--vee);
    background: var(--ves);
    border: 1px solid var(--linha);
    border-bottom-width: 2px;
    border-radius: 5px;
    padding: 0 5px
}

.bloco { margin: clamp(24px, 4vw, 40px) 0 }

.bloco > h2 {
    font-family: 'Montserrat', 'Segoe UI', Arial, sans-serif;
    font-size: clamp(1rem, 2.4vw, 1.25rem);
    color: var(--vee);
    padding-bottom: 8px;
    margin-bottom: 16px;
    border-bottom: 3px solid var(--linha)
}

.grade {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 290px), 1fr));
    gap: clamp(12px, 2vw, 20px)
}

.card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--papel);
    border: 1px solid var(--linha);
    border-radius: 14px;
    padding: 18px 20px 16px;
    text-decoration: none;
    color: inherit;
    box-shadow: 0 1px 2px rgba(16, 32, 24, .05), 0 6px 16px rgba(16, 32, 24, .05);
    transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease
}

.card:hover,
.card:focus-visible {
    transform: translateY(-3px);
    border-color: var(--ve);
    box-shadow: 0 10px 26px rgba(16, 32, 24, .16);
    outline: none
}

.card:focus-visible {
    box-shadow: 0 0 0 3px rgba(52, 128, 92, .45), 0 10px 26px rgba(16, 32, 24, .16)
}

.badge {
    align-self: flex-start;
    background: var(--ves);
    color: var(--vee);
    border: 1px solid var(--ve);
    border-radius: 999px;
    font-size: .76rem;
    font-weight: 700;
    letter-spacing: .04em;
    text-transform: uppercase;
    padding: 3px 11px
}

.card h3 {
    font-family: 'Montserrat', 'Segoe UI', Arial, sans-serif;
    font-size: 1.06rem;
    color: var(--vee);
    margin-top: 4px
}

.card .sub { font-size: .9rem; color: var(--tinta-2) }

.card .info {
    font-size: .8rem;
    color: var(--tinta-2);
    font-variant-numeric: tabular-nums
}

.card .abrir { margin-top: 8px; font-weight: 700; color: var(--ve); font-size: .92rem }

.rodape { padding: 22px 0 40px; font-size: .82rem; color: var(--tinta-2) }

.rodape code { background: var(--ves); border-radius: 5px; padding: 1px 5px }

@media (prefers-reduced-motion: reduce) {
    .card { transition: none }
}
"""

INSTRUCOES = """  <section class="aviso">
    <h2>Instruções de uso</h2>
    <ul>
      <li>Clique no cartão de uma aula para abrir a apresentação.</li>
      <li>Para projetar: use <strong>Apresentação</strong> (abre em janela dedicada — libere os pop-ups se o navegador bloquear) ou tecle <kbd>F</kbd> para tela cheia.</li>
      <li>Avançar e voltar: <kbd>→</kbd> <kbd>←</kbd>, <kbd>PageDown</kbd>/<kbd>PageUp</kbd> ou <kbd>Espaço</kbd>; <kbd>Home</kbd> volta ao primeiro slide e <kbd>End</kbd> vai ao último.</li>
      <li>Ir direto a um slide: clique nos números (bolinhas) ou nas setas laterais.</li>
      <li>Tamanho do texto: <strong>A−</strong> e <strong>A+</strong> (de 80% a 180%).</li>
      <li>Tema da tela: <strong>◉ Projetor</strong> (mais contraste, para sala) e <strong>◐ Leitura</strong> (tela do computador).</li>
      <li>Passagem automática: <kbd>P</kbd> ou o botão <strong>▶</strong> (troca de slide a cada 4 segundos).</li>
      <li>Fotos com a lupa 🔍: clique para ver a imagem inteira; <kbd>Esc</kbd> ou um clique fora fecha.</li>
      <li>No celular ou tablet, deslize o dedo para o lado para trocar de slide.</li>
    </ul>
  </section>
"""


def limpar(texto: str) -> str:
    """Remove tags e normaliza espaços de um trecho de HTML."""
    sem_tags = re.sub(r"<[^>]+>", " ", texto or "")
    return re.sub(r"\s+", " ", html.unescape(sem_tags)).strip()


# Nomes de exibição para pastas conhecidas (o restante é capitalizado automaticamente)
NOMES_AMIGAVEIS = {
    "meio_ambiente": "Meio Ambiente",
    "informatica_aplicada": "Informática Aplicada",
    "informatica_basica": "Informática Básica",
}


def titulo_amigavel(nome: str) -> str:
    """aula-02 -> Aula 02 | informatica_aplicada -> Informática Aplicada."""
    if nome in NOMES_AMIGAVEIS:
        return NOMES_AMIGAVEIS[nome]
    partes = [p for p in re.split(r"[-_\s]+", nome) if p]
    return " ".join(p if p.isdigit() else p.capitalize() for p in partes)


def chave_ordem(rel: str) -> tuple:
    """Ordena aula-1, aula-02, aula-10 corretamente."""
    pedacos = rel.split("/")
    area = pedacos[0] if pedacos else ""
    disciplina = pedacos[1] if len(pedacos) > 2 else ""
    numeros = [int(n) for n in re.findall(r"\d+", rel)]
    return (area, disciplina, numeros or [0], rel)


def partes_do_titulo(bruto: str) -> tuple:
    """Separa 'Curso · Aula 02 — Assunto' em (assunto, curso)."""
    texto = limpar(bruto)
    assunto = texto
    curso = ""
    if "—" in texto:
        antes, depois = texto.split("—", 1)
        assunto = depois.strip()
        texto = antes.strip()
    if "·" in texto:
        pedacos = [p.strip() for p in texto.split("·") if p.strip()]
        curso = " · ".join(pedacos[:2])
    return assunto or texto, curso


def procurar_aulas(raiz: str) -> list:
    """Percorre a árvore e devolve as apresentações encontradas."""
    aulas = []
    for pasta, subpastas, arquivos in os.walk(raiz):
        subpastas[:] = sorted(
            d for d in subpastas if d not in PASTAS_IGNORADAS and not d.startswith(".")
        )
        for arquivo in sorted(arquivos):
            if not arquivo.lower().endswith(".html") or arquivo.lower() == "index.html":
                continue
            caminho = os.path.join(pasta, arquivo)
            try:
                conteudo = open(caminho, encoding="utf-8").read()
            except (OSError, UnicodeDecodeError):
                continue
            total = len(PADRAO_SLIDE.findall(conteudo))
            if total < 2:  # não é apresentação
                continue
            rel = os.path.relpath(caminho, raiz).replace(os.sep, "/")
            titulo_html = PADRAO_TITULO.search(conteudo)
            h1 = PADRAO_H1.search(conteudo)
            base = titulo_html.group(1) if titulo_html else (h1.group(1) if h1 else arquivo)
            assunto, curso = partes_do_titulo(base)
            pedacos = rel.split("/")
            aulas.append({
                "rel": rel,
                "area": titulo_amigavel(pedacos[0]) if len(pedacos) > 2 else "Geral",
                "disciplina": titulo_amigavel(pedacos[1]) if len(pedacos) > 2 else "Aulas",
                "pasta": pedacos[-2] if len(pedacos) > 1 else "",
                "arquivo": arquivo,
                "assunto": assunto,
                "curso": curso,
                "slides": total,
            })
    aulas.sort(key=lambda a: chave_ordem(a["rel"]))
    return aulas


def gerar_html(aulas: list, gerado_em: datetime | None = None) -> str:
    """Monta o HTML final do índice (sem `gerado_em`, o rodapé sai sem a data)."""
    grupos = {}
    for aula in aulas:
        grupos.setdefault((aula["area"], aula["disciplina"]), []).append(aula)

    blocos = []
    for (area, disciplina), itens in grupos.items():
        cartoes = []
        for aula in itens:
            curso = (
                '        <p class="sub">{}</p>\n'.format(html.escape(aula["curso"]))
                if aula["curso"] else ""
            )
            cartoes.append(
                '      <a class="card" href="{href}">\n'
                '        <span class="badge">{rotulo}</span>\n'
                "        <h3>{assunto}</h3>\n"
                "{curso}"
                '        <p class="info">{slides} slides · {arquivo}</p>\n'
                '        <span class="abrir">Abrir aula →</span>\n'
                "      </a>".format(
                    href=html.escape(aula["rel"]),
                    rotulo=html.escape(titulo_amigavel(aula["pasta"]) or "Aula"),
                    assunto=html.escape(aula["assunto"]),
                    curso=curso,
                    slides=aula["slides"],
                    arquivo=html.escape(aula["arquivo"]),
                )
            )
        titulo = "{} · {}".format(area, disciplina) if area != "Geral" else disciplina
        blocos.append(
            '  <section class="bloco">\n'
            "    <h2>{}</h2>\n".format(html.escape(titulo)) +
            '    <div class="grade">\n' + "\n".join(cartoes) + "\n    </div>\n"
            "  </section>"
        )

    if not blocos:
        blocos.append(
            '  <section class="bloco">\n'
            "    <h2>Nenhuma aula encontrada</h2>\n"
            "    <p>Crie uma pasta no formato <code>area/disciplina/aula-NN/</code> "
            "com o arquivo <code>aulaNN.html</code> e envie para o GitHub.</p>\n"
            "  </section>"
        )

    if gerado_em is not None:
        carimbo = "Página gerada automaticamente em {} por <code>scripts/gerar_index.py</code>.".format(
            gerado_em.strftime("%d/%m/%Y às %H:%M")
        )
    else:
        carimbo = "Página gerada automaticamente por <code>scripts/gerar_index.py</code>."

    rodape = (
        "  <p>" + carimbo + " Para publicar uma aula nova, crie a pasta "
        "<code>aula-NN/</code> e envie para o GitHub — o índice se atualiza sozinho.</p>\n"
    )

    return (
        "<!DOCTYPE html>\n"
        '<html lang="pt-BR">\n'
        "<head>\n"
        '<meta charset="UTF-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        '<meta name="color-scheme" content="light">\n'
        "<title>Slides das aulas · IFPI Campus Barras</title>\n"
        "<style>" + ESTILO + "</style>\n"
        "</head>\n"
        "<body>\n"
        '<header class="topo">\n'
        '  <div class="wrap">\n'
        '    <span class="rot">IFPI · Campus Barras</span>\n'
        "    <h1>Slides das aulas</h1>\n"
        '    <div class="linhas">\n'
        "      <p>Material pedagógico produzido por: <strong>Professor Diego Cordeiro de Oliveira</strong></p>\n"
        '      <p>Plataforma de estudos: <a href="https://professordiegocordeiro.com.br/"'
        ' target="_blank" rel="noopener">professordiegocordeiro.com.br</a></p>\n'
        "    </div>\n"
        "  </div>\n"
        "</header>\n"
        '<main class="wrap">\n'
        + INSTRUCOES
        + "\n".join(blocos) + "\n</main>\n"
        '<footer class="rodape wrap">\n' + rodape + "</footer>\n"
        "</body>\n"
        "</html>\n"
    )


def listar(aulas: list) -> None:
    """Imprime as aulas agrupadas por área/disciplina (não escreve arquivo)."""
    atual = None
    grupos = 0
    for aula in aulas:
        grupo = (aula["area"], aula["disciplina"])
        if grupo != atual:
            grupos += 1
            titulo = (
                "{} · {}".format(aula["area"], aula["disciplina"])
                if aula["area"] != "Geral" else aula["disciplina"]
            )
            print(titulo)
            atual = grupo
        print("  - {} — {} slides -> {}".format(
            titulo_amigavel(aula["pasta"]) or aula["arquivo"], aula["slides"], aula["rel"]
        ))
    if not aulas:
        print("Nenhuma aula encontrada. Crie a pasta <área>/<disciplina>/aula-NN/ com um .html que tenha slides.")
    else:
        print("\n{} aula(s) em {} grupo(s).".format(len(aulas), grupos))


def main() -> None:
    parser = argparse.ArgumentParser(description="Gera o index.html com a lista das aulas.")
    parser.add_argument("--raiz", default=".", help="pasta raiz do site (padrão: .)")
    parser.add_argument("--saida", default="index.html", help="arquivo de saída (padrão: index.html)")
    parser.add_argument("--listar", action="store_true",
                        help="apenas lista as aulas encontradas (não escreve o índice)")
    parser.add_argument("--sem-data", action="store_true",
                        help="gera o rodapé sem a data (saída estável para o git)")
    args = parser.parse_args()

    raiz = os.path.abspath(args.raiz)
    aulas = procurar_aulas(raiz)

    if args.listar:
        listar(aulas)
        return

    destino = os.path.abspath(args.saida)
    pasta_saida = os.path.dirname(destino)
    if pasta_saida:
        os.makedirs(pasta_saida, exist_ok=True)
    carimbo = None if args.sem_data else datetime.now()
    with open(destino, "w", encoding="utf-8") as arquivo:
        arquivo.write(gerar_html(aulas, carimbo))

    print("{} aula(s) encontrada(s):".format(len(aulas)))
    for aula in aulas:
        print("  - {} ({} slides) -> {}".format(aula["pasta"] or "aula", aula["slides"], aula["rel"]))
    print("index gerado em {} {}".format(
        os.path.relpath(destino, os.getcwd()), "(sem data)" if args.sem_data else ""
    ).rstrip())


if __name__ == "__main__":
    main()
