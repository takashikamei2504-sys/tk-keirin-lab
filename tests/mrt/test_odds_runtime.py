import importlib.util
import json
from pathlib import Path
import tempfile
import io
import tarfile
import threading
import unittest
from unittest.mock import patch,Mock
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
                with urlopen(base+'/api/archive/2026-11-27') as r:
                    with tarfile.open(fileobj=io.BytesIO(r.read()),mode='r:gz') as archive:
                        self.assertIn('data/mrt_odds/latest/202611271234.json',archive.getnames())
                for path in ['/api/latest/../../runtime-status.json','/runtime-status.json','/api/trigger']:
                    with self.assertRaises(HTTPError) as ex:urlopen(base+path)
                    self.assertEqual(ex.exception.code,404)
            finally:server.shutdown();server.server_close();thread.join()
    def test_cycle_start_is_captured_before_variable_input_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            started=m.odds.stamp('2026-11-28T09:00:00+09:00')
            after_sync=started+m.timedelta(seconds=25)
            captured=[]
            def collect(**kwargs):
                captured.append(kwargs['cycle_started_at']);return {'state':'ok'}
            app=m.Runtime(tmp,collect=collect)
            app.sync=lambda at:None
            with patch.object(m.odds,'now',side_effect=[started,after_sync]):app.cycle()
            self.assertEqual(captured,[started])

    def test_retry_loop_reuses_scheduled_anchor(self):
        with tempfile.TemporaryDirectory() as tmp:
            app=m.Runtime(tmp)
            start='2026-11-28T09:00:00+09:00'
            app.cycle=Mock(side_effect=[{'state':'partial','cycle_started_at':start},{'state':'ok'}])
            app.stop=Mock()
            app.stop.is_set.side_effect=[False,True]
            app.stop.wait.side_effect=[False,True]
            app.loop()
            self.assertEqual(app.cycle.call_count,2)
            self.assertEqual(app.cycle.call_args.kwargs,{'cycle_started_at':m.odds.stamp(start)})

    def test_overlap(self):
        with tempfile.TemporaryDirectory() as tmp:
            app=m.Runtime(tmp);app.lock.acquire()
            self.assertIsNone(app.cycle());app.lock.release()

if __name__=='__main__':unittest.main()
