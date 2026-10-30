"""Typed errors with API codes. Messages never contain message text."""

from __future__ import annotations


class PsychoSightError(Exception):
    code = "INTERNAL_ERROR"
    http_status = 500

    def __init__(self, message: str):
        from .config import redact  # lazy: config must not import errors at module load

        message = redact(message)  # an API key (any source) never reaches an error body, log or report
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


class InvalidReasoningLevel(InvalidRequest, ValueError):
    """reasoning_level is not one of psychosight.reasoning.REASONING_IDS."""

    code = "INVALID_REASONING_LEVEL"
    http_status = 422


class DateRangeInvalid(InvalidRequest):
    """date_from is after date_to."""

    code = "DATE_RANGE_INVALID"
    http_status = 422


class DateRangeOutOfBounds(InvalidRequest):
    """The requested range does not overlap the conversation's first..last message dates."""

    code = "DATE_RANGE_OUT_OF_BOUNDS"
    http_status = 422


class ExperimentalConsentRequired(PsychoSightError):
    """score_other without experimental scores, or a consent echo that does not match /config."""

    code = "EXPERIMENTAL_CONSENT_REQUIRED"
    http_status = 422


class LLMOutputInvalid(PsychoSightError):
    """Model output failed schema validation (after the retry)."""

    code = "LLM_UNAVAILABLE"
    http_status = 503


class ReportInvalid(PsychoSightError):
    code = "INTERNAL_ERROR"
    http_status = 500
