import argparse
import copy
import runpy
import unittest
from pathlib import Path


adapter = runpy.run_path(str(Path(__file__).resolve().parents[1] / "recipes/qualify-tier2.py"))


class Tier2Controls(unittest.TestCase):
    def test_endpoint(self):
        for url in ("http://127.0.0.1:4001/v1", "http://[::1]/v1", "https://models.example/v1"):
            self.assertEqual(adapter["endpoint"](url), url)
        for url in ("http://models.example/v1", "https://person:password@models.example", "https://models.example/?key=value"):
            with self.assertRaises(argparse.ArgumentTypeError):
                adapter["endpoint"](url)

    def test_duplicate_requires_signed_off_target_and_complete_intra_skill_coverage(self):
        intra = {"validator": "Context Deduplication", "passed": True, "legacy": {"errors": []}, "success_details": [
            {"check": "file_collection", "metadata": {"file_count": 2}}, {"check": "chunking", "metadata": {"chunk_count": 2}}]}
        inter = {"validator": "Similarity Check", "passed": False, "legacy": {"errors": ["detected duplicate"]},
                 "success_details": [{"check": "catalog_compared", "metadata": {"target_name": "archive-copy",
                 "catalog_entry_count": 1, "self_matches_excluded": 0}}], "findings": [{"category": "SIMILARITY",
                 "message": "detected duplicate", "metadata": {"score": .96, "entry_a": "archive-copy",
                 "entry_b": "archive-lookup", "comparison_mode": "target-vs-catalog"}}]}
        check = adapter["check_control"]
        self.assertEqual(check(1, [intra, inter], "archive-copy", .75), .96)
        for key, value in [("entry_b", "other"), ("score", .72), ("score", float("nan"))]:
            bad = copy.deepcopy(inter)
            bad["findings"][0]["metadata"][key] = value
            with self.assertRaises(ValueError):
                check(1, [intra, bad], "archive-copy", .75)
        with self.assertRaises(ValueError):
            check(0, [intra, inter], "archive-copy", .75)
        intra["success_details"][1]["metadata"]["chunk_count"] = 1
        with self.assertRaises(ValueError):
            check(1, [intra, inter], "archive-copy", .75)


if __name__ == "__main__":
    unittest.main()
