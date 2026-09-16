"""The architectural rule: the verifier is a function from bytes to a verdict.

SPEC section 12 states it for the reference — "nothing under `verifier/**` may
import `node:`, read a file, touch the network, or consult a clock" — and the
same rule is what makes the recorded answers comparable across two
implementations. Here it is enforced the same way: by reading the source of the
core modules and refusing the imports that would let one of them look at the
world beyond its argument.

`cli` and `kit` are exempt by name, and they are the only two: one reads the
file it was asked about, and the other reads the kit.
"""

from __future__ import annotations

import pathlib
import unittest

from charter_verify import kit

# The modules that answer questions. Everything that turns bytes into a verdict
# lives in these, and none of them may look outside.
CORE = (
    "__init__",
    "base64url",
    "canonical",
    "checks",
    "container",
    "documents",
    "ed25519",
    "errors",
    "limits",
    "verdict",
    "verify",
    "vocabulary",
)

# Imports that would let a check read a file, a clock, a socket, or a locale.
FORBIDDEN = (
    "import os",
    "import pathlib",
    "import sys",
    "import time",
    "import datetime",
    "import random",
    "import socket",
    "import subprocess",
    "import urllib",
    "import json",
    "import tempfile",
    "import shutil",
    "from os ",
    "from pathlib ",
    "from sys ",
    "from time ",
    "from datetime ",
    "from random ",
    "from json ",
)


class PurityTest(unittest.TestCase):
    def sources(self) -> dict:
        package = pathlib.Path(kit.__file__).parent
        return {
            name: (package / f"{name}.py").read_text(encoding="utf-8") for name in CORE
        }

    def test_no_core_module_imports_the_world(self) -> None:
        for name, source in self.sources().items():
            for forbidden in FORBIDDEN:
                with self.subTest(module=name, forbidden=forbidden):
                    self.assertNotIn(forbidden, source)

    def test_no_core_module_opens_a_file(self) -> None:
        for name, source in self.sources().items():
            with self.subTest(module=name):
                self.assertNotIn("open(", source)

    def test_the_verifier_is_a_function_from_bytes_to_a_verdict(self) -> None:
        from charter_verify import verify

        data = (kit.REPO / "vectors" / "out" / "valid.charter").read_bytes()
        first = verify(data).to_json("x")
        second = verify(data).to_json("x")
        self.assertEqual(first, second)

    def test_the_verifier_does_not_care_where_it_is_run_from(self) -> None:
        """No path is consulted, so the current directory cannot change a verdict."""
        import os

        from charter_verify import verify

        data = (kit.REPO / "vectors" / "out" / "valid.charter").read_bytes()
        here = os.getcwd()
        try:
            os.chdir(kit.REPO)
            from_repository_root = verify(data).to_json("x")
        finally:
            os.chdir(here)
        self.assertEqual(from_repository_root, verify(data).to_json("x"))


if __name__ == "__main__":
    unittest.main()
