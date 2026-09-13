#!/usr/bin/env python3
"""Valida as apresentações antes de publicar.

Para cada aula detectada (mesma regra usada pelo índice) confere:

  * referências locais de ``src``/``href`` que não existem;
  * grafia de maiúsculas/minúsculas diferente do arquivo real
    (o macOS não diferencia, mas o GitHub Pages roda em Linux e diferencia);
  * caminhos absolutos (começando com ``/``), que quebram em "project pages";
  * se o ``index.html`` cita todas as aulas encontradas.

Uso:
    python3 scripts/checar_referencias.py
    python3 scripts/checar_referencias.py --raiz .

Sai com código 1 quando encontra algum problema (assim o ``make publicar`` para).
"""
from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gerar_index import procurar_aulas  # noqa: E402  (fonte única da descoberta)

PADRAO_REF = re.compile(r'(?:src|href)="([^"]+)"')
IGNORAR = ("http://", "https://", "//", "mailto:", "data:", "#")


def grafia_exata(caminho: str) -> str:
    """Devolve o nome real do arquivo (com a grafia do disco) ou '' se não existir."""
    pasta, base = os.path.split(caminho)
    if not os.path.isdir(pasta):
        return ""
    for nome in os.listdir(pasta):
        if nome.lower() == base.lower():
            return nome
    return ""


def checar_aula(raiz: str, aula: dict) -> list:
    """Devolve a lista de problemas encontrados numa aula."""
    problemas = []
    caminho = os.path.join(raiz, aula["rel"])
    pasta = os.path.dirname(caminho)
    try:
        html = open(caminho, encoding="utf-8").read()
    except (OSError, UnicodeDecodeError) as erro:
        return ["{}: não foi possível ler ({})".format(aula["rel"], erro)]

    for ref in sorted(set(PADRAO_REF.findall(html))):
        if ref.startswith(IGNORAR) or ref == "":
            continue
        if ref.startswith("/"):
            problemas.append("{}: caminho absoluto '{}' (use caminho relativo)".format(aula["rel"], ref))
            continue

        limpo = ref.split("#")[0].split("?")[0]
        alvo = os.path.normpath(os.path.join(pasta, limpo))
        if not os.path.abspath(alvo).startswith(os.path.abspath(raiz)):
            problemas.append("{}: '{}' aponta para fora do site".format(aula["rel"], ref))
            continue
        if not os.path.exists(alvo):
            problemas.append("{}: arquivo não encontrado -> '{}'".format(aula["rel"], ref))
            continue
        if os.path.isdir(alvo):
            continue
        real = grafia_exata(alvo)
        if real and real != os.path.basename(alvo):
            problemas.append(
                "{}: '{}' está com maiúsculas/minúsculas diferentes do arquivo real ('{}')".format(
                    aula["rel"], ref, real
                )
            )
    return problemas


def checar_indice(raiz: str, aulas: list) -> list:
    """Confere se o index.html existe e cita todas as aulas."""
    indice = os.path.join(raiz, "index.html")
    if not os.path.exists(indice):
        return ["index.html não existe — rode: make index"]
    conteudo = open(indice, encoding="utf-8").read()
    problemas = []
    for aula in aulas:
        if aula["rel"] not in conteudo:
            problemas.append(
                "index.html: a aula '{}' não aparece no índice — rode: make index".format(aula["rel"])
            )
    return problemas


def main() -> None:
    parser = argparse.ArgumentParser(description="Valida as referências das apresentações.")
    parser.add_argument("--raiz", default=".", help="pasta raiz do site (padrão: .)")
    args = parser.parse_args()

    raiz = os.path.abspath(args.raiz)
    aulas = procurar_aulas(raiz)
    problemas = []

    for aula in aulas:
        problemas.extend(checar_aula(raiz, aula))
    problemas.extend(checar_indice(raiz, aulas))

    print("Aulas verificadas: {}".format(len(aulas)))
    for aula in aulas:
        print("  - {} ({} slides)".format(aula["rel"], aula["slides"]))

    if problemas:
        print("\nProblemas encontrados ({}):".format(len(problemas)))
        for item in problemas:
            print("  x " + item)
        sys.exit(1)

    print("\nTudo certo: nenhuma referência quebrada, maiúscula trocada ou caminho absoluto.")


if __name__ == "__main__":
    main()
