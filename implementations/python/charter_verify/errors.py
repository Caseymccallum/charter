"""Refusals, and the two ways a check can fail to have an answer.

A rule that does not hold raises `Refusal` carrying the reason code the record
records. A rule that *cannot be applied* because something it needs is absent
raises `Blocked` carrying a `Blocker`: the check that owns the failure, the
status it will report, and the reason it will carry.

The distinction is the whole of SPEC section 10's first rule. A check that
never ran is SKIP, never PASS, and the difference between "this requirement
does not hold" and "this requirement was never tested" is the difference
between BROKEN and INCOMPLETE.
"""

from __future__ import annotations

from .vocabulary import (
    PREREQUISITE_FAILED,
    UNSUPPORTED,
    VERSION_GATE,
)


class Refusal(Exception):
    """A rule did not hold.

    `reason` is a reason code from SPEC section 10. `detail` is prose, and the
    spec says prose may be reworded between releases; `reason` may not.
    """

    def __init__(self, reason: str, detail: str) -> None:
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


class Blocker:
    """Why a check had no answer: the check that owns the failure, and it.

    `owner` is the id of the check that reports this failure as its own FAIL or
    UNSUPPORTED. Every other check that needed the same fact is SKIP, because
    the fact it needed is the fact that is missing — and it is reported once,
    by the check named here, rather than once per dependent.
    """

    def __init__(self, owner: str, status: str, reason: str, detail: str) -> None:
        self.owner = owner
        self.status = status
        self.reason = reason
        self.detail = detail

    def skip_reason(self) -> str:
        """What a dependent check carries when this blocker stops it.

        Two answers, and the difference is observable in the recorded kit. A
        check stopped because its prerequisite *failed* carries
        PREREQUISITE_FAILED. The single exception is the format version gate:
        SPEC section 5 says a value this verifier does not implement "produces
        UNSUPPORTED and stops the manifest checks", and every check it stops
        carries UNSUPPORTED_VERSION rather than the generic reason — which is
        how a reader can tell "nobody read the rules for this version" from
        "the rules were read and something in them broke".
        """
        if self.status == UNSUPPORTED and self.owner == VERSION_GATE:
            return self.reason
        return PREREQUISITE_FAILED


class Blocked(Exception):
    """Raised by a facility that cannot answer, carrying the Blocker."""

    def __init__(self, blocker: Blocker) -> None:
        super().__init__(blocker.detail)
        self.blocker = blocker
