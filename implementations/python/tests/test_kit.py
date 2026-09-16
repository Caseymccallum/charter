"""The kit, replayed by this verifier — and the rule that it read only the spec.

Two things are being asserted here, and the second is the reason the exercise
exists:

1. all 54 fixtures produce the verdict, exit code, failing checks with their
   reason codes, unsupported checks with their reason codes, and count of
   never-reached checks that `vectors/expected.json` records;
2. the verifier produced them without opening a single file under `verifier/`.
   The second is a *test*, not a promise: the replay installs an audit hook that
   hears every file the interpreter opens, and this test fails if any of them is
   in the reference implementation.
"""

from __future__ import annotations

import contextlib
import io
import unittest

from charter_verify import kit

from .support import VECTORS


class KitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        kit.watch(kit.REPO / "verifier")
        # The replay prints a line per case; the suite is not that report.
        cls.report = io.StringIO()
        with contextlib.redirect_stdout(cls.report):
            cls.cases, cls.matched, cls.problems = kit.replay(VECTORS)

    def test_the_record_holds_the_fixtures_it_says_it_holds(self) -> None:
        self.assertEqual(len(self.cases), 54)
        for case in self.cases:
            with self.subTest(case["name"]):
                data = (VECTORS / case["file"]).read_bytes()
                self.assertEqual(len(data), case["bytes"])
                self.assertEqual(kit.sha256_hex(data), case["sha256"])

    def test_every_verdict_is_the_one_the_record_states(self) -> None:
        self.assertEqual(self.problems, [])
        self.assertEqual(self.matched, 54)

    def test_the_replay_reported_one_verdict_for_every_case(self) -> None:
        lines = [line for line in self.report.getvalue().splitlines() if line.strip()]
        self.assertEqual(len(lines), 54)

    def test_no_file_under_verifier_was_opened(self) -> None:
        self.assertEqual(kit._OPENED, [], "the port needed to read the reference implementation")

    def test_the_comparison_can_fail(self) -> None:
        """A record that is wrong must produce a complaint, or nothing above counts.

        This is the test the whole file rests on. If `compare` could not report a
        mismatch, `test_every_verdict_is_the_one_the_record_states` would pass on
        any implementation at all, including one that returns a constant.
        """
        case = next(case for case in self.cases if case["name"] == "valid")
        data = (VECTORS / "out" / "valid.charter").read_bytes()
        from charter_verify import verify

        verdict = verify(data)
        wrong = dict(case)
        wrong["expected"] = dict(case["expected"])
        wrong["expected"]["skips"] = 99
        self.assertTrue(kit.compare(wrong, verdict))

        wrong = dict(case)
        wrong["expected"] = dict(case["expected"])
        wrong["expected"]["verdict"] = "BROKEN"
        self.assertTrue(kit.compare(wrong, verdict))

        wrong = dict(case)
        wrong["expected"] = dict(case["expected"])
        wrong["expected"]["fail"] = {"L0.ZIP.READABLE": "MALFORMED"}
        self.assertTrue(kit.compare(wrong, verdict))

        # And the right record produces no complaint.
        self.assertEqual(kit.compare(case, verdict), [])
