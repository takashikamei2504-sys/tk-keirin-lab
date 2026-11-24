"""Descriptive original teacher/results census. Research only; no live model or betting.
Historical source was retrieved retrospectively, not independently pre-start verified.
"""
import json,gzip,hashlib,collections,math,re
from pathlib import Path
from .research_data import v3, payout

def ranks(m):
    return sorted(m,key=lambda k:(-m[k],k))
def position(c,loc):
    if c not in loc:return "unknown"
    l,p,n=loc[c]
    return "single" if n==1 else "leader" if p==0 else "second" if p==1 else "third_plus"
def structure(t,loc):
    if not all(c in loc for c in t):return "unknown"
    a,b,c=[loc[x] for x in t]
    if a[0]==b[0]==c[0]:return "all_same"
    if a[0]==b[0]:return "first_two_same"
    if a[0]==c[0]:return "first_third_same"
    if b[0]==c[0]:return "second_third_same"
    return "three_lines"
def record(r):
    lab=r["labels"];roster=set(map(int,r["roster"]))
    if len(roster) not in (7,9):raise ValueError("non_7_9")
    klass=str(r.get("entry",{}).get("race_class") or "unknown")
    if "ガールズ" in klass:raise ValueError("girls")
    if lab.get("cancelled") or lab.get("refund"):raise ValueError("refund_cancel")
    if set(lab.get("tickets",{}))!={"3連単"}:raise ValueError("other_or_mixed_ticket_type")
    raw=lab["tickets"]["3連単"];t=collections.Counter()
    for x in raw:
        a=tuple(map(int,x["cars"]));v=int(x["yen"])
        if len(a)!=3 or len(set(a))!=3 or not set(a)<=roster or v<100 or v%100:raise ValueError("invalid_ticket")
        t[a]+=v
    stake=sum(t.values())
    if not t or stake!=int(lab["charged_stake"]):raise ValueError("stake_mismatch")
    finish={int(c):int(v) for c,v in lab["finish"].items()}
    if set(finish)!=roster or not lab.get("payments"):raise ValueError("incomplete_result")
    w=v3.winners(lab)
    if not w or any(len(set(k))!=3 or not set(k)<=roster for k in w):raise ValueError("invalid_result")
    pay={}
    for k in set(w):
        x=payout({"cars":list(k),"yen":100},"3連単",lab)
        if x is None or int(x)<=0:raise ValueError("payout_missing")
        pay[k]=int(x)
    actual=sum(pay.get(k,0)*v//100 for k,v in t.items())
    if actual!=int(lab["teacher_payout"]):raise ValueError("payout_mismatch")
    first=collections.Counter();pair=collections.Counter()
    for k,v in t.items():first[k[0]]+=v;pair[k[:2]]+=v
    rf=ranks(first);rp=ranks(pair);win1={k[0] for k in pay};win2={k[:2] for k in pay}
    hit=bool(set(t)&set(pay));covered1=bool(set(first)&win1);covered2=bool(set(pair)&win2)
    fav=lab.get("honmei")
    if fav is not None:fav=int(fav)
    loc={}
    for i,l in enumerate(r.get("lines",[])):
        for j,c in enumerate(l):
            if int(c) in loc:raise ValueError("duplicate_line_car")
            loc[int(c)]=(i,j,len(l))
    B=set(map(int,lab.get("back") or []))
    predicted={int(e["actor"]) for e in lab.get("events",[]) if e.get("actor") is not None and e.get("action") in ("先行","カマシ","突っ張り") and not e.get("conditional") and not e.get("negated")}
    predicted &= roster
    pl=r.get("entry",{}).get("players") or {}
    scores={c:pl.get(str(c),{}).get("score") for c in roster}
    score_known=all(isinstance(v,(int,float)) and math.isfinite(v) for v in scores.values())
    maxscore={c for c,v in scores.items() if v==max(scores.values())} if score_known else set()
    # Equal stake on exact same tickets, analytically fractional yen, not a deployable policy.
    equal=stake/len(t)*sum(pay[k]/100 for k in set(t)&set(pay))
    tickets=[]
    for k,v in t.items():
        tickets.append({"stake":v,"pay":pay.get(k,0)*v//100,"win":int(k in pay),
            "high_hit":int(pay.get(k,0)>=10000),"role":position(k[0],loc),
            "structure":structure(k,loc),"amount":"100-300" if v<=300 else "400-900" if v<1000 else "1000+",
            "fav_position":str(k.index(fav)+1) if fav in k else "absent",
            "pair_rank":"top3" if k[:2] in rp[:3] else "other"})
    return {"id":r["race_id"],"date":r["date"],"size":len(roster),"klass":klass,
        "line_count":len(r.get("lines",[])) if set(loc)==roster else None,
        "line_complete":set(loc)==roster,
        "stake":stake,"pay":actual,"equal":equal,"n":len(t),"first_n":len(first),"pair_n":len(pair),
        "top_first_share":first[rf[0]]/stake,"top_pair_share":pair[rp[0]]/stake,
        "fav_known":fav in roster,"fav_win":fav in win1,"fav_top2":any(fav in k[:2] for k in pay),
        "fav_top3":any(fav in k for k in pay),"top_first_win":rf[0] in win1,
        "top_pair_win":rp[0] in win2,"score_known":score_known,"score_win":bool(maxscore&win1),
        "fav_score_same":fav in maxscore,
        "first_covered":covered1,"pair_covered":covered2,"hit":hit,
        "miss":"hit" if hit else "third_missing" if covered2 else "second_missing" if covered1 else "first_missing",
        "high":max(pay.values())>=10000,"high_hit":any(pay[k]>=10000 for k in set(t)&set(pay)),
        "win_structure":structure(next(iter(pay)),loc) if len(pay)==1 else "dead_heat",
        "winner_role":position(next(iter(win1)),loc) if len(win1)==1 else "dead_heat",
        "back_known":bool(B),"back_win":bool(B&win1),
        "back_winner_line":any(b in loc and a in loc and loc[b][0]==loc[a][0] for b in B for a in win1),
        "teacher_action_n":len(predicted),"teacher_action_match":bool(B&predicted),
        "B_single":len(B)==1,"teacher_B_single":len(predicted)==1,
        "tickets":tickets}

def summary(rs):
    n=len(rs);s=sum(x["stake"] for x in rs);p=sum(x["pay"] for x in rs)
    if not n:return {"n":0}
    def ratio(a,b):return round(100*a/b,2) if b else None
    def rate(k):return ratio(sum(x[k] for x in rs),n)
    h=[x for x in rs if x["high"]]
    f=[x for x in rs if x["fav_known"]]
    q=[x for x in rs if x["score_known"] and x["fav_known"]]
    b=[x for x in rs if x["B_single"] and x["teacher_B_single"]]
    known_b=[x for x in rs if x["back_known"] and x["line_complete"]]
    return {"n":n,"stake":s,"pay":p,"roi":ratio(p,s),"equal_same_tickets_roi":ratio(sum(x["equal"] for x in rs),s),
        "hit":rate("hit"),"first_covered":rate("first_covered"),"pair_covered":rate("pair_covered"),
        "third_given_pair":ratio(sum(x["hit"] for x in rs),sum(x["pair_covered"] for x in rs)),
        "mean_tickets":round(sum(x["n"] for x in rs)/n,2),"mean_firsts":round(sum(x["first_n"] for x in rs)/n,2),
        "mean_pairs":round(sum(x["pair_n"] for x in rs)/n,2),
        "top_first_share":rate("top_first_share"),"top_pair_share":rate("top_pair_share"),
        "top_funded_first_win":rate("top_first_win"),"top_funded_pair_win":rate("top_pair_win"),
        "high_races":len(h),"high_hit_count":sum(x["high_hit"] for x in h),
        "high_hit_rate":ratio(sum(x["high_hit"] for x in h),len(h)),
        "miss":dict(collections.Counter(x["miss"] for x in rs)),
        "fav_n":len(f),"fav_win":ratio(sum(x["fav_win"] for x in f),len(f)),
        "fav_top2":ratio(sum(x["fav_top2"] for x in f),len(f)),
        "fav_top3":ratio(sum(x["fav_top3"] for x in f),len(f)),
        "score_comparison_n":len(q),"fav_win_same_subset":ratio(sum(x["fav_win"] for x in q),len(q)),
        "max_score_win":ratio(sum(x["score_win"] for x in q),len(q)),
        "fav_is_max_score":ratio(sum(x["fav_score_same"] for x in q),len(q)),
        "single_B_action_n":len(b),"single_B_action_match":ratio(sum(x["teacher_action_match"] for x in b),len(b)),
        "B_line_n":len(known_b),"B_winner":ratio(sum(x["back_win"] for x in known_b),len(known_b)),
        "B_winner_line":ratio(sum(x["back_winner_line"] for x in known_b),len(known_b))}
def cohort(ts):
    s=sum(x["stake"] for x in ts);p=sum(x["pay"] for x in ts)
    return {"n":len(ts),"stake":s,"pay":p,"roi":round(100*p/s,2) if s else None,"hits":sum(x["win"] for x in ts),"high_hits":sum(x["high_hit"] for x in ts)}
def grouped(rs,key):
    g=collections.defaultdict(list)
    for r in rs:g[str(r[key])].append(r)
    return {k:summary(v) for k,v in sorted(g.items())}
def run(root):
    root=Path(root);m=json.loads((root/"mrt/research_seed_manifest.json").read_text());raw=(root/"mrt/research_seed.json.gz").read_bytes()
    if hashlib.sha256(raw).hexdigest()!=m["sha256"]:raise ValueError("seed checksum")
    data=json.loads(gzip.decompress(raw));assert len(data)==m["records"]
    rows=[];exc=collections.Counter();seen=set()
    for r in data:
        try:
            if r["race_id"] in seen:raise ValueError("duplicate_race")
            x=record(r);seen.add(x["id"]);rows.append(x)
        except (KeyError,TypeError,ValueError,AttributeError) as e:exc[str(e)[:100]]+=1
    all_t=[t for r in rows for t in r["tickets"]]
    cohorts={}
    for key in ("structure","role","amount","fav_position","pair_rank"):
        cohorts[key]={v:cohort([t for t in all_t if t[key]==v]) for v in sorted({t[key] for t in all_t})}
    cohorts["micro_structure"]={v:cohort([t for t in all_t if t["amount"]=="100-300" and t["structure"]==v]) for v in sorted({t["structure"] for t in all_t})}
    for r in rows:r["period"]="through_20260630" if r["date"]<="20260630" else "20260701_plus"
    tops=sorted(rows,key=lambda r:(-r["pay"],r["id"]))
    B=[x for x in rows if x["B_single"] and x["teacher_B_single"]]
    return {"schema":"teacher-result-census/v1","source_records":len(data),"sha256":m["sha256"],
        "retrospective_only":True,"no_current_teacher_inputs":True,"exclusions":dict(exc),
        "total":summary(rows),"by_size":grouped(rows,"size"),"by_class":grouped(rows,"klass"),
        "by_lines":grouped(rows,"line_count"),"by_period":grouped(rows,"period"),
        "by_actual_structure":grouped(rows,"win_structure"),
        "teacher_action_B_match":{"match":summary([x for x in B if x["teacher_action_match"]]),"miss":summary([x for x in B if not x["teacher_action_match"]])},
        "ticket_cohorts":cohorts,"top_paid_races_removed":{str(n):summary(tops[n:]) for n in (1,3,5,10)},
        "notes":["Pure trifecta 7/9 only; exact teacher charged stake and actual payout reconciliation required.",
        "Equal allocation uses theoretical fractional stakes, same ticket set.",
        "B action single unconditional extraction is only a proxy for teacher intended B, not an explicit B prediction.",
        "Retrospective historical entries, partial teacher sample; results do not establish prospective ROI."]}
if __name__=="__main__":
    print(json.dumps(run(Path(__file__).resolve().parents[1]),ensure_ascii=False,indent=2,allow_nan=False))
