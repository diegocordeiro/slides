#!/bin/bash
# Cria o app "Diego Cast" (barra de menus) e instala em Aplicativos.  Uso: ./criar-app.sh
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/Diego Cast.app"
R="$APP/Contents/Resources"

ok()   { printf "\033[32m✔\033[0m %s\n" "$1"; }
info() { printf "\033[36m→\033[0m %s\n" "$1"; }
erro() { printf "\033[31m✘ %s\033[0m\n" "$1"; exit 1; }

xcrun --find swiftc >/dev/null 2>&1 || { xcode-select --install 2>/dev/null; erro "Instale as Ferramentas de Linha de Comando e rode de novo."; }

# Versão mínima explícita: sem isso o binário herda a versão do SDK (pode ser mais nova que o macOS)
TARGET="$(uname -m)-apple-macos13.0"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$R/.bin"

info "Compilando o app da barra de menus..."
xcrun swiftc -O -swift-version 5 -target "$TARGET" -parse-as-library -o "$APP/Contents/MacOS/DiegoCast" \
  "$DIR/mac-app/DiegoCastApp.swift" 2>"$DIR/.app-erros.txt" || { cat "$DIR/.app-erros.txt"; erro "Falha ao compilar o app"; }
ok "App compilado"

info "Compilando o capturador de tela..."
xcrun swiftc -O -swift-version 5 -target "$TARGET" -parse-as-library -import-objc-header "$DIR/vdisplay.h" \
    -o "$R/.bin/diegocap" "$DIR/diegocap.swift" 2>"$DIR/.app-erros.txt" \
  || xcrun swiftc -O -swift-version 5 -target "$TARGET" -parse-as-library -import-objc-header "$DIR/vdisplay.h" \
    -Xlinker -undefined -Xlinker dynamic_lookup -o "$R/.bin/diegocap" "$DIR/diegocap.swift" 2>>"$DIR/.app-erros.txt" \
  || { cat "$DIR/.app-erros.txt"; erro "Falha ao compilar o capturador"; }
ok "Capturador compilado"

cp "$DIR/projetar.sh" "$DIR/instalar-cast.sh" "$DIR/diegocap.swift" "$DIR/vdisplay.h" "$DIR/DiegoCast.apk" "$R/"
chmod +x "$R/projetar.sh" "$R/instalar-cast.sh"
touch "$R/.bin/diegocap"   # mais novo que o código: o projetar.sh não recompila
cp "$DIR/mac-app/Info.plist" "$APP/Contents/Info.plist"
iconutil -c icns "$DIR/mac-app/AppIcon.iconset" -o "$R/AppIcon.icns"
codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true
ok "Diego Cast.app criado"

# Instala em Aplicativos (ou ~/Applications se não tiver permissão)
DEST="/Applications"; [ -w "$DEST" ] || { DEST="$HOME/Applications"; mkdir -p "$DEST"; }
pkill -x DiegoCast 2>/dev/null || true
rm -rf "$DEST/Diego Cast.app"
ditto "$APP" "$DEST/Diego Cast.app"
ok "Instalado em $DEST"

# A assinatura local muda a cada compilação: a autorização antiga do macOS deixa de valer, mas
# continua aparecendo como ativada. Apaga para o macOS perguntar de novo na primeira projeção.
tccutil reset ScreenCapture dev.diego.cast.mac >/dev/null 2>&1
tccutil reset Accessibility dev.diego.cast.mac >/dev/null 2>&1
ok "Permissões antigas limpas: na primeira projeção, autorize Gravação de Tela e Acessibilidade de novo"
if ! open "$DEST/Diego Cast.app" 2>/dev/null; then
  printf "\033[33m!\033[0m O macOS não abriu o app. Diagnóstico:\n"
  vtool -show-build "$DEST/Diego Cast.app/Contents/MacOS/DiegoCast" 2>/dev/null | grep -E "minos|sdk"
  sw_vers -productVersion
  exit 1
fi
echo
echo "   Procure o ícone de TV na barra de menus (perto do relógio)."
echo "   Também dá para abrir pelo Spotlight: Cmd+Espaço → Diego Cast."
