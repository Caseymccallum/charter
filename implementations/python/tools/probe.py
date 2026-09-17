"""The differential probe: hand-built artifacts the conformance kit does not hold.

The kit is 54 artifacts with recorded answers. It is not the whole format: a
fixture can only ask about a rule somebody already thought of, and a rule nobody
wrote down is exactly where two implementations drift apart. This tool builds 27
artifacts by hand — a leading-zero integer, a `created_at` whose value opens a
number token where the opening quote should be, four spellings of an escape, an
uppercase digest, a key with a trailing bit pattern that is not zero, a log line
that is not an object, a CRLF line, an unknown field in four places, an empty
digest, an empty signature, a parent in uppercase, an empty `format`, an empty
`key_id`, and a first entry whose parent is a valid digest where `null` is
required — asks the reference command line what it says about each one, and
records the answer.

# What is here, and what is a probe

    python tools/probe.py --build    write vectors/probe/out/*.charter and the record
    python tools/probe.py --check    rebuild in memory and refuse if the record is stale

`--build` is the author's program: it needs `node` on PATH, because the answers
it records are the reference command line's, taken as a black box
(`node cli/charter.js verify <file> --json`). `--check` needs no runtime: it
rebuilds every artifact from its recipe and compares the bytes with the ones on
disk, which is how a fixture that drifted away from its recipe is caught.

Each case states what it *asks* (`asked`), and the record carries what the
reference *answered* (`expected`). `--build` refuses twice over. It refuses when
the two contradict each other — an artifact whose recorded answer is not the answer
the format requires is a broken fixture rather than a finding, and a probe that
quietly recorded whatever it was given would be a probe that cannot fail. And it
refuses when the *port* answers a case differently from the reference: a case both
implementations do not agree about is the finding itself, and writing one of the
two answers into the record would file a disagreement as a settled answer. What
the record holds is what both of them said.

# Why the answers are recorded rather than asserted

Two of these wanted an answer the specification did not give, and both are now
written down in it (a leading zero is a NON_INTEGER_NUMBER; `L0.PROVENANCE.NONEMPTY`
counts entries and not lines). A third is the opposite case, and the reason this
file exists in a repository whose spec already has a second reading of it: an
entry with no `content_sha256` at all was reported as a *spelling* problem by both
implementations, while `L0.PROVENANCE.CONTENT_HASH_FORMAT`'s own sentence said
"absent (MISSING)" and the vocabulary has a code for exactly that. Two
implementations that are wrong the same way agree about everything, including the
mistake; a probe that asks the question in the spec's words is what turns that
into a finding. Section 10, section 5 and section 7 now say which code an absent
field carries, and `vectors/probe/expected.json` records it.

Three more are that same finding in other fields, and they were found the way it
was: by asking. An empty `content_sha256`, an empty signature and a parent written
in uppercase are all cases where `L0.PROVENANCE.FIELDS` measured a string that the
check reading the value owns — a complaint taken from the check that can name it,
one FAIL where the format has two sentences, and seven checks skipped that had an
answer. SPEC.md section 10's head now states the rule those three are the test of
(one requirement, one owner), §10.2 is that rule applied to all 30 checks, and
`implementations/python/tests/test_spec_gaps.py` holds the three answers.

Three further cases were settled by that rule without ever being a disagreement,
and this pass turned them into fixtures because a rule the repository's own tests
hold is not a rule a stranger can check: an empty `format` (a present string that
names no version, which the version gate owns, so the artifact is unproven rather
than broken), an empty `author.key_id` (FIELDS' own requirement, because no other
check reads a key id), and a first entry whose `parent` is a valid digest where
`null` is required (`L2.CHAIN.FIRST_PARENT_NULL`'s value, and not the spelling
failure `L2.CHAIN.LINKS` reports for a non-digest alongside it). §10.2's
`settled by` column names each row's case, and these three moved that column's
`prose` rows to `fixture`.

The rest are cases where the specification is clear and the *reference's* reading
of it is what the second implementation was compared against — SPEC.md section 16
and `implementations/python/README.md` record which was which.

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
from tools.differential import differences, port_tally, reference_tally  # noqa: E402

OUT_DIR = REPO / "vectors" / "probe" / "out"
RECORD_PATH = REPO / "vectors" / "probe" / "expected.json"
REFERENCE = ["node", "cli/charter.js", "verify"]

PROBE_NOTE = (
    "The answers in this file are the reference command line's, recorded as a black box by "
    "implementations/python/tools/probe.py --build, which refuses to write a record when the "
    "reference and the port disagree about a case. Each case carries the question it asks (`asked`) "
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


def first_parent_with_a_predecessor() -> bytes:
    """The valid log whose first entry names a predecessor, with the chain rebuilt.

    Line 1 gets a well-formed digest where `null` is required, and line 2's parent
    is recomputed over line 1 as it now stands, so the link between the two lines
    is exactly what section 9 requires and `L2.CHAIN.LINKS` has nothing to say
    about it. The one requirement this artifact breaks is the first entry's, which
    `L2.CHAIN.FIRST_PARENT_NULL` owns — and that is the question: which check
    answers for the first entry's parent. Signatures are not recomputed, so
    `L1.PROVENANCE.SIGNATURES` reports them stale, which is a second defect and
    not part of the question.
    """
    entries = [
        canonical.parse_document(one)
        for one in fixture_parts()[PROVENANCE].split(b"\n")
        if one
    ]
    entries[0]["parent"] = hashlib.sha256(b"a line that is not in this log\n").hexdigest()
    # `canonical_document` writes the canonical form *plus the one LF that closes
    # it*, so the digest of "line 1 as it stands in the file" is the digest of
    # exactly these bytes — section 9's rule, not an extra newline.
    line = canonical.canonical_document(entries[0])
    entries[1]["parent"] = hashlib.sha256(line).hexdigest()
    return with_log(b"".join(canonical.canonical_document(one) for one in entries))


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
            "name": "created-at-value-opens-a-number",
            "probe": "`created_at`'s value with its opening quote replaced by a newline, so the bytes `2026-01-01T00:00:00Z` stand where a value belongs. The parse finds a number token where a value is due and the token is not the one spelling of an integer, so `L0.MANIFEST.PARSE` reports NON_INTEGER_NUMBER — the family `01` is in, and for the same reason: the bytes where a number belongs are a number spelled wrong rather than a value of another kind. The two implementations disagreed here until section 4 fixed where a number token ends: the reference ran the token to the first character that cannot occur in one (`2026-01-01`) and reported NON_INTEGER_NUMBER, while this port's scanner stopped at the `-`, kept `2026` as its number, and reported MALFORMED about an object that holds a `-` where a comma or a brace was due. The port moved, and this case is the fixture that keeps the disagreement from coming back.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.PARSE": "NON_INTEGER_NUMBER"}},
            "bytes": with_manifest(
                manifest_text().replace('"created_at":"', '"created_at":\n')
            ),
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
            "probe": "A log line with a space after its colon: the value is well-formed and its bytes are not the canonical form of it. The line also carries one field of the seven an entry needs, and the six that are absent are MISSING — this is the case that settled it, and the only finding in this probe that was a bug in the reference rather than a silence in the spec: section 10 defines MISSING for \"a required thing is absent\", and the reference reported a spelling code for a digest that is not there.",
            "asked": {
                "verdict": "BROKEN",
                "fail": {
                    "L0.PROVENANCE.CANONICAL": "NON_CANONICAL",
                    "L0.PROVENANCE.FIELDS": "MISSING",
                    "L0.PROVENANCE.CONTENT_HASH_FORMAT": "MISSING",
                },
            },
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
        {
            "name": "log-line-empty-content-hash",
            "probe": "An entry whose `content_sha256` is the empty string. It is a string, so the seven fields are present and correctly typed and `L0.PROVENANCE.FIELDS` has nothing to say; what is wrong is that `\"\"` is not 64 lowercase hex characters, which is the sentence of the check that reads the digest. The reference used to report it as a malformed *field* and skip the seven checks that had an answer, which is the same finding as `log-line-not-canonical` in a different field.",
            "asked": {
                "verdict": "BROKEN",
                "fail": {
                    "L0.PROVENANCE.CONTENT_HASH_FORMAT": "NON_CANONICAL_ENCODING",
                    "L1.PROVENANCE.SIGNATURES": "MISMATCH",
                    "L2.CHAIN.HEAD_MATCHES_CONTENT": "NON_CANONICAL_ENCODING",
                },
            },
            "bytes": log_with(lambda entry: entry.__setitem__("content_sha256", "")),
        },
        {
            "name": "log-line-empty-signature",
            "probe": "An entry whose signature is the empty string. `\"\"` is the one spelling of the empty byte string, so this is not a spelling problem at all: the signature decodes to 0 bytes where Ed25519 uses 64, which is MALFORMED, and `L1.PROVENANCE.SIGNATURES` is the check that says so. The reference used to report it as a malformed *field* instead.",
            "asked": {"verdict": "BROKEN", "fail": {"L1.PROVENANCE.SIGNATURES": "MALFORMED"}},
            "bytes": log_with(lambda entry: entry.__setitem__("signature", "")),
        },
        {
            "name": "log-line-bad-parent",
            "probe": "An entry whose `parent` is the digest of the line before it written in uppercase: the same 64 hex characters, in the one other spelling of them. `parent` is a string or null as far as the fields are concerned, and the value is a digest to `L2.CHAIN.LINKS`, so this is NON_CANONICAL_ENCODING rather than a link that does not match — and rather than a malformed field, which is what the reference reported before section 10 said which check owns a parent.",
            "asked": {
                "verdict": "BROKEN",
                "fail": {
                    "L2.CHAIN.LINKS": "NON_CANONICAL_ENCODING",
                    "L1.PROVENANCE.SIGNATURES": "MISMATCH",
                },
            },
            "bytes": log_with(lambda entry: entry.__setitem__("parent", entry["parent"].upper())),
        },
        {
            "name": "manifest-empty-format",
            "probe": "`format` is the empty string. It is not an absence: the key is there, so MISSING is not the word for it. It is not a malformation either: `\"\"` is a string, so MALFORMED is not the word for it. It is a present string that names no version this format implements, and section 5's three cases are absent, not a string, and a value this verifier does not implement — the empty string is the third, so the version gate owns it and the verdict is INCOMPLETE rather than BROKEN. The checks that depend on a manifest value are SKIP behind the gate, which is §10.1 and not a second failure.",
            "asked": {
                "verdict": "INCOMPLETE",
                "unsupported": {"L0.FORMAT.IDENTIFIER": "UNSUPPORTED_VERSION"},
            },
            "bytes": manifest_change(lambda value: value.__setitem__("format", "")),
        },
        {
            "name": "manifest-empty-key-id",
            "probe": "`author.key_id` is the empty string. Section 5's table asks for a non-empty string, and this is empty, so `L0.MANIFEST.FIELDS` reports MALFORMED — and it is FIELDS that reports it because no other check reads a key id: `L1.MANIFEST.KEY_ID` derives the id from the public key and compares the two, and it cannot run until the fields are readable. The checks that need a manifest value are SKIP, exactly as they are for any other thing FIELDS refuses.",
            "asked": {"verdict": "BROKEN", "fail": {"L0.MANIFEST.FIELDS": "MALFORMED"}},
            "bytes": manifest_change(lambda value: value["author"].__setitem__("key_id", "")),
        },
        {
            "name": "log-first-parent-nonnull",
            "probe": "The first entry's `parent` is a well-formed digest — 64 lowercase hex characters — of a line that is not in this log, and the second entry's parent is recomputed over the first line as it now stands, so the link between them is exactly what section 9 asks for and `L2.CHAIN.LINKS` passes. The question is which check answers for the first entry's parent. It is not a spelling problem: the value is a digest, so nothing here is NON_CANONICAL_ENCODING. It is not LINKS' value either: section 9's LINKS reads every *later* entry's parent, and the first entry's is the one value `L2.CHAIN.FIRST_PARENT_NULL` owns, whatever it holds. The requirement there is that the chain starts from nothing, so a digest where `null` is required is MISMATCH and nothing else. Compare `log-line-bad-parent` in this probe, where the same field holds a non-digest string on an entry LINKS does read: that is a spelling failure and LINKS owns it. The kit's `log-reordered` shows the same field failing, but it moves both entries, so LINKS fails there too and the two owners are not separated.",
            "asked": {
                "verdict": "BROKEN",
                "fail": {"L2.CHAIN.FIRST_PARENT_NULL": "MISMATCH"},
                "pass": ["L2.CHAIN.LINKS"],
            },
            "bytes": first_parent_with_a_predecessor(),
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


def log_with(change, line: int = -1) -> bytes:
    """The valid log with one entry's fields changed, and nothing recomputed."""
    lines = [
        canonical.parse_document(one)
        for one in fixture_parts()[PROVENANCE].split(b"\n")
        if one
    ]
    change(lines[line])
    return with_log(b"".join(canonical.canonical_document(one) for one in lines))


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


def disagreements(case: dict, expected: dict, port: dict) -> list:
    """The ways the port's answer is not the one the reference gave."""
    return [
        f"{case['name']}: the reference and the port disagree — {line}"
        for line in differences(expected, port)
    ]


def contradictions(case: dict, expected: dict) -> list:
    """The ways the reference's answer is not the answer this case asks for."""
    problems = []
    asked = case["asked"]
    if asked["verdict"] != expected["verdict"]:
        problems.append(
            f"{case['name']}: this case asks for {asked['verdict']}, and the reference says {expected['verdict']}"
        )
    for group in ("fail", "unsupported"):
        for check_id, code in asked.get(group, {}).items():
            seen = expected[group].get(check_id)
            if seen != code:
                problems.append(
                    f"{case['name']}: this case asks for {check_id}={code}, and the reference reports "
                    f"{check_id}={seen if seen is not None else 'no such result'}"
                )
    for check_id in asked.get("pass", []):
        seen = expected["fail"].get(check_id) or expected["unsupported"].get(check_id)
        if seen is not None:
            problems.append(
                f"{case['name']}: this case asks for {check_id} to pass, and the reference reports "
                f"{check_id}={seen}"
            )
    return problems


def build(quiet: bool) -> int:
    """Write the artifacts and the record, or refuse and write nothing."""
    cases = probes()
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    entries = []
    problems = []
    refusals = []
    for case in cases:
        path = OUT_DIR / f"{case['name']}.charter"
        path.write_bytes(case["bytes"])
        answer = ask_reference(path)
        expected = reference_tally(answer)
        problems.extend(contradictions(case, expected))
        refusals.extend(disagreements(case, expected, port_tally(case["bytes"])))
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

    if problems or refusals:
        print("")
        for problem in problems:
            print(problem)
        for refusal in refusals:
            print(refusal)
        if refusals:
            print(
                f"\n{len(refusals)} case(s) the two implementations do not agree about. "
                f"{RECORD_PATH.name} was not written: a case whose answer depends on which "
                "implementation you ask is a finding to settle in SPEC.md, and recording one of "
                "the two answers would file it as settled."
            )
        if problems:
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
