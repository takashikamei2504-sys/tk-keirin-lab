"""Cover the prospective export's timing and evidence gates."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from test_archive_join import DAY, KEY, PUBLISHED, RAW, SAVED
from two_t.ledger import ledger_path, store_once
from two_t.netkeirin_results import RESULT_URL
from two_t.observation_export import audit, summary
from two_t.observe import observe
from two_t.source import payload, stamp, write


SOURCE_ID = "202609011303"
SOURCE_URL = "https://keirin.kdreams.jp/iwakitaira/racedetail/1320260830030003/?pageType=showResult"
REVIEWED = DAY + "T21:50:00+09:00"
CONFIRMED = DAY + "T21:51:00+09:00"


class ObservationExportTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.ledger = Path(directory.name)
        feed = {"date": DAY, "generated_at": PUBLISHED, "races": [{**RAW, "race_id": SOURCE_ID}]}
        with patch("two_t.observe.day_feed", return_value=feed):
            observe(self.ledger, clock=lambda: stamp(SAVED), review_results=True)
        self.card_file = ledger_path(self.ledger / "cards", KEY)
        self.feature = payload(self.card_file)
        binding = {"race_id": KEY, "feature_sha256": self.feature["feature_sha256"]}
        self.review = {**binding, "source_race_id": SOURCE_ID, "result_source": SOURCE_URL,
                       "result_sha256": "a" * 64, "observed_at": REVIEWED,
                       "statuses": {}, "back": 7, "finish": [7, 3, 2], "payouts": {"7-3": 6330}}
        result = {"labels": [7, 7, 3, 2], "payouts": {"7-3": 6330}, "refund_cars": [],
                  "rider_ids_verified": True, "confirmed": True, "accident": False, "cancelled": False,
                  "result_source": SOURCE_URL, "decided_at": None,
                  "roster_confirmation": self.feature["card"]["roster"],
                  "evidence": {SOURCE_URL: "a" * 64, RESULT_URL + SOURCE_ID: "b" * 64}}
        self.result = {**binding, "observed_at": CONFIRMED, "result": result, "complete_labels": True}

    def get_audit(self, as_of=CONFIRMED, day=DAY):
        return audit(self.ledger, stamp(as_of), day)

    def test_export_has_provenance_and_an_independent_split(self):
        store_once(self.ledger / "review-results", KEY, self.review)
        store_once(self.ledger / "results", KEY, self.result)
        rows, report = self.get_audit()
        self.assertEqual(report["counts"], {"eligible": 1})
        self.assertEqual(report["fields"], {"7": {"eligible": 1}, "9": {}})
        self.assertIn("| 検証用に抽出 | 1 | 1 | 0 |", summary(report))
        self.assertEqual(rows[0]["split"], "prospective")
        self.assertEqual(rows[0]["result"]["labels"], [7, 7, 3, 2])
        self.assertEqual(rows[0]["result_observed_at"], CONFIRMED)
        self.assertEqual(self.get_audit(day="2026-09-02")[0], [])

    def test_timing_and_unconfirmed_rows_do_not_leak(self):
        self.assertEqual(self.get_audit(SAVED)[1]["counts"], {"before_result_window": 1})
        self.assertEqual(self.get_audit()[1]["counts"], {"result_unavailable": 1})
        store_once(self.ledger / "review-results", KEY, self.review)
        self.assertEqual(self.get_audit()[1]["counts"], {"unverified_result": 1})
        store_once(self.ledger / "results", KEY, self.result)
        self.assertEqual(self.get_audit(REVIEWED)[1]["counts"], {"result_after_cutoff": 1})

    def test_rejects_changed_payout_and_tampered_card(self):
        store_once(self.ledger / "review-results", KEY, self.review)
        self.result["result"]["payouts"] = {"7-3": 6300}
        store_once(self.ledger / "results", KEY, self.result)
        self.assertEqual(self.get_audit()[1]["counts"], {"invalid_result": 1})
        self.feature["card"]["lineup"] = self.feature["card"]["lineup"][::-1]
        write(self.card_file, self.feature)
        self.assertEqual(self.get_audit()[1]["counts"], {"invalid_card": 1})
