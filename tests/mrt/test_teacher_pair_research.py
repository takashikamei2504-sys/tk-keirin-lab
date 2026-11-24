"""Tests for teacher-ordered-pair research feature safety and ticket labels."""
import copy
import unittest
from mrt.teacher_pair_research import (FEATURE_NAMES, eligible, first_two_pairs, micro_pair_set,
                                       line_index, pair_features, race_training_rows)


class TeacherPairResearchTest(unittest.TestCase):
    def fixture(self):
        return {
            "race_id": "202611228101", "date": "20261122",
            "roster": [1,2,3,4,5,6,7],
            "lines": [[1,2], [3,4], [5,6], [7]],
            "entry": {"race_class": "A一般", "players": {
                str(i): {"score": 88+i, "B": i-1, "nige":i, "makuri":i*2,
                         "sashi":i*3, "top2_rate":i*7}
                for i in range(1,8)}},
            "labels": {"cancelled": [],"refund":0,"tickets": {"3連単": [
                {"cars":[1,3,5],"yen":5000},
                {"cars":[1,3,6],"yen":1000},
                {"cars":[2,1,5],"yen":2500},
                {"cars":[3,1,2],"yen":1500},
            ]}},
        }

    def test_pair_features_no_labels_or_finish(self):
        r=self.fixture()
        original=pair_features(r, 2, 1)
        self.assertEqual(len(original),len(FEATURE_NAMES))
        self.assertEqual(original[13],1)
        self.assertEqual(original[14],0)
        r["labels"]["tickets"]["3連単"]=[]
        r["labels"]["finish"]={"1": 1}
        self.assertEqual(pair_features(r,2,1),original)
        self.assertEqual(line_index(r)[1],(1,0,2))

    def test_imitation_labels_and_top_three(self):
        r=self.fixture()
        ranks=first_two_pairs(r["labels"]["tickets"]["3連単"])
        self.assertEqual(ranks[:3],[(1,3),(2,1),(3,1)])
        pairs, X, y, truth=race_training_rows(r)
        self.assertEqual(len(pairs),42)
        self.assertEqual(len(X),42)
        self.assertEqual(sum(y),3)
        self.assertEqual(truth,set(ranks[:3]))
        self.assertEqual(micro_pair_set(r["labels"]["tickets"]["3連単"]), set())
        r["labels"]["tickets"]["3連単"][2]["yen"] = 100
        self.assertEqual(micro_pair_set(r["labels"]["tickets"]["3連単"]), {(2, 1)})

    def test_eligibility_and_refund_guard(self):
        r=self.fixture()
        self.assertTrue(eligible(r))
        r["entry"]["race_class"]="ガールズ予選"
        self.assertFalse(eligible(r))
        r=self.fixture()
        r["labels"]["refund"]=100
        self.assertIsNone(race_training_rows(r))
        r=self.fixture()
        r["roster"]=r["roster"][:6]
        self.assertFalse(eligible(r))


if __name__ == "__main__":
    unittest.main()
