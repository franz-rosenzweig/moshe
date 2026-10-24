#!/bin/zsh
# Builds Moshe.app with the Command Line Tools alone, no Xcode needed:
#   (cd ../frontend && npm ci && npm run build) && ./build.sh && open build/Moshe.app
# The settings and Info.plist keys come from project.yml, the same spec the Xcode
# project is generated from, so the two builds cannot drift apart.
set -euo pipefail
cd "${0:A:h}"

command -v swiftc >/dev/null || { echo "no swiftc: run xcode-select --install" >&2; exit 1; }
command -v xcodegen >/dev/null || { echo "no xcodegen: run brew install xcodegen" >&2; exit 1; }

setting() { sed -n "s/^ *$1: *\"*\([^\"]*\)\"*$/\1/p" project.yml | head -1; }
BUNDLE_ID=${MOSHE_BUNDLE_ID:-$(setting PRODUCT_BUNDLE_IDENTIFIER)}   # selftest.sh runs as another app
VERSION=$(setting MARKETING_VERSION)
BUILD=$(setting CURRENT_PROJECT_VERSION)
MACOS=$(setting macOS)

# The server Use the Server offers before an address is typed: none, unless
# this build is given one, in MOSHE_DEFAULT_SERVER or in local.env beside this
# script (MOSHE_DEFAULT_SERVER=https://…), which git leaves out.
[[ -z ${MOSHE_DEFAULT_SERVER:-} && -f local.env ]] && source ./local.env
DEFAULT_SERVER=${MOSHE_DEFAULT_SERVER:-}

OUT=${MOSHE_OUT:-build}                # selftest.sh builds its variant into build/selftest
APP=$OUT/Moshe.app

xcodegen generate --quiet               # writes Moshe/Info.plist, the entitlements and the Xcode project
rm -rf $APP && mkdir -p $APP/Contents/MacOS $APP/Contents/Resources
swiftc -O -wmo -sdk "$(xcrun --show-sdk-path)" -target "$(uname -m)-apple-macos$MACOS" -swift-version 5 \
    -parse-as-library -module-name Moshe Moshe/*.swift ${=MOSHE_EXTRA:-} \
    -o $APP/Contents/MacOS/Moshe
sed -e "s/\$(DEVELOPMENT_LANGUAGE)/en/" -e "s/\$(EXECUTABLE_NAME)/Moshe/" \
    -e "s/\$(PRODUCT_BUNDLE_IDENTIFIER)/$BUNDLE_ID/" -e "s/\$(MARKETING_VERSION)/$VERSION/" \
    -e "s/\$(CURRENT_PROJECT_VERSION)/$BUILD/" -e "s/\$(PRODUCT_NAME)/Moshe/" \
    -e "s#\$(MOSHE_DEFAULT_SERVER)#$DEFAULT_SERVER#" Moshe/Info.plist > $APP/Contents/Info.plist
plutil -lint -s $APP/Contents/Info.plist

# The web app, served from inside the app (AppScheme.swift). Without it the app
# can only open the server's page.
WEB=../frontend/dist
if [[ -f $WEB/index.html ]]; then
    rm -rf $APP/Contents/Resources/web && cp -R $WEB $APP/Contents/Resources/web
else
    echo "no web build: only the server's page will open (cd ../frontend && npm ci && npm run build)" >&2
fi

# The icon: the web app's, a white camel on yellow, with the margin the
# macOS icon grid leaves round the shape (its rounded square fills 824 of 1024;
# in icon-1024.png it fills 896).
SRC=../frontend/public/icons/icon-1024.png
if [[ -f $SRC ]]; then
    SET=$OUT/AppIcon.iconset && rm -rf $SET && mkdir -p $SET
    sips -p 1113 1113 $SRC --out $OUT/icon-grid.png >/dev/null
    for s in 16 32 128 256 512; do
        sips -z $s $s $OUT/icon-grid.png --out $SET/icon_${s}x${s}.png >/dev/null
        sips -z $((s * 2)) $((s * 2)) $OUT/icon-grid.png --out $SET/icon_${s}x${s}@2x.png >/dev/null
    done
    iconutil -c icns $SET -o $APP/Contents/Resources/AppIcon.icns
    plutil -replace CFBundleIconFile -string AppIcon $APP/Contents/Info.plist
    rm -rf $SET $OUT/icon-grid.png
fi

# An Apple Development identity if there is one (Xcode makes it from your Apple ID),
# ad-hoc otherwise, which is enough to run it on this Mac.
IDENTITY=${MOSHE_SIGN:-$(security find-identity -v -p codesigning | sed -n 's/^ *[0-9]*) \([0-9A-F]*\) "Apple Development.*/\1/p' | head -1)}
codesign --force --options runtime --entitlements Moshe/Moshe.entitlements --sign "${IDENTITY:--}" $APP
[[ -n $IDENTITY ]] || echo "note: signed ad-hoc; fine on this Mac"
echo "built $APP"
