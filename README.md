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
├── editor_slides/                         # editor visual de slides (local, não é publicado)
├── index.html                             # página inicial (gerada — não editar à mão)
├── meio_ambiente/
│   └── informatica_aplicada/
│       ├── aula-01/                       # aula01.html · aula01.css · aula01.js · imagens · apresentacao.json
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
| `make publicar` | `gerar` → `index` → `checar` → commit (só se houver mudança) → push **na branch atual** · `MSG="Aula 03"` personaliza a mensagem |
| `make acompanhar` | acompanha o deploy no GitHub Actions até terminar |
| `make site` | abre a URL publicada no navegador |
| `make status` | branch atual, pendências locais e último deploy |
| `make limpar` | remove `_site/`, `scripts/__pycache__/` e arquivos `.DS_Store` |
| `make editor` | abre o **editor de slides** em <http://127.0.0.1:8765> (`LLM=openai` troca o provedor de IA) |
| `make gerar` | gera as aulas a partir dos `apresentacao.json` (só as que estão no estado *editor*) |
| `make importar` | importa para o editor as aulas feitas à mão (cria o `apresentacao.json`, **não altera** o HTML) |
| `make verificar` | confere se cada aula importada ainda reproduz, byte a byte, o HTML publicado |

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

## Editor de slides

Editor visual que roda na sua máquina (Python 3 da biblioteca padrão — nada para instalar) e grava
as aulas no mesmo formato e nas mesmas pastas de sempre. O `make publicar` continua sendo o caminho
para o GitHub Pages; o editor só tem um botão que o chama.

```bash
make editor            # abre http://127.0.0.1:8765 no navegador (Ctrl+C encerra)
```

**Como funciona**

- Cada aula tem um `apresentacao.json` (a fonte) ao lado do HTML. O botão **Gerar** (ou `make gerar`)
  escreve `aulaNN.html`, `aulaNN.css`, `aulaNN.js` e `fonts/` — o que o índice e o Pages já conhecem.
- **Palco**: a prévia é o HTML real da aula (renderizado pelo mesmo código do gerador). Clique num texto
  para editar ali mesmo; clique num bloco para abrir suas propriedades; duplo clique numa imagem para trocá-la.
- **Slides**: arraste para reordenar, duplique, exclua, adicione pelos modelos (capa, 1–3 colunas,
  imagem + texto, tabela, indicadores, seção/encerramento, imagem inteira, HTML livre).
- **Blocos** (`editor_slides/componentes.json`): texto, lista, cartão, destaque, etiquetas, pergunta, tabela,
  indicadores, faixa de conclusão, figura, comparação, linhas numeradas, evolução, pergunta com resposta oculta,
  código, vídeo do YouTube, grade de sub-colunas e HTML livre — os mesmos elementos visuais do exemplo
  `editor_slides/exemplos/random-forest-original/`.
- **Temas** (`editor_slides/temas/`): `ppgcc`, `ifpi` e `neutro`, **sem logos**. Na aba *Tema* você troca o tema,
  ajusta cores/fontes/tamanhos (variáveis CSS), adiciona suas próprias logos (barra, capa, rodapé, marca d'água)
  e pode salvar o resultado como um tema novo.
- **Todos os campos de texto** dos slides e blocos (títulos, corpo, faixas, legendas, indicadores, itens de lista,
  roteiro…) têm um editor integrado (nos campos de uma linha, Enter quebra a linha):
  negrito, itálico, marca-texto, código, listas, **tamanho da fonte** (A− / A+, lista de 60% a 300% ou
  Ctrl+Shift+> / Ctrl+Shift+<, relativo ao tema), quebra de linha, link e limpar formatação, além do botão
  `</>` para ver/editar o HTML. Nas listas, cada item é um editor próprio: Enter cria o próximo item,
  Shift+Enter quebra a linha, ↑ ↓ reordenam. Colar sempre insere texto puro (sem estilos de outros sites).
  **Tabelas** são editadas numa grade: cada célula tem o editor; ↑ ↓ ← → movem linhas/colunas, ✕ exclui,
  "+ Linha" / "+ col" acrescentam e ⋯ define a cor da linha (destacada, base) ou da célula (bom, ruim, centralizada).
  O bloco **HTML livre** abre no código quando tem estrutura (tabelas, divs) e pode ser alternado para o modo visual.
  Os **slides em HTML livre** (aulas importadas) também têm o editor no painel, sincronizado com a edição direta no palco.
  O botão ⇔ nas abas amplia o painel lateral.
- **Imagens** enviadas pelo editor vão para `img/` da aula com nome em minúsculas e hífens (o `make checar` agradece).
- **Apresentar com passador ou tela de toque** (aulas geradas pelo editor, nas janelas de apresentação e do
  apresentador, que andam juntas):
  - avançar: PageDown, →, ↓, Espaço, Enter · voltar: PageUp, ←, ↑, Backspace, Shift+Espaço · Home/End: início/fim;
  - botão "iniciar" do passador (F5) ou F: tela cheia · botão "tela preta" (. ou B) / W: tela branca —
    qualquer tecla volta;
  - toque: arraste para a esquerda/direita, ou toque na faixa lateral (15% de cada lado);
    os botões de navegação ficam maiores em telas de toque.
- **Celular e tablet**: as aulas geradas se adaptam à tela. Em telas estreitas (até 820 px) o slide vira uma
  página que rola: colunas e cartões empilham, indicadores ficam 2 por linha, tabelas largas rolam para o lado
  (arrastar sobre a tabela não troca de slide), imagens mantêm a proporção e a barra superior mostra só o
  essencial (roteiro, cronômetro, modo apresentador, rodapé e "Exportar PDF" ficam ocultos). Com o celular
  deitado, as barras ficam mínimas. Grades criadas no "CSS extra" de uma aula também passam a quebrar quando
  não cabem. Na tela grande e no PDF nada muda.
- **Salvamento** automático, desfazer/refazer (Ctrl+Z / Ctrl+Shift+Z), Ctrl+S salva.
- **Publicar**: mostra a branch e os arquivos alterados, permite rodar o *checar* e então executa
  `make publicar` exibindo o log. Fora da `main` o push vai para a branch atual (o site só muda após o merge).

### Aulas antigas (importadas)

As seis aulas feitas à mão já foram importadas com `make importar`. Cada slide virou um bloco **HTML livre**
com o markup original intacto; o CSS e o JS de cada aula continuam os mesmos. Para não arriscar o que está no ar:

1. A aula importada fica no estado **importada**: o HTML publicado continua sendo a versão oficial e
   `make gerar`/`make publicar` não o reescrevem. Você já pode editar — tudo fica salvo no JSON.
2. `make verificar` confirma que o JSON reproduz o HTML publicado **byte a byte**.
3. Quando quiser que o editor passe a gerar aquela aula, clique em **Assumir esta aula pelo editor**.
   Só os slides que você mexeu mudam no HTML.

Nas aulas importadas a aba *Tema* lista as variáveis `:root` do CSS original; as mudanças entram num `<style>`
extra no HTML, sem tocar no `.css`. O relatório da importação está em `editor_slides/relatorio_importacao.md`.

### IA (LLM)

A aba **IA** usa o **DeepSeek** por padrão e aceita outros provedores configuráveis.

1. Copie `editor_slides/.env.exemplo` para `editor_slides/.env` e preencha `DEEPSEEK_API_KEY=...`
   (o `.env` está no `.gitignore` e o `make checar` bloqueia a publicação se uma chave escapar).
2. Rode `make editor` (ou `make editor LLM=openai` para outro provedor padrão).

Ações: gerar uma aula inteira a partir de tema/roteiro; criar um slide (nas aulas importadas, no mesmo estilo
HTML dos vizinhos); reescrever/resumir/deixar mais didático/corrigir o texto selecionado; escrever o roteiro de
fala; converter um slide HTML em blocos ou sugerir um layout melhor; texto alternativo de imagens.
Toda sugestão aparece numa prévia para **aceitar ou descartar**.

#### Importar uma aula em PDF

Na aba **IA → Importar aula de um PDF** você carrega uma aula que elaborou em PDF e o LLM a **adapta** ao
template da apresentação aberta (reorganiza, divide páginas densas, transforma texto em tópicos/cartões/tabelas
e leva os detalhes para o roteiro de fala). Passo a passo:

1. **Arquivo** — o texto e as imagens são extraídos no seu computador com o PyMuPDF
   (instale uma vez com `make instalar-pdf`). Logos repetidas e ícones pequenos são descartados.
2. **Revisar** — escolha as páginas (ex.: `1-5, 8`), as imagens a aproveitar, o nº aproximado de slides,
   onde inserir e se quer o roteiro de fala. Aparece uma estimativa de tokens.
   Páginas **sem texto** (escaneadas ou só imagem) viram slides de **imagem inteira**, sem passar pelo LLM.
3. **Conversão** — em lotes de até 8 páginas, com o sumário do documento para manter a coerência
   (dá para cancelar). O LLM só pode usar as imagens extraídas.
4. **Prévia** — navegue pelos slides gerados, desmarque o que não quiser e insira. Só as imagens usadas vão para
   `img/` da aula (`pdf-p03-1.png`…). Nas aulas importadas, os slides saem em HTML no mesmo estilo da aula.

O PDF fica em `editor_slides/.cache/pdf/` (fora do git) e é **apagado** ao terminar ou cancelar
(sobras com mais de 24 h também são removidas). O texto das páginas escolhidas é enviado ao provedor de IA.

Provedores e modelos ficam em `editor_slides/llm.config.json` (sem chaves):

| Provedor | Tipo | Modelos (rápido / forte) |
|---|---|---|
| `deepseek` (padrão) | compatível com OpenAI | `deepseek-flash` / `deepseek-v4-pro` |
| `openai` | compatível com OpenAI | configurável |
| `anthropic` | API da Anthropic | configurável |
| `ollama` | local, sem chave | configurável |

O campo `acoes` define qual nível de modelo cada ação usa (gerar aula = forte; reescrever = rápido…).
Qualquer outro serviço compatível com a API da OpenAI entra copiando um bloco e ajustando `base_url`,
`chave_env` e `modelos`. Os prompts estão em `editor_slides/llm/prompts/`.

### Estrutura do editor

```
editor_slides/
├── servidor.py          # servidor local (127.0.0.1): editor, projetos, prévia, upload, publicar, proxy do LLM
├── gerar_slides.py      # apresentacao.json → aula (make gerar / make verificar)
├── importar_aula.py     # aula feita à mão → apresentacao.json (make importar)
├── componentes.json     # catálogo de layouts e blocos (formulários, validação e formato do LLM)
├── motor/               # render.py (JSON → HTML/CSS) e validar.py
├── modelo/              # base.css, runtime.js (navegação, apresentador, roteiro, cronômetro, PDF) e fonte Inter
├── temas/               # ppgcc · ifpi · neutro (+ os que você salvar)
├── editor/              # interface web do editor
├── llm/                 # provedores.py, acoes.py, prompts/
├── llm.config.json      # provedores e modelos (sem chaves)
├── .env.exemplo         # modelo do .env com as chaves
└── exemplos/            # random-forest-original (exemplo base) e random-forest (o mesmo deck refeito em JSON)
```

A pasta `editor_slides/` e os `apresentacao.json` **não são publicados** no Pages (veja o workflow).

## Como a publicação funciona

`.github/workflows/publicar-pages.yml`, a cada push na `main`:

1. monta a pasta `_site/` copiando o repositório (sem `.git`, `.github`, `scripts`, `_site`, `editor_slides`,
   `apresentacao.json` e `.env`);
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
