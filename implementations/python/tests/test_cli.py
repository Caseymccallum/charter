"""The command line: one file in, a verdict out, and five exit codes.

SPEC section 12 says the codes are the codes of a verdict, plus 64 for a command
line that was not understood and 66 for a file that could not be read, and says
why: "a file that was not read has not been judged".
"""

from __future__ import annotations

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

from charter_verify import checks
from charter_verify.vocabulary import EXIT_UNREADABLE, EXIT_USAGE

from .support import FIXTURES, VECTORS, manifest_change

HERE = pathlib.Path(__file__).resolve().parents[1]

# The keys of the JSON verdict, in the order the reference CLI prints them. The
# spec does not define this shape; the README records where it came from.
KEYS = ("file", "bytes", "verdict", "exit_code", "summary", "artifact", "checks", "limitations")


def run(*arguments: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "charter_verify", *arguments],
        cwd=HERE,
        capture_output=True,
        text=True,
    )


class ExitCodeTest(unittest.TestCase):
    def test_the_three_verdicts(self) -> None:
        for fixture, code in (("valid", 0), ("unsupported-format", 1), ("not-a-zip", 2)):
            with self.subTest(fixture):
                completed = run(str(FIXTURES / f"{fixture}.charter"), "--json")
                self.assertEqual(completed.returncode, code)
                self.assertEqual(json.loads(completed.stdout)["exit_code"], code)

    def test_a_file_that_could_not_be_read_is_not_a_verdict(self) -> None:
        completed = run("no-such-file.charter", "--json")
        self.assertEqual(completed.returncode, EXIT_UNREADABLE)
        self.assertEqual(completed.stdout, "")
        self.assertIn("could not be read", completed.stderr)

    def test_a_command_line_that_was_not_understood(self) -> None:
        for arguments in ((), ("--nope",), ("one.charter", "two.charter")):
            with self.subTest(arguments):
                completed = run(*arguments)
                self.assertEqual(completed.returncode, EXIT_USAGE)
                self.assertIn("Usage:", completed.stderr)

    def test_help_is_not_a_failure(self) -> None:
        self.assertEqual(run("--help").returncode, 0)


class OutputEncodingTest(unittest.TestCase):
    """A verdict carries text the artifact chose, and it leaves as UTF-8.

    SPEC section 4 fixes UTF-8 for every byte of a `.charter` file, so a reader
    that printed those bytes through the host's locale would be the one place in
    this project where the encoding of a verdict depends on the machine. On
    Windows that is not a subtlety, it is a failure: with stdout redirected, the
    text layer encodes with the console code page (cp1252 by default) and raises
    on the first character outside it, so the verdict arrives empty.

    The differential probe found it, and only it could have: an artifact whose
    title is U+1F600, asked through a pipe. No fixture in the kit reaches it, and
    neither did this suite until the probe's artifacts were committed.
    """

    def test_a_title_outside_the_host_code_page_survives_a_pipe(self) -> None:
        title = "a title with \U0001f600 in it"
        data = manifest_change(lambda value: value.__setitem__("title", title))
        with tempfile.TemporaryDirectory() as work:
            path = pathlib.Path(work) / "astral.charter"
            path.write_bytes(data)
            # `capture_output` is the pipe, and the bytes are decoded here rather
            # than by the host: `text=True` would decode the child's UTF-8 with
            # this process's locale, which is the same mistake on the other side.
            completed = subprocess.run(
                [sys.executable, "-m", "charter_verify", str(path), "--json"],
                cwd=HERE,
                capture_output=True,
            )
        self.assertEqual(completed.returncode, 2)
        verdict = json.loads(completed.stdout.decode("utf-8"))
        self.assertEqual(verdict["artifact"]["title"], title)
        self.assertEqual(verdict["verdict"], "BROKEN")


class ShapeTest(unittest.TestCase):
    def test_the_json_verdict_has_the_shape_a_script_consumes(self) -> None:
        completed = run(str(FIXTURES / "valid.charter"), "--json")
        verdict = json.loads(completed.stdout)
        self.assertEqual(tuple(verdict.keys()), KEYS)
        self.assertEqual(verdict["file"], str(FIXTURES / "valid.charter"))
        self.assertEqual(verdict["bytes"], len((FIXTURES / "valid.charter").read_bytes()))
        self.assertEqual(verdict["verdict"], "VERIFIED")
        self.assertEqual(
            set(verdict["summary"]),
            {"pass", "fail", "unsupported", "skip", "total"},
        )
        self.assertEqual(verdict["summary"], {"pass": 30, "fail": 0, "unsupported": 0, "skip": 0, "total": 30})
        self.assertEqual(
            set(verdict["artifact"]),
            {
                "format",
                "title",
                "created_at",
                "author_name",
                "author_key_id",
                "entries",
                "head_content_sha256",
            },
        )
        self.assertEqual(len(verdict["checks"]), 30)
        self.assertEqual(
            [check["id"] for check in verdict["checks"]],
            [id for id, _, _, _ in checks.CHECKS],
        )
        for check in verdict["checks"]:
            self.assertEqual(
                set(check),
                {"id", "level", "status", "reason_code", "detail", "requirement"},
            )
        self.assertEqual(
            [limitation["id"] for limitation in verdict["limitations"]],
            [
                "INTERMEDIATE_CONTENT_HASHES",
                "KEY_HOLDER_CAN_REWRITE_HISTORY",
                "KEYS_ARE_SELF_DECLARED",
                "TIMESTAMPS_ARE_CLAIMS",
                "CONTENT_IS_NOT_JUDGED",
            ],
        )

    def test_json_prints_the_verdict_and_nothing_else(self) -> None:
        completed = run(str(FIXTURES / "empty-log.charter"), "--json")
        self.assertEqual(completed.stderr, "")
        json.loads(completed.stdout)

    def test_all_lists_every_check_and_the_default_lists_the_ones_that_did_not_pass(
        self,
    ) -> None:
        default = run(str(FIXTURES / "empty-log.charter")).stdout
        everything = run(str(FIXTURES / "empty-log.charter"), "--all").stdout
        self.assertNotIn("L0.ZIP.READABLE", default)
        self.assertIn("L0.PROVENANCE.NONEMPTY", default)
        self.assertIn("L0.ZIP.READABLE", everything)
        self.assertIn("what a passing verdict does not mean:", everything)

    def test_the_verdict_is_byte_identical_on_two_runs(self) -> None:
        first = run(str(FIXTURES / "content-bom.charter"), "--json").stdout
        second = run(str(FIXTURES / "content-bom.charter"), "--json").stdout
        self.assertEqual(first, second)


class RecordedExitCodeTest(unittest.TestCase):
    """Every exit code in the record, through the command line rather than the API."""

    def test_the_record_and_the_command_line_agree(self) -> None:
        record = json.loads((VECTORS / "expected.json").read_text(encoding="utf-8"))
        for case in record["cases"]:
            with self.subTest(case["name"]):
                completed = run(str(VECTORS / case["file"]), "--json")
                self.assertEqual(completed.returncode, case["expected"]["exit_code"])


if __name__ == "__main__":
    unittest.main()
