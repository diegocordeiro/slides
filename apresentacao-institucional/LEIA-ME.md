# Aula Inaugural — IFPI Campus Barras · Apresentação em HTML

Apresentação institucional (43 slides) para a **Aula Inaugural dos Cursos da Oferta Inicial do
Campus Barras**, feita em HTML/CSS/JS puro a partir da estrutura base das aulas
(`slides/meio_ambiente/informatica_aplicada/aula-02`) e com a identidade visual do template
institucional do IFPI (Poppins, fundo de mármore a 7%, verde `#359830`, vermelho `#C90C0F` e o
motivo de quadradinhos do logo).

## Como abrir e projetar

| Ação | Comando / tecla |
|---|---|
| Abrir no navegador | duplo clique em `institucional.html` |
| Servidor local (mais fiel, vídeos sem bloqueio) | `python3 -m http.server 8000` e acesse <http://localhost:8000/institucional.html> |
| Janela de apresentação | botão **Apresentação** (ou tecla <kbd>N</kbd>) — abre a janela dedicada e sincroniza com o controle |
| Tela cheia | **⛶** ou <kbd>F</kbd> |
| Avançar / voltar | <kbd>→</kbd> <kbd>←</kbd>, <kbd>PageDown</kbd>/<kbd>PageUp</kbd> ou <kbd>Espaço</kbd> |
| Primeiro / último slide | <kbd>Home</kbd> / <kbd>End</kbd> |
| Sumário (ir direto a um slide) | botão **☰ Sumário** ou tecla <kbd>S</kbd> |
| Tamanho do texto | **A−** / **A+** (de 80% a 180%) |
| Tema da tela | **◉ Projetor** (contraste alto, padrão) e **◐ Leitura** |
| Passagem automática | **▶** ou tecla <kbd>P</kbd> (4 s por slide) |
| Fotos ampliadas | clique em qualquer foto da galeria (lupa 🔍); <kbd>Esc</kbd> fecha |
| Vídeos | clique na capa do vídeo para carregar e reproduzir (YouTube) |

> **Projeção:** o conteúdo de cada slide se ajusta sozinho para ocupar a área branca
> (ver “Como as proporções se ajustam” abaixo), então a apresentação cabe sem rolagem em
> projetores 1920×1080 e 1600×900. Em telas muito baixas (1366×768) o texto fica um pouco
> menor — e, se você ampliar com **A+**, o slide passa a rolar internamente.
>
> **Internet:** os dois vídeos são do YouTube e precisam de conexão. Todas as imagens e as
> fontes Poppins são locais — o restante funciona offline.

## Como as proporções se ajustam (autofit)

- O conteúdo de cada slide é **centralizado** na área útil (entre o cabeçalho e a linha de
  fonte) e **cresce até ocupar ~90% da altura livre** — o mesmo slide fica grande em telas
  maiores e compacto em telas menores, sem sobras no rodapé.
- Quem faz isso é o `fitSlides`: ele mede cada slide e grava um fator na variável CSS `--aj`
  do próprio slide (entre 0,60 e 1,70). O zoom do usuário (**A− / A+**) continua valendo por
  cima, como um multiplicador.
- O recálculo acontece ao abrir, ao carregar as fontes, ao redimensionar a janela e ao
  alternar **◉ Projetor / ◐ Leitura**.
- Os slides com pouco conteúdo e texto já no tamanho máximo recebem a classe `folga`, que
  distribui o respiro entre os blocos em vez de deixar uma faixa branca embaixo.
- Grades de cartões usam colunas explícitas por slide (`style="--cols:N"`): 4 cartões → 2×2,
  6 → 3×2, 8 → 4×2, 5 → 3+2 (centralizado nas galerias). Para mudar a proporção de um slide,
  altere apenas o `--cols` dele no HTML.
- **Sem JavaScript** (ex.: impressão, PDF ou abrir o HTML com JS desativado): o layout usa os
  tamanhos-base do tema e continua legível, apenas sem o ajuste fino por slide.


## Vídeos incluídos

| Slide | Vídeo | Link |
|---|---|---|
| 4 | Vídeo Institucional IFPI | <https://www.youtube.com/watch?v=ym_3gvKCiV8> |
| 43 | Trailer do documentário “Ronny: uma vida” | <https://www.youtube.com/watch?v=hvosYFrpwOo> |

Ambos do canal oficial **IFPiauí Comunicação**. As capas (`img/video-*.jpg`) são as miniaturas
oficiais, usadas para que o player só carregue quando você clicar.

## Arquivos

```
institucional.html     os 45 slides (cada um marcado com <!-- SLIDE N -->)
institucional.css      identidade IFPI + componentes (KPIs, linha do tempo, galerias, sumário)
institucional.js       navegação, sumário, animações e ampliação de fotos
fonts/                 Poppins (woff2) — funciona sem internet
img/                   logos, mapas, gráficos, ícones e capas dos vídeos
img/fotos/             20 registros da mobilização (fotografias)
```

### Origem dos arquivos (não foram alterados)

| Fonte | O que foi extraído |
|---|---|
| `Aula inaugural - Campus Barras 3.pptx` | textos dos 24 slides; logos, textura de mármore, Decreto 1909, linha do tempo, mapa da Rede Federal, foto de estudantes, egressa, mapas do território e ícones |
| `Apresentação Campus-Barras-Relatorio.odp` | dados do diagnóstico participativo: números da mobilização, perfil dos respondentes, cursos mais votados, cenários de docentes e oferta inicial (PDI) |
| `Registros mobilizaação.docx` | narrativa das portarias e o acervo de fotografias da mobilização |

## Para editar

- **Texto/cursos:** abra `institucional.html` e procure o comentário `<!-- SLIDE N -->`.
- **Legendas das fotos:** cada registro é um `<figure>` com **apenas a foto e a legenda abaixo**
  (sem texto extra no quadro) — os 15 registros estão nos slides 32 a 34, 5 por slide, com a
  legenda “Registro 01” a “Registro 15”. Para ajustar, edite o texto do `figcaption`. Os quadros
  usam moldura retrato (2:3) com a **foto inteira** (`object-fit: contain`); clicar em uma foto
  abre a ampliação com a legenda.
- **Imagem em destaque:** os slides 5, 7, 10 e 19 usam `<div class="mid img-grande">` — a foto
  ocupa a altura máxima que cabe no slide (64vh, ~92% da área útil) e a moldura acompanha a
  proporção da imagem, sem faixas. Para tirar o destaque, basta remover a classe `img-grande`
  do `div.mid`; para ajustar o tamanho, mude o `height` (64vh / 52vh / 42vh) nas regras
  `.mid.img-grande` de `institucional.css`.
- **Tabelas centralizadas:** as tabelas do PDI (slides 40 e 41) usam `class="tb2 centro"` — a
  tabela encolhe para o conteúdo e centraliza no slide, com o texto das células centralizado.
  Sem a classe `centro`, a tabela volta a ocupar a largura toda.
- **Cores/tipografia:** o bloco `:root` e o bloco **IDENTIDADE IFPI NO TEMA PROJETOR** no topo e no
  fim de `institucional.css`.
- **Fontes citadas:** cada slide tem uma linha `.ref` no rodapé com a origem dos dados.

## Validação feita

- 43 slides, numeração sequencial e ids únicos; sem referências quebradas (imagens, CSS, JS e fontes).
- Chrome sem erros de JavaScript; sumário com 43 itens; galerias com 15 fotos e ampliação funcionando.
- Nenhuma imagem quebrada; Poppins carregada localmente; tema projetor com a paleta do IFPI.
- **Proporções medidas no navegador** (conteúdo ÷ área útil, com o conteúdo centralizado):

| Tela | Uso da área útil (antes → depois) | Centralização | Fontes |
|---|---|---|---|
| 1920×1080 | 83% → **90%** (86–97%, nada estoura) | desvio médio de 4 px entre sobra acima/abaixo | 23–39 px |
| 1600×900 | 83% → **90%** (81–99%) | 4 px | 17–31 px |
| 1366×768 | ~72% → **92%** (83–100%) | 4 px | 12–24 px |

- Antes, 41 dos 44 slides deixavam de 5% a 32% da altura em branco (média 119 px), sempre
  embaixo; agora a sobra média é de ~10% e fica dividida acima e abaixo do conteúdo.
- Imagens em destaque nos slides 5, 7, 10 e 19: **636 px de altura** (64vh, ~92% da área útil),
  com a moldura acompanhando a proporção de cada foto — 481×640 px (decreto), 830×636 (mapa),
  1121×636 (missão) e 480×640 (egressa).
- Tabelas do PDI centralizadas: 711 px (slide 40) e 643 px (slide 41) em uma área de 1520 px,
  com margens simétricas.


> Observação: as legendas das 20 fotografias foram escritas a partir da narrativa documentada do
> processo de mobilização (visitas institucionais, encontros preparatórios, audiência pública e
> consulta pública). Vale uma conferência rápida de cada uma com o acervo original.
