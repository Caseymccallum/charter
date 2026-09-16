"""A verdict: the 30 checks, a name, and an exit code. SPEC section 10.

"Three verdicts, over all 30 checks": every check PASS is VERIFIED and exits 0;
no FAIL with at least one SKIP or UNSUPPORTED is INCOMPLETE and exits 1; any
FAIL is BROKEN and exits 2. There is no fourth verdict and no "pass with
warnings".

The JSON form is the interface a script consumes, and SPEC section 12.1 states it
key for key: the eight keys, the `summary` counts, every check's id, status and
reason code, and the rule for when `artifact` is `null`. The keys below are that
section, in the order it lists them. Section 12.1 also says what kind of
requirement it is: the format needs no command line, and an implementation that
offers `verify --json` prints this shape because the recorded answers are compared
through it.
"""

from __future__ import annotations

from . import checks
from .vocabulary import (
    BROKEN,
    EXIT_OF_VERDICT,
    FAIL,
    INCOMPLETE,
    LIMITATIONS,
    PASS,
    SKIP,
    UNSUPPORTED,
    VERIFIED,
)

STATUS_WIDTH = 12
DETAIL_INDENT = 15
# The column the five statements of section 11 are printed in, so that their
# continuation lines line up under the statement rather than under the id.
LIMITATION_INDENT = 4 + 33 + 1
WRAP = 88


class Verdict:
    """What one artifact came to, in every shape it is reported in."""

    def __init__(self, data: bytes) -> None:
        results, ctx = checks.examine(data)
        self.results = results
        self.size = len(data)
        self.artifact = ctx.summary()
        self.verdict = self._name()
        self.exit_code = EXIT_OF_VERDICT[self.verdict]

    def _name(self) -> str:
        statuses = [result.status for result in self.results]
        if FAIL in statuses:
            return BROKEN
        if SKIP in statuses or UNSUPPORTED in statuses:
            return INCOMPLETE
        return VERIFIED

    def counts(self) -> dict:
        tally = {PASS: 0, FAIL: 0, UNSUPPORTED: 0, SKIP: 0}
        for result in self.results:
            tally[result.status] += 1
        return tally

    def failures(self) -> list:
        return [
            result
            for result in self.results
            if result.status in (FAIL, UNSUPPORTED)
        ]

    def to_json(self, file: str) -> dict:
        """The verdict as the reference CLI prints it, key for key."""
        tally = self.counts()
        return {
            "file": file,
            "bytes": self.size,
            "verdict": self.verdict,
            "exit_code": self.exit_code,
            "summary": {
                "pass": tally[PASS],
                "fail": tally[FAIL],
                "unsupported": tally[UNSUPPORTED],
                "skip": tally[SKIP],
                "total": len(self.results),
            },
            "artifact": self.artifact,
            "checks": [
                {
                    "id": result.id,
                    "level": result.level,
                    "status": result.status,
                    "reason_code": result.reason_code,
                    "detail": result.detail,
                    "requirement": result.requirement,
                }
                for result in self.results
            ],
            "limitations": [
                {"id": id, "statement": statement} for id, statement in LIMITATIONS
            ],
        }

    def human(self, file: str, show_all: bool = False) -> str:
        """The form a person reads: what did not pass, and what it does not mean."""
        tally = self.counts()
        out = [
            f"{file}  ({self.size} byte(s))",
            "",
            f"{self.verdict}  {file}",
            "",
            f"  {tally[FAIL]} failed, {tally[UNSUPPORTED]} unsupported, "
            f"{tally[SKIP]} not reached, {tally[PASS]} passed, of {len(self.results)}.",
            "",
        ]
        if self.artifact is not None:
            claim = self.artifact
            out += [
                f"  {'title':<14} {claim['title']}",
                f"  {'author':<14} {claim['author_name']} ({claim['author_key_id']})",
                f"  {'created':<14} {claim['created_at']}",
                f"  {'format':<14} {claim['format']}",
                f"  {'entries':<14} {claim['entries']}",
                f"  {'head digest':<14} {claim['head_content_sha256']}",
                "",
            ]
        shown = self.results if show_all else self.failures()
        if not shown:
            out += ["  every check passed; run with --all to list them.", ""]
        else:
            out.append("  checks:")
            for result in shown:
                out.append(
                    f"    {result.status:<10} {result.id}  ({result.reason_code})"
                )
                out += _wrap(result.detail)
                out.append("")
        out.append("  what a passing verdict does not mean:")
        for id, statement in LIMITATIONS:
            lines = _wrap(statement, indent=LIMITATION_INDENT, limit=WRAP)
            out.append(f"    {id:<33} {lines[0].strip()}")
            out += lines[1:]
        return "\n".join(out)


def _wrap(text: str, indent: int = DETAIL_INDENT, limit: int = WRAP) -> list:
    words = text.split()
    lines: list[str] = []
    current = " " * indent
    for word in words:
        candidate = f"{current}{word}" if current.strip() == "" else f"{current} {word}"
        if len(candidate) > limit and current.strip() != "":
            lines.append(current)
            current = " " * indent + word
        else:
            current = candidate
    lines.append(current)
    return lines
