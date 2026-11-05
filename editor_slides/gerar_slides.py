#!/usr/bin/env python3
"""Gera as aulas a partir dos apresentacao.json.

Uso:
    python3 editor_slides/gerar_slides.py --todas            # todas as aulas no estado "editor"
    python3 editor_slides/gerar_slides.py caminho/apresentacao.json [...]
    python3 editor_slides/gerar_slides.py --verificar        # aulas importadas: o JSON reproduz o publicado?
    python3 editor_slides/gerar_slides.py --exemplos         # inclui editor_slides/exemplos

Aulas importadas (estado "importada") NUNCA são regeneradas por --todas: o
HTML publicado continua sendo a versão oficial até você clicar em
"Assumir esta aula pelo editor".
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from motor import render  # noqa: E402


def rel(p: str) -> str:
    return os.path.relpath(p, render.RAIZ)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("arquivos", nargs="*")
    ap.add_argument("--todas", action="store_true")
    ap.add_argument("--exemplos", action="store_true")
    ap.add_argument("--verificar", action="store_true")
    a = ap.parse_args()

    alvos = [os.path.abspath(x) for x in a.arquivos]
    if a.todas or a.verificar or not alvos:
        alvos = render.procurar_projetos(com_exemplos=a.exemplos)

    if a.verificar:
        ruins = 0
        for p in alvos:
            d = render.ler_json(p)
            if d.get("motor") != "legado":
                continue
            ok, msg = render.verificar_legado(p)
            ruins += 0 if ok else 1
            print(("OK   " if ok else "ERRO ") + rel(p) + " — " + msg)
        return 1 if ruins else 0

    total = 0
    for p in alvos:
        d = render.ler_json(p)
        if d.get("motor") == "legado" and d.get("estado") != "editor":
            print("pula " + rel(p) + " (importada; o HTML publicado continua oficial)")
            continue
        escritos = render.gerar(p)
        total += len(escritos)
        print("gera " + rel(p) + (" → " + ", ".join(os.path.basename(x) for x in escritos) if escritos else " (sem mudanças)"))
    print("%d arquivo(s) atualizado(s)." % total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
