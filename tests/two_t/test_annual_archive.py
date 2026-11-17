import csv
import math
from pathlib import Path
import tempfile
import unittest

import torch

from two_t.annual_archive import construct, rider_id
from two_t.annual_train import observed_log_prob, predict_many
from two_t.model import make


class AnnualArchiveTest(unittest.TestCase):
    def test_target_result_and_same_week_are_excluded_from_features(self):
        def make_rows(out, second_day_winner):
            with out.open("w", newline="") as stream:
                columns = ["race_id", "venue_slug", "date", "race_no", "banum", "player_name",
                           "term", "player_class", "rank", "ni_sha_tan"]
                writer = csv.writer(stream)
                writer.writerow(columns)
                for day, meeting, meeting_day, winner, second in (
                    (1, 1, 1, 1, 2), (2, 1, 2, second_day_winner, 3), (10, 10, 1, 1, 2)
                ):
                    front = [winner, second]
                    order = front + [car for car in range(1, 10) if car not in front]
                    for car in range(1, 10):
                        writer.writerow([f"42202501{meeting:02}{meeting_day:02}0001", "nagoya",
                                         f"2025-01-{meeting:02}", 1, car, f"選手 選手{car} 愛", "105.0",
                                         "S1", order.index(car) + 1, f"{winner}-{second} 100円"])
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.csv"
            make_rows(source, 1)
            a, report = construct([source], 9)
            make_rows(source, 2)
            b, _ = construct([source], 9)
        self.assertEqual(report["counts"], {"train": 3})
        self.assertEqual(a[1]["date"], "2025-01-02")
        self.assertEqual(a[1]["personal"], b[1]["personal"])
        self.assertEqual(a[1]["personal"][0], [None] * 19)
        self.assertNotEqual(a[1]["targets"], b[1]["targets"])
        self.assertNotEqual(a[2]["personal"], b[2]["personal"])
        self.assertEqual(rider_id({"player_name": "亀井 選手 愛", "term": "100.0"}),
                         rider_id({"player_name": "亀井 選手", "term": "100"}))

    def test_missing_back_is_a_marginal_not_a_single_class(self):
        torch.set_num_threads(2)
        n = 9
        c, x, r = torch.zeros(2, 2), torch.zeros(2, n, 3), torch.zeros(2, n, n, 3)
        targets = torch.tensor([[0, 1, 2], [2, 1, 0]])
        for kind in ("transformer", "mlp"):
            with self.subTest(kind=kind):
                model = make(kind, n, 2, 3).eval()
                for weights in model.parameters():
                    torch.nn.init.zeros_(weights)
                p = observed_log_prob(model, c, x, r, targets, kind)
                torch.testing.assert_close(p, torch.full((2,), -math.log(n*(n-1)*(n-2))))
                for exacta in predict_many(model, (c, x, r, targets), 2):
                    self.assertEqual(int(exacta.count_nonzero()), 72)
                    self.assertEqual(int(exacta.diagonal().count_nonzero()), 0)
                    self.assertAlmostEqual(exacta.sum().item(), 1., delta=1e-6)


if __name__ == "__main__":
    unittest.main()
