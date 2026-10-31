#!/bin/zsh
# Checks the test build on a phone plugged in over USB, the way docs/BRIDGE.md
# says a shell is checked: builds and installs the debug variant (it sits beside
# the real app as xyz.tiresia.moshe.debug), opens it on a library, and over the
# WebView's DevTools runs the bridge's conformance checks and the shell's own.
#
#   ./check.sh            # Moshe's own folder, seeded with the sample library
#   ./check.sh tree       # the folder picked in the test build's settings (pick it on the phone first)
#   ./check.sh voice      # writing by voice: sentences spoken by the Mac's `say` into a file, which the
#                         # app hears instead of the microphone, then reading aloud (docs/VOICE.md)
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

# Voice: the Mac's sentences (mac/selftest.sh), spoken by `say` at 16 kHz, with pauses between them
VOICE=build/selftest/voice.wav
if [[ $KIND == voice && ! -f $VOICE ]]; then
    command -v say >/dev/null || { echo "check.sh voice makes its sound with the Mac's say" >&2; exit 2; }
    mkdir -p ${VOICE:h}
    python3 - ${VOICE:h} <<'PY'
import subprocess, sys, wave
out, rate, frames = sys.argv[1], 16000, []
said = ["The storm came in from the west.", "New paragraph.", "It rained for three days.", "Select the storm.",
        "Make that bold.", "Scratch that.", "Go to sleep.", "This should not be typed.", "Wake up."]
frames.append(b"\0\0" * int(rate * 1.5))
for i, s in enumerate(said):
    subprocess.run(["say", "-o", f"{out}/v{i}.aiff", s], check=True)
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{rate}", "-c", "1", f"{out}/v{i}.aiff", f"{out}/v{i}.wav"], check=True)
    with wave.open(f"{out}/v{i}.wav") as f: frames.append(f.readframes(f.getnframes()))
    frames.append(b"\0\0" * int(rate * 2))
with wave.open(f"{out}/voice.wav", "wb") as f:
    f.setnchannels(1); f.setsampwidth(2); f.setframerate(rate); f.writeframes(b"".join(frames))
PY
    rm -f ${VOICE:h}/v[0-9]*.aiff ${VOICE:h}/v[0-9]*.wav
fi

./gradlew assembleDebug -q --console=plain
adb install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null
adb shell am force-stop $PKG
if [[ $KIND == app || $KIND == voice ]]; then
    # a fresh copy of the sample library in the app's own folder
    SAMPLE=$(mktemp -d)/library
    node ../tools/sample-library.mjs $SAMPLE >/dev/null
    adb shell rm -rf /data/local/tmp/moshe-sample
    adb push $SAMPLE /data/local/tmp/moshe-sample >/dev/null
    adb shell run-as $PKG sh -c "'rm -rf files/library && mkdir -p files && cp -R /data/local/tmp/moshe-sample files/library'"
    rm -rf ${SAMPLE:h}
    EXTRA=()
    if [[ $KIND == voice ]]; then
        adb push $VOICE /data/local/tmp/moshe-voice.wav >/dev/null
        adb shell run-as $PKG cp /data/local/tmp/moshe-voice.wav files/voice.wav
        adb shell rm /data/local/tmp/moshe-voice.wav
        adb shell pm grant $PKG android.permission.RECORD_AUDIO
        EXTRA=(--es moshe.voiceFile voice.wav)
    fi
    adb shell am start -n $PKG/xyz.tiresia.moshe.MainActivity --es moshe.kind app $EXTRA >/dev/null
else
    adb shell am start -n $PKG/xyz.tiresia.moshe.MainActivity >/dev/null
fi
# the WebView's DevTools socket is named after the app's process (others may be left from other apps)
for i in {1..40}; do
    PID=$(adb shell pidof $PKG | tr -d '\r' || true)
    [[ -n $PID ]] && adb shell cat /proc/net/unix | grep -a -q "webview_devtools_remote_$PID" && SOCK=webview_devtools_remote_$PID && break
    sleep 0.3
done
[[ -n ${SOCK:-} ]] || { echo "the test build's page didn't open" >&2; exit 1; }
adb forward tcp:9223 localabstract:$SOCK >/dev/null
$PY check.py http://localhost:9223 $KIND
