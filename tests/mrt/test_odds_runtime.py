import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import urlopen
from urllib.error import HTTPError
from http.server import ThreadingHTTPServer

spec=importlib.util.spec_from_file_location('runtime',Path(__file__).resolve().parents[2]/'ops/micro_odds/runtime.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class RuntimeTest(unittest.TestCase):
    def test_persist_failure_and_public_api(self):
        with tempfile.TemporaryDirectory() as tmp:
            app=m.Runtime(tmp,fetch=lambda p:(_ for _ in ()).throw(OSError('offline')))
            status=app.cycle();self.assertEqual(status['state'],'error')
            self.assertEqual(m.odds.read(app.status_path)['stop_reason'],'OSError: offline')
            p=Path(tmp)/'data/mrt_odds/latest/202611271234.json'
            m.odds.write(p,{'saved':True})
            restarted=m.Runtime(tmp)
            server=ThreadingHTTPServer(('127.0.0.1',0),m.handler(restarted))
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                base='http://127.0.0.1:'+str(server.server_port)
                with urlopen(base+'/api/latest/202611271234.json') as r:
                    self.assertEqual(json.load(r),{'saved':True})
                    self.assertEqual(r.headers['Cache-Control'],'no-store')
                    self.assertEqual(r.headers['Access-Control-Allow-Origin'],m.ORIGIN)
                for path in ['/api/latest/../../runtime-status.json','/runtime-status.json','/api/trigger']:
                    with self.assertRaises(HTTPError) as ex:urlopen(base+path)
                    self.assertEqual(ex.exception.code,404)
            finally:server.shutdown();server.server_close();thread.join()
    def test_overlap(self):
        with tempfile.TemporaryDirectory() as tmp:
            app=m.Runtime(tmp);app.lock.acquire()
            self.assertIsNone(app.cycle());app.lock.release()

if __name__=='__main__':unittest.main()
