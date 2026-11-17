"""Exercise exacta pair order and clock/pool gates for the public odds capture."""
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from test_archive_join import DAY, KEY, PUBLISHED, RAW, SAVED
from two_t.kdreams_odds import capture, snapshot, verify_quote
from two_t.ledger import ledger_path
from two_t.observe import observe
from two_t.source import payload, stamp


URL = "https://keirin.kdreams.jp/iwakitaira/racedetail/1320260830030003/?pageType=showResult"
RAW_CARD = {**RAW, "race_id": "202609011303", "close_time": "21:32"}
DUE = DAY + "T21:21:51+09:00"


def page(cars, start="21:37", close="21:32", published="21:20", extra=""):
    roster = "".join(f'<td class="rider n{i}">選手{i}<br>県 99期</td>' for i in cars)
    odds = "".join(f'<tr><td><span class="num">{first}-{second}</span><span class="odds">'
                   f'{10 * first + second}.0</span></td></tr>'
                   for first in cars for second in cars if first != second)
    return (
        '<head><title>いわき平競輪 3R | 2026年09月01日</title></head>'
        f'<dt class="start">発走予定</dt><dd>{start}</dd><dt class="bet">投票締切</dt><dd>{close}</dd>'
        f'{extra}<div class="status none" id="JS_ODDSSTATUS_2shatan"><p class="time">'
        f'2026/09/01 {published}現在</p></div><div id="JS_ODDSCONTENTS_2shatan">'
        f'<table class="odds_table">{roster}</table><p class="header">人気順</p><table>{odds}</table>'
        '<!-- 2車単 End -->'
    )


def record(raw=RAW_CARD):
    return {"card": {"date": DAY, "venue": "いわき平", "race_no": 3,
                     "start": f"{DAY}T{raw['start_time']}:00+09:00",
                     "cars": [r["car_number"] for r in raw["entries"]]}, "raw_card": raw}


class OddsCaptureTests(unittest.TestCase):
    def test_decodes_7_and_9_ordered_fields(self):
        for n in (7, 9):
            raw = {**RAW_CARD, "entries": [{"car_number": i, "rider_full_name": f"選手{i}"}
                                           for i in range(1, n + 1)]}
            data = record(raw)
            quote = snapshot(page(data["card"]["cars"]), URL, data, stamp(DUE))
            verify_quote(quote, data["card"])
            self.assertEqual(len(quote["odds"]), n * (n - 1))
            self.assertEqual((quote["odds"]["1-2"], quote["odds"]["2-1"]), (12, 21))

    def test_rejects_final_stale_or_late_quotes_and_unknown_roster(self):
        data = record()
        cars = data["card"]["cars"]
        for html, now, reason in (
                (page(cars, extra='<span class="icon_confirmed">確定オッズ</span>'), DUE, "final"),
                (page(cars, published="21:10"), DUE, "stale"),
                (page(cars), DAY + "T21:22:01+09:00", "window"),
                (page(cars).replace("選手3", "別選手"), DUE, "roster"),
                (page(cars).replace("1-2", "1-3", 1), DUE, "duplicate"),
                (page(cars, close="21:31"), DUE, "schedule"),
        ):
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, reason):
                verify_quote(snapshot(html, URL, data, stamp(now)), data["card"])

    def test_requires_proven_full_pool_for_early_updates(self):
        data = record({**RAW_CARD, "start_time": "09:21", "close_time": "09:16"})
        options = {"start": "09:21", "close": "09:16", "published": "09:04"}
        now = stamp(DAY + "T09:06:00+09:00")
        cars = data["card"]["cars"]
        with self.assertRaisesRegex(ValueError, "provider-only"):
            verify_quote(snapshot(page(cars, **options), URL, data, now), data["card"])
        html = page(cars, extra='<span class="icon_status morning"></span>', **options)
        verify_quote(snapshot(html, URL, data, now), data["card"])

    def test_captures_once_in_the_actual_window(self):
        with TemporaryDirectory() as directory:
            ledger = Path(directory)
            feed = {"date": DAY, "generated_at": PUBLISHED, "races": [RAW_CARD]}
            with patch("two_t.observe.day_feed", return_value=feed):
                observe(ledger, clock=lambda: stamp(SAVED), review_results=True)
            with patch("two_t.kdreams_odds.links_for", return_value={RAW_CARD["race_id"]: URL}), \
                    patch("two_t.kdreams_odds.read_page", return_value=page(range(1, 8))) as read:
                self.assertEqual(capture(ledger, clock=lambda: stamp(SAVED))["counts"], {"window_not_open": 1})
                read.assert_not_called()
                self.assertEqual(capture(ledger, clock=lambda: stamp(DUE))["counts"], {"quotes_saved": 1})
                self.assertEqual(capture(ledger, clock=lambda: stamp(DUE))["counts"], {"already_saved": 1})
                read.assert_called_once()
            entry = payload(ledger_path(ledger / "quotes", KEY + ":t10"))
            self.assertEqual(entry["quote"]["captured_at"], DUE)
            self.assertEqual(entry["feature_sha256"], payload(ledger_path(ledger / "cards", KEY))["feature_sha256"])
