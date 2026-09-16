"""Replay the conformance kit with the Python verifier.

This is the reader's program, written a second time: it reads
`vectors/expected.json`, reads each `.charter` file the record names, asks *this*
verifier for a verdict, and compares. It builds nothing.

It also watches itself. SPEC section 12 says the reference's tests enforce the
rule that the verifier is a function from bytes to a verdict, and the brief for
this port adds a harder one: **the Python verifier must pass the kit without
reading any file inside `verifier/**`**. A reader that needed to open the
reference to decide what a fixture meant would be a reader that had not read the
spec, and the point of the exercise is to find out whether the spec is a spec.
So the replay hears every file the interpreter opens, records the ones under
`verifier/`, and refuses to call the run clean if there is one.

Usage: python -m charter_verify.kit [--vectors <dir>]
"""

from __future__ import annotations

import hashlib
import json
import os
import pathlib
import sys

from .verify import verify

HERE = pathlib.Path(__file__).resolve()
REPO = HERE.parents[3]
DEFAULT_VECTORS = REPO / "vectors"

_OPENED: list[str] = []


def watch(root: pathlib.Path) -> None:
    """Record every open under this directory, from this moment on."""
    prefix = str(root.resolve())

    def hook(event: str, arguments) -> None:
        if event != "open":
            return
        try:
            path = pathlib.Path(os.fspath(arguments[0])).resolve()
        except (TypeError, ValueError):
            return
        if str(path).startswith(prefix):
            _OPENED.append(str(path))

    sys.addaudithook(hook)


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def tally(results: list) -> dict:
    """The three shapes the record compares: fail, unsupported, and skips."""
    fail = {}
    unsupported = {}
    skips = 0
    for result in results:
        if result.status == "FAIL":
            fail[result.id] = result.reason_code
        elif result.status == "UNSUPPORTED":
            unsupported[result.id] = result.reason_code
        elif result.status == "SKIP":
            skips += 1
    return {"fail": fail, "unsupported": unsupported, "skips": skips}


def compare_reasons(name: str, seen: dict, stated: dict, label: str) -> list:
    problems = []
    for id, code in stated.items():
        if id not in seen:
            problems.append(f"{name}: {id} must be {label} and is not")
        elif seen[id] != code:
            problems.append(
                f"{name}: {id} carries reason {seen[id]}, and the record says it must "
                f"be {code}"
            )
    for id, code in seen.items():
        if id not in stated:
            problems.append(
                f"{name}: {id} is {label} ({code}), and the record does not expect it "
                "to be"
            )
    return problems


def compare(recorded: dict, verdict) -> list:
    name = str(recorded["name"])
    stated = recorded["expected"]
    problems = []
    if verdict.verdict != stated["verdict"]:
        problems.append(
            f"{name}: verdict is {verdict.verdict}, and the record says it must be "
            f"{stated['verdict']}"
        )
    if verdict.exit_code != stated["exit_code"]:
        problems.append(
            f"{name}: exit code is {verdict.exit_code}, and the record says it must be "
            f"{stated['exit_code']}"
        )
    seen = tally(verdict.results)
    problems += compare_reasons(name, seen["fail"], stated["fail"], "FAIL")
    problems += compare_reasons(
        name, seen["unsupported"], stated.get("unsupported", {}), "UNSUPPORTED"
    )
    if seen["skips"] != stated["skips"]:
        ids = [r.id for r in verdict.results if r.status == "SKIP"]
        problems.append(
            f"{name}: {seen['skips']} check(s) were never reached, and the record says "
            f"{stated['skips']}: {', '.join(ids)}"
        )
    return problems


def describe(verdict) -> str:
    seen = tally(verdict.results)
    parts = [verdict.verdict]
    failed = [f"{id} ({code})" for id, code in seen["fail"].items()]
    unsupported = [f"{id} ({code})" for id, code in seen["unsupported"].items()]
    if failed:
        parts.append("fail: " + ", ".join(failed))
    if unsupported:
        parts.append("unsupported: " + ", ".join(unsupported))
    if seen["skips"]:
        parts.append(f"skips: {seen['skips']}")
    return "  ".join(parts)


def replay(vectors: pathlib.Path) -> tuple:
    """Every case, and every way this verifier disagreed with the record."""
    record = json.loads((vectors / "expected.json").read_text(encoding="utf-8"))
    cases = record.get("cases") or []
    if not cases:
        raise SystemExit(
            "vectors/expected.json holds no cases, so there is nothing to replay"
        )
    problems = []
    widest = max(len(str(case["name"])) for case in cases)
    matched = 0
    for case in cases:
        name = str(case["name"])
        try:
            data = (vectors / str(case["file"])).read_bytes()
        except OSError as problem:
            problems.append(f"{name}: {case['file']} could not be read ({problem})")
            print(f"{name:<{widest}}  unreadable")
            continue
        digest = sha256_hex(data)
        if len(data) != case["bytes"] or digest != case["sha256"]:
            problems.append(
                f"{name}: the file on disk is not the one the record describes "
                f"({len(data)} bytes, sha256 {digest}; the record says {case['bytes']} "
                f"bytes, sha256 {case['sha256']})"
            )
        verdict = verify(data)
        found = compare(case, verdict)
        if not found:
            matched += 1
        problems += found
        print(f"{name:<{widest}}  {describe(verdict)}")
    return cases, matched, problems


def main(argv=None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    vectors = DEFAULT_VECTORS
    if arguments:
        if len(arguments) == 2 and arguments[0] == "--vectors":
            vectors = pathlib.Path(arguments[1])
        else:
            sys.stderr.write("usage: python -m charter_verify.kit [--vectors <dir>]\n")
            return 64
    if not (vectors / "expected.json").exists():
        sys.stderr.write(
            f"charter-verify.kit: {vectors / 'expected.json'} could not be read\n"
        )
        return 1

    watch(REPO / "verifier")
    cases, matched, problems = replay(vectors)

    for problem in problems:
        sys.stderr.write(f"  {problem}\n")
    # The architectural rule, stated as a result rather than as a promise.
    if _OPENED:
        problems.append(
            f"the verifier opened {len(_OPENED)} file(s) under verifier/**, which is "
            "the one thing it must not need to do: "
            + ", ".join(sorted(set(_OPENED)))
        )
        sys.stderr.write(f"  {problems[-1]}\n")
    if problems:
        print(f"\n{len(problems)} mismatch(es) across {len(cases)} case(s).")
        return 1
    print(
        f"\n{len(cases)} case(s) replayed, and every verdict is the one the record "
        f"states; {matched} matched exactly."
    )
    print("no file under verifier/** was opened.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
