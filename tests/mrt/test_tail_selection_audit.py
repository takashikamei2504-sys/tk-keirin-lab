"""Checks tail-structure research and no payout-driven ticket selection."""
import json
import tempfile
import unittest
from pathlib import Path

from mrt.tail_selection_audit import record_summary, statistics, outcome_payouts, line_relation, ticket_bucket


def example():
    return {
        "race_id": "202611228101",
        "date": "20261122",
        "roster": [1, 2, 3, 4, 5, 6, 7],
        "lines": [[1, 2], [3, 4], [5, 6], [7]],
        "labels": {
            "tickets": {"3連単": [
                {"cars": [1, 2, 3], "yen": 6500},
                {"cars": [1, 2, 5], "yen": 3100},
                {"cars": [5, 1, 2], "yen": 100},
                {"cars": [3, 5, 2], "yen": 300},
            ]},
            "refund": 0, "cancelled": [],
            "payments": [["３連単", "5>1>2", "34,540円", "200人気"]],
        },
    }


class TailSelectionAuditTest(unittest.TestCase):
    def test_bucket_and_line_roles(self):
        self.assertEqual(ticket_bucket(100), "100-300")
        self.assertEqual(ticket_bucket(300), "100-300")
        self.assertEqual(ticket_bucket(400), "400-900")
        self.assertEqual(ticket_bucket(1000), "1000+")
        self.assertEqual(line_relation([1, 2, 3], [[1, 2], [3, 4]]),
                         "same_line_first_two_other_line_third")
        self.assertEqual(line_relation([2, 1, 3], [[1, 2], [3, 4]]),
                         "follower_before_leader")
        self.assertEqual(line_relation([5, 1, 2], [[1, 2], [5, 6]]),
                         "cross_line_first_two")

    def test_small_ticket_separation_and_no_overfit(self):
        r, err = record_summary(example(), "example")
        self.assertIsNone(err)
        self.assertEqual(r["stake"], 10000)
        self.assertEqual(r["distinct_pairs"], 3)
        self.assertEqual(r["rows"][2]["pair_role"], "alternative_first")
        self.assertTrue(r["rows"][2]["high_hit"])
        self.assertEqual(r["rows"][2]["paid_yen"], 34540)
        report = statistics([r])
        self.assertEqual(report["races"], 1)
        self.assertEqual(report["groups"]["100-300"]["ticket_count"], 2)
        self.assertEqual(report["groups"]["100-300"]["stake_yen"], 400)
        self.assertEqual(report["groups"]["100-300"]["high_payout_win_count"], 1)
        self.assertEqual(report["groups"]["100-300"]["return_yen"], 34540)
        self.assertEqual(report["high_payout_hit_races"], 1)
        self.assertEqual(report["mean_top_pair_budget_percent"], 96)
        self.assertEqual(report["small_ticket_roles"]["alternative_first"]["high_payout_hits"], 1)

        # Result must not alter which pair is primary or how small bets are tagged.
        unchanged = example()
        unchanged["labels"]["payments"] = [["３連単", "1>2>3", "150円", "1人気"]]
        other, _ = record_summary(unchanged, "example")
        self.assertEqual([x["pair_role"] for x in r["rows"]],
                         [x["pair_role"] for x in other["rows"]])
        self.assertEqual(r["top_pair_stake_share"], other["top_pair_stake_share"])

    def test_exclusions_and_empty(self):
        r = example()
        r["labels"]["cancelled"] = [7]
        self.assertEqual(record_summary(r, "example")[1], "refund_or_cancelled")
        self.assertIsNone(statistics([])["roi_percent"])
        self.assertEqual(outcome_payouts({"payments": []}), {})


if __name__ == "__main__":
    unittest.main()
