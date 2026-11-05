#!/usr/bin/env bash
# Gera o PDF da apresentação (9 páginas 16:9) sem abrir diálogo de impressão.
# Uso: ./exportar_pdf.sh [arquivo_de_saida.pdf]
set -euo pipefail
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SAIDA="${1:-Random_Forest_apresentacao.pdf}"

if [ ! -x "$CHROME" ]; then
  echo "Chrome não encontrado em: $CHROME" >&2
  echo "Ajuste a variável CHROME no script ou use o botão 'Exportar PDF' no próprio slide." >&2
  exit 1
fi

"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=6000 --print-to-pdf="$SAIDA" \
  "file://$(pwd)/index.html?pdf=1"

case "$SAIDA" in
  /*) echo "PDF gerado: $SAIDA" ;;
  *)  echo "PDF gerado: $(pwd)/$SAIDA" ;;
esac
