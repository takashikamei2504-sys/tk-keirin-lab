"""Cover the prospective export's timing and evidence gates."""
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from test_archive_join import DAY, KEY, PUBLISHED, RAW, SAVED
from two_t.kdreams_odds import ODDS_QUERY, RESULT_QUERY
from two_t.ledger import ledger_path, store_once
from two_t.netkeirin_results import RESULT_URL
from two_t.observed_forward import V1_PINS, freeze_quotes, reconcile
from two_t.observation_export import audit, summary
from two_t.observe import observe
from two_t.publish import forward_data
from two_t.source import pairs, payload, stamp, write


SOURCE_ID = "202609011303"
SOURCE_URL = "https://keirin.kdreams.jp/iwakitaira/racedetail/1320260830030003/?pageType=showResult"
REVIEWED = DAY + "T21:50:00+09:00"
CONFIRMED = DAY + "T21:51:00+09:00"


class ObservationExportTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.ledger = Path(directory.name)
        feed = {"date": DAY, "generated_at": PUBLISHED, "races": [{**RAW, "race_id": SOURCE_ID, "close_time": "21:32"}]}
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

    def test_links_eligible_odds_and_holds_mismatches_separately(self):
        store_once(self.ledger / "review-results", KEY, self.review)
        store_once(self.ledger / "results", KEY, self.result)
        self.assertEqual(self.get_audit()[1]["t10_counts"], {"missing": 1})
        quote = {"state": "live", "pool": "all", "sales_close": DAY + "T21:32:00+09:00",
                 "published_at": DAY + "T21:20:00+09:00", "captured_at": DAY + "T21:21:30+09:00",
                 "page_sha256": "d" * 64, "source_url": SOURCE_URL.removesuffix(RESULT_QUERY) + ODDS_QUERY,
                 "odds": {pair: 30.5 for pair in pairs(self.feature["card"]["cars"])}}
        saved = {"race_id": KEY, "mode": "t10", "quote": quote, "feature_sha256": self.feature["feature_sha256"]}
        path = store_once(self.ledger / "quotes", KEY + ":t10", saved)
        rows, report = self.get_audit()
        self.assertEqual(report["t10_counts"], {"eligible": 1})
        self.assertEqual(rows[0]["t10"], quote)
        saved["feature_sha256"] = "9" * 64
        write(path, saved)
        rows, report = self.get_audit()
        self.assertEqual(report["t10_counts"], {"invalid": 1})
        self.assertNotIn("t10", rows[0])

    def test_frozen_v1_hashes_match_the_existing_replay(self):
        root = Path(__file__).resolve().parents[2]
        frozen = payload(root / "two_t/race-records.json")["replay"]
        self.assertEqual({len(row["cars"]): row["model_sha256"] for row in frozen}, V1_PINS)
        self.assertTrue(all(V1_PINS[len(row["cars"])] == row["model_sha256"] for row in frozen))

    def test_freezes_before_sales_close_and_settles_at_the_fixed_threshold(self):
        quote = {"state": "live", "pool": "all", "sales_close": DAY + "T21:32:00+09:00",
                 "published_at": DAY + "T21:20:00+09:00", "captured_at": DAY + "T21:21:30+09:00",
                 "page_sha256": "e" * 64, "source_url": SOURCE_URL.removesuffix(RESULT_QUERY) + ODDS_QUERY,
                 "odds": {pair: 30.5 for pair in pairs(self.feature["card"]["cars"])}}
        identity = KEY + ":t10"
        store_once(self.ledger / "quotes", identity,
                   {"race_id": KEY, "mode": "t10", "quote": quote, "feature_sha256": self.feature["feature_sha256"]})
        clock = lambda: stamp(DAY + "T21:23:00+09:00")
        checkpoint = self.ledger / "transformer-7.pt"
        self.assertEqual(freeze_quotes(self.ledger, self.ledger, {}, clock)["counts"], {"checkpoint_unavailable": 1})
        checkpoint.write_bytes(b"fixture checkpoint")
        pin = sha256(checkpoint.read_bytes()).hexdigest()
        self.assertIn("SHA-256 mismatch", freeze_quotes(self.ledger, self.ledger, {7: "f" * 64}, clock)["failures"][KEY])
        late = lambda: stamp(quote["sales_close"])
        self.assertEqual(freeze_quotes(self.ledger, self.ledger, {7: pin}, late)["counts"], {"closed_before_freeze": 1})
        card = self.feature["card"]
        probabilities = dict.fromkeys(quote["odds"], 0.85 / 41)
        probabilities["7-3"] = 0.15
        forecast = {**card, "input_as_of": card["saved_at"], "probabilities": probabilities,
                    "model_sha256": pin, "feature_sha256": self.feature["feature_sha256"]}
        with patch("two_t.forward.predict_card", return_value=forecast) as predict:
            self.assertEqual(freeze_quotes(self.ledger, self.ledger, {7: pin}, clock)["counts"], {"frozen": 1})
            self.assertEqual(freeze_quotes(self.ledger, self.ledger, {7: pin}, clock)["counts"], {"already_frozen": 1})
            predict.assert_called_once()
        self.assertEqual(reconcile(self.ledger, clock)["counts"], {"before_result_window": 1})
        store_once(self.ledger / "review-results", KEY, self.review)
        store_once(self.ledger / "results", KEY, self.result)
        after = lambda: stamp(CONFIRMED)
        self.assertIn("fixed V1 model", reconcile(self.ledger, after)["failures"][KEY])
        self.assertEqual(reconcile(self.ledger, after, {7: pin})["counts"], {"settled": 1})
        self.assertEqual(reconcile(self.ledger, after, {7: pin})["counts"], {"already_settled": 1})
        settlement = payload(ledger_path(self.ledger / "settlements", identity))["settlement"]
        self.assertEqual((settlement["stake"], settlement["returned"]), (100, 6330))

    def test_cumulative_roi_keeps_field_size_and_odds_mode_separate(self):
        for index, cars, mode, stake, returned in (
                (1, 7, "t10", 100, 200),
                (2, 9, "t10", 200, 100),
                (3, 7, "t5", 100, 50),
                (4, 7, "t10", 100, 0)):
            key = f"{DAY}:いわき平:{index}:{mode}"
            store_once(self.ledger / "forecasts", key, {"race_id": str(index),
                       "start": f"{DAY}T21:{index:02d}:00+09:00",
                       "cars": list(range(1, cars + 1)), "quote_mode": mode})
            store_once(self.ledger / "settlements", key,
                       {"settlement": {"stake": stake, "returned": returned}})
        reports = {row["race_id"]: row["cumulative_roi"] for row in forward_data(self.ledger)}
        self.assertEqual(reports, {"1": 2.0, "2": 0.5, "3": 0.5, "4": 1.0})
