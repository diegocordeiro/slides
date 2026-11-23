#!/bin/bash
# Instala o Diego Cast no Fire TV.   Uso: ./instalar-cast.sh [IP]
LIMPO=0; [ "$1" = "--limpo" ] && { LIMPO=1; shift; }
IP="${1:-$(cat "$HOME/.diegocast" 2>/dev/null || cat "$HOME/.lumencast" 2>/dev/null)}"; IP="${IP:-192.168.1.22}"
ALVO="$IP:5555"; PKG="dev.diego.cast"
DIR="$(cd "$(dirname "$0")" && pwd)"

ok()   { printf "\033[32m✔\033[0m %s\n" "$1"; }
erro() { printf "\033[31m✘ %s\033[0m\n" "$1"; exit 1; }

command -v adb >/dev/null 2>&1 || erro "adb não encontrado (brew install android-platform-tools)"
adb connect "$ALVO" >/dev/null 2>&1
for i in $(seq 1 15); do [ "$(adb -s "$ALVO" get-state 2>/dev/null)" = "device" ] && break; adb connect "$ALVO" >/dev/null 2>&1; sleep 2; done
[ "$(adb -s "$ALVO" get-state 2>/dev/null)" = "device" ] || erro "Não conectou ao Fire TV em $ALVO"
ok "Conectado ao Fire TV"
A="adb -s $ALVO"

# Remove a versão antiga com o nome "Lumen Cast", se existir
$A shell pm list packages | grep -q "dev.lumen.cast" && $A uninstall dev.lumen.cast >/dev/null 2>&1 && ok "Versão antiga (Lumen Cast) removida"

# Atualiza mantendo os dados do app (o código de pareamento continua o mesmo).
# Use "./instalar-cast.sh --limpo" para apagar tudo, inclusive o pareamento.
if [ "$LIMPO" = "1" ]; then $A uninstall $PKG >/dev/null 2>&1; fi
$A install -r -g "$DIR/DiegoCast.apk" | tail -1 | grep -q Success || erro "Falha ao instalar"
ok "Diego Cast instalado"

# Permissões e localização: exigidas pelo Android para criar a rede direta
$A shell pm grant $PKG android.permission.ACCESS_FINE_LOCATION >/dev/null 2>&1
$A shell pm grant $PKG android.permission.ACCESS_COARSE_LOCATION >/dev/null 2>&1
$A shell settings put secure location_mode 3 >/dev/null 2>&1
$A shell settings put secure location_providers_allowed +network >/dev/null 2>&1
$A shell cmd appops set $PKG RUN_IN_BACKGROUND allow >/dev/null 2>&1
$A shell cmd package compile -m speed -f $PKG >/dev/null 2>&1
ok "Permissões da rede direta concedidas"

$A shell am start -n $PKG/.CastActivity >/dev/null 2>&1
echo "$IP" > "$HOME/.diegocast"
ok "Pronto! O Diego Cast está aberto na TV."
echo "   Primeira vez? Pareie: na TV escolha \"Parear um Mac\" e no Mac rode ./projetar.sh --parear"
