"""Coverage of the research import gates and the recorded real-race audit."""
from copy import deepcopy
from pathlib import Path
import unittest
from unittest.mock import patch

from two_t.archive_join import join, checked_card, checked_result
from two_t.source import payload


DAY = "2026-09-01"
REV = "a" * 40
KEY = DAY + ":いわき平:3"
URL = "https://www.winticket.jp/keirin/iwakitaira/racecard/2026083013/3/3"
PUBLISHED = DAY + "T20:00:00+09:00"
SAVED = DAY + "T20:01:00+09:00"
PROOF = {"id": "202609011303", "venue": "いわき平", "race": 3, "start": "21:37",
         "rider_ids_by_car": [[i, str(10000 + i)] for i in range(1, 8)],
         "back": 4, "finish": [7, 3, 2], "exacta": ["7-3", 6330]}
RAW = {"venue": "いわき平", "race_number": 3, "start_time": "21:37",
       "is_girls": False, "grade": "F2", "round_name": "一般",
       "entries": [{"car_number": i, "rider_full_name": f"選手{i}", "rider_id": str(10000 + i),
                    "class_rank": "A3", "running_style": "追", "competition_score": 70,
                    "line_position": f"{i}-1"} for i in range(1, 8)]}


class ArchiveJoinTests(unittest.TestCase):
    def test_recorded_pilot_has_no_admissible_line_evidence(self):
        root = Path(__file__).resolve().parents[2]
        evidence = payload(root / "docs" / "2T_RACE_JOIN_20261117.json")
        added, report = join(evidence, [])
        self.assertEqual(report["pilot"], 50)
        self.assertEqual(report["reasons"], {"no timestamped lineup revision": 50})
        self.assertEqual(added, [])

    def test_reject_late_revision_and_wrong_identity(self):
        for changed, at in ((RAW, DAY + "T21:28:00+09:00"),
                            ({**RAW, "start_time": "21:38"}, SAVED)):
            with self.subTest(at=at, start=changed["start_time"]), self.assertRaises(ValueError):
                checked_card(changed, DAY, PUBLISHED, at, URL, PROOF)
        changed = deepcopy(RAW)
        changed["entries"][0]["rider_id"] = "19999"
        with self.assertRaisesRegex(ValueError, "ID"):
            checked_card(changed, DAY, PUBLISHED, SAVED, URL, PROOF)

    @patch("two_t.archive_join.checked_result")
    @patch("two_t.archive_join.snapshot")
    @patch("two_t.archive_join.git")
    def test_builds_only_new_training_row(self, git, snapshot, result):
        git.return_value = SAVED.encode()
        snapshot.return_value = {"date": DAY, "generated_at": PUBLISHED, "races": [RAW]}
        result.return_value = {"confirmed": True, "labels": [4, 7, 3, 2]}
        evidence = {"result_verified_pilot": [PROOF]}
        added, report = join(evidence, [], Path("."), [(REV, DAY)], {PROOF["id"]: URL})
        self.assertEqual(report["eligible_additions"], 1)
        self.assertEqual(added[0]["split"], "train")
        self.assertEqual(added[0]["race_id"], KEY)
        self.assertEqual(len(added[0]["feature_sha256"]), 64)
        result.reset_mock()
        added, report = join(evidence, [{"race_id": KEY}], Path("."), [(REV, DAY)])
        self.assertEqual(report["reasons"], {"already in baseline": 1})
        self.assertEqual(added, [])
        result.assert_not_called()

    @patch("two_t.archive_join.get_page", return_value="")
    @patch("two_t.archive_join.state")
    @patch("two_t.archive_join.result_data")
    def test_result_requires_same_back_and_payout(self, parse, state, page):
        card = checked_card(RAW, DAY, PUBLISHED, SAVED, URL, PROOF)
        found = {"confirmed": True, "cancelled": False, "accident": False, "refund_cars": [],
                 "labels": [4, 7, 3, 2], "payouts": {"7-3": 6330}, "decided_at": DAY + "T21:45:00+09:00"}
        parse.return_value = found
        self.assertEqual(checked_result(card, PROOF, URL), found)
        for change in ({"labels": [3, 7, 3, 2]}, {"payouts": {"7-3": 6000}}, {"accident": True},
                       {"decided_at": "2026-11-10T12:00:00+09:00"}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                parse.return_value = {**found, **change}
                checked_result(card, PROOF, URL)
