"""What two implementations are compared by: five things, and never prose.

A verdict is compared by its verdict, its exit code, the checks that failed with
their reason codes, the checks this runtime does not support with theirs, and how
many checks were never reached. That is the list the conformance kit compares, the
probe compares and the sweep compares, and it is the whole list: SPEC.md section 10
says a detail may be reworded between releases while a reason code may not, so a
tool that compared a sixth thing — a sentence, a duration — would report
differences the format does not have.

It lives here rather than in each tool because the three tools must ask the same
question of an answer. `tools/probe.py` records the reference's answer and refuses
to write a record the port disagrees with; `tools/sweep.py` asks both
implementations about one field at a time. Two copies of this comparison would be
two chances for the third one to be a little different.
"""

from __future__ import annotations

#: The five keys, in the order a verdict states them.
FIVE = ("verdict", "exit_code", "fail", "unsupported", "skips")


def summarise(results) -> tuple:
    """The two groups and the count, out of (id, status, reason_code) triples."""
    fail = {}
    unsupported = {}
    skips = 0
    for check_id, status, reason_code in results:
        if status == "FAIL":
            fail[check_id] = reason_code
        elif status == "UNSUPPORTED":
            unsupported[check_id] = reason_code
        elif status == "SKIP":
            skips += 1
    return fail, unsupported, skips


def reference_tally(answer: dict) -> dict:
    """The reference command line's JSON, as the five things compared."""
    fail, unsupported, skips = summarise(
        (check["id"], check["status"], check["reason_code"]) for check in answer["checks"]
    )
    return {
        "verdict": answer["verdict"],
        "exit_code": answer["exit_code"],
        "fail": fail,
        "unsupported": unsupported,
        "skips": skips,
    }


def port_tally(data: bytes) -> dict:
    """This repository's port, asked the same five questions about the same bytes."""
    from charter_verify import verify

    verdict = verify(data)
    fail, unsupported, skips = summarise(
        (result.id, result.status, result.reason_code) for result in verdict.results
    )
    return {
        "verdict": verdict.verdict,
        "exit_code": verdict.exit_code,
        "fail": fail,
        "unsupported": unsupported,
        "skips": skips,
    }


def differences(reference: dict, port: dict) -> list:
    """Every way one answer is not the other, one line each."""
    out = []
    for field in ("verdict", "exit_code", "skips"):
        if reference[field] != port[field]:
            out.append(f"{field}: reference {reference[field]!r}, port {port[field]!r}")
    for field, absent in (("fail", "no failure"), ("unsupported", "not unsupported")):
        for check_id in sorted(set(reference[field]) | set(port[field])):
            one = reference[field].get(check_id, absent)
            two = port[field].get(check_id, absent)
            if one != two:
                out.append(f"{field} {check_id}: reference {one}, port {two}")
    return out


def describe(answer: dict) -> str:
    """One line: the verdict, what failed, and how much was never reached."""
    failed = ", ".join(f"{cid}={code}" for cid, code in sorted(answer["fail"].items()))
    return (
        f"{answer['verdict']} exit={answer['exit_code']} "
        f"fail={{{failed}}} unsupported={len(answer['unsupported'])} skip={answer['skips']}"
    )
