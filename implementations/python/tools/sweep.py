"""The differential sweep: every field of the two documents, eight ways each.

The conformance kit holds 54 artifacts with recorded answers and the probe holds
20 more built by hand. Both are finite, and both were written by people thinking
about one rule at a time: a fixture can only ask about a rule somebody already
stated, so a rule two implementations read differently *and* nobody wrote a
fixture for is invisible to both. Three findings of that shape are already
recorded — an absent digest reported as a misspelling, an absent entry field
reported as a misspelling, an absent `content_sha256` reported the same way — and
each of them was found by a person asking a question rather than by a run.

This tool asks all of them. It takes the valid fixture and rewrites one field at
a time, every way a field can be written that is not the way the format writes
it: absent, `null`, a number, a short string, the empty string, an array, an
object, the same string in uppercase, a character outside the alphabet, a padded
spelling, and one character short of its own spelling. For each artifact it asks
both implementations — the reference command line as a black box, and this
repository's port — and prints the cases where their answers differ.

# What the sweep is and is not

    python tools/sweep.py                 sweep and report (needs node on PATH)
    python tools/sweep.py --all           report every case, agreeing ones too
    python tools/sweep.py --only parent   report one family of cases
    python tools/sweep.py --out DIR       keep the artifacts it built, in DIR

It is not a record and not a fixture. Nothing here is committed: the sweep is a
*finding* tool, and a finding belongs in SPEC.md or in a fixture once it is
settled, not in a tool that re-asks it forever. What is committed is the tool
itself, so that the question "do these two implementations read this field the
same way?" can be asked again in one command, with an answer that is a list of
cases rather than an opinion.

A case is one field, one document, and one encoding of it. The answers are
compared by the five things a verdict is compared by everywhere else in this
repository — the verdict, the exit code, the failed checks with their reason
codes, the unsupported checks, and the count of checks never reached — and
`--all` prints the whole tally, so a case that agrees can be read rather than
assumed. Prose is not compared, and must not be: SPEC.md section 10 says a
detail may be reworded between releases while a reason code may not.

# What it does not do, and the fuzzer after it

A sweep is not a fuzzer. It knows the *shape* of a document — which fields exist,
which JSON kinds they take, which spellings this format fixes — and asks about each
one; it cannot ask about a shape nobody described, and what it cannot reach is
exactly what a fuzzer reaches: a container's byte offsets and declared sizes, a
document that is well formed everywhere and wrong in two places at once, a log whose
entries disagree with each other. The kit's own `no single changed byte of the
accepted artifact is accepted` is that idea applied to one artifact. A differential
fuzzer here would be that test with both implementations asked and their five things
compared: mutate the *container* — entry names and order, declared sizes and
CRC-32s, compression methods, flag words, the end record — and, less often, the
values, and compare each result. It is worth building, and the case for it is the
container: two ZIP walkers that agree on 54 fixtures and 212 field-level cases are
still two implementations of one offset arithmetic, and an offset is where a read
can succeed and mean something else. What it would need that this sweep did not: a
corpus of *artifacts* rather than recipes, a shrinker so that a disagreement arrives
as a small file, and a decision about which mutations are noise and which are the
point.

The mutation is applied to the *last* entry of the log, except for `parent`,
which is asked of the first entry as well: every other field of the first entry
would be read by the same checks in the same way, while `parent` is the one field
whose owning check depends on which entry carries it (`L2.CHAIN.FIRST_PARENT_NULL`
reads the first, `L2.CHAIN.LINKS` reads the rest). Nothing is recomputed after a
mutation, so a rewritten field leaves the signature over it stale: those failures
are identical in both implementations and are not what the sweep is for.

Usage:
    python tools/sweep.py [--all] [--only TEXT] [--out DIR]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve()
PYTHON_DIR = HERE.parents[1]
REPO = HERE.parents[3]
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from charter_verify import canonical  # noqa: E402
from tests.support import MANIFEST, PROVENANCE, artifact, fixture_parts  # noqa: E402
from tools.differential import describe, differences, port_tally, reference_tally  # noqa: E402

REFERENCE = ["node", "cli/charter.js", "verify"]

#: A value no field takes, meaning "this field is not in the object".
ABSENT = object()
#: A value no field takes, meaning "this mutation does not apply here".
UNCHANGED = object()

#: The manifest's fields, each as the path to it inside the manifest value.
MANIFEST_TARGETS = (
    ("format",),
    ("title",),
    ("created_at",),
    ("signature",),
    ("content",),
    ("content", "sha256"),
    ("author",),
    ("author", "name"),
    ("author", "algorithm"),
    ("author", "key_id"),
    ("author", "public_key"),
)

#: A provenance entry's fields, each as the path to it inside the entry.
ENTRY_TARGETS = (
    ("timestamp",),
    ("action",),
    ("summary",),
    ("author",),
    ("author", "name"),
    ("author", "key_id"),
    ("parent",),
    ("content_sha256",),
    ("signature",),
)

#: The ways a field can be written that are not the way the format writes it.
#: `upper`, `illegal` and `padded` say something only about a string, and
#: `short` only about a string with a spelling to shorten.
MUTATIONS = (
    "absent",
    "null",
    "number",
    "string",
    "empty",
    "array",
    "object",
    "upper",
    "illegal",
    "padded",
    "short",
)


def mutated(mutation: str, value):
    """The value one mutation writes in place of `value`.

    `ABSENT` when the field is to be removed, and `UNCHANGED` when the mutation
    has no meaning for this value — an object has no uppercase, and no short
    spelling to shorten.
    """
    if mutation == "absent":
        return ABSENT
    if mutation == "null":
        return None
    if mutation == "number":
        return 1
    if mutation == "string":
        return "x"
    if mutation == "empty":
        return ""
    if mutation == "array":
        return []
    if mutation == "object":
        return {}
    if not isinstance(value, str):
        return UNCHANGED
    if mutation == "upper":
        return value.upper()
    if mutation == "illegal":
        # A character outside both alphabets this format uses: not hex, and not
        # one of the 64 base64url characters.
        return "!"
    if mutation == "padded":
        return value + "="
    if mutation == "short":
        return value[:-1]
    raise ValueError(f"unknown mutation: {mutation}")


def replaced(value: dict, path: tuple, replacement):
    """The same object with the value at `path` replaced, or that field removed."""
    holder = value
    for key in path[:-1]:
        holder = holder[key]
    if replacement is ABSENT:
        del holder[path[-1]]
    else:
        holder[path[-1]] = replacement
    return value


def targets() -> list:
    """Every (document, line, path) the sweep asks about."""
    out = [("manifest", "", path) for path in MANIFEST_TARGETS]
    out += [("entry", "last", path) for path in ENTRY_TARGETS]
    # The first entry's `parent` is the one field whose owning check depends on
    # which entry carries it, so it is asked twice.
    out.append(("entry", "first", ("parent",)))
    return out


def case_name(document: str, line: str, path: tuple) -> str:
    """The name of a family of cases: where the field is, not what is done to it."""
    where = ".".join(path)
    return f"manifest.{where}" if document == "manifest" else f"log.{line}.{where}"


def build(document: str, line: str, path: tuple, mutation: str):
    """The artifact one case asks about, or None when the mutation changes nothing."""
    parts = fixture_parts()
    index = 0
    if document == "manifest":
        value = canonical.parse_document(parts[MANIFEST])
    else:
        lines = parts[PROVENANCE].split(b"\n")[:-1]
        index = 0 if line == "first" else len(lines) - 1
        value = canonical.parse_document(lines[index])

    held = value
    for key in path:
        held = held[key]
    replacement = mutated(mutation, held)
    if replacement is UNCHANGED:
        return None
    if replacement is not ABSENT and replacement == held:
        return None

    replaced(value, path, replacement)
    if document == "manifest":
        parts[MANIFEST] = canonical.canonical_document(value)
    else:
        # canonical_document closes its result with one LF, and a line of a log
        # carries no terminator of its own.
        lines[index] = canonical.canonical_document(value)[:-1]
        parts[PROVENANCE] = b"".join(one + b"\n" for one in lines)
    return artifact(parts)


def cases(only: str = "") -> list:
    """Every case, in a stable order: the manifest's fields, then the log's."""
    out = []
    for document, line, path in targets():
        for mutation in MUTATIONS:
            name = f"{case_name(document, line, path)}.{mutation}"
            if only and only not in name:
                continue
            data = build(document, line, path, mutation)
            if data is None:
                continue
            out.append(
                {
                    "name": name,
                    "document": document,
                    "path": ".".join(path),
                    "mutation": mutation,
                    "bytes": data,
                }
            )
    return out


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
            "node was not found on PATH: the sweep compares two implementations, so it needs both"
        ) from None
    if completed.returncode not in (0, 1, 2):
        raise SystemExit(
            f"the reference exited {completed.returncode} on {path.name}: "
            f"{completed.stderr.strip()[:400]}"
        )
    return json.loads(completed.stdout)


def sweep(only: str, out: str, show_all: bool) -> int:
    """Build every case, ask both implementations, and report where they differ."""
    asked = cases(only)
    if not asked:
        print(f"no case matches {only!r}: the sweep asks about 18 fields of two documents")
        return 1

    kept = None
    if out:
        kept = pathlib.Path(out)
        kept.mkdir(parents=True, exist_ok=True)

    divergences = []
    with tempfile.TemporaryDirectory() as scratch:
        root = pathlib.Path(scratch)
        for case in asked:
            path = root / f"{case['name']}.charter"
            path.write_bytes(case["bytes"])
            if kept is not None:
                (kept / f"{case['name']}.charter").write_bytes(case["bytes"])
            reference = reference_tally(ask_reference(path))
            port = port_tally(case["bytes"])
            found = differences(reference, port)
            if found:
                divergences.append((case, reference, port, found))
            if show_all:
                print(f"{case['name']:<44} reference {describe(reference)}")
                print(f"{'':<44} port      {describe(port)}")
                for line in found:
                    print(f"{'':<44} differs:  {line}")

    for case, reference, port, found in divergences:
        print("")
        print(f"{case['name']}  ({case['document']}: {case['path']} written as {case['mutation']})")
        print(f"    reference {describe(reference)}")
        print(f"    port      {describe(port)}")
        for line in found:
            print(f"    {line}")

    print("")
    agree = len(asked) - len(divergences)
    if divergences:
        print(f"{len(asked)} case(s): {agree} agree, {len(divergences)} differ")
        return 1
    print(f"{len(asked)} case(s): both implementations answer every one of them the same way")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="ask the reference and the port about one field at a time"
    )
    parser.add_argument("--all", action="store_true", help="print every case, agreeing ones too")
    parser.add_argument("--only", default="", help="run only the cases whose name contains this text")
    parser.add_argument("--out", default="", help="keep the artifacts this sweep builds, in this directory")
    arguments = parser.parse_args()
    return sweep(arguments.only, arguments.out, arguments.all)


if __name__ == "__main__":
    raise SystemExit(main())

