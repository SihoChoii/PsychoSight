"""PsychoSight.app entry point.

The same signed executable is the Dock app and, as a child process, the FastAPI server
(``python -m psychosight serve`` on 127.0.0.1). Full Disk Access granted to PsychoSight.app
covers that process tree. No API key is read from the bundle.
"""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path
from typing import List, Optional

from psychosight import config
from psychosight.resources import package_dir, pick_loopback_port

NOTE = (
    "PsychoSight does not include a DeepSeek API key.\n\n"
    "To run the real model, copy ~/.psychosight/.env.example to ~/.psychosight/.env, "
    "set DEEPSEEK_API_KEY, then quit and reopen PsychoSight. "
    "An environment variable of the same name also works and takes priority.\n\n"
    "Without a key, the demo still runs with offline mock scores (labelled \"not real model\"). "
    "The key is never stored in the app and is never logged."
)


def _log(message: str) -> None:
    try:
        path = Path.home() / "Library" / "Logs" / "PsychoSight" / "launcher.log"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(message.rstrip() + "\n")
    except OSError:
        pass


def _home_dir() -> Path:
    path = Path.home() / ".psychosight"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _example_is_placeholder(text: str) -> bool:
    for line in text.splitlines():
        compact = line.strip().replace(" ", "")
        if compact.startswith("#") or "DEEPSEEK_API_KEY=" not in compact:
            continue
        if "your-key-here" not in compact:
            return False
    return True


def install_env_example() -> None:
    """Copy the placeholder template when ~/.psychosight/.env.example is absent. Never touch .env."""
    dest = _home_dir() / ".env.example"
    if dest.exists():
        return
    bundled = config.resource_root() / ".env.example"
    if not bundled.is_file():
        _log("no bundled .env.example")
        return
    text = bundled.read_text(encoding="utf-8")
    if not _example_is_placeholder(text):
        _log("refused to copy .env.example (not the placeholder)")
        return
    dest.write_text(text, encoding="utf-8")
    _log(f"wrote {dest}")


def note_needed() -> bool:
    if (_home_dir() / ".first-run-noted").exists():
        return False
    return not config.llm_settings().configured


def write_first_run_note() -> None:
    dest = _home_dir() / "FIRST_RUN.txt"
    if not dest.exists():
        dest.write_text(NOTE + "\n", encoding="utf-8")
        _log(f"wrote {dest}")


def mark_note_shown() -> None:
    (_home_dir() / ".first-run-noted").write_text("shown\n", encoding="utf-8")


def runtime_path() -> Path:
    return _home_dir() / "app-runtime.json"


def write_runtime(port: int, pid: int) -> None:
    runtime_path().write_text('{"port": %d, "pid": %d}\n' % (port, pid), encoding="utf-8")


def clear_runtime() -> None:
    try:
        runtime_path().unlink()
    except OSError:
        pass


def check_resources() -> int:
    root = config.resource_root()
    pkg = package_dir()
    needed = [
        root / "web" / "dist" / "index.html",
        root / "schemas" / "report.schema.json",
        root / ".env.example",
        pkg / "data" / "demo_conversation.jsonl",
        pkg / "experimental" / "wwbp" / "bigfive_lexicon.json",
        pkg / "experimental" / "data" / "exp_anchors_v1.json",
    ]
    print(f"resource_root={root}")
    print(f"package_dir={pkg}")
    missing = [str(path) for path in needed if not path.is_file()]
    example = root / ".env.example"
    if example.is_file() and not _example_is_placeholder(example.read_text(encoding="utf-8")):
        missing.append(str(example) + " (not the placeholder)")
    if missing:
        print("missing resources:", file=sys.stderr)
        for item in missing:
            print(item, file=sys.stderr)
        return 1
    print("resources ok")
    return 0


def _watch_parent(parent_pid: int) -> None:
    while True:
        time.sleep(0.5)
        if os.getppid() != parent_pid:
            os._exit(0)


def run_server(argv: List[str]) -> int:
    port = config.DEFAULT_PORT
    static = None
    parent = 0
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg in ("--port", "--static-dir", "--parent-pid") and index + 1 < len(argv):
            value = argv[index + 1]
            if arg == "--port":
                port = int(value)
            elif arg == "--static-dir":
                static = value
            else:
                parent = int(value)
            index += 2
            continue
        index += 1
    if parent > 0:
        threading.Thread(target=_watch_parent, args=(parent,), daemon=True).start()
    serve = ["serve", "--host", "127.0.0.1", "--port", str(port)]
    if static:
        serve += ["--static-dir", static]
    from psychosight.cli import main as cli_main
    return cli_main(serve)


def stop_server(proc: Optional[subprocess.Popen]) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass


def start_server(port: int, static: Path) -> subprocess.Popen:
    log_dir = Path.home() / "Library" / "Logs" / "PsychoSight"
    log_dir.mkdir(parents=True, exist_ok=True)
    handle = (log_dir / "server.log").open("a", encoding="utf-8")
    handle.write(f"\n--- start port={port} ---\n")
    handle.flush()
    cmd = [
        sys.executable, "--ps-serve",
        "--port", str(port),
        "--parent-pid", str(os.getpid()),
        "--static-dir", str(static),
    ]
    proc = subprocess.Popen(
        cmd, stdout=handle, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
        env=os.environ.copy(), close_fds=True,
    )
    handle.close()
    return proc


def wait_health(port: int, proc: subprocess.Popen, timeout: float = 25.0) -> None:
    url = f"http://127.0.0.1:{port}/health"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.time() + timeout
    last = "not up"
    while time.time() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"backend exited ({proc.returncode}) before /health responded")
        try:
            with opener.open(url, timeout=0.5) as resp:
                if resp.status == 200:
                    return
        except Exception as exc:
            last = type(exc).__name__
        time.sleep(0.15)
    raise RuntimeError(f"backend did not respond on port {port} ({last})")


def inform(title: str, body: str) -> None:
    _log(f"{title}: {body}")
    try:
        from Cocoa import NSAlert, NSApplication, NSApplicationActivationPolicyRegular
        app = NSApplication.sharedApplication()
        app.setActivationPolicy_(NSApplicationActivationPolicyRegular)
        alert = NSAlert.alloc().init()
        alert.setMessageText_(title)
        alert.setInformativeText_(body)
        alert.addButtonWithTitle_("OK")
        alert.runModal()
    except Exception:
        pass


def run_cocoa(url: str, proc: subprocess.Popen, show_note: bool) -> None:
    from Cocoa import (
        NSAlert,
        NSApplication,
        NSApplicationActivationPolicyRegular,
        NSBackingStoreBuffered,
        NSMakeRect,
        NSObject,
        NSTerminateNow,
        NSWindow,
        NSWindowStyleMaskClosable,
        NSWindowStyleMaskMiniaturizable,
        NSWindowStyleMaskResizable,
        NSWindowStyleMaskTitled,
    )
    from Foundation import NSURL, NSURLRequest
    from WebKit import WKWebView, WKWebViewConfiguration

    class AppDelegate(NSObject):
        def applicationDidFinishLaunching_(self, _notification):
            mask = (
                NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
                | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
            )
            frame = NSMakeRect(0, 0, 1120, 780)
            window = NSWindow.alloc().initWithContentRect_styleMask_backing_defer_(
                frame, mask, NSBackingStoreBuffered, False)
            window.setTitle_("PsychoSight")
            window.setMinSize_((720, 560))
            web = WKWebView.alloc().initWithFrame_configuration_(frame, WKWebViewConfiguration.alloc().init())
            window.setContentView_(web)
            window.center()
            window.makeKeyAndOrderFront_(None)
            web.loadRequest_(NSURLRequest.requestWithURL_(NSURL.URLWithString_(self.url)))
            self.window = window
            self.web = web
            NSApplication.sharedApplication().activateIgnoringOtherApps_(True)
            if self.show_note:
                alert = NSAlert.alloc().init()
                alert.setMessageText_("Add a DeepSeek key to run the real model")
                alert.setInformativeText_(NOTE)
                alert.addButtonWithTitle_("OK")
                alert.beginSheetModalForWindow_completionHandler_(window, None)
                mark_note_shown()

        def applicationShouldTerminateAfterLastWindowClosed_(self, _sender):
            return True

        def applicationShouldTerminate_(self, _sender):
            stop_server(self.proc)
            clear_runtime()
            return NSTerminateNow

        def applicationWillTerminate_(self, _notification):
            stop_server(self.proc)
            clear_runtime()

    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(NSApplicationActivationPolicyRegular)
    delegate = AppDelegate.alloc().init()
    delegate.url = url
    delegate.proc = proc
    delegate.show_note = show_note
    app.setDelegate_(delegate)
    app.run()


def run_browser(url: str, proc: subprocess.Popen) -> None:
    import webbrowser
    webbrowser.open(url)
    _log(f"opened browser at port, webkit unavailable")
    try:
        proc.wait()
    except KeyboardInterrupt:
        pass


def run_app() -> int:
    install_env_example()
    show_note = note_needed()
    if show_note:
        write_first_run_note()
    static = config.resource_root() / "web" / "dist"
    if not (static / "index.html").is_file():
        inform("PsychoSight", "The bundled UI is missing (web/dist/index.html).")
        return 1
    port = pick_loopback_port(config.port())
    proc = start_server(port, static)

    def _stop(*_args):
        stop_server(proc)
        clear_runtime()
        os._exit(0)

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    try:
        wait_health(port, proc)
    except Exception as exc:
        stop_server(proc)
        inform("PsychoSight could not start", f"{exc}\n\nSee ~/Library/Logs/PsychoSight/server.log")
        return 1
    write_runtime(port, os.getpid())
    url = f"http://127.0.0.1:{port}/"
    _log(f"ui {url}")
    try:
        try:
            run_cocoa(url, proc, show_note)
        except Exception as exc:
            _log(f"webkit failed: {type(exc).__name__}")
            run_browser(url, proc)
    finally:
        stop_server(proc)
        clear_runtime()
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if "--ps-serve" in args:
        return run_server(args)
    if "--ps-check" in args:
        return check_resources()
    return run_app()


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    raise SystemExit(main())
