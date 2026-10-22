#!/bin/zsh
# Checks the test build on a phone plugged in over USB, the way docs/BRIDGE.md
# says a shell is checked: builds and installs the debug variant (it sits beside
# the real app as xyz.tiresia.moshe.debug), opens it on a library, and over the
# WebView's DevTools runs the bridge's conformance checks and the shell's own.
#
#   ./check.sh            # Moshe's own folder, seeded with the sample library
#   ./check.sh tree       # the folder picked in the test build's settings (pick it on the phone first)
#
# Needs a Python with websockets: MOSHE_PYTHON=/path/to/python.
set -euo pipefail
cd "${0:A:h}"
KIND=${1:-app}
PKG=xyz.tiresia.moshe.debug
PY=${MOSHE_PYTHON:-python3}
export JAVA_HOME=${JAVA_HOME:-/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home}
export ANDROID_HOME=${ANDROID_HOME:-$HOME/android-sdk}
adb get-state >/dev/null 2>&1 || { echo "no phone: plug it in and allow USB debugging" >&2; exit 2; }

./gradlew assembleDebug -q --console=plain
adb install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null
adb shell am force-stop $PKG
if [[ $KIND == app ]]; then
    # a fresh copy of the sample library in the app's own folder
    SAMPLE=$(mktemp -d)/library
    node ../tools/sample-library.mjs $SAMPLE >/dev/null
    adb shell rm -rf /data/local/tmp/moshe-sample
    adb push $SAMPLE /data/local/tmp/moshe-sample >/dev/null
    adb shell run-as $PKG sh -c "'rm -rf files/library && mkdir -p files && cp -R /data/local/tmp/moshe-sample files/library'"
    rm -rf ${SAMPLE:h}
    adb shell am start -n $PKG/xyz.tiresia.moshe.MainActivity --es moshe.kind app >/dev/null
else
    adb shell am start -n $PKG/xyz.tiresia.moshe.MainActivity >/dev/null
fi
for i in {1..40}; do
    SOCK=$(adb shell cat /proc/net/unix | grep -a -o 'webview_devtools_remote_[0-9]*' | tail -1) && [[ -n $SOCK ]] && break
    sleep 0.3
done
adb forward tcp:9223 localabstract:$SOCK >/dev/null
$PY check.py http://localhost:9223 $KIND
