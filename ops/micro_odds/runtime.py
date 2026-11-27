"""Single collector with persistent split files and a read-only public API."""
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import threading
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from mrt import odds

UPSTREAM='https://raw.githubusercontent.com/takashikamei2504-sys/tk-keirin-lab/main/'
ORIGIN='https://takashikamei2504-sys.github.io'


def fetch_json(path):
    with urlopen(Request(UPSTREAM+path,headers={'User-Agent':'TK-MICRO-Odds/1.0'}),timeout=20) as r:
        data=r.read(4_000_001)
        if len(data)>4_000_000:raise ValueError('upstream_too_large')
        return json.loads(data)


class Runtime:
    def __init__(self, root, fetch=fetch_json, collect=odds.run):
        self.root=Path(root);self.fetch=fetch;self.collect=collect
        self.lock=threading.Lock();self.stop=threading.Event();self.heartbeat=time.monotonic()
        self.status_path=self.root/'runtime-status.json'
        self.root.mkdir(parents=True,exist_ok=True)

    def sync(self,at):
        day=at.astimezone(odds.JST).date().isoformat()
        base='data/mrt/'+day+'/'
        manifest=self.fetch(base+'index.json')
        if manifest.get('date')!=day or manifest.get('schema')!='tk-mrt-day/v1':raise ValueError('manifest_identity')
        active=[]
        for e in manifest.get('races',[]):
            rid=e.get('race_id','');file=e.get('file','')
            if e.get('status')!='ready':continue
            if not odds.RID.fullmatch(rid) or not rid.startswith(day.replace('-','')) or not re.fullmatch(rid+r'-[a-f0-9]+\.json',file):raise ValueError('manifest_path')
            delta=odds.stamp(e['sales_close_at'])-at
            if not timedelta(seconds=120)<delta<=timedelta(minutes=180):continue
            target=self.root/base/file
            if not target.exists():
                p=self.fetch(base+file);odds.validate_original(p)
                if p['race_id']!=rid or p['identity_sha256']!=e['identity_sha256']:raise ValueError('manifest_original_identity')
                odds.write(target,p)
            micro='data/mrt_research/micro_forward/snapshots/'+rid+'.json'
            # A pending snapshot can become frozen later: refresh every cycle.
            try:odds.write(self.root/micro,self.fetch(micro))
            except HTTPError as ex:
                if ex.code!=404:raise
                (self.root/micro).unlink(missing_ok=True)
            active.append(e)
        odds.write(self.root/base/'index.json',{**manifest,'races':active})

    def cycle(self):
        if not self.lock.acquire(blocking=False):return None
        started=odds.now()
        try:
            self.sync(started)
            status=self.collect(root=self.root,max_races=80,budget_seconds=360)
        except HTTPError as ex:
            status={'state':'source_access_blocked' if ex.code in (401,403,429) else 'error','stop_reason':'upstream_http_'+str(ex.code)}
        except Exception as ex:
            status={'state':'error','stop_reason':type(ex).__name__+': '+str(ex)[:240]}
        finally:
            self.lock.release()
        status={**status,'runtime':'railway','cycle_started_at':started.isoformat(),
                'cycle_finished_at':odds.now().isoformat(),'interval_seconds':600}
        odds.write(self.status_path,status)
        print(json.dumps(status,ensure_ascii=False),flush=True)
        return status

    def loop(self):
        # Resume stored per-race capture clocks after restart; collector skips fresh quotes.
        while not self.stop.is_set():
            begin=time.monotonic();self.heartbeat=begin
            result=self.cycle();self.heartbeat=time.monotonic()
            # One retry for transient failures. Never retry access denials early.
            if result and result['state'] in ('error','partial'):
                if not self.stop.wait(60):self.cycle()
            delay=max(1,600-(time.monotonic()-begin))
            # Heartbeat also advances while waiting, distinguishing idle from stuck.
            end=time.monotonic()+delay
            while not self.stop.wait(min(15,max(0,end-time.monotonic()))):
                self.heartbeat=time.monotonic()
                if time.monotonic()>=end:break


def handler(runtime):
    class API(BaseHTTPRequestHandler):
        def do_GET(self):
            path=self.path.split('?',1)[0]
            if path=='/health':
                alive=time.monotonic()-runtime.heartbeat<480
                return self.send(200 if alive else 503,{'ok':alive})
            if path=='/api/status':
                p=runtime.status_path
            elif re.fullmatch(r'/api/latest/\d{12}\.json',path):
                p=runtime.root/'data/mrt_odds/latest'/path.rsplit('/',1)[1]
            else:return self.send(404,{'error':'not_found'})
            try:return self.send(200,odds.read(p))
            except FileNotFoundError:return self.send(404,{'error':'not_collected'})
        def send(self,code,payload):
            data=json.dumps(payload,ensure_ascii=False,allow_nan=False).encode()
            self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8')
            self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store')
            self.send_header('Access-Control-Allow-Origin',ORIGIN)
            self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
            self.wfile.write(data)
        def log_message(self,fmt,*args):
            if not self.path.startswith('/health'):print(fmt%args,flush=True)
    return API


if __name__=='__main__':
    app=Runtime(os.environ.get('MICRO_DATA_ROOT','/data/micro'))
    worker=threading.Thread(target=app.loop,daemon=True);worker.start()
    ThreadingHTTPServer(('0.0.0.0',int(os.environ.get('PORT','8080'))),handler(app)).serve_forever()
