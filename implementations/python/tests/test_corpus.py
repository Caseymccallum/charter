"""The container corpus, replayed through the port.

`vectors/container/expected.json` holds, for each of the corpus's cases, what the
reference said and what this port said. This module holds the port to its own
column: every case the two implementations agreed about is checked against the
answer both of them gave, and a case the record holds as a disagreement is
checked against the answer this port gave — so a change in either direction fails
here rather than being noticed by whoever runs the replay next.

The corpus itself is `implementations/python/tools/corpus.py`; the reader's replay
is `vectors/container/run.js`. This is the port's half of `test/corpus.test.js`,
which does the same for the reference.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import unittest

from charter_verify import verify

HERE = pathlib.Path(__file__).resolve()
REPO = HERE.parents[3]
CORPUS = REPO / "vectors" / "container"
RECORD = json.loads((CORPUS / "expected.json").read_text(encoding="utf-8"))


def tally(data: bytes) -> dict:
    """The five things a verdict is compared by, out of this port's verdict."""
    verdict = verify(data)
    fail = {}
    unsupported = {}
    skips = 0
    for result in verdict.results:
        if result.status == "FAIL":
            fail[result.id] = result.reason_code
        elif result.status == "UNSUPPORTED":
            unsupported[result.id] = result.reason_code
        elif result.status == "SKIP":
            skips += 1
    return {
        "verdict": verdict.verdict,
        "exit_code": verdict.exit_code,
        "fail": fail,
        "unsupported": unsupported,
        "skips": skips,
    }


class CorpusTest(unittest.TestCase):
    def test_every_case_is_still_the_artifact_the_record_describes(self) -> None:
        self.assertGreaterEqual(len(RECORD["cases"]), 26)
        for entry in RECORD["cases"]:
            with self.subTest(entry["name"]):
                data = (CORPUS / entry["file"]).read_bytes()
                self.assertEqual(len(data), entry["bytes"])
                self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])

    def test_the_port_still_answers_every_case_as_the_record_says_it_did(self) -> None:
        for entry in RECORD["cases"]:
            data = (CORPUS / entry["file"]).read_bytes()
            with self.subTest(entry["name"]):
                self.assertEqual(tally(data), entry["port"])

    def test_every_case_the_record_settles_is_one_both_implementations_agree_about(self) -> None:
        """A case the two still read differently is a finding, not a record."""
        disagreements = [entry["name"] for entry in RECORD["cases"] if not entry["agreement"]]
        for entry in RECORD["cases"]:
            with self.subTest(entry["name"]):
                self.assertEqual(
                    entry["agreement"],
                    entry["expected"] == entry["port"],
                    f"{entry['name']}: the record's two answers say something other than "
                    f"agreement={entry['agreement']}",
                )
        self.assertEqual(
            disagreements,
            [],
            "the corpus was built with every disagreement settled in SPEC.md section 3",
        )

    def test_every_case_says_where_it_was_settled_and_what_it_asked(self) -> None:
        for entry in RECORD["cases"]:
            with self.subTest(entry["name"]):
                self.assertTrue(entry["spec"] is None or entry["spec"].startswith("3."))
                self.assertIn("two implementations", RECORD["note"])
                if entry["asked"] is not None:
                    self.assertEqual(entry["asked"]["verdict"], entry["expected"]["verdict"])
                    for check_id, code in entry["asked"].get("fail", {}).items():
                        self.assertEqual(entry["expected"]["fail"].get(check_id), code)
                    for check_id, code in entry["asked"].get("unsupported", {}).items():
                        self.assertEqual(entry["expected"]["unsupported"].get(check_id), code)


if __name__ == "__main__":
    unittest.main()
