from datetime import date
import unittest

from two_t.annual_extension import payout_rows


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


if __name__ == "__main__":
    unittest.main()
