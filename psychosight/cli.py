"""Command line: list-conversations, analyze, list-reports, delete-report, serve, --demo."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import List, Optional

from . import config, loader, pipeline
from .errors import PsychoSightError
from .storage import Store


def _setup_logging(verbose: bool) -> None:
    # Logs carry ids and counts only, never message text.
    from .llm import install_log_guard
    logging.basicConfig(level=logging.INFO if verbose else logging.WARNING, stream=sys.stderr,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    install_log_guard()


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m psychosight", description=(
        "PsychoSight Lite: descriptive communication-pattern report for one 1:1 conversation. "
        + config.DISCLAIMER + "."))
    p.add_argument("--demo", action="store_true", help="shortcut for 'analyze --demo'")
    p.add_argument("--opt-in-llm", action="store_true", help="with --demo: include LLM sections")
    p.add_argument("-v", "--verbose", action="store_true", help="info logs (ids and counts only)")
    sub = p.add_subparsers(dest="cmd")

    lc = sub.add_parser("list-conversations", help="list conversations (demo + chat.db)")
    lc.add_argument("--db", type=Path, help="path to chat.db (default ~/Library/Messages/chat.db)")
    lc.add_argument("--json", action="store_true")

    an = sub.add_parser("analyze", help="analyze one conversation and print/write the report JSON")
    an.add_argument("--conversation", "-c", help="conversation id from list-conversations")
    an.add_argument("--demo", action="store_true", help="use the synthetic demo conversation")
    an.add_argument("--from", dest="date_from", help="YYYY-MM-DD (inclusive, local)")
    an.add_argument("--to", dest="date_to", help="YYYY-MM-DD (inclusive, local)")
    an.add_argument("--opt-in-llm", action="store_true",
                    help="opt in to sending excerpts of BOTH sides' messages to DeepSeek (mock for --demo)")
    an.add_argument("--mode", choices=["full", "deterministic_only"])
    an.add_argument("--out", "-o", help="write report JSON here (default: stdout)")
    an.add_argument("--no-save", action="store_true", help="do not store the report in the local DB")

    sub.add_parser("list-reports", help="list stored reports")
    dr = sub.add_parser("delete-report", help="delete a stored report (it contains evidence quotes)")
    dr.add_argument("report_id")

    sub.add_parser("check-llm", help="smoke-test DeepSeek with ONE synthetic demo episode (no real messages)")

    sv = sub.add_parser("serve", help="serve the API and static UI on localhost")
    sv.add_argument("--host", default=config.DEFAULT_HOST)
    sv.add_argument("--port", type=int, default=None, help=f"default {config.DEFAULT_PORT} or PSYCHOSIGHT_PORT")
    sv.add_argument("--static-dir", type=Path, help="default web/dist, then web/ (or PSYCHOSIGHT_STATIC_DIR)")
    return p


def cmd_list(args) -> int:
    rows = [loader.demo_summary()]
    warning = None
    try:
        rows += loader.list_conversations(args.db)
    except PsychoSightError as exc:
        warning = exc
    if args.json:
        print(json.dumps({"conversations": rows, "chat_db": {
            "available": warning is None,
            "error": None if warning is None else {"code": warning.code, "message": warning.message}}}, indent=2))
    else:
        for r in rows:
            flag = " (group chat: unsupported)" if r["is_group"] else ""
            print(f"{r['id']:>8}  {r['message_count']:>7} msgs  {r['latest_date'] or '-':<26}  {r['label']}{flag}")
    if warning is not None:
        print(f"note {warning.code}: {warning.message}", file=sys.stderr)
    return 0


def _print_progress(stage: str, cur: int, tot: int) -> None:
    if (stage == "scoring" and (cur % 10 == 0 or cur == tot)) or (stage != "scoring" and cur == 0):
        print(f"[{stage}] {cur}/{tot}", file=sys.stderr)


def cmd_analyze(args) -> int:
    if not args.demo and not args.conversation:
        print("error: pass --conversation ID or --demo", file=sys.stderr)
        return 2
    rep = pipeline.run_analysis(
        args.conversation or config.DEMO_CONVERSATION_ID, demo=args.demo,
        date_from=loader.parse_date(args.date_from), date_to=loader.parse_date(args.date_to),
        llm_opt_in=bool(args.opt_in_llm), mode=args.mode, save=not args.no_save,
        progress=_print_progress)
    text = json.dumps(rep, indent=2, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    h, m = rep["header"], rep["run_meta"]
    print(f"report {rep['report_id']} mode={rep['mode']} messages={sum(h['message_counts'].values())} "
          f"episodes={h['episode_count']} scored={h['episodes_scored']} weeks={h['week_count']} "
          f"llm_calls={m['llm_calls']} cache_hits={m['cache_hits']} schema=valid"
          + (f" -> {args.out}" if args.out else ""), file=sys.stderr)
    if not args.no_save:
        kind = "contains evidence quotes" if rep["quotes"] else "no quotes in this mode"
        print(f"stored locally ({kind}); delete with: python -m psychosight delete-report "
              f"{rep['report_id']}", file=sys.stderr)
    return 0


def cmd_list_reports(args) -> int:
    for r in Store().list_reports():
        print(f"{r['job_id']}  {r['created_at']}  {r['mode']:<18}  {r['conversation_label']}")
    return 0


def cmd_delete(args) -> int:
    if Store().delete_report(args.report_id):
        print(f"deleted report {args.report_id}")
        return 0
    print(f"error NOT_FOUND: no report with id '{args.report_id}'", file=sys.stderr)
    return 1


def cmd_check_llm(args) -> int:
    """Phase 12.1 smoke test: model list + one rubric call on a synthetic episode."""
    import tempfile

    from . import rubric, sessionize
    from .llm import DeepSeekProvider

    provider = DeepSeekProvider()
    try:
        models = provider.list_models()
        s = provider.settings
        print(f"model={provider.model} reasoning_effort={provider.reasoning_effort} thinking={s.thinking} "
              f"base_url={s.base_url} key={config.mask_key(s.api_key)} ({s.key_source or 'unset'})")
        print(f"provider models: {', '.join(models) if models else '(could not list)'}")
        if models and provider.model not in models:
            print("warning: DEEPSEEK_MODEL is not in the provider's model list", file=sys.stderr)
        eps = sessionize.sessionize(loader.load_demo().msgs)
        sel = rubric.select_episodes(eps)
        ep = next(e for e in eps if e.id in sel)
        store = Store(Path(tempfile.mkdtemp(prefix="ps-check-")) / "check.db")
        stats = rubric.ScoringStats()
        record = rubric.score_one(provider, ep, 0, store, stats, rubric.CallBudget(4))
    finally:
        provider.close()
    ok = record is not None
    print(f"rubric call on synthetic {ep.id}: {'valid JSON' if ok else 'INVALID output'} calls={stats.llm_calls} "
          f"retries={stats.llm_retries} dropped_quotes={stats.dropped_quotes}")
    if ok:
        print("scores: " + ", ".join(f"{k}={v['score']}" for k, v in record["items"].items()))
    return 0 if ok else 1


_LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")


def cmd_serve(args) -> int:
    import uvicorn

    from .app import create_app

    port = args.port or config.port()
    if args.host not in _LOOPBACK_HOSTS:
        print(f"error INVALID_REQUEST: refusing to bind {args.host}. "
              "The API listens on 127.0.0.1 only.", file=sys.stderr)
        return 2
    app = create_app(static_dir=args.static_dir)
    print(f"PsychoSight Lite on http://{args.host}:{port}  ({config.DISCLAIMER})", file=sys.stderr)
    uvicorn.run(app, host=args.host, port=port, log_level="info")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    _setup_logging(args.verbose)
    try:
        if args.cmd is None and args.demo:
            ns = argparse.Namespace(conversation=None, demo=True, date_from=None, date_to=None,
                                    opt_in_llm=args.opt_in_llm, mode=None, out=None, no_save=False)
            return cmd_analyze(ns)
        handlers = {"list-conversations": cmd_list, "analyze": cmd_analyze, "list-reports": cmd_list_reports,
                    "delete-report": cmd_delete, "serve": cmd_serve, "check-llm": cmd_check_llm}
        if args.cmd not in handlers:
            build_parser().print_help()
            return 2
        return handlers[args.cmd](args)
    except PsychoSightError as exc:
        print(f"error {exc.code}: {exc.message}", file=sys.stderr)
        return 2
    except ValueError as exc:
        print(f"error INVALID_REQUEST: {exc}", file=sys.stderr)
        return 2
