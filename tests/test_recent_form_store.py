import json,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from recent_form_store import load,save,LEGACY,part_path
class StoreTests(unittest.TestCase):
 def test_lossless_migration_and_mixed_generation(self):
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'recent_form.json';rows=[{'id':str(i),'rider_id':f'{i%17+1:06d}','collected_at':'2026-11-01','nested':{'name':'選手','results':[1,2,3]}} for i in range(100)]
   pack={'schema':LEGACY,'generated_at':'x','status':{'covered':17},'snapshots':rows}
   path.write_text(json.dumps(pack));self.assertEqual(load(path),pack)
   m=save(path,load(path));self.assertEqual(m['snapshot_count'],100);self.assertEqual(len(m['parts']),32)
   got=load(path);self.assertEqual(got['status'],pack['status']);self.assertEqual(sorted(got['snapshots'],key=lambda x:x['id']),sorted(rows,key=lambda x:x['id']))
   shard=path.parent/part_path(1);p=json.loads(shard.read_text());p['generated_at']='other';shard.write_text(json.dumps(p))
   with self.assertRaises(ValueError):load(path)
