import unittest
from mrt.micro_tail_forward import select,debit,settle,THRESHOLD,validate_base

class TailTests(unittest.TestCase):
    def test_gate_rank_before_filter(self):
        ts=[{'cars':[1,2,3],'prob':.1,'payout_proxy':1},{'cars':[1,2,4],'prob':.05,'payout_proxy':3000},{'cars':[1,2,5],'prob':.04,'payout_proxy':3000}]
        self.assertEqual(select(ts,1),[])
        self.assertEqual([x['cars'] for x in select(ts,3)],[[1,2,4],[1,2,5]])
    def test_fixed_budget(self):
        b=[{'cars':[1,2,3],'yen':9000},{'cars':[1,2,4],'yen':1000}];validate_base(b,list(range(1,8)))
        for n in range(4):
            t=debit(b,n);self.assertEqual(sum(x['yen'] for x in t),10000-100*n);self.assertTrue(all(x['yen']>=100 for x in t))
        self.assertEqual(settle(b,[{'cars':[1,2,5],'yen':100}],{'1-2-5':20000})['delta'],20000)
    def test_duplicate(self):
        with self.assertRaises(ValueError):validate_base([{'cars':[1,2,3],'yen':5000}]*2,list(range(1,8)))
if __name__=='__main__':unittest.main()
