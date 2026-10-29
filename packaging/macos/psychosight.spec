# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for PsychoSight.app. Run from packaging/macos/build.sh."""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_dynamic_libs, collect_submodules

ROOT = Path(SPECPATH).resolve().parents[1]
sys.path.insert(0, str(ROOT))
ICON = Path(SPECPATH) / "PsychoSight.icns"
DIST_INDEX = ROOT / "web" / "dist" / "index.html"
if not DIST_INDEX.is_file():
    raise SystemExit(f"missing {DIST_INDEX}; build the frontend before packaging")
if not ICON.is_file():
    raise SystemExit(f"missing {ICON}; run packaging/macos/make_icon.py")
if not (ROOT / ".env.example").is_file():
    raise SystemExit("missing .env.example")

# psychosight is a source tree, not an installed distribution, so list its data files directly.
datas = [
    (str(ROOT / "schemas"), "schemas"),
    (str(ROOT / "web" / "dist"), "web/dist"),
    (str(ROOT / ".env.example"), "."),
    (str(ROOT / "psychosight" / "data"), "psychosight/data"),
    (str(ROOT / "psychosight" / "experimental" / "data"), "psychosight/experimental/data"),
    (str(ROOT / "psychosight" / "experimental" / "wwbp"), "psychosight/experimental/wwbp"),
]
binaries = []
for name in ("objc", "Cocoa", "AppKit", "Foundation", "WebKit", "CoreFoundation"):
    binaries += collect_dynamic_libs(name)

hidden = collect_submodules("psychosight") + collect_submodules("uvicorn")
hidden += ["objc", "Cocoa", "AppKit", "Foundation", "WebKit", "CoreFoundation"]

a = Analysis(
    [str(ROOT / "packaging" / "macos" / "launcher.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pytest", "tkinter", "_tkinter", "numpy", "PIL", "test", "tests"],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="PsychoSight",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch="arm64",
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ICON),
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="PsychoSight",
)
app = BUNDLE(
    coll,
    name="PsychoSight.app",
    icon=str(ICON),
    bundle_identifier="com.sihochoi.psychosight",
    info_plist={
        "CFBundleName": "PsychoSight",
        "CFBundleDisplayName": "PsychoSight",
        "CFBundleShortVersionString": "0.1.0",
        "CFBundleVersion": "0.1.0",
        "NSHighResolutionCapable": True,
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
        "LSApplicationCategoryType": "public.app-category.utilities",
        "NSRequiresAquaSystemAppearance": False,
    },
)
