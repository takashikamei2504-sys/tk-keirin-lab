import unittest
from unittest.mock import patch

from two_t.netkeirin_results import BASE, RESULT_URL, confirm, parse_result


ID = "202611062501"
CARD = {"race_id": "2026-11-06:大宮:1", "date": "2026-11-06", "venue": "大宮", "race_no": 1,
        "start": "2026-11-06T11:05:00+09:00", "cars": list(range(1, 8)),
        "roster": [[car, str(10000 + car)] for car in range(1, 8)]}
STAGED = {"race_id": CARD["race_id"], "source_race_id": ID, "statuses": {}, "back": 6,
          "finish": [3, 5, 2], "payouts": {"3-5": 670}, "result_sha256": "c" * 64,
          "result_source": "https://keirin.kdreams.jp/omiya/racedetail/2520261104030001/?pageType=showResult"}


def page():
    rows = ""
    for rank, car in enumerate([3, 5, 2, 1, 6, 7, 4], 1):
        link = f'<a href="{BASE}/db/profile/?id=0{10000 + car}">選手</a>'
        cells = [f"{rank}着", "1", str(car), link, "", "14.5", "", "B" if car == 6 else ""]
        comment = '<!-- <td><a href="wrong-id">unused</a></td> -->'
        rows += '<tr class="PlayerList">' + comment + "".join(f"<td>{x}</td>" for x in cells) + "</tr>"
    return (
        '<title>大宮競輪 ＦＩ杯 2026年11月06日 1R 結果・払戻金</title>'
        f'<link rel="canonical" href="{RESULT_URL}{ID}">'
        '<div>発走 11:05 締切 11:00</div><p>レースが確定しました</p>'
        f'<table id="All_Result_Table">{rows}</table>'
        '<table><tr class="Umatan"><td class="Result">3&gt;5</td>'
        '<td class="Payout"><span>670円</span></td></tr></table>'
    )


class NetkeirinTests(unittest.TestCase):
    def test_requires_the_same_race_schedule_and_final_status(self):
        for old, new, reason in (("大宮競輪", "松山競輪", "race identity"),
                                 ("11:05", "11:06", "race schedule"),
                                 ("レースが確定しました", "", "result pending"),
                                 ("010006", "099999", "rider IDs"),
                                 ("3&gt;5", "3&gt;7", "payout disagree"),
                                 ("4着", "落車", "irregular")):
            with self.subTest(reason=reason), self.assertRaisesRegex(ValueError, reason):
                parse_result(page().replace(old, new), CARD, ID)

    @patch("two_t.netkeirin_results.read_result", return_value=page())
    def test_two_sources_must_agree_before_confirmation(self, read):
        checked = confirm(CARD, STAGED)
        self.assertTrue(checked["rider_ids_verified"])
        self.assertEqual(checked["labels"], [6, 3, 5, 2])
        self.assertEqual(checked["payouts"], {"3-5": 670})
        self.assertIsNone(checked["decided_at"])
        self.assertEqual(len(checked["evidence"]), 2)
        for change in ({"back": 4}, {"payouts": {"3-5": 671}}, {"finish": [3, 5, 1]}):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "providers disagree"):
                confirm(CARD, {**STAGED, **change})
