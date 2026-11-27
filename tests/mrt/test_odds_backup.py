import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from scripts.micro_odds_backup import restore

class BackupTest(unittest.TestCase):
    def archive(self,path,data):
        out=io.BytesIO()
        with tarfile.open(fileobj=out,mode='w:gz') as a:
            b=json.dumps(data).encode();i=tarfile.TarInfo(path);i.size=len(b);a.addfile(i,io.BytesIO(b))
        return out.getvalue()
    def test_preserve_split_files_and_reject_unsafe_or_conflicting(self):
        day='2026-11-27';p='data/mrt_odds/snapshots/'+day+'/202611271234/123456-abcdef.json'
        with tempfile.TemporaryDirectory() as root:
            raw=self.archive(p,{'x':1});self.assertEqual(restore(raw,root,day),1)
            self.assertEqual(restore(raw,root,day),1)
            self.assertEqual(json.loads((Path(root)/p).read_text()),{'x':1})
            with self.assertRaisesRegex(ValueError,'immutable_conflict'):restore(self.archive(p,{'x':2}),root,day)
            with self.assertRaisesRegex(ValueError,'archive_path'):restore(self.archive('../../bad',{}),root,day)
