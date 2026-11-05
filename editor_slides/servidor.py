#!/usr/bin/env python3
"""Servidor local do editor de slides (somente biblioteca padrão).

    python3 editor_slides/servidor.py [--porta 8765] [--llm deepseek] [--sem-navegador]

Escuta apenas em 127.0.0.1. Serve o editor, lê/grava os apresentacao.json do
repositório, gera as aulas, faz upload de imagens, roda o ``make publicar`` e
repassa as chamadas ao LLM (a chave da API fica só aqui, nunca vai ao navegador).
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import traceback
import unicodedata
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
sys.path.insert(0, os.path.join(os.path.dirname(AQUI), "scripts"))

from motor import render, validar  # noqa: E402
from llm import provedores, acoes  # noqa: E402
from motor import pdf as mpdf  # noqa: E402
import importar_aula  # noqa: E402

RAIZ = render.RAIZ
EDITOR_WEB = os.path.join(AQUI, "editor")
IMG_EXT = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp")
LLM_PADRAO = {"provedor": None}
PREVIAS: dict = {}  # token → HTML da prévia (servido como <pasta da aula>/__previa__.html)
NOME_PREVIA = "__previa__.html"
TRAVA_PUBLICAR = threading.Lock()


class ErroUsuario(Exception):
    pass


# ------------------------------------------------------------------ util
def slug(t: str) -> str:
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-zA-Z0-9._-]+", "-", t).strip("-._").lower()
    return re.sub(r"-{2,}", "-", t)


def dentro_da_raiz(rel: str) -> str:
    alvo = os.path.realpath(os.path.join(RAIZ, rel or ""))
    if alvo != RAIZ and not alvo.startswith(RAIZ + os.sep):
        raise ErroUsuario("caminho fora do repositório")
    partes = os.path.relpath(alvo, RAIZ).split(os.sep)
    if any(p in (".git", ".env") or p.startswith(".env") for p in partes):
        raise ErroUsuario("caminho protegido")
    return alvo


def caminho_json(rel: str) -> str:
    p = dentro_da_raiz(rel)
    if os.path.basename(p) != "apresentacao.json":
        raise ErroUsuario("o projeto deve ser um apresentacao.json")
    return p


def rel(p: str) -> str:
    return os.path.relpath(p, RAIZ).replace(os.sep, "/")


def git(*args) -> str:
    try:
        return subprocess.run(["git", *args], cwd=RAIZ, capture_output=True, text=True, timeout=20).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def base_href(cj: str) -> str:
    return "/r/" + urllib.parse.quote(rel(os.path.dirname(cj))) + "/"


# ------------------------------------------------------------------ operações
def listar_projetos() -> dict:
    projetos = []
    for p in render.procurar_projetos(com_exemplos=True):
        try:
            d = render.ler_json(p)
        except (OSError, ValueError):
            continue
        r = rel(p)
        partes = r.split("/")
        grupo = "Exemplos" if r.startswith("editor_slides/") else " · ".join(x.replace("_", " ").title() for x in partes[:2])
        projetos.append({"caminho": r, "titulo": (d.get("meta") or {}).get("titulo") or r, "motor": d.get("motor", "editor"),
                         "estado": d.get("estado", "editor"), "slides": len(d.get("slides") or []), "grupo": grupo})
    com_json = {os.path.dirname(p["caminho"]) for p in projetos}
    from gerar_index import procurar_aulas
    importaveis = [{"rel": a["rel"], "assunto": a["assunto"], "slides": a["slides"]}
                   for a in procurar_aulas(RAIZ) if os.path.dirname(a["rel"]) not in com_json]
    return {"projetos": projetos, "importaveis": importaveis}


def novo_projeto(e: dict) -> str:
    area, disc, pasta = slug(e.get("area")), slug(e.get("disciplina")), slug(e.get("pasta"))
    if not (area and disc and pasta):
        raise ErroUsuario("informe área, disciplina e pasta (ex.: meio_ambiente / informatica_aplicada / aula-05)")
    area, disc = area.replace("-", "_"), disc.replace("-", "_")
    destino = os.path.join(RAIZ, area, disc, pasta)
    dentro_da_raiz(os.path.relpath(destino, RAIZ))
    if os.path.exists(os.path.join(destino, "apresentacao.json")):
        raise ErroUsuario("já existe uma apresentação nessa pasta")
    if os.path.isdir(destino) and any(f.endswith(".html") for f in os.listdir(destino)):
        raise ErroUsuario("a pasta já tem um HTML; use Importar")
    m = re.search(r"(\d+)", pasta)
    arquivo = slug(e.get("arquivo") or "") or ("aula%02d.html" % int(m.group(1)) if m else pasta + ".html")
    if not arquivo.endswith(".html"):
        arquivo += ".html"
    titulo = e.get("titulo") or "Nova aula"
    bruto = (e.get("disciplina") or "").strip()
    disc_nome = bruto if (" " in bruto or bruto != slug(bruto)) else disc.replace("_", " ").title()
    dados = {
        "versao": render.VERSAO_FORMATO, "motor": "editor", "estado": "editor",
        "meta": {"titulo": "%s · %s — %s" % (disc_nome, pasta.replace("-", " ").title(), titulo), "titulo_barra": disc_nome,
                 "arquivo": arquivo, "cronometro_min": 50, "rodape": "", "numerar": True, "mostrar_pdf": True, "lang": "pt-BR"},
        "tema": {"base": e.get("tema") or "ifpi", "vars": {}, "logos": {}},
        "css_extra": "",
        "slides": [
            {"layout": "capa", "rotulo": "%s · %s" % (disc_nome, pasta.replace("-", " ").title()), "titulo": titulo,
             "subtitulos": [e.get("autor") or "Prof. Diego Cordeiro de Oliveira"], "notas": ""},
            {"layout": "conteudo", "titulo": "Objetivos da aula", "proporcao": "1fr",
             "colunas": [[{"tipo": "lista", "itens": ["Primeiro objetivo", "Segundo objetivo", "Terceiro objetivo"]}]], "notas": ""},
            {"layout": "secao", "rotulo": "Encerramento", "titulo": "Dúvidas?", "texto": "<p>Obrigado!</p>", "notas": ""},
        ],
    }
    os.makedirs(os.path.join(destino, "img"), exist_ok=True)
    cj = os.path.join(destino, "apresentacao.json")
    render.gravar_json(cj, dados)
    return rel(cj)


def listar_imagens(cj: str) -> list:
    pasta = os.path.dirname(cj)
    res = []
    for raiz, subs, arqs in os.walk(pasta):
        subs[:] = [s for s in subs if not s.startswith(".") and s != "fonts"]
        for a in sorted(arqs):
            if a.lower().endswith(IMG_EXT):
                res.append(os.path.relpath(os.path.join(raiz, a), pasta).replace(os.sep, "/"))
    return sorted(res)


def upload(cj: str, nome: str, b64: str) -> str:
    nome = slug(nome) or "imagem.png"
    if not nome.lower().endswith(IMG_EXT):
        raise ErroUsuario("formato de imagem não suportado")
    bruto = base64.b64decode(b64.split(",", 1)[-1])
    if len(bruto) > 15 * 1024 * 1024:
        raise ErroUsuario("imagem maior que 15 MB")
    pasta = os.path.join(os.path.dirname(cj), "img")
    os.makedirs(pasta, exist_ok=True)
    base, ext = os.path.splitext(nome)
    alvo, k = os.path.join(pasta, nome), 2
    while os.path.exists(alvo) and open(alvo, "rb").read() != bruto:
        alvo = os.path.join(pasta, "%s-%d%s" % (base, k, ext))
        k += 1
    with open(alvo, "wb") as f:
        f.write(bruto)
    return "img/" + os.path.basename(alvo)


def vars_do_tema(cj: str, dados: dict) -> dict:
    """Variáveis de cor/fonte editáveis: do tema (motor editor) ou do :root do CSS da aula (legado)."""
    if dados.get("motor") == "legado":
        css = (dados.get("legado") or {}).get("css")
        p = os.path.join(os.path.dirname(cj), css or "")
        txt = open(p, encoding="utf-8").read() if css and os.path.isfile(p) else ""
        m = re.search(r":root\s*\{(.*?)\}", txt, re.S)
        base = dict(re.findall(r"(--[\w-]+)\s*:\s*([^;]+);", m.group(1))) if m else {}
        return {"origem": css, "vars": {k: v.strip() for k, v in base.items()}}
    t = render.carregar_tema((dados.get("tema") or {}).get("base"))
    return {"origem": t["nome"], "vars": t.get("vars", {})}


def salvar_tema(e: dict) -> str:
    nome = slug(e.get("nome")).replace("-", "_")
    if not nome:
        raise ErroUsuario("informe o nome do tema")
    base = render.carregar_tema(e.get("base"))
    v = dict(base.get("vars", {}))
    v.update(e.get("vars") or {})
    pasta = os.path.join(render.TEMAS, nome)
    os.makedirs(pasta, exist_ok=True)
    render.gravar_json(os.path.join(pasta, "tema.json"), {
        "nome": nome, "rotulo": e.get("rotulo") or nome, "descricao": e.get("descricao") or "Tema personalizado.",
        "vars": v, "logos": {"barra": None, "capa": None, "rodape": None, "marca": None}})
    return nome


def estado_git() -> dict:
    st = git("status", "--porcelain")
    return {"branch": git("branch", "--show-current"), "alteracoes": [l for l in st.splitlines() if l.strip()][:200],
            "remoto": git("remote", "get-url", "origin")}


def checar() -> dict:
    r = subprocess.run([sys.executable, os.path.join(RAIZ, "scripts", "checar_referencias.py")], cwd=RAIZ,
                       capture_output=True, text=True, timeout=120)
    return {"ok": r.returncode == 0, "saida": (r.stdout + r.stderr)[-6000:]}


# ------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "EditorSlides/1"

    def log_message(self, fmt, *args):  # silencioso, exceto erros
        if args and str(args[1])[:1] in "45":
            sys.stderr.write("%s %s\n" % (self.command, fmt % args))

    # --- respostas
    def _json(self, obj, status=200):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def _arquivo(self, p: str):
        if not os.path.isfile(p):
            return self.send_error(404, "não encontrado")
        tipo = mimetypes.guess_type(p)[0] or "application/octet-stream"
        if tipo.startswith("text/") or tipo in ("application/javascript", "application/json"):
            tipo += "; charset=utf-8"
        b = open(p, "rb").read()
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def _corpo(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n > 90 * 1024 * 1024:
            raise ErroUsuario("requisição grande demais")
        return json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}

    def _origem_ok(self) -> bool:
        o = self.headers.get("Origin")
        h = self.headers.get("Host", "")
        return not o or urllib.parse.urlparse(o).netloc == h

    # --- GET
    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        caminho = urllib.parse.unquote(u.path)
        try:
            if caminho in ("/", "/index.html"):
                return self._arquivo(os.path.join(EDITOR_WEB, "index.html"))
            if caminho.startswith("/editor/"):
                p = os.path.realpath(os.path.join(EDITOR_WEB, caminho[len("/editor/"):]))
                if not p.startswith(EDITOR_WEB + os.sep):
                    return self.send_error(403)
                return self._arquivo(p)
            if caminho.startswith("/r/"):
                if os.path.basename(caminho) == NOME_PREVIA:
                    html = PREVIAS.get(q.get("t", ""))
                    if html is None:
                        return self.send_error(404, "prévia expirada")
                    b = html.encode("utf-8")
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(b)))
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    return self.wfile.write(b)
                return self._arquivo(dentro_da_raiz(caminho[3:]))
            if caminho == "/api/estado":
                cfg = provedores.config()
                return self._json({"raiz": RAIZ, "git": estado_git(), "temas": render.listar_temas(),
                                   "catalogo": render.catalogo(),
                                   "llm": {"padrao": LLM_PADRAO["provedor"] or cfg.get("padrao"),
                                           "provedores": provedores.disponiveis(cfg), "acoes": cfg.get("acoes", {}),
                                           "uso": acoes.USO}})
            if caminho == "/api/projetos":
                return self._json(listar_projetos())
            if caminho == "/api/projeto":
                cj = caminho_json(q.get("c"))
                d = render.ler_json(cj)
                verif = render.verificar_legado(cj) if d.get("motor") == "legado" else (True, "")
                return self._json({"dados": d, "verificacao": {"ok": verif[0], "msg": verif[1]},
                                   "tema_vars": vars_do_tema(cj, d), "imagens": listar_imagens(cj)})
            if caminho == "/api/imagens":
                return self._json({"imagens": listar_imagens(caminho_json(q.get("c")))})
            if caminho == "/api/pdf/status":
                ok, msg = mpdf.disponivel()
                return self._json({"ok": ok, "msg": msg})
            if caminho == "/api/git":
                return self._json(estado_git())
            return self.send_error(404)
        except ErroUsuario as e:
            return self._json({"erro": str(e)}, 400)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            return self._json({"erro": "%s: %s" % (type(e).__name__, e)}, 500)

    # --- POST
    def do_POST(self):
        if not self._origem_ok():
            return self._json({"erro": "origem não permitida"}, 403)
        caminho = urllib.parse.urlparse(self.path).path
        try:
            e = self._corpo()
            if caminho == "/api/projeto":
                cj = caminho_json(e.get("c"))
                d = e.get("dados")
                if not isinstance(d, dict) or "slides" not in d:
                    raise ErroUsuario("dados inválidos")
                render.gravar_json(cj, d)
                return self._json({"ok": True})
            if caminho == "/api/previa":
                cj = caminho_json(e.get("c"))
                html = render.render_pagina(e["dados"], ed=True)
                token = "%x" % (abs(hash((html, len(PREVIAS)))) ^ int.from_bytes(os.urandom(4), "big"))
                PREVIAS[token] = html
                while len(PREVIAS) > 40:
                    PREVIAS.pop(next(iter(PREVIAS)))
                return self._json({"url": base_href(cj) + NOME_PREVIA + "?t=" + token})
            if caminho == "/api/gerar":
                cj = caminho_json(e.get("c"))
                if e.get("dados"):
                    render.gravar_json(cj, e["dados"])
                d = render.ler_json(cj)
                erros = validar.validar_dados(d) if d.get("motor") != "legado" else []
                if erros:
                    return self._json({"ok": False, "erros": erros})
                if d.get("motor") == "legado" and d.get("estado") != "editor":
                    return self._json({"ok": False, "erros": ["Aula importada: clique em 'Assumir esta aula pelo editor' antes de gerar."]})
                escritos = render.gerar(cj)
                return self._json({"ok": True, "escritos": [rel(x) for x in escritos],
                                   "html": rel(os.path.join(os.path.dirname(cj), render.nomes(d)[0]))})
            if caminho == "/api/novo":
                return self._json({"c": novo_projeto(e)})
            if caminho == "/api/importar":
                h = dentro_da_raiz(e.get("rel"))
                destino, dados, msg = importar_aula.importar(h, bool(e.get("forcar")))
                if dados is None:
                    raise ErroUsuario(msg)
                return self._json({"c": rel(destino), "msg": msg})
            if caminho == "/api/assumir":
                cj = caminho_json(e.get("c"))
                if e.get("dados"):
                    render.gravar_json(cj, e["dados"])
                d = render.ler_json(cj)
                ok, msg = render.verificar_legado(cj)
                editado = any(s.get("editado") or s.get("prefixo") is None for s in d.get("slides", []))
                if not ok and not e.get("confirmar"):
                    return self._json({"ok": False, "precisa_confirmar": True,
                                       "msg": "O JSON já tem alterações em relação ao publicado (%s). "
                                              "Ao assumir, o HTML será regerado com elas." % msg, "editado": editado})
                d["estado"] = "editor"
                render.gravar_json(cj, d)
                return self._json({"ok": True, "msg": msg})
            if caminho == "/api/upload":
                cj = caminho_json(e.get("c"))
                return self._json({"src": upload(cj, e.get("nome", ""), e.get("dados", ""))})
            if caminho == "/api/temas":
                return self._json({"nome": salvar_tema(e), "temas": render.listar_temas()})
            if caminho == "/api/checar":
                return self._json(checar())
            if caminho == "/api/publicar":
                return self._publicar(e)
            if caminho == "/api/pdf/enviar":
                ok, msg = mpdf.disponivel()
                if not ok:
                    raise ErroUsuario(msg)
                bruto = base64.b64decode((e.get("dados") or "").split(",", 1)[-1])
                if not bruto.startswith(b"%PDF"):
                    raise ErroUsuario("o arquivo não parece ser um PDF")
                if len(bruto) > 60 * 1024 * 1024:
                    raise ErroUsuario("PDF maior que 60 MB")
                try:
                    r = mpdf.extrair(bruto, os.path.basename(e.get("nome") or "aula.pdf"))
                except RuntimeError as ex:
                    raise ErroUsuario(str(ex))
                for p in r["paginas"]:  # a interface só precisa de um trecho do texto
                    p["caracteres"] = len(p["texto"])
                    p["texto"] = p["texto"][:400]
                r["url_cache"] = "/r/" + rel(mpdf.pasta(r["token"])) + "/"
                return self._json(r)
            if caminho == "/api/pdf/planejar":
                return self._json({"lotes": mpdf.planejar(mpdf.carregar(e.get("token")), e.get("paginas") or [])})
            if caminho == "/api/pdf/aplicar":
                cj = caminho_json(e.get("c"))
                mapa = mpdf.copiar_para_aula(e.get("token"), os.path.dirname(cj), e.get("arquivos") or [])
                mpdf.apagar(e.get("token"))
                return self._json({"mapa": mapa})
            if caminho == "/api/pdf/descartar":
                try:
                    mpdf.apagar(e.get("token"))
                except ValueError:
                    pass
                return self._json({"ok": True})
            if caminho == "/api/llm":
                return self._llm(e)
            return self.send_error(404)
        except ErroUsuario as ex:
            return self._json({"erro": str(ex)}, 400)
        except provedores.ErroLLM as ex:
            return self._json({"erro": str(ex)}, 502)
        except Exception as ex:  # noqa: BLE001
            traceback.print_exc()
            return self._json({"erro": "%s: %s" % (type(ex).__name__, ex)}, 500)

    def _llm(self, e: dict):
        acao = e.get("acao")
        fn = acoes.ACOES.get(acao)
        if not fn:
            raise ErroUsuario("ação de IA desconhecida")
        entrada = e.get("entrada") or {}
        if acao == "alt" and e.get("c") and entrada.get("src"):
            cj = caminho_json(e["c"])
            try:
                entrada["arquivo"] = dentro_da_raiz(os.path.relpath(os.path.join(os.path.dirname(cj), entrada["src"]), RAIZ))
            except ErroUsuario:
                pass
        prov = e.get("provedor") or LLM_PADRAO["provedor"]
        return self._json(fn(entrada, prov, e.get("modelo") or None))

    def _publicar(self, e: dict):
        msg = (e.get("msg") or "Atualiza slides (editor)").replace('"', "'")[:200]
        if not TRAVA_PUBLICAR.acquire(blocking=False):
            return self._json({"erro": "uma publicação já está em andamento"}, 409)
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.close_connection = True
            cmd = ["make", "publicar", "MSG=" + msg]
            self.wfile.write(("$ %s\n" % " ".join(cmd)).encode())
            self.wfile.flush()
            proc = subprocess.Popen(cmd, cwd=RAIZ, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            for linha in proc.stdout:
                self.wfile.write(linha.encode("utf-8"))
                self.wfile.flush()
            proc.wait()
            self.wfile.write(("\n[fim: código %d]\n" % proc.returncode).encode())
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            TRAVA_PUBLICAR.release()


def main() -> int:
    ap = argparse.ArgumentParser(description="Servidor local do editor de slides")
    ap.add_argument("--porta", type=int, default=int(os.environ.get("PORTA_EDITOR", 8765)))
    ap.add_argument("--llm", default=os.environ.get("LLM") or None, help="provedor de LLM (sobrescreve o padrão do llm.config.json)")
    ap.add_argument("--sem-navegador", action="store_true")
    a = ap.parse_args()
    provedores.carregar_env()
    mpdf.limpar_antigos()
    if a.llm:
        if a.llm not in provedores.config()["provedores"]:
            print("Provedor de LLM desconhecido: %s" % a.llm)
            return 2
        LLM_PADRAO["provedor"] = a.llm
    srv = ThreadingHTTPServer(("127.0.0.1", a.porta), Handler)
    url = "http://127.0.0.1:%d/" % a.porta
    prov = LLM_PADRAO["provedor"] or provedores.config().get("padrao")
    prontos = [p["nome"] for p in provedores.disponiveis() if p["pronto"]]
    print("Editor de slides em %s  (Ctrl+C encerra)" % url)
    print("Branch: %s · LLM padrão: %s%s" % (git("branch", "--show-current") or "?", prov,
                                              "" if prov in prontos else "  (sem chave — veja editor_slides/.env.exemplo)"))
    if not a.sem_navegador:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
