"""Unit tests for the shadow-only MRT allocation audit."""
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from mrt.allocation_audit import allocate, variants, accounting, classification, run


class AllocationAuditTest(unittest.TestCase):
    def test_rounding_and_budget(self):
        tickets = [
            {"cars": [1, 2, 3], "allocation_score": 0.5, "yen": 5000},
            {"cars": [1, 2, 4], "allocation_score": 0.3, "yen": 3000},
            {"cars": [1, 2, 5], "allocation_score": 0.2, "yen": 2000},
        ]
        result = allocate(tickets, 10000, [0.5, 0.3, 0.2])
        self.assertEqual(sum(t["yen"] for t in result), 10000)
        self.assertTrue(all(t["yen"] >= 100 and t["yen"] % 100 == 0 for t in result))

    def test_new_third_combinations_are_unique_and_pre_result(self):
        tickets = [
            {"cars": [1, 2, 3], "allocation_score": 0.6, "yen": 6000},
            {"cars": [1, 2, 4], "allocation_score": 0.2, "yen": 2000},
            {"cars": [2, 1, 5], "allocation_score": 0.2, "yen": 2000},
        ]
        alternatives, extras = variants(tickets)
        original = {tuple(t["cars"]) for t in tickets}
        self.assertTrue(all(tuple(t["cars"]) not in original for t in extras))
        self.assertTrue(all(sum(t["yen"] for t in a) == 10000 for a in alternatives.values()))
        self.assertLessEqual(len(extras), 5)
        self.assertEqual(alternatives["A"], tickets)

    def test_dead_heat_and_finish_types(self):
        tickets = [
            {"cars": [1, 2, 3], "allocation_score": .5, "yen": 7000},
            {"cars": [2, 1, 3], "allocation_score": .2, "yen": 3000},
        ]
        self.assertEqual(accounting(tickets, {"1-2-3": 1000, "2-1-3": 2000}), 130000)
        self.assertEqual(classification(tickets, {"1-2-7": 3000}), "third_miss")
        self.assertEqual(classification(tickets[:1], {"2-1-7": 3000}), "reverse_top2")
        self.assertEqual(classification(tickets[:1], {"2-3-1": 3000}), "two_present")
        self.assertEqual(classification(tickets[:1], {"4-5-6": 3000}), "not_top2")

    def test_read_only_report_and_exclusion(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            day = root / "data/mrt/2026-11-23"
            day.mkdir(parents=True)
            rid = "202611232601"
            roster = {str(i): f"10{i:03d}" for i in range(1, 8)}
            result = {"race_id": rid, "status": "final", "roster": roster,
                      "payouts": {"1-2-7": 25000}}
            payload = {
                "race_id": rid, "pre_race": True,
                "entry_observed_at": "2026-11-23T05:00:00+09:00",
                "generated_at": "2026-11-23T05:01:00+09:00",
                "sales_close_at": "2026-11-23T12:00:00+09:00",
                "start_at": "2026-11-23T12:05:00+09:00",
                "input": {"race_id": rid, "date": "20261123",
                          "entry": {"players": {c: {"rider_id": rider} for c, rider in roster.items()}}},
                "automatic": {"tickets": [
                    {"cars": [1, 2, 3], "yen": 5000, "allocation_score": .5},
                    {"cars": [1, 2, 4], "yen": 5000, "allocation_score": .5},
                ]},
            }
            (day / "index.json").write_text(json.dumps({"races": [
                {"race_id": rid, "file": "race.json"},
                {"race_id": "202611232602", "status": "unavailable"},
            ]}))
            (day / "results.json").write_text(json.dumps({"results": [result]}))
            (day / "race.json").write_text(json.dumps(payload))
            report = run(root)
            self.assertEqual(report["total"]["races"], 1)
            self.assertEqual(report["total"]["returns_yen"]["A"], 0)
            self.assertEqual(report["total"]["categories"], {"third_miss": 1})
            self.assertEqual(report["total"]["stake_yen"], 10000)
            self.assertEqual(len(report["excluded"]), 1)
            self.assertFalse((root / "data/mrt_research").exists())

            # A post-close forecast must never enter retrospective evaluation.
            payload["generated_at"] = "2026-11-23T12:03:00+09:00"
            (day / "race.json").write_text(json.dumps(payload))
            rejected = run(root)
            self.assertEqual(rejected["total"]["races"], 0)
            self.assertTrue(any("prediction is not prior to close" in r["reason"] for r in rejected["excluded"]))


if __name__ == "__main__":
    unittest.main()
