#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
SDK=/usr/lib/android-sdk/platforms/android-23/android.jar
rm -rf build && mkdir -p build/gen build/classes build/dex

aapt package -f -m -J build/gen -M AndroidManifest.xml -S res -I "$SDK" \
  -F build/unsigned.apk --min-sdk-version 22 --target-sdk-version 28

mkdir -p build/stubs
javac -source 8 -target 8 -nowarn -Xlint:-options -encoding UTF-8 \
  -bootclasspath "$SDK" -d build/stubs $(find stubs -name '*.java')
javac -source 8 -target 8 -nowarn -Xlint:-options -encoding UTF-8 \
  -bootclasspath "build/stubs:$SDK" -d build/classes \
  $(find src build/gen -name '*.java')

dalvik-exchange --dex --min-sdk-version=22 --output=build/dex/classes.dex build/classes
(cd build/dex && aapt add ../unsigned.apk classes.dex >/dev/null)

zipalign -f 4 build/unsigned.apk build/aligned.apk

[ -f lumen.keystore ] || keytool -genkeypair -keystore lumen.keystore -storepass lumen123 \
  -keypass lumen123 -alias lumen -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Lumen" >/dev/null 2>&1
apksigner sign --ks lumen.keystore --ks-pass pass:lumen123 --key-pass pass:lumen123 \
  --out build/DiegoCast.apk build/aligned.apk
apksigner verify --print-certs build/DiegoCast.apk | head -2
ls -la build/DiegoCast.apk
