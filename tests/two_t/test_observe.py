"""Test prospective capture and the real result parser with fixed feed fixtures."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from test_archive_join import DAY, KEY, PUBLISHED, RAW, SAVED, URL
from two_t import kdreams_results
from two_t.observe import observe
from two_t.source import payload, stamp


FEED = {"date": DAY, "generated_at": PUBLISHED, "races": [RAW]}


def queries(*items):
    return ("window.__PRELOADED_STATE__ = " + json.dumps({"tanStackQuery": {"queries": [
        {"queryKey": [name], "state": {"data": data}} for name, data in items]}})
        + "; window.__CONFIG__")


def result_page(*, wrong_roster=False, pending=False, cancelled=False, refund=False, tie=False):
    start = stamp(DAY + "T21:37:00+09:00").timestamp()
    entries = [{"number": i, "playerId": str(10000 + i), "absent": refund and i == 1}
               for i in range(1, 8)]
    if wrong_roster:
        entries[0]["playerId"] = "19999"
    race = {"id": "race-id", "number": 3, "startAt": start, "closeAt": start - 180, "cancel": cancelled,
            "status": 2 if pending else 3, "decidedAt": None if pending else start + 180}
    results = [{"order": order, "playerId": str(10000 + car),
                "back": car == 4, "hasAccident": False}
               for order, car in enumerate([7, 3, 2, 4, 1, 5, 6], 1)]
    if tie:
        results[1]["order"] = 1
    data = {"race": race, "schedule": {"id": "2026090113", "date": DAY.replace("-", "")},
            "venues": [{"id": "13", "name": RAW["venue"]}], "entries": entries,
            "results": [] if pending or cancelled else results}
    odds = {"exacta": [] if cancelled else [{"raceId": "race-id", "key": [7, 3], "unitPrice": 100,
              "absent": False, "odds": 63.3, "payoffUnitPrice": 6330}]}
    return queries(("FETCH_KEIRIN_RACE", data), ("FETCH_KEIRIN_RACE_ODDS", odds))


class ObserveTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.ledger = Path(directory.name)
        self.now = stamp(SAVED)
        feed = patch("two_t.observe.day_feed", return_value=FEED)
        self.feed = feed.start()
        self.addCleanup(feed.stop)
        page = patch("two_t.observe.get_page", return_value=result_page())
        self.page = page.start()
        self.addCleanup(page.stop)

    def run_cycle(self, use_override=True):
        return observe(self.ledger, {KEY: URL} if use_override else {}, clock=lambda: self.now)

    def test_capture_and_result_are_separate_and_immutable(self):
        self.assertEqual(self.run_cycle()["cards_saved"], 1)
        self.page.assert_not_called()
        card_file, = (self.ledger / "cards").glob("*.json")
        before = card_file.read_bytes()
        self.now = stamp(DAY + "T21:51:00+09:00")
        summary = self.run_cycle()
        self.assertEqual(summary["complete_labels"], 1)
        result_file, = (self.ledger / "results").glob("*.json")
        found = payload(result_file)
        self.assertEqual(found["result"]["labels"], [4, 7, 3, 2])
        self.assertEqual(found["result"]["payouts"], {"7-3": 6330})
        self.assertEqual(found["feature_sha256"], payload(card_file)["feature_sha256"])
        self.page.reset_mock()
        self.assertEqual(self.run_cycle()["results_saved"], 0)
        self.page.assert_not_called()
        self.assertEqual(card_file.read_bytes(), before)

    def test_rejects_late_and_duplicated_lineups(self):
        self.now = stamp(DAY + "T21:27:01+09:00")
        self.assertIn("too late", self.run_cycle()["failures"][KEY])
        self.now = stamp(DAY + "T21:27:00+09:00")
        self.feed.return_value = {**FEED, "races": [RAW, RAW]}
        self.assertIn("duplicate", self.run_cycle()["failures"][KEY])
        self.feed.return_value = FEED
        self.assertEqual(self.run_cycle()["cards_saved"], 1)

    def test_keeps_evidence_when_listing_is_unavailable(self):
        self.page.side_effect = OSError("listing unavailable")
        self.assertEqual(self.run_cycle(use_override=False)["cards_saved"], 1)
        self.now = stamp("2026-09-02T07:00:00+09:00")
        self.feed.side_effect = OSError("next feed unavailable")
        self.page.side_effect = None
        self.assertEqual(self.run_cycle()["complete_labels"], 1)

    def test_mismatched_roster_and_pending_results_can_be_retried(self):
        self.run_cycle()
        self.now = stamp(DAY + "T21:51:00+09:00")
        self.page.return_value = result_page(wrong_roster=True)
        self.assertIn("match", self.run_cycle()["failures"][KEY])
        self.page.return_value = result_page(pending=True)
        self.assertEqual(self.run_cycle()["results_pending"], 1)
        self.page.return_value = result_page()
        self.assertEqual(self.run_cycle()["complete_labels"], 1)

    def test_cancellation_refund_and_tie_are_preserved_without_complete_labels(self):
        for scenario in ("cancelled", "refund", "tie"):
            with self.subTest(scenario=scenario), TemporaryDirectory() as directory:
                self.ledger = Path(directory)
                self.now = stamp(SAVED)
                self.run_cycle()
                self.now = stamp(DAY + "T21:51:00+09:00")
                self.page.return_value = result_page(**{scenario: True})
                summary = self.run_cycle()
                self.assertEqual(summary["results_saved"], 1)
                self.assertEqual(summary["complete_labels"], 0)

    def test_invalid_line_evidence_is_rejected(self):
        raw = deepcopy(RAW)
        del raw["entries"][0]["line_position"]
        self.feed.return_value = {**FEED, "races": [raw]}
        self.assertIn("no documented line", self.run_cycle()["failures"][KEY])

    def test_result_budget_leaves_existing_cards_available_for_retry(self):
        self.run_cycle()
        self.now = stamp(DAY + "T21:51:00+09:00")
        with patch("two_t.observe.monotonic", side_effect=[100, 101]):
            summary = observe(self.ledger, {KEY: URL}, clock=lambda: self.now, budget_seconds=1)
        self.assertEqual(summary["reconcile_budget_exhausted"], 1)
        self.page.assert_not_called()
        self.assertEqual(self.run_cycle()["complete_labels"], 1)

    def test_automatic_retry_expiry_still_allows_explicit_reconciliation(self):
        self.run_cycle()
        self.now = stamp("2026-09-05T22:00:00+09:00")
        summary = self.run_cycle(use_override=False)
        self.assertEqual(summary["result_retries_expired"], 1)
        self.page.assert_not_called()
        self.assertEqual(self.run_cycle()["complete_labels"], 1)

    def test_kdreams_result_requires_full_roster_and_remains_unverified(self):
        raw = {**RAW, "race_id": "202609011303"}
        self.feed.return_value = {**FEED, "races": [raw]}
        url = "https://keirin.kdreams.jp/iwakitaira/racedetail/1320260830030003/?pageType=showResult"
        rows = ""
        for pos, car in enumerate([7, 3, 2, 4, 1, 5, 6], 1):
            cells = ["", str(pos), str(car), f"選手{car}", "", "14.2", "", "B" if car == 4 else "", ""]
            rows += "<tr>" + "".join(f"<td>{cell}</td>" for cell in cells) + "</tr>"
        html = (
            "<title>いわき平競輪 レース詳細 3R | 2026年09月01日</title>"
            '<dt class="start">発走予定</dt><dd>21:37</dd>'
            f'<table class="result_table">{rows}</table>'
            '<table class="refund_table"><tr><td><dl><dt>7-3</dt><dd>6,330円</dd>'
            '</dl></td></tr></table>'
        )
        observe(self.ledger, clock=lambda: self.now, review_results=True)
        self.now = stamp(DAY + "T21:51:00+09:00")
        with patch.object(kdreams_results, "links_for", return_value={raw["race_id"]: url}), \
                patch.object(kdreams_results, "read_page", return_value=html.replace("選手4", "別選手")) as read:
            failed = observe(self.ledger, clock=lambda: self.now, review_results=True)
            self.assertIn("roster", failed["failures"][KEY])
            read.return_value = html.replace("7-3", "7-2")
            failed = observe(self.ledger, clock=lambda: self.now, review_results=True)
            self.assertIn("payout disagree", failed["failures"][KEY])
            read.return_value = html
            good = observe(self.ledger, clock=lambda: self.now, review_results=True)
            self.assertEqual(good["review_results_saved"], 1)
            self.assertEqual(good["complete_labels"], 0)
            read.reset_mock()
            self.assertEqual(observe(self.ledger, clock=lambda: self.now, review_results=True)
                             ["review_results_saved"], 0)
            read.assert_not_called()
        result_file, = (self.ledger / "review-results").glob("*.json")
        result = payload(result_file)
        self.assertEqual((result["back"], result["finish"], result["payouts"]), (4, [7, 3, 2], {"7-3": 6330}))
        self.assertFalse(result["rider_ids_verified"])
        self.assertFalse((self.ledger / "results").exists())
