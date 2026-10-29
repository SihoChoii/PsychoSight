#!/bin/bash
# Build PsychoSight.app from this checkout, sign it, and install it.
# Does not read, copy, or bundle a DeepSeek API key.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PATH="/opt/homebrew/bin:${PATH:-/usr/bin:/bin}"
PY="${PY:-/Library/Frameworks/Python.framework/Versions/3.13/bin/python3}"
VENV="$ROOT/packaging/macos/.venv"
APP="$ROOT/dist/PsychoSight.app"
ENT="$ROOT/packaging/macos/entitlements.plist"
DEV_ID="Developer ID Application: Siho Choi (5Q9JAMW353)"

if [[ ! -x "$PY" ]]; then
  echo "Python 3.13 not found at $PY" >&2
  exit 1
fi

echo "building web/dist"
(cd "$ROOT/web" && npm ci && npm run build)

echo "preparing packaging venv"
if [[ ! -x "$VENV/bin/python" ]]; then
  "$PY" -m venv "$VENV"
fi
"$VENV/bin/pip" install -q -r "$ROOT/requirements.txt" \
  "pyinstaller>=6.11" "pyinstaller-hooks-contrib>=2025.1" \
  "pyobjc-framework-Cocoa>=11" "pyobjc-framework-WebKit>=11" "pillow>=11"

echo "making icon"
"$VENV/bin/python" "$ROOT/packaging/macos/make_icon.py"

# Drop a previous build so a running copy cannot keep stale files in dist/.
osascript -e 'tell application "PsychoSight" to quit' >/dev/null 2>&1 || true
sleep 1
killall PsychoSight >/dev/null 2>&1 || true
rm -rf "$ROOT/build" "$APP"

echo "running PyInstaller"
"$VENV/bin/pyinstaller" "$ROOT/packaging/macos/psychosight.spec" \
  --noconfirm --clean --distpath "$ROOT/dist" --workpath "$ROOT/build"

MAIN="$APP/Contents/MacOS/PsychoSight"
if ! file "$MAIN" | grep -q "arm64"; then
  echo "expected an arm64 executable at $MAIN" >&2
  file "$MAIN" >&2 || true
  exit 1
fi

IDENTITY="-"
if security find-identity -v -p codesigning | grep -F "$DEV_ID" >/dev/null; then
  # Probe the keychain. A GUI prompt we cannot answer should time out into an ad-hoc signature.
  if perl -e 'alarm 45; exec @ARGV' codesign --force --sign "$DEV_ID" --options runtime "$MAIN"; then
    IDENTITY="$DEV_ID"
  else
    echo "Developer ID signing unavailable; using an ad-hoc signature"
  fi
fi
"$VENV/bin/python" "$ROOT/packaging/macos/sign_app.py" "$APP" "$IDENTITY" "$ENT"

codesign --verify --deep --strict --verbose=2 "$APP"
ents="$(codesign -d --entitlements - "$APP" 2>&1 || true)"
if grep -q "com.apple.security.app-sandbox" <<<"$ents"; then
  echo "refusing to install a sandboxed app" >&2
  exit 1
fi
xattr -dr com.apple.quarantine "$APP" || true

echo "checking bundled resources and that no key was packed"
"$MAIN" --ps-check
"$VENV/bin/python" "$ROOT/packaging/macos/scan_bundle.py" "$APP"

if [[ -w /Applications ]]; then
  DEST="/Applications/PsychoSight.app"
else
  mkdir -p "$HOME/Applications"
  DEST="$HOME/Applications/PsychoSight.app"
fi
rm -rf "$DEST"
ditto "$APP" "$DEST"
xattr -dr com.apple.quarantine "$DEST" || true
codesign --verify --deep --strict "$DEST"

echo "signed with: $IDENTITY"
echo "installed: $DEST"
echo "checkout copy: $APP"
