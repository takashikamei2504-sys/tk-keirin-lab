"""Teacher-vs-MRT paired audit tests. Never mutate production snapshots."""
import json
import tempfile
import unittest
from pathlib import Path

from mrt.teacher_comparison import compare, run


def fixture():
    rid = "202611222601"
    roster = {str(i): f"20{i:03d}" for i in range(1, 8)}
    result = {"race_id": rid, "status": "final", "roster": roster,
              "back": [5], "payouts": {"5-1-2": 25000}}
    mrt = {
        "race_id": rid, "pre_race": True, "date": "20261122",
        "venue_name": "テスト", "race_no": 1,
        "entry_observed_at": "2026-11-22T08:30:00+09:00",
        "generated_at": "2026-11-22T08:31:00+09:00",
        "sales_close_at": "2026-11-22T11:00:00+09:00",
        "start_at": "2026-11-22T11:05:00+09:00",
        "input": {"race_id": rid, "date": "20261122",
                  "entry": {"players": {c: {"rider_id": rider} for c, rider in roster.items()}}},
        "automatic": {"tickets": [
            {"cars": [1, 5, 2], "yen": 7000, "allocation_score": .7},
            {"cars": [1, 2, 5], "yen": 3000, "allocation_score": .3},
        ], "scenarios": [{"proposed_B_holder": 1, "scenario_weight": .7}]},
        "model_sha256": "test_only",
    }
    teacher = {
        "expert_id": 634, "result_crosspage_verified": True,
        "forecast_id": "t_634", "date": "20261122", "race_id": rid,
        "race_no": 1,
        "measured_result": {"roster": roster},
        "labels": {"tickets": {"3連単": [
            {"cars": [5, 1, 2], "yen": 300},
            {"cars": [1, 5, 2], "yen": 9700},
        ]}, "charged_stake": 10000, "teacher_payout": 75000,
            "cancelled": [], "refund": 0, "honmei": 5, "events": []},
        "published_at": None, "source_url": "https://example.invalid/ref",
        "pre_race_snapshot": f"data/mrt/2026-11-22/{rid}-frozen.json",
    }
    return teacher, mrt, result


class TeacherComparisonTest(unittest.TestCase):
    def test_pairwise_high_payout_teacher_only(self):
        teacher, mrt, result = fixture()
        row = compare(teacher, mrt, result)
        self.assertEqual(row["teacher_return"], 75000)
        self.assertEqual(row["mrt_return"], 0)
        self.assertEqual(row["winning_payout_per_100"], 25000)
        self.assertTrue(row["teacher_hit"])
        self.assertFalse(row["mrt_hit"])
        self.assertEqual(row["teacher_win_ticket_yen"], {"5-1-2": 300})
        self.assertEqual(row["mrt_miss_class"], "reverse_top2")
        self.assertFalse(row["mrt_has_winning_pair"])
        self.assertTrue(row["teacher_has_winning_pair"])
        self.assertEqual(row["shared_ticket_stake_min_yen"], 7000)
        self.assertEqual(row["teacher_top_first_car"], "1")
        self.assertEqual(row["teacher_top_first_stake"], 9700)
        self.assertEqual(row["mrt_top_first_car"], "1")
        self.assertEqual(row["mrt_top_first_stake"], 10000)

    def test_pre_start_and_rider_identity_guards(self):
        teacher, mrt, result = fixture()
        mrt["generated_at"] = "2026-11-22T11:01:00+09:00"
        with self.assertRaisesRegex(ValueError, "prediction is not prior"):
            compare(teacher, mrt, result)
        teacher, mrt, result = fixture()
        result["roster"]["7"] = "different"
        with self.assertRaisesRegex(ValueError, "roster mismatch"):
            compare(teacher, mrt, result)

    def test_teacher_payment_mismatch_guards(self):
        teacher, mrt, result = fixture()
        teacher["labels"]["teacher_payout"] = 1
        with self.assertRaisesRegex(ValueError, "teacher payout"):
            compare(teacher, mrt, result)

    def test_read_only_research_report(self):
        teacher, mrt, result = fixture()
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            day = root / "data/mrt/2026-11-22"
            records = root / "data/mrt_teacher/records"
            day.mkdir(parents=True)
            records.mkdir(parents=True)
            (day/"results.json").write_text(json.dumps({"results": [result]}))
            (day/f"{teacher['race_id']}-frozen.json").write_text(json.dumps(mrt))
            (records/"t_634.json").write_text(json.dumps(teacher))
            audit = run(root)
            self.assertEqual(audit["total"]["matched_races"], 1)
            self.assertEqual(audit["total"]["teacher_only_hits"], 1)
            self.assertEqual(audit["high_payout_count"], 1)
            self.assertEqual(audit["teacher_high_payout_hits"], 1)
            self.assertEqual(audit["mrt_high_payout_hits"], 0)
            self.assertEqual(audit["excluded"], [])
            self.assertFalse((root / "data/mrt_research").exists())


if __name__ == "__main__":
    unittest.main()
