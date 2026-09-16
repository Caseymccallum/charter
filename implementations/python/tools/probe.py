"""The differential probe: hand-built artifacts the conformance kit does not hold.

The kit is 54 artifacts with recorded answers. It is not the whole format: a
fixture can only ask about a rule somebody already thought of, and a rule nobody
wrote down is exactly where two implementations drift apart. This tool builds 20
artifacts by hand — a leading-zero integer, four spellings of an escape, an
uppercase digest, a key with a trailing bit pattern that is not zero, a log line
that is not an object, a CRLF line, an unknown field in four places — asks the
reference command line what it says about each one, and records the answer.

# What is here, and what is a probe

    python tools/probe.py --build    write vectors/probe/out/*.charter and the record
    python tools/probe.py --check    rebuild in memory and refuse if the record is stale

`--build` is the author's program: it needs `node` on PATH, because the answers
it records are the reference command line's, taken as a black box
(`node cli/charter.js verify <file> --json`). `--check` needs no runtime: it
rebuilds every artifact from its recipe and compares the bytes with the ones on
disk, which is how a fixture that drifted away from its recipe is caught.

Each case states what it *asks* (`asked`), and the record carries what the
reference *answered* (`expected`). When the two contradict each other, `--build`
writes nothing and says so: an artifact whose recorded answer is not the answer
the format requires is a broken fixture rather than a finding, and a probe that
quietly recorded whatever it was given would be a probe that cannot fail.

# Why the answers are recorded rather than asserted

Two of these 20 wanted an answer the specification did not give, and both are now
written down in it (a leading zero is a NON_INTEGER_NUMBER; `L0.PROVENANCE.NONEMPTY`
counts entries and not lines). The rest are cases where the specification is
clear and the *reference's* reading of it is what the second implementation was
compared against — SPEC.md section 16 and `implementations/python/README.md`
record which was which.

Nothing here reads `verifier/**`. The reference is a program that is run, not a
source file that is read, and the port's `tests/test_spec_gaps.py` holds the
outcomes this probe found.

Usage:
    python tools/probe.py --build [--quiet]
    python tools/probe.py --check
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve()
PYTHON_DIR = HERE.parents[1]
REPO = HERE.parents[3]
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from charter_verify import base64url, canonical  # noqa: E402
from tests.support import (  # noqa: E402
    MANIFEST,
    PROVENANCE,
    artifact,
    fixture_parts,
)

OUT_DIR = REPO / "vectors" / "probe" / "out"
RECORD_PATH = REPO / "vectors" / "probe" / "expected.json"
REFERENCE = ["node", "cli/charter.js", "verify"]

PROBE_NOTE = (
    "The answers in this file are the reference command line's, recorded as a black box by "
    "implementations/python/tools/probe.py --build. Each case carries the question it asks (`asked`) "
    "and the answer the reference gave (`expected`); vectors/probe/run.js replays both against the "
    "reference and, when a Python interpreter is installed, against implementations/python."
)


def base_manifest() -> dict:
    """The valid fixture's manifest, as a value."""
    return canonical.parse_document(fixture_parts()[MANIFEST])


def manifest_text() -> str:
    """The valid fixture's manifest, as the canonical text it is."""
    return canonical.canonical_document(base_manifest()).decode("utf-8")


def with_manifest(text: str) -> bytes:
    """An artifact whose manifest is exactly these bytes."""
    parts = fixture_parts()
    parts[MANIFEST] = text.encode("utf-8")
    return artifact(parts)


def with_log(data: bytes) -> bytes:
    """An artifact whose log is exactly these bytes."""
    parts = fixture_parts()
    parts[PROVENANCE] = data
    return artifact(parts)


def manifest_change(change) -> bytes:
    """An artifact whose manifest is the valid value with one field changed."""
    value = base_manifest()
    change(value)
    return with_manifest(canonical.canonical_document(value).decode("utf-8"))


def first_log_line() -> bytes:
    """The valid fixture's first log line, canonical and closed by one LF."""
    return canonical.canonical_document(
        canonical.parse_document(fixture_parts()[PROVENANCE].split(b"\n")[0])
    )


def probes() -> list[dict]:
    """Every case, in the order the record carries them.

    `asked` is what the case asks of the format: a verdict, and the checks that
    have to report the defect for the case to be the case it says it is. It is
    deliberately partial — the record carries the whole answer, and a case that
    restated the whole answer would be a second record rather than a question.
    """
    title = '"Charter: a .charter draft"'
    signature = base_manifest()["signature"]
    return [
        {
            "name": "zero-lead",
            "probe": "An integer written with a leading zero. SPEC.md 4.1 names `01` a NON_INTEGER_NUMBER; a manifest has no integer field, so one is appended beside an extra field, and the parse is the check that reads it.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.PARSE": "NON_INTEGER_NUMBER"}},
            "bytes": with_manifest(manifest_text()[:-2] + ',"level":01}\n'),
        },
        {
            "name": "escape-upper-hex",
            "probe": "`\\u00E9` written for `é`, in uppercase hexadecimal. SPEC.md 4 says a string is escaped the one way and everything outside the control characters is written literally, so this is well-formed JSON in the wrong spelling.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.CANONICAL": "NON_CANONICAL"}},
            "bytes": with_manifest(manifest_text().replace(title, '"\\u00E9"')),
        },
        {
            "name": "escape-solidus",
            "probe": "`\\/` written for `/` — the escape JSON allows and this format does not, because section 4 says `/` is `/`.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.CANONICAL": "NON_CANONICAL"}},
            "bytes": with_manifest(manifest_text().replace(title, '"a\\/b"')),
        },
        {
            "name": "escape-surrogate-pair",
            "probe": "A supplementary character written as a correctly paired surrogate escape. Section 4 keeps the pair as an ordinary character and says an escape belongs only where JSON requires one, so the value is right and the bytes are a second spelling of it.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.CANONICAL": "NON_CANONICAL"}},
            "bytes": with_manifest(manifest_text().replace(title, '"\\ud83d\\ude00"')),
        },
        {
            "name": "title-is-a-float",
            "probe": "`1e2` where the title belongs. Section 4.1 reports `1.0`, `1e0` and `-0` as NON_INTEGER_NUMBER; an exponent is the same family of spelling, and it is read before anything could notice that a title is a string.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.PARSE": "NON_INTEGER_NUMBER"}},
            "bytes": with_manifest(manifest_text().replace(title, "1e2")),
        },
        {
            "name": "manifest-array",
            "probe": "`[]` as the whole manifest: well-formed JSON, and not an object.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.PARSE": "MALFORMED"}},
            "bytes": with_manifest("[]\n"),
        },
        {
            "name": "manifest-duplicate-key",
            "probe": "A manifest with `title` twice. Section 4 refuses a duplicate key with reason DUPLICATE, because a reader that keeps the last one and a reader that keeps the first disagree about what was signed.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.PARSE": "DUPLICATE"}},
            "bytes": with_manifest(manifest_text()[:-2] + ',"title":"x"}\n'),
        },
        {
            "name": "manifest-format-missing",
            "probe": "The manifest without `format`. Section 5 gives the field to L0.FORMAT.IDENTIFIER, which runs before the fields, so an absent one is MISSING rather than a field defect.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.FORMAT.IDENTIFIER": "MISSING"}},
            "bytes": manifest_change(lambda value: value.pop("format")),
        },
        {
            "name": "manifest-format-not-a-string",
            "probe": "`format` as a number. The same check owns the field, and a value of the wrong type is MALFORMED.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.FORMAT.IDENTIFIER": "MALFORMED"}},
            "bytes": manifest_change(lambda value: value.__setitem__("format", 1)),
        },
        {
            "name": "digest-uppercase",
            "probe": "`content.sha256` in uppercase hex: the same digest spelled a second way. Section 5 gives a value's spelling to the checks that read it, so this is NON_CANONICAL_ENCODING on the two checks that read it — and the manifest bytes changed, so the signature no longer covers them.",
            "asked": {
                "verdict": "BROKEN",
                "fail": {
                    "L0.CONTENT.HASH": "NON_CANONICAL_ENCODING",
                    "L2.CHAIN.HEAD_MATCHES_CONTENT": "NON_CANONICAL_ENCODING",
                    "L1.MANIFEST.SIGNATURE": "MISMATCH",
                },
            },
            "bytes": manifest_change(
                lambda value: value["content"].__setitem__("sha256", value["content"]["sha256"].upper())
            ),
        },
        {
            "name": "nested-unknown-content-field",
            "probe": "An unknown field one level down, inside `content`. Section 5 says a field nobody interprets is reported rather than ignored.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.EXTRA_FIELDS": "UNKNOWN_FIELD"}},
            "bytes": manifest_change(lambda value: value["content"].__setitem__("length", 158)),
        },
        {
            "name": "nested-unknown-author-field",
            "probe": "The same defect one level down, inside `author`: an unknown field is reported rather than ignored, whichever level of the document it sits at.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.EXTRA_FIELDS": "UNKNOWN_FIELD"}},
            "bytes": manifest_change(lambda value: value["author"].__setitem__("nickname", "Casey")),
        },
        {
            "name": "public-key-31-bytes",
            "probe": "A public key of 31 bytes. Section 5 gives the key's encoding to L1.MANIFEST.KEY_ID and L1.MANIFEST.SIGNATURE, so a key that does not decode to 32 bytes is MALFORMED there rather than a field defect.",
            "asked": {
                "verdict": "BROKEN",
                "fail": {
                    "L1.MANIFEST.KEY_ID": "MALFORMED",
                    "L1.MANIFEST.SIGNATURE": "MALFORMED",
                },
            },
            "bytes": manifest_change(
                lambda value: value["author"].__setitem__("public_key", base64url.encode(bytes(31)))
            ),
        },
        {
            "name": "public-key-trailing-bits",
            "probe": "A base64url key whose unused trailing bits are not zero: the same 32 bytes in a second spelling, which is NON_CANONICAL_ENCODING rather than MALFORMED.",
            "asked": {
                "verdict": "BROKEN",
                "fail": {
                    "L1.MANIFEST.KEY_ID": "NON_CANONICAL_ENCODING",
                    "L1.MANIFEST.SIGNATURE": "NON_CANONICAL_ENCODING",
                },
            },
            "bytes": manifest_change(
                lambda value: value["author"].__setitem__(
                    "public_key",
                    value["author"]["public_key"][:-1]
                    + base64url.ALPHABET[
                        base64url.ALPHABET.index(value["author"]["public_key"][-1]) + 1
                    ],
                )
            ),
        },
        {
            "name": "signature-padded",
            "probe": "A signature with `=` padding: the same 64 bytes, spelled the way the format does not.",
            "asked": {"verdict": "BROKEN", "fail": {"L1.MANIFEST.SIGNATURE": "NON_CANONICAL_ENCODING"}},
            "bytes": manifest_change(lambda value: value.__setitem__("signature", signature + "=")),
        },
        {
            "name": "log-is-not-an-object",
            "probe": "A log whose only line is `[1,2]`: well-formed JSON, not an object, so it is not an entry — and an artifact whose log holds no entry is not one that states a history.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.PROVENANCE.PARSE": "MALFORMED"}},
            "bytes": with_log(b"[1,2]\n"),
        },
        {
            "name": "log-is-a-bare-number",
            "probe": "A log whose only line is the bare number `1`. Section 7 says one JSON object per line, and a number is not an object, so the line is PARSE's complaint and the artifact states no history.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.PROVENANCE.PARSE": "MALFORMED"}},
            "bytes": with_log(b"1\n"),
        },
        {
            "name": "log-line-with-crlf",
            "probe": "One canonical entry, closed by CRLF instead of LF. Section 7 says each line is closed by exactly one LF and section 4 says a line's bytes are the canonical form of its value followed by one LF, so the line parses and its bytes are a second spelling of it.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.PROVENANCE.CANONICAL": "NON_CANONICAL"}},
            "bytes": with_log(first_log_line().replace(b"\n", b"\r\n")),
        },
        {
            "name": "log-line-not-canonical",
            "probe": "A log line with a space after its colon: the value is well-formed and its bytes are not the canonical form of it.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.PROVENANCE.CANONICAL": "NON_CANONICAL"}},
            "bytes": with_log(b'{"action": "create"}\n'),
        },
        {
            "name": "log-line-unknown-field",
            "probe": "A canonical entry carrying one field this version does not define.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.PROVENANCE.EXTRA_FIELDS": "UNKNOWN_FIELD"}},
            "bytes": with_log(
                canonical.canonical_document(
                    dict(
                        canonical.parse_document(fixture_parts()[PROVENANCE].split(b"\n")[0]),
                        note="extra",
                    )
                )
            ),
        },
    ]


def digest(data: bytes) -> str:
    """The lowercase hex SHA-256 of some bytes, as the record states it."""
    return hashlib.sha256(data).hexdigest()


def tally(answer: dict) -> dict:
    """The five things a verdict is compared by, out of the reference's JSON.

    The same five the conformance kit compares: the verdict, the exit code, the
    checks that failed with their reason codes, the checks this runtime does not
    support, and how many checks were never reached. Prose is not compared, and
    must not be: SPEC.md 10 says a detail may be reworded between releases while
    a reason code may not.
    """
    fail = {}
    unsupported = {}
    skips = 0
    for check in answer["checks"]:
        if check["status"] == "FAIL":
            fail[check["id"]] = check["reason_code"]
        elif check["status"] == "UNSUPPORTED":
            unsupported[check["id"]] = check["reason_code"]
        elif check["status"] == "SKIP":
            skips += 1
    return {
        "verdict": answer["verdict"],
        "exit_code": answer["exit_code"],
        "fail": fail,
        "unsupported": unsupported,
        "skips": skips,
    }


def ask_reference(path: pathlib.Path) -> dict:
    """The reference command line's answer, taken as a black box."""
    try:
        completed = subprocess.run(
            [*REFERENCE, str(path), "--json"],
            cwd=REPO,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except FileNotFoundError:
        raise SystemExit(
            "node was not found on PATH: --build records the reference command line's answers, so it needs one"
        ) from None
    if completed.returncode not in (0, 1, 2):
        raise SystemExit(
            f"the reference exited {completed.returncode} on {path.name}: {completed.stderr.strip()[:400]}"
        )
    return json.loads(completed.stdout)


def contradictions(case: dict, expected: dict) -> list:
    """The ways the reference's answer is not the answer this case asks for."""
    problems = []
    asked = case["asked"]
    if asked["verdict"] != expected["verdict"]:
        problems.append(
            f"{case['name']}: this case asks for {asked['verdict']}, and the reference says {expected['verdict']}"
        )
    for check_id, code in asked.get("fail", {}).items():
        seen = expected["fail"].get(check_id)
        if seen != code:
            problems.append(
                f"{case['name']}: this case asks for {check_id}={code}, and the reference reports "
                f"{check_id}={seen if seen is not None else 'no failure'}"
            )
    return problems


def build(quiet: bool) -> int:
    """Write the artifacts and the record, or refuse and write nothing."""
    cases = probes()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    entries = []
    problems = []
    for case in cases:
        path = OUT_DIR / f"{case['name']}.charter"
        path.write_bytes(case["bytes"])
        answer = ask_reference(path)
        expected = tally(answer)
        problems.extend(contradictions(case, expected))
        entries.append(
            {
                "name": case["name"],
                "file": f"out/{case['name']}.charter",
                "bytes": len(case["bytes"]),
                "sha256": digest(case["bytes"]),
                "probe": case["probe"],
                "asked": case["asked"],
                "expected": expected,
            }
        )
        if not quiet:
            failed = ", ".join(f"{cid}={code}" for cid, code in sorted(expected["fail"].items()))
            print(
                f"{case['name']:<32} {expected['verdict']:<11} fail={len(expected['fail'])} "
                f"skip={expected['skips']:<2} {failed}"
            )

    if problems:
        print("")
        for problem in problems:
            print(problem)
        print(
            f"\n{len(problems)} case(s) whose recorded answer is not the answer the case asks for. "
            f"{RECORD_PATH.name} was not written: the format's answer and the reference's differ, and that is a "
            "finding to settle in SPEC.md rather than a record to overwrite."
        )
        return 1

    record = {
        "probe": "charter differential probes",
        "format": "charter/0.1",
        "built_by": "implementations/python/tools/probe.py --build",
        "note": PROBE_NOTE,
        "cases": entries,
    }
    RECORD_PATH.write_text(
        json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n"
    )
    if not quiet:
        print(f"\n{len(entries)} probe(s) recorded in {RECORD_PATH.relative_to(REPO)}")
    return 0


def check() -> int:
    """Rebuild every artifact in memory and refuse if the record is stale."""
    if not RECORD_PATH.exists():
        print(f"{RECORD_PATH.relative_to(REPO)} does not exist: run --build first")
        return 1
    record = json.loads(RECORD_PATH.read_text(encoding="utf-8"))
    recorded = {entry["name"]: entry for entry in record["cases"]}
    problems = []
    for case in probes():
        entry = recorded.pop(case["name"], None)
        if entry is None:
            problems.append(f"{case['name']}: the record does not name this probe")
            continue
        if entry["asked"] != case["asked"]:
            problems.append(f"{case['name']}: the record carries a different question than the case asks")
        if entry["bytes"] != len(case["bytes"]) or entry["sha256"] != digest(case["bytes"]):
            problems.append(
                f"{case['name']}: the record describes {entry['bytes']} byte(s) and {entry['sha256']}, "
                f"and the recipe builds {len(case['bytes'])} byte(s) and {digest(case['bytes'])}"
            )
        path = OUT_DIR / f"{case['name']}.charter"
        try:
            on_disk = path.read_bytes()
        except FileNotFoundError:
            problems.append(f"{case['name']}: {path.name} is not on disk")
            continue
        if on_disk != case["bytes"]:
            problems.append(f"{case['name']}: the file on disk is not the one the recipe builds")
    for name in sorted(recorded):
        problems.append(f"{name}: the record names a probe that no longer exists")

    for problem in problems:
        print(problem)
    if problems:
        print(f"\n{len(problems)} problem(s): the probe's fixtures and its record are not the same thing")
        return 1
    print(f"{len(record['cases'])} probe(s): every artifact matches its recipe, and every question matches the record")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="the differential probe's builder and its consistency check")
    parser.add_argument("--build", action="store_true", help="write the artifacts and the record")
    parser.add_argument("--check", action="store_true", help="fail if the artifacts on disk are not what the recipes build")
    parser.add_argument("--quiet", action="store_true", help="print nothing but problems")
    arguments = parser.parse_args()
    if arguments.build == arguments.check:
        parser.error("pass exactly one of --build and --check")
    return build(arguments.quiet) if arguments.build else check()


if __name__ == "__main__":
    raise SystemExit(main())
