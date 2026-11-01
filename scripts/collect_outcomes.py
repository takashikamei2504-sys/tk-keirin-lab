#!/usr/bin/env python3
"""Bounded public feed collection for frozen pre-race forecasts and reported results."""
import argparse, os, datetime as dt, json, subprocess, tempfile, urllib.request, urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
JST=dt.timezone(dt.timedelta(hours=9))
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--days',type=int,default=7);args=ap.parse_args()
    if not 1<=args.days<=31:ap.error('--days must be 1..31')
    now=dt.datetime.now(dt.timezone.utc);today=now.astimezone(JST).date();errors=[];count=0
    with tempfile.TemporaryDirectory(prefix='keirin-outcomes-') as directory:
        for offset in range(-1,args.days):
            date=(today-dt.timedelta(days=offset)).isoformat()
            url=f'https://raw.githubusercontent.com/kurinaka12-afk/keirin-app-data/main/{date}.json'
            try:
                req=urllib.request.Request(url,headers={'User-Agent':'TKKeirinLab/2.0 (bounded public results collection)'})
                with urllib.request.urlopen(req,timeout=15) as res:body=res.read(8_000_001)
                if len(body)>8_000_000:raise ValueError('feed too large')
                data=json.loads(body)
                if data.get('date')!=date or not isinstance(data.get('races'),list) or len(data['races'])>250:raise ValueError('date or races invalid')
                Path(directory,f'{date}.json').write_text(json.dumps(data,ensure_ascii=False));count+=1
            except urllib.error.HTTPError as exc:
                if exc.code!=404:errors.append({'date':date,'error':f'HTTP {exc.code}'})
            except Exception as exc:errors.append({'date':date,'error':str(exc)[:160]})
        Path(directory,'collection.json').write_text(json.dumps({'collected_at':dt.datetime.now(dt.timezone.utc).isoformat(),'errors':errors,'feeds':count,'event':os.environ.get('GITHUB_EVENT_NAME','local'),'run_id':os.environ.get('GITHUB_RUN_ID')}))
        subprocess.run(['node','scripts/update_outcomes.cjs','--feed-dir',directory],cwd=ROOT,check=True)
    if errors:print('Some feeds unavailable; existing history was preserved:',json.dumps(errors,ensure_ascii=False))
if __name__=='__main__':main()
