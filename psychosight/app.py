"""FastAPI app: localhost API + static frontend. See docs/API.md."""

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, StrictBool
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import config, loader, pipeline
from .errors import FullDiskAccessRequired, InvalidRequest, NotFound, PsychoSightError, ReportNotReady
from .llm import get_provider, install_log_guard
from .storage import Store

log = logging.getLogger("psychosight.app")

LOCAL_ORIGINS = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"


class AnalysisRequest(BaseModel):
    conversation_id: str
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    llm_opt_in: StrictBool
    demo: StrictBool = False
    mode: Optional[str] = None


@dataclass
class Job:
    job_id: str
    conversation_id: str
    mode: str
    created_at: str
    status: str = "queued"
    stage: str = "loading"
    progress: Dict[str, int] = field(default_factory=lambda: {"current": 0, "total": 1})
    error: Optional[dict] = None
    deleted: bool = False

    def view(self) -> dict:
        return {"job_id": self.job_id, "status": self.status, "stage": self.stage, "progress": dict(self.progress),
                "mode": self.mode, "conversation_id": self.conversation_id, "created_at": self.created_at,
                "error": self.error}


def _err(code: str, message: str, status: int) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def _public_id(value: str, limit: int = 64) -> str:
    """Short, single-line id for error text. Do not echo an unbounded client string."""
    cleaned = "".join(ch if ch.isprintable() and ch not in "\r\n\t" else " " for ch in (value or ""))
    cleaned = " ".join(cleaned.split())
    if len(cleaned) > limit:
        return cleaned[:limit] + "..."
    return cleaned or "(empty)"


def create_app(static_dir: Optional[Path] = None, store: Optional[Store] = None, use_default_static: bool = True) -> FastAPI:
    install_log_guard()
    app = FastAPI(title="PsychoSight Lite", version=config.BACKEND_VERSION)
    app.add_middleware(CORSMiddleware, allow_origin_regex=LOCAL_ORIGINS, allow_methods=["*"], allow_headers=["*"])
    state = {"store": store}
    jobs: Dict[str, Job] = {}
    lock = threading.Lock()

    def get_store() -> Store:
        if state["store"] is None:
            state["store"] = Store()
        return state["store"]

    @app.exception_handler(PsychoSightError)
    async def _ps_error(request: Request, exc: PsychoSightError):
        return _err(exc.code, exc.message, exc.http_status)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        fields = [".".join(str(p) for p in e.get("loc", [])[1:]) for e in exc.errors()]
        return _err("INVALID_REQUEST", f"Invalid request fields: {', '.join(fields) or 'body'}.", 422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException):
        if exc.status_code == 404:
            return _err("NOT_FOUND", "Not found.", 404)
        return _err("INVALID_REQUEST" if exc.status_code < 500 else "INTERNAL_ERROR", str(exc.detail), exc.status_code)

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception):
        log.error("unexpected error type=%s", type(exc).__name__)
        return _err("INTERNAL_ERROR", "Unexpected backend error.", 500)

    @app.get("/health")
    def health():
        return {"status": "ok", "version": config.BACKEND_VERSION}

    @app.get("/config")
    def get_config():
        s = config.llm_settings()
        return {"version": config.BACKEND_VERSION, "schema_version": config.SCHEMA_VERSION, "provider": "deepseek",
                "model": s.model, "llm_configured": s.configured, "llm_available": s.configured,
                "llm_key_source": s.key_source, "reasoning_effort": s.reasoning_effort,
                "demo_provider": config.demo_provider_name(), "opt_in_text": config.OPT_IN_TEXT,
                "disclaimer": config.DISCLAIMER, "limitations_title": config.LIMITATIONS_TITLE,
                "max_episodes_scored": config.MAX_EPISODES_SCORED}

    @app.get("/conversations")
    def conversations():
        items = [loader.demo_summary()]
        chat_db = {"available": True, "error": None}
        try:
            items += loader.list_conversations()
        except FullDiskAccessRequired as exc:
            chat_db = {"available": False, "error": {"code": exc.code, "message": exc.message}}
        return {"conversations": items, "chat_db": chat_db}

    def _run(job: Job, req: AnalysisRequest, provider, date_from, date_to) -> None:
        def progress(stage: str, cur: int, tot: int) -> None:
            job.stage, job.progress = stage, {"current": cur, "total": tot}

        job.status = "running"
        try:
            pipeline.run_analysis(req.conversation_id, date_from=date_from, date_to=date_to,
                                  llm_opt_in=req.llm_opt_in, demo=req.demo, mode=job.mode, report_id=job.job_id,
                                  progress=progress, store=get_store(), provider=provider)
            job.status, job.stage = "done", "done"
            if job.deleted:
                get_store().delete_report(job.job_id)
        except PsychoSightError as exc:
            job.status, job.error = "error", {"code": exc.code, "message": exc.message}
            log.warning("job=%s failed code=%s stage=%s", job.job_id, exc.code, job.stage)
        except Exception as exc:  # noqa: BLE001
            job.status, job.error = "error", {"code": "INTERNAL_ERROR", "message": "Unexpected backend error."}
            log.error("job=%s failed type=%s stage=%s", job.job_id, type(exc).__name__, job.stage)
        finally:
            closer = getattr(provider, "close", None)
            if closer:
                closer()

    @app.post("/analyses", status_code=202)
    def create_analysis(req: AnalysisRequest):
        if req.mode not in (None, "full", "deterministic_only"):
            raise InvalidRequest("mode must be 'full', 'deterministic_only' or null.")
        if not req.conversation_id or len(req.conversation_id) > 128:
            raise InvalidRequest("conversation_id is missing or too long.")
        try:
            date_from, date_to = loader.parse_date(req.date_from), loader.parse_date(req.date_to)
        except ValueError:
            raise InvalidRequest("date_from/date_to must be YYYY-MM-DD.")
        if date_from and date_to and date_from > date_to:
            raise InvalidRequest("date_from must be on or before date_to.")
        if req.demo:
            req.conversation_id = config.DEMO_CONVERSATION_ID
        run_mode = pipeline.resolve_mode(req.llm_opt_in, req.mode)
        loader.check_supported(req.conversation_id)
        provider = None
        if run_mode == "full":
            provider = get_provider(req.conversation_id == config.DEMO_CONVERSATION_ID, req.llm_opt_in)
        job = Job(job_id=uuid.uuid4().hex[:12], conversation_id=req.conversation_id, mode=run_mode,
                  created_at=datetime.now(timezone.utc).astimezone().isoformat())
        with lock:
            jobs[job.job_id] = job
        threading.Thread(target=_run, args=(job, req, provider, date_from, date_to), daemon=True).start()
        log.info("job=%s queued mode=%s", job.job_id, run_mode)
        return {"job_id": job.job_id, "status": job.status}

    @app.get("/analyses")
    def list_analyses():
        return {"analyses": get_store().list_reports()}

    @app.get("/analyses/{job_id}")
    def get_analysis(job_id: str):
        job = jobs.get(job_id)
        if job and not job.deleted:
            return job.view()
        rep = get_store().get_report(job_id)
        if rep is None:
            raise NotFound(f"No analysis with id '{_public_id(job_id)}'.")
        return {"job_id": job_id, "status": "done", "stage": "done", "progress": {"current": 1, "total": 1},
                "mode": rep["mode"], "conversation_id": rep["header"]["conversation_id"],
                "created_at": rep["run_meta"]["created_at"], "error": None}

    @app.get("/analyses/{job_id}/report")
    def get_report(job_id: str):
        job = jobs.get(job_id)
        if job and job.deleted:
            raise NotFound(f"No analysis with id '{_public_id(job_id)}'.")
        if job and job.status in ("queued", "running"):
            raise ReportNotReady(f"Analysis '{job_id}' is still {job.status} (stage {job.stage}).")
        if job and job.status == "error":
            err = job.error or {}
            return _err(err.get("code", "INTERNAL_ERROR"), err.get("message", "Analysis failed."), 409)
        rep = get_store().get_report(job_id)
        if rep is None:
            raise NotFound(f"No report with id '{_public_id(job_id)}'.")
        return rep

    @app.delete("/analyses/{job_id}")
    def delete_analysis(job_id: str):
        job = jobs.get(job_id)
        removed = get_store().delete_report(job_id)
        if job and not job.deleted:
            job.deleted = True
            removed = True
            if job.status not in ("queued", "running"):
                with lock:
                    jobs.pop(job_id, None)
        if not removed:
            raise NotFound(f"No analysis with id '{_public_id(job_id)}'.")
        log.info("job=%s deleted", job_id)
        return {"deleted": True, "job_id": job_id}

    # Static UI last, so API routes win.
    directory = static_dir if static_dir is not None else (config.static_dir() if use_default_static else None)
    if directory is not None and Path(directory).is_dir():
        app.mount("/", StaticFiles(directory=str(directory), html=True), name="static")
        log.info("serving static UI from %s", directory)
    else:
        @app.get("/", response_class=HTMLResponse)
        def root_note():
            return ("<!doctype html><title>PsychoSight Lite</title><h1>PsychoSight Lite backend</h1>"
                    "<p>The API is running. No UI build found (expected <code>web/dist</code> or <code>web/</code>, "
                    "or set PSYCHOSIGHT_STATIC_DIR). See <a href='/docs'>/docs</a> and <code>docs/API.md</code>.</p>"
                    f"<p>{config.DISCLAIMER}.</p>")
    return app
