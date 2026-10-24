#!/bin/bash
# Cuts a release of the apps: the version raised, a signed APK and the zipped
# Mac app built on a Mac, a GitHub Release with both (Obtainium on a phone
# watches it), and the Homebrew cask brought up to it (brew on a Mac).
#
#   tools/release.sh 0.2.0 "What's new, in a line or two"
#
# It runs where gh and git can push, and builds nothing here. The Mac it builds
# on is in tools/release.env, which git leaves out:
#   MOSHE_MAC=user@host  MOSHE_MAC_KEY=~/.ssh/key  MOSHE_MAC_REPO=path/to/moshe (from the Mac's home)
# The Mac app is signed in the Mac's own session (an iTerm window runs it for
# a minute), because codesign can't reach the keychain over ssh, and an app
# whose signature changes from one version to the next asks for its folder
# again. The APK is signed by android/release.sh, with the same key every time.
set -euo pipefail
cd "$(dirname "$0")/.."

V=${1:?usage: tools/release.sh X.Y.Z "notes"}
NOTES=${2:-"Moshe $V"}
[[ $V =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "a version is X.Y.Z" >&2; exit 2; }
[[ -f tools/release.env ]] || { echo "no tools/release.env (the Mac to build on)" >&2; exit 2; }
source tools/release.env
REPO=franz-rosenzweig/moshe
TAP=franz-rosenzweig/homebrew-tap
mac() { ssh -o BatchMode=yes -o ConnectTimeout=15 -i "${MOSHE_MAC_KEY/#\~/$HOME}" "$MOSHE_MAC" "$@"; }
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
SHA=$(git rev-parse HEAD)
say "v$V tagged at ${SHA:0:7} (Android $code, Mac build $build)"

# 2. built on the Mac, from exactly that commit
mac "export PATH=/opt/homebrew/bin:\$PATH; cd $MOSHE_MAC_REPO && git fetch -q https://github.com/$REPO.git master:refs/remotes/origin/master \
  && git merge -q --ff-only origin/master && test \$(git rev-parse HEAD) = $SHA \
  && (cd frontend && npm ci --silent >/dev/null 2>&1 && npx vite build >/dev/null) && cd android && ./release.sh"
say "APK built"
cat <<EOF | mac "cat > /tmp/moshe-release.command && chmod +x /tmp/moshe-release.command && rm -f /tmp/moshe-release.log && open -a iTerm /tmp/moshe-release.command"
#!/bin/zsh
exec > /tmp/moshe-release.log 2>&1
export PATH=/opt/homebrew/bin:\$PATH
cd ~/$MOSHE_MAC_REPO/mac && ./build.sh || { echo FAILED; exit 1; }
cd build && rm -f Moshe-$V-mac.zip && ditto -c -k --keepParent Moshe.app Moshe-$V-mac.zip && echo DONE || echo FAILED
EOF
for _ in $(seq 1 60); do
  sleep 5
  state=$(mac "grep -E '^(DONE|FAILED)' /tmp/moshe-release.log 2>/dev/null || true")
  [[ -n $state ]] && break
done
[[ $state == DONE ]] || { mac "tail -20 /tmp/moshe-release.log"; echo "the Mac app didn't build" >&2; exit 1; }
mac "codesign -dv $MOSHE_MAC_REPO/mac/build/Moshe.app 2>&1 | grep -q TeamIdentifier=[A-Z0-9]" \
  || { echo "the Mac app isn't signed with a developer identity" >&2; exit 1; }
say "Mac app built and signed"

# 3. here, and out
OUT=$(mktemp -d)
trap 'rm -rf "$OUT"' EXIT
scp -q -o BatchMode=yes -i "${MOSHE_MAC_KEY/#\~/$HOME}" "$MOSHE_MAC:$MOSHE_MAC_REPO/android/Moshe-$V.apk" "$MOSHE_MAC:$MOSHE_MAC_REPO/mac/build/Moshe-$V-mac.zip" "$OUT/"
ZIPSUM=$(sha256sum "$OUT/Moshe-$V-mac.zip" | cut -d' ' -f1)
gh release create "v$V" "$OUT/Moshe-$V.apk" "$OUT/Moshe-$V-mac.zip" --repo "$REPO" --title "Moshe $V" --notes "$NOTES"

# 4. the cask: only Moshe's file in the shared tap
git clone -q "git@github.com:$TAP.git" "$OUT/tap"
mkdir -p "$OUT/tap/Casks"
cat > "$OUT/tap/Casks/moshe.rb" <<EOF
cask "moshe" do
  version "$V"
  sha256 "$ZIPSUM"

  url "https://github.com/$REPO/releases/download/v#{version}/Moshe-#{version}-mac.zip"
  name "Moshe"
  desc "Writing app over a folder of plain Markdown files"
  homepage "https://github.com/$REPO"

  depends_on macos: ">= :sonoma"

  app "Moshe.app"

  postflight do
    system_command "/usr/bin/xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/Moshe.app"]
  end
end
EOF
cd "$OUT/tap"
git add Casks/moshe.rb
git commit -q -m "moshe $V"
git pull -q --rebase
git push -q
say "released: https://github.com/$REPO/releases/tag/v$V, and the cask is at $V"
