import copy, json, tempfile, unittest
from pathlib import Path
from mrt.mirror_compare import match, settle, stats, score, valid_tickets, sha, METHODS

class CompareTests(unittest.TestCase):
    def setUp(self):
        rid="202611252601"; rs={str(i):str(100+i) for i in range(1,8)}
        self.rs=rs; self.rid=rid
        t=[{"cars":[1,2,3],"yen":10000}]
        p={"race_id":rid,"input":{"entry":{"players":{c:{"rider_id":v} for c,v in rs.items()}}},
           "identity_sha256":"identity","model_sha256":"v3","engine_sha256":"v3engine",
           "generated_at":"2026-11-25T00:00:00+00:00","sales_close_at":"2026-11-25T01:00:00+00:00",
           "start_at":"2026-11-25T01:05:00+00:00","automatic":{"tickets":t}}
        both={"race_id":rid,"roster":rs,"identity_sha256":"identity","source_sha256":sha(p),
              "pre_race":True,"frozen":True,"generated_at":"2026-11-25T00:01:00+00:00",
              "sales_close_at":p["sales_close_at"],"start_at":p["start_at"]}
        self.p=p
        self.b=dict(both,schema="tk-mrt-micro-forward/v1",model_sha256="v3",engine_sha256="v3engine",
                    original_generated_at=p["generated_at"],methods={"A_original":t,"D_hybrid":[{"cars":[2,1,3],"yen":10000}]})
        self.f=dict(both,schema="tk-mrt-mirror-fusion/v1",source_model_sha256="v3",source_engine_sha256="v3engine",
                    source_generated_at=p["generated_at"],tickets=[{"cars":[3,2,1],"yen":10000}])
    def test_match_exact(self):
        rs,m=match(self.p,self.b,self.f)
        self.assertEqual(rs,self.rs);self.assertEqual(set(m),set(METHODS))
        self.assertEqual(score(m["MRT"],{"1-2-3":1230}),123000)
    def test_reject(self):
        for field,value in [("source_sha256","other"),("generated_at",self.p["sales_close_at"]),("identity_sha256","other"),("roster",{})]:
            f=dict(self.f);f[field]=value
            with self.assertRaises(ValueError):match(self.p,self.b,f)
        f=copy.deepcopy(self.f);f["tickets"][0]["yen"]=9900
        with self.assertRaises(ValueError):match(self.p,self.b,f)
    def test_pending_and_dead_heat(self):
        self.assertIsNone(settle(self.rs,None,self.rid))
        self.assertIsNone(settle(self.rs,{"status":"pending"},self.rid))
        pays={"1-2-3":1200,"2-1-3":4000}
        self.assertEqual(settle(self.rs,{"status":"final","race_id":self.rid,"roster":self.rs,"payouts":pays},self.rid),pays)
        self.assertEqual(stats([{"status":"pending"}])["MRT"]["roi"],None)
        self.assertEqual(stats([])["MICRO"]["races"],0)
if __name__=="__main__":unittest.main()
