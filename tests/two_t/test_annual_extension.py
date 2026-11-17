from datetime import date
import unittest
from unittest.mock import patch

from two_t.annual_extension import compare_days, join, payout_rows


class AnnualExtensionTest(unittest.TestCase):
    def test_matches_two_unique_payouts_for_the_expected_date(self):
        race = "3620261026020001"

        def row(result, amount, extras=""):
            url = f"https://keirin.kdreams.jp/odawara/racedetail/{race}/?pageType=result"
            return (f'<tr><td class="order" {extras}>{result}</td><td class="refund">{amount}</td>'
                    f'<td><a href="{url}">結果</a></td></tr>').replace('class="order" >', 'class="order">')

        def page(three, two):
            return (f"<title>競輪 払戻金（2026年10月27日） | 楽天Kドリームス</title>"
                    f'<h3 class="daily-refund-result-list_heading">3連単</h3>{three}'
                    f'<h3 class="daily-refund-result-list_heading">2車単</h3>{two}')

        day = date(2026, 10, 27)
        three, two = row("5-1-4", "2,180"), row("5-1", "620")
        self.assertEqual(payout_rows(page(three, two), day), {race: ((5, 1, 4), 620, "odawara")})
        self.assertEqual(payout_rows(page(three, two + two), day), {})
        self.assertEqual(payout_rows(page(three, row("1-5", "420")), day), {})
        self.assertEqual(payout_rows(page(three, row("5-1", "620", 'rowspan="2"')), day), {})
        with self.assertRaisesRegex(ValueError, "date mismatch"):
            payout_rows(page(three, two), date(2026, 10, 28))

    def test_requested_dates_and_duplicates(self):
        day = date(2026, 6, 1)
        riders = {car: ((f"選手{car}", 100), "A1", "", "") for car in range(1, 8)}
        races = [((day, "36", "odawara"), rid, riders) for rid in ("known", "new")]
        races.append(((date(2026, 6, 2), "36", "odawara"), "outside", riders))
        payouts = {day: ({rid: ((1, 3, 5), 620, "odawara") for rid in ("known", "new")}, {})}
        with patch("two_t.annual_extension.read_races", return_value=(races, {})):
            new, counts = join([], payouts, [[{"race_id": "known"}]])
        self.assertEqual([row["race_id"] for row in new], ["new"])
        self.assertEqual(counts["2026-06 / 7"]["matched"], 1)

    def test_paired_comparison_weights_by_race_count(self):
        a = {"data_sha256": "a", "size": 7, "daily": {
            "2026-06-01": {"races": 2, "log_loss": 4.0},
            "2026-06-02": {"races": 1, "log_loss": 3.0},
        }}
        b = dict(a, daily={day: dict(row, log_loss=3.0) for day, row in a["daily"].items()})
        self.assertAlmostEqual(compare_days(a, b, replicates=40)["transformer_minus_mlp_log_loss"], 2 / 3)
        with self.assertRaisesRegex(ValueError, "same race file"):
            compare_days(a, dict(b, data_sha256="b"))


if __name__ == "__main__":
    unittest.main()
