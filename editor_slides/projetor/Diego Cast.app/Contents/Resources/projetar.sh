#!/bin/bash
# Diego Cast – projeta a tela do Mac no Fire TV.
#
#   ./projetar.sh                          acha o Fire TV na rede sozinho
#   ./projetar.sh 192.168.1.22             usa este IP
#   ./projetar.sh --rede "NOME" "SENHA"    conecta o Mac a uma rede (ex.: hotspot do celular) e projeta
#   ./projetar.sh --help                   mostra todas as opções
#   ./projetar.sh --teste                  grava 4s da tela num vídeo para conferir a captura
#
# Opções:
#   --tela 2                      usa a TV como monitor estendido (cria uma tela virtual
#                                 se o Mac não tiver um segundo monitor ligado)
#   --qualidade normal|alta|slides|leve  (padrão: normal = 1080p 60fps)
#   --sem-controle                não usa o controle do Fire TV para passar slides
#
# Ctrl+C encerra.

VPORT=7000; CPORT=7002
CONF="$HOME/.diegocast"; [ -f "$CONF" ] || { [ -f "$HOME/.lumencast" ] && cp "$HOME/.lumencast" "$CONF"; }
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/diegocap.swift"; BIN="$DIR/.bin/diegocap"
TELA=1; QUAL=normal; CONTROLE=1; IP=""; SSID=""; SENHA=""; TESTE=0

ok()   { printf "\033[32m✔\033[0m %s\n" "$1"; }
info() { printf "\033[36m→\033[0m %s\n" "$1"; }
aviso(){ printf "\033[33m!\033[0m %s\n" "$1"; }
erro() { printf "\033[31m✘ %s\033[0m\n" "$1"; limpar; exit 1; }

mostrar_ajuda() {
  cat <<'AJUDA'

  Diego Cast · projeta a tela do Mac no Fire TV

  USO
    ./projetar.sh [IP] [opções]

  ONDE PROJETAR
    (sem nada)              acha o Fire TV na rede sozinho (abre o app na TV pelo ADB)
    192.168.1.22            usa este IP direto
    --rede "NOME" "SENHA"   conecta o Mac a uma rede Wi‑Fi antes (ex.: hotspot do celular
                            com dados desligados, para projetar sem internet) e acha a TV nela.
                            Ao sair (Ctrl+C), o Mac volta para a rede de sempre.

  O QUE PROJETAR
    --tela 1                espelha a tela do Mac (padrão)
    --tela 2                TV como MONITOR ESTENDIDO: cria a tela virtual "Diego Cast (TV)".
                            Keynote: Ajustes → Apresentação → monitor "Diego Cast (TV)"
                            PowerPoint: Apresentação de Slides → Modo do Apresentador

  QUALIDADE  (--qualidade ...)
    normal                  1080p · até 60 fps · 9 Mbit/s   (padrão, fluido)
    alta                    1080p · até 60 fps · 14 Mbit/s  (Wi‑Fi 5 GHz bom)
    slides                  1080p · até 30 fps · 6 Mbit/s   (texto nítido, economiza rede)
    leve                    720p  · até 30 fps · 4 Mbit/s   (Wi‑Fi fraco / hotspot do celular)

  OUTRAS
    --sem-controle          não usa o controle do Fire TV para passar slides
    --teste                 grava 4s da tela e abre o vídeo (confere a captura, sem a TV)
    -h, --help, ajuda       mostra esta ajuda

  CONTROLE DO FIRE TV DURANTE A PROJEÇÃO
    ▶ / OK / ⏩              próximo slide          ◀ / ⏪      slide anterior
    ▲ ▼                     setas cima/baixo       ⏯          espaço (play/pausa)
    ☰                       mostra/esconde a tela de informações
    Voltar                  sai do app na TV

  EXEMPLOS
    ./projetar.sh
    ./projetar.sh --tela 2 --qualidade slides
    ./projetar.sh --rede "iPhone do Diego" "minhasenha" --qualidade leve
    ./projetar.sh 192.168.1.22 --sem-controle

  OUTROS COMANDOS
    ./instalar-cast.sh [IP]   instala/atualiza o app Diego Cast na TV

  PRIMEIRA VEZ NO MAC
    Ajustes do Sistema → Privacidade e Segurança: libere o seu terminal em
    "Gravação de Tela" (captura) e "Acessibilidade" (passar slides pelo controle).

AJUDA
}

while [ $# -gt 0 ]; do
  case "$1" in
    --rede) SSID="$2"; SENHA="$3"; shift 3 ;;
    --tela) TELA="$2"; shift 2 ;;
    --qualidade) QUAL="$2"; shift 2 ;;
    --sem-controle) CONTROLE=0; shift ;;
    --teste) TESTE=1; shift ;;
    -h|--help|ajuda|help) mostrar_ajuda; exit 0 ;;
    --*) printf "\033[31m✘ Opção desconhecida: %s\033[0m\n" "$1"; mostrar_ajuda; exit 1 ;;
    *) IP="$1"; shift ;;
  esac
done

case "$QUAL" in
  alta)  W=1920; H=1080; FPS=60; BR=14000000 ;;   # 60 fps, nitidez máxima (Wi‑Fi 5 GHz)
  leve)  W=1280; H=720;  FPS=30; BR=4000000  ;;   # Wi‑Fi fraco ou hotspot do celular
  slides) W=1920; H=1080; FPS=30; BR=6000000 ;;   # texto nítido, economiza rede
  *)     W=1920; H=1080; FPS=60; BR=9000000  ;;   # padrão: 60 fps, fluido
esac

PY=""
python3 -c 1 >/dev/null 2>&1 && PY=python3
WIFI=$(networksetup -listallhardwareports 2>/dev/null | awk '/Wi-Fi|AirPort/{getline; print $2; exit}')
CTRL_PID=""; CAF_PID=""; CAP_PID=""; PAROU=0; NA_REDE_DIRETA=0

limpar() {
  [ -n "$CAP_PID" ] && kill "$CAP_PID" 2>/dev/null
  [ -n "$CTRL_PID" ] && kill "$CTRL_PID" 2>/dev/null
  [ -n "$CAF_PID" ] && kill "$CAF_PID" 2>/dev/null
  if [ "$NA_REDE_DIRETA" = "1" ] && [ -n "$WIFI" ]; then
    info "Voltando para a sua rede Wi‑Fi de sempre..."
    networksetup -removepreferredwirelessnetwork "$WIFI" "$SSID" >/dev/null 2>&1
    networksetup -setairportpower "$WIFI" off; sleep 1; networksetup -setairportpower "$WIFI" on
  fi
}
trap 'PAROU=1; echo; limpar; ok "Projeção encerrada."; exit 0' INT TERM

# ---------------------------------------------------------------- capturador (ScreenCaptureKit)
if [ ! -x "$BIN" ] || [ "$SRC" -nt "$BIN" ] || [ "$DIR/vdisplay.h" -nt "$BIN" ]; then
  if ! xcrun --find swiftc >/dev/null 2>&1; then
    aviso "Preciso das Ferramentas de Linha de Comando da Apple (só uma vez)."
    xcode-select --install 2>/dev/null
    erro "Conclua a instalação que abriu na tela e rode ./projetar.sh de novo."
  fi
  info "Compilando o capturador de tela (só na primeira vez, ~30s)..."
  mkdir -p "$DIR/.bin"
  HDR="$DIR/vdisplay.h"
  xcrun swiftc -O -swift-version 5 -parse-as-library -import-objc-header "$HDR" -o "$BIN" "$SRC" \
      2>"$DIR/.diegocap-erros.txt" \
    || xcrun swiftc -O -swift-version 5 -parse-as-library -import-objc-header "$HDR" \
      -Xlinker -undefined -Xlinker dynamic_lookup -o "$BIN" "$SRC" 2>>"$DIR/.diegocap-erros.txt" \
    || { cat "$DIR/.diegocap-erros.txt"; erro "Falha ao compilar o capturador (mande o erro acima)"; }
  ok "Capturador pronto"
fi

capturar() {  # argumentos extras vão para o diegocap
  "$BIN" --display "$TELA" --width "$W" --height "$H" --fps "$FPS" --bitrate "$BR" "$@" &
  CAP_PID=$!
  wait $CAP_PID
  local rc=$?
  CAP_PID=""
  return $rc
}

permissao() {
  echo
  aviso "O macOS bloqueou a Gravação de Tela."
  echo "   Ajustes do Sistema → Privacidade e Segurança → Gravação de Tela e Áudio do Sistema:"
  echo "   ative o seu app de terminal, feche-o com Cmd+Q, abra de novo e rode o comando outra vez."
  open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" 2>/dev/null
}

# ---------------------------------------------------------------- modo teste (não precisa da TV)
if [ "$TESTE" = "1" ]; then
  info "Gravando 4s da tela $TELA..."
  capturar --out /tmp/diegocast-teste.h264 --seconds 4 --verbose
  RC=$?
  echo
  [ "$RC" = "3" ] && { permissao; exit 1; }
  [ "$RC" = "4" ] && erro "Essa tela não existe (veja quantas há com: $BIN --list)"
  [ "$RC" = "0" ] || erro "A captura falhou (código $RC). Mande as linhas que começam com · acima."
  if command -v ffmpeg >/dev/null 2>&1; then
    ffmpeg -loglevel error -y -f h264 -i /tmp/diegocast-teste.h264 -c copy /tmp/diegocast-teste.mp4 \
      && { ok "Captura funcionando. Abrindo o vídeo gravado..."; open /tmp/diegocast-teste.mp4; }
  else
    ok "Captura funcionando ($(du -h /tmp/diegocast-teste.h264 | cut -f1) gravados)"
  fi
  exit 0
fi

# ---------------------------------------------------------------- rede direta
if [ -n "$SSID" ]; then
  [ -n "$WIFI" ] || erro "Não achei a placa Wi‑Fi do Mac"
  info "Conectando o Mac à rede \"$SSID\"..."
  networksetup -setairportpower "$WIFI" on
  SAIDA=$(networksetup -setairportnetwork "$WIFI" "$SSID" "$SENHA" 2>&1)
  [ -n "$SAIDA" ] && aviso "$SAIDA"
  NA_REDE_DIRETA=1
  for i in $(seq 1 25); do
    MEU_IP=$(ipconfig getifaddr "$WIFI" 2>/dev/null)
    GW=$(ipconfig getoption "$WIFI" router 2>/dev/null)
    [ -n "$MEU_IP" ] && [ -n "$GW" ] && break
    sleep 1
  done
  [ -n "$MEU_IP" ] || erro "Não consegui entrar na rede \"$SSID\". Confira nome e senha."
  ok "Mac conectado à rede \"$SSID\" ($MEU_IP). O Fire TV precisa estar nesta mesma rede."
fi

# ---------------------------------------------------------------- achar o Fire TV
descobrir() {
  [ -n "$PY" ] || return
  $PY - "$1" <<'EOF'
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try: s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
except Exception: pass
s.bind(("", 7001)); s.settimeout(float(sys.argv[1]))
try:
    d, a = s.recvfrom(512)
    p = d.decode("utf-8", "ignore").split("|")
    if p[0] in ("DIEGOCAST", "LUMENCAST"): print(a[0] + "|" + p[1])
except Exception: pass
EOF
}

abrir_app_via_adb() {
  command -v adb >/dev/null 2>&1 || return
  perl -e 'alarm 5; exec @ARGV' adb connect "$1:5555" >/dev/null 2>&1
  perl -e 'alarm 5; exec @ARGV' adb -s "$1:5555" shell am start -n dev.diego.cast/.CastActivity >/dev/null 2>&1
}

SALVO=""; [ -f "$CONF" ] && SALVO=$(cat "$CONF")
if [ -z "$IP" ]; then
  [ -n "$SALVO" ] && [ -z "$SSID" ] && { info "Abrindo o Diego Cast na TV..."; abrir_app_via_adb "$SALVO"; }
  info "Procurando o Fire TV na rede..."
  R=$(descobrir 5)
  if [ -n "$R" ]; then
    IP="${R%%|*}"; ok "Encontrado: ${R#*|} ($IP)"
  elif [ -n "$SALVO" ]; then
    IP="$SALVO"; aviso "Não respondeu ao anúncio; tentando o último IP usado ($IP)"
  else
    erro "Não encontrei o Fire TV. Abra o Diego Cast na TV e rode: ./projetar.sh IP_DA_TV"
  fi
else
  abrir_app_via_adb "$IP"
fi
echo "$IP" > "$CONF"

info "Verificando se o Diego Cast está aberto na TV..."
for i in $(seq 1 10); do nc -z -G 2 "$IP" $VPORT >/dev/null 2>&1 && break; sleep 1; done
nc -z -G 2 "$IP" $VPORT >/dev/null 2>&1 || erro "O Fire TV ($IP) não respondeu. Abra o app Diego Cast na TV."
ok "Fire TV pronto"

# ---------------------------------------------------------------- controle remoto → slides
if [ "$CONTROLE" = "1" ] && [ -n "$PY" ]; then
  $PY - "$IP" "$CPORT" <<'EOF' &
import socket, subprocess, sys, time
ip, port = sys.argv[1], int(sys.argv[2])
# R/L = setas (Keynote, PowerPoint, Google Slides, PDF); U/D = cima/baixo; PLAY = espaço
CODES = {"R": 124, "L": 123, "U": 126, "D": 125, "PLAY": 49}
while True:
    try:
        s = socket.create_connection((ip, port), timeout=5); s.settimeout(None)
        for line in s.makefile("r"):
            c = CODES.get(line.strip())
            if c is not None:
                subprocess.run(["osascript", "-e",
                    'tell application "System Events" to key code %d' % c],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        time.sleep(1)
EOF
  CTRL_PID=$!
  ok "Controle do Fire TV ligado: ◀ ▶ e OK passam os slides"
fi

caffeinate -dimsu -w $$ >/dev/null 2>&1 &
CAF_PID=$!

# ---------------------------------------------------------------- transmissão
echo
ok "Projetando a tela $TELA em $IP  (qualidade: $QUAL · ${W}x${H} · até ${FPS} fps)"
echo "   Ctrl+C para parar."
echo
while [ "$PAROU" = "0" ]; do
  capturar --host "$IP" --port "$VPORT"
  RC=$?
  [ "$PAROU" = "1" ] && break
  case "$RC" in
    3) permissao; limpar; exit 1 ;;
    4) erro "Não foi possível usar a tela $TELA" ;;
  esac
  echo
  aviso "Conexão caiu (a TV saiu do app?). Tentando de novo em 2s..."
  sleep 2
done
