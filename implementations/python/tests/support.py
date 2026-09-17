"""Helpers for the tests: the committed fixture, and synthetic artifacts.

Nothing here is part of the verifier. The synthetic writer exists because a few
rules cannot be exercised by the 54 committed artifacts — a log line ending in
CRLF, a manifest with a leading-zero integer, an escape spelling the spec
mentions and no fixture carries — and a rule nobody has run is a rule nobody has
checked.

The writer sets the fields SPEC section 3.6 fixes, so an artifact built here
passes METADATA and the checks are about the thing under test rather than about
the writer. It does not sign anything: a synthetic artifact is used for the
checks that never look at a signature, and the committed fixtures are used for
the ones that do.
"""

from __future__ import annotations

import pathlib
import zipfile

HERE = pathlib.Path(__file__).resolve()
REPO = HERE.parents[3]
VECTORS = REPO / "vectors"
FIXTURES = VECTORS / "out"

MANIFEST = "manifest.json"
CONTENT = "content.md"
PROVENANCE = "provenance.jsonl"
REQUIRED = (MANIFEST, CONTENT, PROVENANCE)


def fixture_bytes(name: str) -> bytes:
    """The bytes of a committed artifact, exactly as the record describes them."""
    return (FIXTURES / f"{name}.charter").read_bytes()


def fixture_parts(name: str = "valid") -> dict:
    """The three entries of a committed artifact, as raw bytes."""
    out = {}
    with zipfile.ZipFile(FIXTURES / f"{name}.charter") as archive:
        for entry in REQUIRED:
            out[entry] = archive.read(entry)
    return out


def artifact(parts: dict, *, deflated: bool = False, extra: dict | None = None) -> bytes:
    """An archive holding these entries, with the metadata charter/0.1 fixes.

    `zipfile` writes one field this format fixes: it sets `external_attr` to a
    permissions value, because it writes archives for file systems. The test
    writer clears it in the central directory records — which is what a producer
    that read SPEC section 3.6 would do, and it keeps the artifacts built here
    from failing METADATA for a reason that has nothing to do with the check
    under test.
    """
    import io

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        written = dict(parts)
        if extra:
            written.update(extra)
        for name in list(parts) + list(extra or {}):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 0
            info.create_version = 20
            info.extract_version = 20
            info.compress_type = zipfile.ZIP_DEFLATED if deflated else zipfile.ZIP_STORED
            info.internal_attr = 0
            info.external_attr = 0
            archive.writestr(info, written[name])
    return _clear_external_attributes(buffer.getvalue())


def _clear_external_attributes(data: bytes) -> bytes:
    """Set the external attributes of every central directory record to 0."""
    out = bytearray(data)
    at = out.find(b"PK\x01\x02")
    found = 0
    while at >= 0:
        out[at + 38 : at + 42] = b"\x00\x00\x00\x00"
        found += 1
        at = out.find(b"PK\x01\x02", at + 4)
    if found != 3:
        raise AssertionError(f"expected three central directory records, found {found}")
    return bytes(out)


def replace_log(data: bytes, lines: bytes) -> bytes:
    """The same artifact, with `provenance.jsonl` swapped for these bytes."""
    parts = fixture_parts()
    parts[PROVENANCE] = lines
    return artifact(parts)


def manifest_with_digest(parts: dict, digest: str) -> bytes:
    """The same manifest value, declaring a different digest for the content.

    Used to ask what a verifier does when the bytes of a document are declared
    one way and hold another — the CRLF case, where the difference is reflowed
    line endings rather than different words.
    """
    from charter_verify import canonical

    value = canonical.parse_document(parts[MANIFEST])
    value["content"]["sha256"] = digest
    return canonical.canonical_document(value)


def fails(data: bytes) -> dict:
    """Every check that FAILED or found something UNSUPPORTED, by id.

    Skipped checks are not here: a check that never ran is not a claim that
    something is wrong, and the kit keeps the two apart for the same reason.
    `skips()` counts them.
    """
    from charter_verify import verify

    return {
        result.id: result.reason_code
        for result in verify(data).results
        if result.status in ("FAIL", "UNSUPPORTED")
    }


def check(data: bytes, id: str):
    """One check's result, by id."""
    from charter_verify import verify

    for result in verify(data).results:
        if result.id == id:
            return result
    raise KeyError(id)


def skips(data: bytes) -> int:
    """How many checks were never reached."""
    from charter_verify import verify

    return sum(1 for result in verify(data).results if result.status == "SKIP")


def unsupported(data: bytes) -> dict:
    """The checks that found something this verifier does not implement, by id.

    `fails()` lumps these in with the failures because a case that asks "what is
    wrong with this file" wants both; a case that asks which of the two *kinds*
    of answer came back — an artifact that is broken against one that is
    unproven — needs them apart, and section 3.2 is the place that says which.
    """
    from charter_verify import verify

    return {
        result.id: result.reason_code
        for result in verify(data).results
        if result.status == "UNSUPPORTED"
    }


# --- builders for cases no committed fixture covers -----------------------


def base_manifest() -> dict:
    """The valid fixture's manifest, as a value."""
    from charter_verify import canonical

    return canonical.parse_document(fixture_parts()[MANIFEST])


def manifest_text() -> str:
    """The valid fixture's manifest, as the canonical text it is."""
    from charter_verify import canonical

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
    from charter_verify import canonical

    value = base_manifest()
    change(value)
    return with_manifest(canonical.canonical_document(value).decode("utf-8"))


def first_log_line() -> bytes:
    """The valid fixture's first log line, canonical and closed by one LF."""
    from charter_verify import canonical

    return canonical.canonical_document(
        canonical.parse_document(fixture_parts()[PROVENANCE].split(b"\n")[0])
    )
