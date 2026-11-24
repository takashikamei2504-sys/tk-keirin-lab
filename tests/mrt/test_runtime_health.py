import datetime as dt,json,tempfile,unittest,os
from pathlib import Path
from unittest.mock import patch
from scripts.mrt_runtime_health import inspect,fallback_needed,report,STAGES
class RuntimeHealthTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.now=dt.datetime(2026,11,25,0,0,tzinfo=dt.timezone.utc)
        self.base=self.root/"data/mrt_research";self.folder=self.root/"data/mrt/2026-11-25"
        self.rid="202611252601";self.hash="a"*64
        self.put(self.folder/"index.json",{"checked_at":self.now.isoformat(),"races":[{"race_id":self.rid,"file":"r.json","sales_close_at":"2026-11-25T10:00:00+09:00"}]})
        self.put(self.folder/"r.json",{})
        self.put(self.base/"mirror_fusion/active_model.json",{"model_sha256":self.hash})
        self.put(self.base/"micro_forward/freeze_status.json",{"date":"2026-11-25","at":self.now.isoformat()})
        self.put(self.base/"mirror_fusion/freeze_status.json",{"date":"2026-11-25","updated_at":self.now.isoformat()})
    def put(self,p,x):
        p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(x))
    def test_missing_then_ready(self):
        self.assertEqual(inspect(self.root,self.now)["micro_open_missing"],1)
        self.assertTrue(fallback_needed(self.root,self.now))
        self.put(self.base/"micro_forward/snapshots"/(self.rid+".json"),{})
        self.put(self.base/"mirror_fusion"/self.hash/(self.rid+".json"),{})
        with patch.dict(os.environ,{"MRT_"+k.upper():"success" for k in STAGES}):
            h=report(self.root,self.now)
        self.assertEqual(h["status"],"ok")
        self.assertFalse(fallback_needed(self.root,self.now+dt.timedelta(minutes=30)))
        self.assertTrue(fallback_needed(self.root,self.now+dt.timedelta(minutes=46)))
    def test_partial_failure_has_cooldown(self):
        with patch.dict(os.environ,{"MRT_"+k.upper():"success" for k in STAGES}):
            h=report(self.root,self.now)
        self.assertEqual(h["status"],"degraded")
        self.assertFalse(fallback_needed(self.root,self.now+dt.timedelta(minutes=5)))
        self.assertTrue(fallback_needed(self.root,self.now+dt.timedelta(minutes=16)))
    def test_closed_not_missing(self):
        h=inspect(self.root,self.now+dt.timedelta(hours=2))
        self.assertEqual(h["mrt_open"],0)
        self.assertEqual(h["fusion_open_missing"],0)
if __name__=="__main__":unittest.main()
