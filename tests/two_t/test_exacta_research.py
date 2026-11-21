import csv
from pathlib import Path
import tempfile
import unittest

import torch

from two_t.exacta_research import CARD_WIDTH, DirectExacta, add_card, card_features


class DirectExactaTests(unittest.TestCase):
    def test_distribution_masks_diagonal_and_respects_permutation(self):
        torch.manual_seed(11)
        model = DirectExacta(2, 5).eval()
        race, riders = torch.randn(3, 2), torch.randn(3, 7, 5)
        order = torch.tensor([3, 5, 6, 1, 2, 0, 4])
        old = model(race, riders).softmax(-1).reshape(-1, 7, 7)
        new = model(race, riders[:, order]).softmax(-1).reshape(-1, 7, 7)
        self.assertTrue((old.diagonal(dim1=1, dim2=2) == 0).all())
        torch.testing.assert_close(old.sum((1, 2)), torch.ones(3))
        torch.testing.assert_close(new, old[:, order][:, :, order])

    def test_result_columns_are_ignored_and_conflicting_cards_are_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "archive.csv"
            with p.open("w", encoding="utf-8-sig", newline="") as s:
                w = csv.writer(s)
                w.writerow(("race_id", "banum", "race_score", "age", "running_style", "player_class", "rank", "ni_sha_tan"))
                w.writerow(("a", 1, 81, 31, "逃", "A1", 1, 1500))
                w.writerow(("a", 1, 81, 31, "逃", "A1", 7, 1900))
                w.writerow(("a", 2, 91, 22, "両", "A2", 5, 1500))
                w.writerow(("a", 2, 92, 22, "両", "A2", 5, 1500))
            row = add_card([{"race_id": "a", "cars": [1, 2], "personal": [[1], [2]]}], card_features([p], {"a"}))[0]
        self.assertEqual(row["personal"][0][1:4], [81., 31., 1.])
        self.assertEqual(row["personal"][1][1:], [None] * CARD_WIDTH)


if __name__ == "__main__":
    unittest.main()
