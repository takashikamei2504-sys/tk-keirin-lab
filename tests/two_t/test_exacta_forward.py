from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from two_t.exacta_forward import archive, card_input, freeze, restore, settle, summarize
from two_t.source import pairs, payload, write


DAY = "2026-11-18"
KEY = "202611187503"
NOW = datetime(2026, 11, 17, 21, 51, tzinfo=timezone.utc)


def card_fixture():
    return {"race_id": KEY, "venue": "松山", "race_number": 3, "start_time": "09:31",
            "close_time": "09:26", "is_girls": False, "result_top3": None,
            "entries": [{"car_number": i, "class_rank": "A1", "rider_id": str(10000 + i),
                         "term": 100, "is_absent": False, "competition_score": 85, "age": 30,
                         "running_style": "両", "rider_full_name": f"選手{i}"} for i in range(1, 8)]}


def feed(raw=None):
    return {"date": DAY, "generated_at": (NOW - timedelta(hours=1)).isoformat(),
            "races": [card_fixture() if raw is None else raw]}


def uniform(card, *_):
    return {key: 1 / 42 for key in pairs(card["cars"])}


class DirectForwardTests(unittest.TestCase):
    def test_freeze_cutoff_and_append_only_result(self):
        models = {7: {"direct": (None, "a" * 64), "mlp": (None, "b" * 64)}}
        with TemporaryDirectory() as tmp:
            ledger = Path(tmp)
            too_late = NOW + timedelta(hours=2, minutes=30)
            x = freeze(ledger, feed(), NOW, {}, "pin", models, clock=lambda: too_late, predictor=uniform)
            self.assertEqual(x["counts"], {})
            x = freeze(ledger, feed(), NOW, {}, "pin", models, clock=lambda: NOW, predictor=uniform)
            self.assertEqual(x["counts"], {"frozen_7": 1})
            x = freeze(ledger, feed(), NOW, {}, "pin", models, clock=lambda: NOW, predictor=uniform)
            self.assertEqual(x["counts"], {"already_frozen": 1})
            self.assertEqual(settle(ledger, clock=lambda: NOW)["counts"], {"awaiting_start": 1})

            def parse(body, card, source_id):
                self.assertEqual(source_id, KEY)
                self.assertEqual(card["race_id"], KEY)
                return {"labels": [7, 1, 2, 3], "source": "test", "sha256": "b" * 64}

            performed = settle(ledger, clock=lambda: NOW + timedelta(hours=5), reader=lambda *_: "",
                               parser=parse)
            self.assertEqual(performed["counts"], {"settled": 1})
            self.assertEqual(summarize(ledger)[7]["settled"], 1)
            target, restored = ledger / "published", ledger / "restored"
            self.assertEqual(archive(ledger, DAY, target)["races"], 1)
            self.assertEqual(restore(target, restored)["races"], 1)
            self.assertEqual(summarize(restored)[7]["frozen"], 1)
            p = target / "venue-75.json"
            data = payload(p)
            data[0]["card"]["venue"] = "改変"
            write(p, data)
            with self.assertRaisesRegex(ValueError, "manifest"):
                restore(target, restored)

    def test_rider_features_have_seven_day_lag_and_exclude_results(self):
        raw = card_fixture()
        history = {("選手1", 100): [(date(2026, 11, 11), "75", 1), (date(2026, 11, 12), "75", 7)]}
        x = card_input(raw, DAY, history)
        self.assertEqual(x["history"][0][12], 1)
        self.assertEqual(x["history"][0][-1], 7)
        raw["result_top3"] = [1, 2, 3]
        with self.assertRaisesRegex(ValueError, "pre-race"):
            card_input(raw, DAY, history)


if __name__ == "__main__":
    unittest.main()
