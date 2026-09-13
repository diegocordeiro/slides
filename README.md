# Slides das aulas — IFPI Campus Barras

Apresentações HTML das disciplinas do **Técnico em Meio Ambiente** (IFPI — Campus Barras),
publicadas automaticamente no **GitHub Pages**.

- Índice das aulas: <https://diegocordeiro.github.io/slides/>
- Aulas: `https://diegocordeiro.github.io/slides/<área>/<disciplina>/aula-NN/aulaNN.html`

## Estrutura do repositório

```
.
├── .github/workflows/publicar-pages.yml   # publica o site a cada push na main
├── scripts/gerar_index.py                 # gera o index.html varrendo as aulas
├── index.html                             # página inicial (gerada — não editar à mão)
├── meio_ambiente/
│   └── informatica_aplicada/
│       ├── aula-01/                       # aula01.html · aula01.css · aula01.js · imagens
│       └── aula-02/                       # aula02.html · aula02.css · aula02.js · img/
└── README.md
```

## Como criar uma aula nova

1. Crie a pasta seguindo a convenção: `<área>/<disciplina>/aula-NN/`
   (ex.: `meio_ambiente/informatica_aplicada/aula-03/`).
2. Dentro dela, coloque o arquivo `aulaNN.html` junto do CSS, do JS e das imagens
   (ex.: `aula03.html`, `aula03.css`, `aula03.js`, `img/…`).
   Use sempre **caminhos relativos** (`img/foto.jpg` — nunca `/img/foto.jpg`).
3. Pronto: não existe lista para editar. O `scripts/gerar_index.py` encontra qualquer
   `.html` que tenha slides (`<div class="sl…`) e atualiza o índice; o GitHub Actions
   republica o site a cada push na `main`.

> Dica: evite espaços e acentos nos nomes de pastas/arquivos; mantenha o padrão
> minúsculas-com-hífen. O GitHub Pages roda em Linux e diferencia maiúsculas de minúsculas.

## Testar localmente

```bash
# na raiz do repositório
python3 scripts/gerar_index.py        # atualiza o index.html
python3 -m http.server 8000           # abre http://localhost:8000
```

Os slides também podem ser abertos direto no navegador (duplo clique no `.html`), mas o
servidor local é mais fiel ao que é publicado.

## Automação com `make`

O `Makefile` da raiz automatiza todo o ciclo. **Nenhum alvo conhece nomes de aulas** — a
descoberta é feita pelo `scripts/gerar_index.py`, então pastas e **disciplinas novas entram
automaticamente** em todos os comandos.

| Comando | O que faz |
|---|---|
| `make` | mostra a ajuda com os alvos disponíveis |
| `make listar` | lista as aulas detectadas, agrupadas por área/disciplina |
| `make index` | regenera o `index.html` (rodapé sem data, para não criar diff à toa) |
| `make checar` | valida as referências de **todas** as aulas: arquivo faltando, maiúscula/minúscula diferente, caminho absoluto — e se o índice cita todas elas |
| `make servir` | gera o índice e serve em <http://localhost:8000> (`make servir PORTA=9000` muda a porta) |
| `make publicar` | `index` → `checar` → commit (só se houver mudança) → push · `MSG="Aula 03"` personaliza a mensagem |
| `make acompanhar` | acompanha o deploy no GitHub Actions até terminar |
| `make site` | abre a URL publicada no navegador |
| `make status` | branch atual, pendências locais e último deploy |
| `make limpar` | remove `_site/`, `scripts/__pycache__/` e arquivos `.DS_Store` |

### Receita: publicar uma aula nova

```bash
# 1. crie a pasta e o arquivo:
#    meio_ambiente/informatica_aplicada/aula-03/  (aula03.html, aula03.css, aula03.js, img/)

make listar      # confirma que a aula nova foi detectada
make servir      # opcional: pré-visualiza em http://localhost:8000
make checar      # valida imagens, CSS e JS antes de subir
make publicar    # gera o índice, commita e faz push
make acompanhar  # opcional: segue o deploy até o fim / make site abre o resultado
```

> `make index` grava o rodapé **sem data** de propósito: rodar duas vezes não gera diferença no
> git. No deploy, o GitHub Actions regenera o índice **com** a data de publicação — é a rede de
> segurança: mesmo esquecendo o `make index`, o site publicado fica correto.

## Como a publicação funciona

`.github/workflows/publicar-pages.yml`, a cada push na `main`:

1. monta a pasta `_site/` copiando o repositório (sem `.git`, `.github`, `scripts`, `_site`);
2. roda `scripts/gerar_index.py` para gerar o `index.html` atualizado;
3. publica o conteúdo no GitHub Pages (artefato + deploy oficiais do Pages).

**Configuração inicial (uma única vez):** no GitHub, abra
**Settings → Pages → Build and deployment → Source** e escolha **GitHub Actions**.

Para republicar sem alterar arquivos: aba **Actions → Publicar slides no GitHub Pages →
Run workflow**.

## Observações

- O Pages serve os arquivos com cache curto (cerca de 10 minutos). Se a página parecer
  desatualizada no navegador, use **Ctrl+Shift+R** (ou **Cmd+Shift+R**).
- Fontes, imagens e CSS são locais: o site funciona offline, exceto pelos vídeos do YouTube
  incorporados em algumas aulas.
- `index.html` é **gerado**; se editar à mão, a próxima publicação sobrescreve. Para mudar o
  visual do índice, edite o `ESTILO` dentro de `scripts/gerar_index.py`.
