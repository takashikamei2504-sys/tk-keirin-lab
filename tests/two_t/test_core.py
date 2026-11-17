from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import torch

from two_t.evaluate import choices, eligible_quote, settle
from two_t.forward import freeze, predict_card
from two_t.model import classes, make, permute, predict
from two_t.source import card_input, pairs, split
from two_t.train import fit_scaling, tensorize


def snapshot():
    cars = range(1, 8)
    return {"race_id": "2026-11-13:大宮:1", "cutoff": "2026-11-13T02:00:00Z",
            "saved_at": "2026-11-13T01:00:00Z", "pre_race": True,
            "identity": [[n, str(n), "名称"] for n in cars],
            "input": {"date": "2026-11-13", "venue": "大宮", "race_no": 1, "start": "11:00",
                      "grade": "FI", "class": "一般", "lineup": [[1, 2], [3, 4], [5, 6, 7]],
                      "riders": [{"no": n, "score": 80, "style": "追", "meta": {"rank": "A1", "rider_id": str(n)}}
                                 for n in cars],
                      "source": {"mode": "live-public-feed", "generated_at": "2026-11-13T00:00:00Z",
                                 "url": "https://example.com"}}}


class CoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        torch.set_num_threads(1)
        torch.manual_seed(11)

    def test_legal_distributions(self):
        for n, count in ((7, 42), (9, 72)):
            self.assertEqual(len(pairs(range(1, n+1))), count)
            self.assertEqual(len(classes(n)), n*n*(n-1)*(n-2))
            x = (torch.randn(1, 4), torch.randn(1, n, 8), torch.rand(1, n, n, 3))
            for kind in ("transformer", "mlp"):
                with self.subTest(n=n, kind=kind):
                    model = make(kind, n, 4, 8).eval()
                    p, b = predict(model, *x, repeats=2)
                    self.assertEqual(p.count_nonzero().item(), count)
                    self.assertEqual(p.diagonal().count_nonzero().item(), 0)
                    self.assertAlmostEqual(p.sum().item(), 1, places=6)
                    self.assertAlmostEqual(b.sum().item(), 1, places=6)
                    torch.testing.assert_close(predict(model, *x, repeats=2)[0], p, rtol=0, atol=0)
                    with torch.inference_mode():
                        slow, _ = model.distribution(*x, full=True)
                        fast, _ = model.distribution(*x)
                    torch.testing.assert_close(slow, fast, rtol=2e-5, atol=1e-7)

    def test_backward_decoding_and_permutation(self):
        n = 9
        x = (torch.randn(2, 4), torch.randn(2, n, 8), torch.rand(2, n, n, 3))
        labels = torch.tensor([[1, 1, 2, 3], [4, 6, 3, 1]])
        order = torch.arange(n-1, -1, -1).repeat(2, 1)
        c, p, r, target = permute(*x, labels, order)
        self.assertTrue(torch.equal(r, x[2].flip(1, 2)))
        self.assertTrue(torch.equal(target, n - 1 - labels))
        for kind in ("transformer", "mlp"):
            model = make(kind, n, 4, 8)
            loss = model.loss(c, p, r, target)
            self.assertTrue(loss.isfinite())
            loss.backward()

    def test_features_and_boundaries(self):
        row = card_input(snapshot())
        self.assertEqual([split(d) for d in ("2026-11-09", "2026-11-10", "2026-11-13")],
                         ["train", "validation", "test"])
        self.assertEqual(row["relation"][0][1], [1, 0, 1])
        s = snapshot()
        s["saved_at"] = "2026-11-13T03:00:00Z"
        with self.assertRaisesRegex(ValueError, "unverified"):
            card_input(s)
        s = snapshot()
        s["input"]["lineup"] = [[1, 2]]
        with self.assertRaisesRegex(ValueError, "lineup"):
            card_input(s)
        s = snapshot()
        s["input"]["riders"][0]["recent_form"] = {"verified_identity": True, "rider_id": "1",
          "collected_at": "2026-11-13T01:01:00Z", "source_updated_at": "2026-11-13T00:50:00Z",
          "stats": {"b": 10}}
        self.assertIsNone(card_input(s)["personal"][0][7])

    def test_ev_settlement(self):
        quote = {"odds": {"1-2": 30, "2-1": 15, "3-1": 30}}
        tickets = choices({"1-2": .05, "2-1": .1, "3-1": .05}, quote, 1.5)
        self.assertEqual(tickets, {"1-2": 1.5, "2-1": 1.5, "3-1": 1.5})
        observed = {"confirmed": True, "cancelled": False, "payouts": {"1-2": 800, "2-1": 1100},
                    "refund_cars": [3]}
        result = settle(tickets, observed)
        self.assertEqual((result["stake"], result["returned"], result["hits"], result["refunds"]),
                         (300, 2000, 2, 1))
        result = settle(tickets, {**observed, "cancelled": True})
        self.assertEqual((result["stake"], result["returned"], result["hits"]), (300, 300, 0))
        self.assertIsNone(settle(tickets, {**observed, "confirmed": False}))

    def test_quote_window_and_immutable_forecast(self):
        card = card_input(snapshot())
        card["feature_sha256"] = "abc"
        market = pairs(card["cars"])
        forecast = {"race_id": card["race_id"], "feature_sha256": "abc",
                    "probabilities": dict.fromkeys(market, 1/42)}
        close = "2026-11-13T01:55:00+00:00"
        captured = datetime.fromisoformat(close) - timedelta(minutes=10, seconds=20)
        quote = {"state": "live", "sales_close": close, "odds": dict.fromkeys(market, 75),
                 "captured_at": captured.isoformat(), "published_at": captured.isoformat(),
                 "source_url": "https://example.com"}
        self.assertTrue(eligible_quote(quote, card["cars"], close, "t10"))
        self.assertFalse(eligible_quote(quote, card["cars"], close, "t5"))
        self.assertFalse(eligible_quote({**quote, "state": "final"}, card["cars"], close, "t10"))
        self.assertFalse(eligible_quote({**quote, "captured_at": datetime.fromisoformat(close).isoformat()},
                                        card["cars"], close, "t10"))
        with TemporaryDirectory() as temp:
            path = freeze(Path(temp), card, forecast, quote, captured, "t10")
            original = path.read_bytes()
            with self.assertRaises(FileExistsError):
                freeze(Path(temp), card, forecast, quote, captured + timedelta(seconds=1), "t10")
            with self.assertRaisesRegex(ValueError, "pre-race"):
                freeze(Path(temp), card, forecast, None, captured + timedelta(hours=2), "t10")
            self.assertEqual(path.read_bytes(), original)

    def test_checkpoint_reload(self):
        card = card_input(snapshot())
        card["feature_sha256"] = "abc"
        scaling = fit_scaling([card])
        c, x, _, _ = tensorize([card], scaling, labels=False)
        model = make("transformer", 7, c.size(-1), x.size(-1))
        with TemporaryDirectory() as temp:
            path = Path(temp) / "model.pt"
            torch.save({"version": 1, "state": model.state_dict(), "n": 7, "kind": "transformer",
                        "scaling": scaling, "common": c.size(-1), "personal": x.size(-1),
                        "temperature": 1., "repeats": 2, "seed": 11}, path)
            a, b = (predict_card(card, path) for _ in range(2))
            self.assertEqual(a["probabilities"], b["probabilities"])
            self.assertEqual(a["model_sha256"], b["model_sha256"])


if __name__ == "__main__":
    unittest.main()
