"""Adaptadores de provedores de LLM (apenas biblioteca padrão).

Tipos suportados:
  * ``openai_compat`` — qualquer API no formato /chat/completions (DeepSeek, OpenAI,
    Groq, OpenRouter, Ollama…). É o adaptador usado pelo DeepSeek, o padrão.
  * ``anthropic``     — API de mensagens da Anthropic.

As chaves vêm de variáveis de ambiente (carregadas do editor_slides/.env pelo
servidor). Nada aqui grava ou devolve a chave ao navegador.
"""
from __future__ import annotations

import json
import os
import ssl
import urllib.error
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
EDITOR = os.path.dirname(AQUI)
CONFIG = os.path.join(EDITOR, "llm.config.json")


class ErroLLM(Exception):
    pass


def carregar_env(caminhos=None) -> None:
    """Lê KEY=VALOR de arquivos .env sem sobrescrever variáveis já definidas."""
    for p in caminhos or [os.path.join(EDITOR, ".env"), os.path.join(os.path.dirname(EDITOR), ".env")]:
        if not os.path.isfile(p):
            continue
        for linha in open(p, encoding="utf-8"):
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            k, v = linha.split("=", 1)
            k = k.strip()
            if k.startswith("export "):
                k = k[7:].strip()
            v = v.strip().strip('"').strip("'")
            if k and v and k not in os.environ:
                os.environ[k] = v


def config() -> dict:
    with open(CONFIG, encoding="utf-8") as f:
        return json.load(f)


def chave(prov: dict) -> str | None:
    nome = prov.get("chave_env")
    return os.environ.get(nome) if nome else ""


def disponiveis(cfg: dict | None = None) -> list:
    cfg = cfg or config()
    res = []
    for nome, p in cfg["provedores"].items():
        k = chave(p)
        res.append({"nome": nome, "rotulo": p.get("rotulo", nome), "tipo": p["tipo"], "modelos": p.get("modelos", {}),
                    "imagens": bool(p.get("imagens")), "pronto": (not p.get("chave_env")) or bool(k),
                    "chave_env": p.get("chave_env")})
    return res


def _post(url: str, corpo: dict, cab: dict, tempo: int) -> dict:
    req = urllib.request.Request(url, data=json.dumps(corpo).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", **cab})
    try:
        with urllib.request.urlopen(req, timeout=tempo, context=ssl.create_default_context()) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        det = e.read().decode("utf-8", "replace")[:600]
        raise ErroLLM("HTTP %s do provedor: %s" % (e.code, det))
    except urllib.error.URLError as e:
        raise ErroLLM("Sem conexão com o provedor (%s)" % e.reason)
    except TimeoutError:
        raise ErroLLM("O provedor demorou demais para responder")


def chamar(prov_nome: str | None, modelo: str | None, sistema: str, usuario, json_mode: bool = True,
           imagens: list | None = None, cfg: dict | None = None) -> tuple:
    """Envia uma conversa de 1 turno. ``usuario`` é texto; ``imagens`` = [(mime, base64)].
    Devolve (texto, uso, provedor, modelo)."""
    cfg = cfg or config()
    prov_nome = prov_nome or cfg.get("padrao", "deepseek")
    p = cfg["provedores"].get(prov_nome)
    if not p:
        raise ErroLLM("Provedor desconhecido: %s" % prov_nome)
    k = chave(p)
    if p.get("chave_env") and not k:
        raise ErroLLM("Defina %s no arquivo editor_slides/.env para usar %s" % (p["chave_env"], p.get("rotulo", prov_nome)))
    modelo = modelo or p["modelos"].get("forte") or next(iter(p["modelos"].values()))
    tempo = int(cfg.get("tempo_limite_s", 180))
    temp = cfg.get("temperatura", 0.4)
    maxt = int(cfg.get("max_tokens", 8000))
    imagens = imagens if p.get("imagens") else None

    if p["tipo"] == "anthropic":
        conteudo = [{"type": "image", "source": {"type": "base64", "media_type": m, "data": b}} for m, b in (imagens or [])]
        conteudo.append({"type": "text", "text": usuario})
        r = _post(p.get("base_url", "https://api.anthropic.com").rstrip("/") + "/v1/messages",
                  {"model": modelo, "max_tokens": maxt, "temperature": temp, "system": sistema,
                   "messages": [{"role": "user", "content": conteudo}]},
                  {"x-api-key": k, "anthropic-version": "2023-06-01"}, tempo)
        texto = "".join(b.get("text", "") for b in r.get("content", []) if b.get("type") == "text")
        u = r.get("usage", {})
        uso = {"entrada": u.get("input_tokens", 0), "saida": u.get("output_tokens", 0)}
        return texto, uso, prov_nome, modelo

    # openai_compat
    if imagens:
        conteudo = [{"type": "text", "text": usuario}] + [
            {"type": "image_url", "image_url": {"url": "data:%s;base64,%s" % (m, b)}} for m, b in imagens]
    else:
        conteudo = usuario
    corpo = {"model": modelo, "temperature": temp, "max_tokens": maxt,
             "messages": [{"role": "system", "content": sistema}, {"role": "user", "content": conteudo}]}
    if json_mode and p.get("json_nativo"):
        corpo["response_format"] = {"type": "json_object"}
    cab = {"Authorization": "Bearer " + k} if k else {}
    r = _post(p["base_url"].rstrip("/") + "/chat/completions", corpo, cab, tempo)
    try:
        texto = r["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError):
        raise ErroLLM("Resposta inesperada do provedor: %s" % json.dumps(r)[:400])
    u = r.get("usage", {})
    uso = {"entrada": u.get("prompt_tokens", 0), "saida": u.get("completion_tokens", 0)}
    return texto, uso, prov_nome, modelo
