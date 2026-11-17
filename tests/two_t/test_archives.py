from copy import deepcopy
import unittest

from two_t.archive_coverage import assess_result
from two_t.supplement import published_card


def raw_card():
    return {
        "venue": "大宮", "race_number": 1, "start_time": "10:30", "grade": "F1",
        "round_name": "予選", "is_girls": False, "result_top3": None,
        "entries": [{"car_number": i, "rider_full_name": f"選手{i}", "rider_id": f"{i:05}",
                     "competition_score": 80, "running_style": "追", "class_rank": "A2",
                     "line_position": f"{i}-1"} for i in range(1, 8)]
    }


class ArchiveTests(unittest.TestCase):
    def test_pre_race_jst_and_known_line(self):
        card = published_card(raw_card(), "2026-11-10", "2026-11-10T06:00:00+09:00",
                              "2026-11-10T00:00:00Z", "https://example.com")
        self.assertEqual(card["lineup"], [[i] for i in range(1, 8)])
        self.assertEqual(card["split"], "validation")
        with self.assertRaisesRegex(ValueError, "pre-race"):
            published_card(raw_card(), "2026-11-10", "2026-11-10T06:00:00+09:00",
                           "2026-11-10T01:31:00Z", "https://example.com")

    def test_reject_result_or_unverified_feature(self):
        for mutator in ("result", "score", "line"):
            with self.subTest(mutator=mutator):
                raw = raw_card()
                if mutator == "result":
                    raw["result_top3"] = [1, 2, 3]
                elif mutator == "score":
                    raw["entries"][0]["competition_score"] = 0
                else:
                    raw["entries"][0]["line_position"] = None
                with self.assertRaises(ValueError):
                    published_card(raw, "2026-11-10", "2026-11-10T06:00:00+09:00",
                                   "2026-11-10T09:00:00+09:00", "https://example.com")

    def test_payback_does_not_imply_observed_back(self):
        r = {"finishers": [{"umaban": 1, "name": " 選手 1 ", "kimarite": "逃"}],
             "paybacks": [{"type": "2車単", "combination": "1-2", "payout": 300}]}
        self.assertEqual(assess_result(r, {1: "選手1", 2: "選手2"}), (True, False))
        self.assertIsNone(assess_result(r, {1: "別人", 2: "選手2"}))
        malformed = deepcopy(r)
        malformed["paybacks"][0]["combination"] = "1-1"
        self.assertEqual(assess_result(malformed, {1: "選手1", 2: "選手2"}), (False, False))
