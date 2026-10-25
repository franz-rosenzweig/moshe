#!/bin/bash
# Cuts a release of the apps: the version raised, a signed APK and the zipped
# Mac app built on a Mac, a GitHub Release with both (Obtainium on a phone
# watches it), and the Homebrew cask brought up to it (brew on a Mac).
#
#   tools/release.sh 0.2.0 "What's new, in a line or two"
#
# It runs where gh and git can push, and builds nothing here. The Mac builds
# from a fresh clone of the tag, so nothing that only lives in someone's own
# checkout (themes kept out of git, a default server in mac/local.env or
# android/local.properties) goes into a release. The Mac, and how things are
# signed, are in tools/release.env, which git leaves out:
#   MOSHE_MAC=user@host  MOSHE_MAC_KEY=~/.ssh/key
#   MOSHE_APK_SIGNING=<keystore.properties on the Mac, absolute>
#   MOSHE_SIGN=<the Mac signing certificate's SHA-1>  MOSHE_SIGN_NAME=<its common name>
#   MOSHE_KEYCHAIN=<the keychain it's in>  MOSHE_KEYCHAIN_PASS=<a file on the Mac holding that keychain's password>
#   MOSHE_PRIVATE='words|that|must|not|be|in|a|release'   (looked for, case-blind, in both apps)
# The APK is signed with the same key every time, or phones can't update. The
# Mac app is signed with the same certificate every time, so macOS sees the
# same app from one version to the next and keeps its permissions; and never
# with a personal identity, whose name anyone could read off a public download.
set -euo pipefail
cd "$(dirname "$0")/.."

V=${1:?usage: tools/release.sh X.Y.Z "notes"}
NOTES=${2:-"Moshe $V"}
[[ $V =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "a version is X.Y.Z" >&2; exit 2; }
[[ -f tools/release.env ]] || { echo "no tools/release.env (the Mac to build on, and the signing)" >&2; exit 2; }
source tools/release.env
REPO=franz-rosenzweig/moshe
TAP=franz-rosenzweig/homebrew-tap
KEY=${MOSHE_MAC_KEY/#\~/$HOME}
mac() { ssh -o BatchMode=yes -o ConnectTimeout=15 -i "$KEY" "$MOSHE_MAC" "$@"; }
say() { echo "== $*"; }

# 1. the version, on master and tagged
git fetch -q origin
[[ -z $(git status --porcelain) ]] || { echo "the tree isn't clean" >&2; exit 1; }
[[ $(git rev-parse HEAD) == $(git rev-parse origin/master) ]] || { echo "HEAD isn't origin/master" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$V" >/dev/null && { echo "v$V is taken" >&2; exit 1; }
code=$(( $(perl -ne 'print $1 if /versionCode (\d+)/' android/app/build.gradle) + 1 ))
build=$(( $(perl -ne 'print $1 if /CURRENT_PROJECT_VERSION: "(\d+)"/' mac/project.yml) + 1 ))
perl -pi -e "s/versionCode \d+/versionCode $code/; s/versionName '[^']*'/versionName '$V'/" android/app/build.gradle
perl -pi -e "s/MARKETING_VERSION: \"[^\"]*\"/MARKETING_VERSION: \"$V\"/; s/CURRENT_PROJECT_VERSION: \"\d+\"/CURRENT_PROJECT_VERSION: \"$build\"/" mac/project.yml
git commit -q -m "Moshe $V" android/app/build.gradle mac/project.yml
git tag -a "v$V" -m "Moshe $V"
git push -q origin HEAD:master "v$V"
say "v$V tagged at $(git rev-parse --short HEAD) (Android $code, Mac build $build)"

# 2. built on the Mac, from a fresh clone of the tag
W=/tmp/moshe-release
mac "export PATH=/opt/homebrew/bin:\$PATH; rm -rf $W && git clone -q --depth 1 -b v$V https://github.com/$REPO.git $W \
  && cd $W/frontend && npm ci --silent >/dev/null 2>&1 && npx vite build >/dev/null \
  && cd $W/android && ./release.sh $MOSHE_APK_SIGNING"
say "APK built"
mac "export PATH=/opt/homebrew/bin:\$PATH; security unlock-keychain -p \"\$(cat $MOSHE_KEYCHAIN_PASS)\" $MOSHE_KEYCHAIN \
  && cd $W/mac && MOSHE_SIGN=$MOSHE_SIGN ./build.sh >/tmp/moshe-release.log 2>&1 \
  && cd build && ditto -c -k --keepParent Moshe.app Moshe-$V-mac.zip" \
  || { mac "tail -20 /tmp/moshe-release.log"; echo "the Mac app didn't build" >&2; exit 1; }

# nothing personal in either: the Mac signature names only the certificate,
# no word on the list is anywhere in them, no home folder in the program
APP="$W/mac/build/Moshe.app" APK="$W/android/Moshe-$V.apk"
[[ $(mac "codesign -dvv $APP 2>&1 | grep '^Authority='") == "Authority=$MOSHE_SIGN_NAME" ]] || { echo "the Mac app isn't signed by $MOSHE_SIGN_NAME alone" >&2; exit 1; }
mac "codesign --verify --strict $APP" || { echo "the Mac app's signature doesn't verify" >&2; exit 1; }
[[ -z $(mac "grep -r -l -a -i -E '$MOSHE_PRIVATE' $APP; strings $APP/Contents/MacOS/Moshe | grep /Users/; /usr/libexec/PlistBuddy -c 'Print :MosheDefaultServer' $APP/Contents/Info.plist") ]] \
  || { echo "something personal is in the Mac app" >&2; exit 1; }
# every file in the APK read straight out of it (unpacked, two whose names differ only in case,
# as a library's shrunk resources can, don't both land on a Mac's disk, and one went unread)
[[ $(mac "unzip -p $APK | grep -a -i -c -E '$MOSHE_PRIVATE' || true") == 0 ]] \
  || { echo "something personal is in the APK" >&2; exit 1; }
say "both built and signed, with nothing personal in them"

# 3. here, and out
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
scp -q -o BatchMode=yes -i "$KEY" "$MOSHE_MAC:$APK" "$MOSHE_MAC:$W/mac/build/Moshe-$V-mac.zip" "$OUT/"
ZIPSUM=$(sha256sum "$OUT/Moshe-$V-mac.zip" | cut -d' ' -f1)
gh release create "v$V" "$OUT/Moshe-$V.apk" "$OUT/Moshe-$V-mac.zip" --repo "$REPO" --title "Moshe $V" --notes "$NOTES"
mac "rm -rf $W"

# 4. the cask: only Moshe's file (and its row) in the shared tap
git clone -q "git@github.com:$TAP.git" "$OUT/tap"
mkdir -p "$OUT/tap/Casks"
cat > "$OUT/tap/Casks/moshe.rb" <<CASK
cask "moshe" do
  version "$V"
  sha256 "$ZIPSUM"

  url "https://github.com/$REPO/releases/download/v#{version}/Moshe-#{version}-mac.zip"
  name "Moshe"
  desc "Writing app over a folder of plain Markdown files"
  homepage "https://github.com/$REPO"

  depends_on macos: :sonoma

  app "Moshe.app"

  postflight_steps do
    run "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "{{appdir}}/Moshe.app"]
  end
end
CASK
cd "$OUT/tap"
ROW='| [moshe](Casks/moshe.rb) | [Moshe](https://github.com/franz-rosenzweig/moshe): writing over a folder of plain Markdown files |'
grep -qF '[moshe](Casks/moshe.rb)' README.md || printf '%s\n' "$ROW" >> README.md
git add Casks/moshe.rb README.md
git commit -q -m "moshe $V"
git pull -q --rebase
git push -q
say "released: https://github.com/$REPO/releases/tag/v$V, and the cask is at $V"
