"""Strict forward-only ticket selection, 100-yen accounting, no promotion."""
import copy
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from mrt.micro_forward import (ALL_METHODS, POLICY, _dump_immutable,
    _verified_forward_row, evaluate, freeze_one, make_variants, training_rows,
    triple_features)

JST=dt.timezone(dt.timedelta(hours=9))
AT=dt.datetime(2026,11,24,9,0,tzinfo=JST)
DONE=dt.datetime(2026,11,24,9,1,tzinfo=JST)

class ConstantClassifier:
    def __init__(self, positive):
        self.positive=positive
    def predict_proba(self,X):
        return np.tile([1-self.positive,self.positive],(len(X),1))

def fixture():
    rid="202611242601"
    players={str(i):{"rider_id":str(15000+i),"score":90+i,
        "B":i,"nige":i/2,"makuri":i*2,"sashi":i,"mark":i,
        "top2_rate":i*5} for i in range(1,8)}
    entry={"race_id":rid,"date":"20261124","venue":26,"race_no":1,
        "roster":list(range(1,8)),"lines":[[1,2,3],[4,5],[6,7]],
        "unknown_cars":[],"names":{str(i):"選手"+str(i) for i in range(1,8)},
        "entry":{"players":players,"race_class":"A級一般"}}
    p={"race_id":rid,"date":"20261124",
       "entry_observed_at":dt.datetime(2026,11,24,8,0,tzinfo=JST).isoformat(),
       "generated_at":dt.datetime(2026,11,24,8,5,tzinfo=JST).isoformat(),
       "sales_close_at":dt.datetime(2026,11,24,10,0,tzinfo=JST).isoformat(),
       "start_at":dt.datetime(2026,11,24,10,5,tzinfo=JST).isoformat(),
       "pre_race":True,"model_id":"MRT_V3_7126","model_sha256":"frozen",
       "engine_sha256":"engine","identity_sha256":"race-identity",
       "input":entry,"automatic":{"tickets":[
         {"cars":[1,2,3],"yen":5000,"allocation_score":.48},
         {"cars":[1,2,4],"yen":3000,"allocation_score":.28},
         {"cars":[2,1,3],"yen":2000,"allocation_score":.24}
       ]}}
    return p

def model(prob=.5):
    return {"pair":ConstantClassifier(prob),"third":ConstantClassifier(.5),
       "meta":{"training_through":"20260630","protocol_id":"test-frozen-protocol",
       "seed_sha256":"fixed-seed","training_races":5086}}

class MicroForwardTest(unittest.TestCase):
    def test_teacher_third_supervision_and_features(self):
        p=fixture()
        entry=p["input"]
        x=triple_features(entry,1,2,4)
        self.assertGreater(len(x),30)
        other=copy.deepcopy(entry)
        other["labels"]={"tickets":{"3連単":[
            {"cars":[1,2,4],"yen":200},
            {"cars":[4,1,2],"yen":800}
        ]},"refund":0,"cancelled":[]}
        px,py,tx,ty=training_rows(other)
        self.assertEqual(len(px),42)
        self.assertEqual(sum(py),1)
        self.assertEqual(sum(ty),1)
        self.assertGreater(len(tx),3)
        other["labels"]["finish"]={"4":1,"1":2,"2":3}
        self.assertEqual(triple_features(other,1,2,4),x)

    def test_all_methods_are_fixed_budget_and_unique(self):
        p=fixture()
        sh=freeze_one(p,model(),at=AT,clock=lambda:DONE)
        self.assertEqual(sh["schema"],"tk-mrt-micro-forward/v1")
        self.assertLess(dt.datetime.fromisoformat(sh["generated_at"]),
                        dt.datetime.fromisoformat(sh["sales_close_at"]))
        self.assertTrue(sh["safety"]["postrace_teacher_used"] is False)
        self.assertEqual(set(sh["methods"]),set(ALL_METHODS))
        self.assertEqual([sum(t["yen"] for t in sh["methods"][k]) for k in ALL_METHODS[:4]],
                         [10000]*4)
        self.assertIn(sum(t["yen"] for t in sh["methods"]["E_capped_skip"]),(0,5000))
        for k, tickets in sh["methods"].items():
            self.assertEqual(len(tickets),len({tuple(t["cars"]) for t in tickets}),k)
            self.assertTrue(all(t["yen"]>=100 and t["yen"]%100==0 for t in tickets),k)
        self.assertEqual(sh["methods"]["A_original"],p["automatic"]["tickets"])

    def test_no_buy_and_closing_time(self):
        p=fixture()
        sh=freeze_one(p,model(.01),at=AT,clock=lambda:DONE)
        self.assertTrue(sh["decision"]["no_buy"])
        self.assertEqual(sh["decision"]["no_buy_reason"],"insufficient_pair_signal")
        self.assertEqual(sh["methods"]["E_capped_skip"],[])
        with self.assertRaisesRegex(ValueError,"after sales close"):
            freeze_one(p,model(),at=dt.datetime(2026,11,24,10,0,tzinfo=JST))
        with self.assertRaisesRegex(ValueError,"complete before sales close"):
            freeze_one(p,model(),at=AT,
                clock=lambda:dt.datetime(2026,11,24,10,1,tzinfo=JST))
        future=fixture()
        future["date"]="20261125"
        with self.assertRaisesRegex(ValueError,"date mismatch"):
            freeze_one(future,model(),at=AT,clock=lambda:DONE)

    def test_forward_record_immutable_and_verified_only(self):
        p=fixture()
        sh=freeze_one(p,model(),at=AT,clock=lambda:DONE)
        roster={str(i):str(15000+i) for i in range(1,8)}
        res={"race_id":p["race_id"],"status":"final","roster":roster,
             "payouts":{"1-2-3":500},"back":[1]}
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            dest=root/"data/mrt_research/micro_forward/snapshots"/(p["race_id"]+".json")
            _dump_immutable(dest,sh)
            with self.assertRaisesRegex(ValueError,"immutable"):
                _dump_immutable(dest,sh)
            results=root/"data/mrt/2026-11-24/results.json"
            results.parent.mkdir(parents=True)
            results.write_text(json.dumps({"results":[res]}))
            result=evaluate(root)
            self.assertEqual(result["evaluated_races"],1)
            self.assertEqual(result["generated_frozen_count"],1)
            self.assertFalse(result["protocols"]["test-frozen-protocol"]["eligible_for_human_review"])
            self.assertEqual(result["protocols"]["test-frozen-protocol"]["summary"]["A_original"]["stake_yen"],10000)
            self.assertEqual(result["protocols"]["test-frozen-protocol"]["summary"]["A_original"]["payout_yen"],25000)
            self.assertEqual(_verified_forward_row(dest,res)["A_original"]["payout"],25000)
            results.write_text(json.dumps({"results":[dict(res,status="pending")]}))
            result=evaluate(root)
            self.assertEqual(result["evaluated_races"],0)
            self.assertEqual(len(result["excluded"]),1)
            results.write_text(json.dumps({"results":[dict(res,roster=dict(roster,**{"1":"bad"}))]}))
            with self.assertRaisesRegex(ValueError,"roster mismatch"):
                _verified_forward_row(dest,dict(res,roster=dict(roster,**{"1":"bad"})))

    def test_budget_50_ticket_edge_case_skips(self):
        original=[{"cars":[a,b,c],"yen":100,"allocation_score":.01}
             for a in range(1,8) for b in range(1,8) if b!=a
             for c in range(1,8) if c not in (a,b)][:51]
        original[0]["yen"]=5000
        self.assertEqual(sum(t["yen"] for t in original),10000)
        methods,decision=make_variants(original,[],[{"cars":[7,1,2],"yen":100}],.8)
        self.assertTrue(decision["no_buy"])
        self.assertEqual(methods["E_capped_skip"],[])
        self.assertEqual(sum(t["yen"] for t in methods["A_original"]),10000)

if __name__=="__main__":
    unittest.main()
