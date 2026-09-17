"""The command line: one file in, a verdict out. SPEC section 12.

```
python -m charter_verify <file.charter>          the verdict, and the checks that did not pass
python -m charter_verify <file.charter> --all    every check
python -m charter_verify <file.charter> --json   the verdict as JSON, and nothing else
```

Exit codes are the reference's five for a verdict and two that are not one: 64
when the command line was not understood, 66 when the named file could not be
read. "Neither is a verdict; a file that was not read has not been judged."
"""

from __future__ import annotations

import json
import sys

from .verify import verify
from .vocabulary import EXIT_UNREADABLE, EXIT_USAGE

USAGE = """charter-verify — read a .charter file the way SPEC.md reads it

Usage:
  python -m charter_verify <file.charter> [--all] [--json]

  --all   list every check, not only the ones that did not pass
  --json  print the verdict as JSON, and nothing else

Exit codes:
  0  VERIFIED     every check passed
  1  INCOMPLETE   nothing failed, and at least one requirement was not established
  2  BROKEN       at least one requirement was violated
 64  the command line was not understood
 66  the named file could not be read
"""


def _write_utf8() -> None:
    """Write UTF-8 whatever the stream was opened with.

    A verdict carries text the artifact chose: a title, an author name, the prose
    of a check. The format fixes UTF-8 for every byte of a `.charter` file, so a
    reader that printed those bytes through the host's locale would be the one
    place in the project where the encoding of a verdict depends on the machine.
    On Windows it also fails outright: with stdout redirected to a pipe, Python
    encodes text with the console code page (cp1252 by default) and raises on the
    first character that is not in it — which is how the differential probe found
    this, on an artifact whose title is U+1F600. Nothing in the 56 recorded
    fixtures reaches it, because all of their titles are ASCII.

    The reference writes UTF-8 through `process.stdout.write`, and the two
    implementations have to be able to be compared, so this one writes UTF-8 too.
    A stream that cannot be reconfigured (a test that swapped `sys.stdout` for a
    string buffer) is left alone: it has no code page to be wrong about.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None and getattr(stream, "encoding", None) not in (None, "utf-8", "UTF-8"):
            reconfigure(encoding="utf-8")


def main(argv=None) -> int:
    arguments = list(sys.argv[1:] if argv is None else argv)
    path = None
    as_json = False
    show_all = False
    _write_utf8()
    for argument in arguments:
        if argument == "--json":
            as_json = True
        elif argument == "--all":
            show_all = True
        elif argument in ("-h", "--help"):
            sys.stdout.write(USAGE)
            return 0
        elif argument.startswith("-"):
            sys.stderr.write(f"charter-verify: unknown option: {argument}\n\n")
            sys.stderr.write(USAGE)
            return EXIT_USAGE
        elif path is None:
            path = argument
        else:
            sys.stderr.write("charter-verify: more than one file was named\n\n")
            sys.stderr.write(USAGE)
            return EXIT_USAGE
    if path is None:
        sys.stderr.write("charter-verify: no file was named\n\n")
        sys.stderr.write(USAGE)
        return EXIT_USAGE

    try:
        with open(path, "rb") as handle:
            data = handle.read()
    except OSError as problem:
        sys.stderr.write(f"charter-verify: {path} could not be read: {problem}\n")
        return EXIT_UNREADABLE

    verdict = verify(data)
    if as_json:
        sys.stdout.write(json.dumps(verdict.to_json(path), indent=2, ensure_ascii=False))
        sys.stdout.write("\n")
    else:
        sys.stdout.write(verdict.human(path, show_all=show_all))
        sys.stdout.write("\n")
    return verdict.exit_code


if __name__ == "__main__":
    raise SystemExit(main())
