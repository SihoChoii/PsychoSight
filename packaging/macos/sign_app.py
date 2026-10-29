"""Sign PsychoSight.app without the App Sandbox.

Developer ID uses the hardened runtime so Full Disk Access stays tied to this identity.
Ad-hoc (identity "-") is the fallback when the keychain will not sign.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# little-endian 64/32, big-endian 64/32, fat, fat64
_MAGIC = (
    b"\xcf\xfa\xed\xfe",
    b"\xce\xfa\xed\xfe",
    b"\xfe\xed\xfa\xcf",
    b"\xfe\xed\xfa\xce",
    b"\xca\xfe\xba\xbe",
    b"\xca\xfe\xba\xbf",
)


def mach_o_files(root: Path) -> list[Path]:
    found = []
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            magic = path.read_bytes()[:4]
        except OSError:
            continue
        if magic in _MAGIC:
            found.append(path)
    found.sort(key=lambda item: len(item.parts), reverse=True)
    return found


def codesign(identity: str, path: Path, entitlements: Path | None, timestamp: bool) -> None:
    cmd = ["codesign", "--force", "--sign", identity]
    if identity != "-":
        cmd += ["--options", "runtime"]
        if timestamp:
            cmd.append("--timestamp")
        if entitlements is not None:
            cmd += ["--entitlements", str(entitlements)]
    cmd.append(str(path))
    subprocess.run(cmd, check=True)


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print("usage: sign_app.py PsychoSight.app IDENTITY entitlements.plist", file=sys.stderr)
        return 2
    app = Path(argv[1])
    identity = argv[2]
    entitlements = Path(argv[3])
    if identity == "-":
        subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(app)], check=True)
        print("signed ad-hoc")
        return 0
    for path in mach_o_files(app):
        codesign(identity, path, None, timestamp=False)
    try:
        codesign(identity, app, entitlements, timestamp=True)
    except subprocess.CalledProcessError:
        print("timestamp server failed; signing without a timestamp", file=sys.stderr)
        codesign(identity, app, entitlements, timestamp=False)
    print(f"signed with {identity}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
