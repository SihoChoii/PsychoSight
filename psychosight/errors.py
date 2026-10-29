"""Typed errors with API codes. Messages never contain message text."""

from __future__ import annotations


class PsychoSightError(Exception):
    code = "INTERNAL_ERROR"
    http_status = 500

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message

    def to_dict(self) -> dict:
        return {"error": {"code": self.code, "message": self.message}}


class FullDiskAccessRequired(PsychoSightError):
    code = "FULL_DISK_ACCESS_REQUIRED"
    http_status = 403


class GroupChatUnsupported(PsychoSightError):
    code = "GROUP_CHAT_UNSUPPORTED"
    http_status = 400


class LLMOptInRequired(PsychoSightError):
    code = "LLM_OPT_IN_REQUIRED"
    http_status = 400


class LLMUnavailable(PsychoSightError):
    code = "LLM_UNAVAILABLE"
    http_status = 503


class NotFound(PsychoSightError):
    code = "NOT_FOUND"
    http_status = 404


class ReportNotReady(PsychoSightError):
    code = "REPORT_NOT_READY"
    http_status = 409


class InvalidRequest(PsychoSightError):
    code = "INVALID_REQUEST"
    http_status = 422


class LLMOutputInvalid(PsychoSightError):
    """Model output failed schema validation (after the retry)."""

    code = "LLM_UNAVAILABLE"
    http_status = 503


class ReportInvalid(PsychoSightError):
    code = "INTERNAL_ERROR"
    http_status = 500
