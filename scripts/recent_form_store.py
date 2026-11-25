"""Lossless recent-form sharding; the manifest replaces the old oversized JSON."""
import argparse, json, re
from pathlib import Path

LEGACY='tk-keirin-recent-form/v1'
MANIFEST='tk-keirin-recent-form-shards/v2'
PART='tk-keirin-recent-form-part/v1'
COUNT=32
MAX_BYTES=50*1024*1024

def encode(obj):return (json.dumps(obj,ensure_ascii=False,separators=(',',':'))+'\n').encode('utf-8')
def atomic(path,raw):
    path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_suffix('.tmp');tmp.write_bytes(raw);tmp.replace(path)
def part_path(i):return f'recent_form_parts/part-{i:02d}.json'
def bucket(s):
    rid=s.get('rider_id','')
    if not re.fullmatch(r'\d{6}',rid):raise ValueError('invalid rider id')
    return int(rid)%COUNT
def load(path):
    path=Path(path)
    if not path.exists():return {}
    m=json.loads(path.read_text(encoding='utf-8'))
    if m.get('schema')==LEGACY and isinstance(m.get('snapshots'),list):return m
    if m.get('schema')!=MANIFEST or len(m.get('parts',[]))!=COUNT:raise ValueError('invalid recent-form manifest')
    rows=[]
    for i,ref in enumerate(m['parts']):
        if ref.get('path')!=part_path(i):raise ValueError('invalid shard path')
        p=json.loads((path.parent/ref['path']).read_text(encoding='utf-8'))
        s=p.get('snapshots')
        if p.get('schema')!=PART or p.get('generated_at')!=m['generated_at'] or not isinstance(s,list) or len(s)!=ref['count'] or any(bucket(x)!=i for x in s):raise ValueError('invalid or mismatched shard')
        rows.extend(s)
    if len(rows)!=m['snapshot_count']:raise ValueError('snapshot count mismatch')
    return {**{k:v for k,v in m.items() if k not in ('parts','snapshot_count')},'schema':LEGACY,'snapshots':rows}
def save(path,pack):
    path=Path(path)
    if pack.get('schema')!=LEGACY or not isinstance(pack.get('snapshots'),list) or not pack.get('generated_at'):raise ValueError('invalid legacy pack')
    parts=[[] for _ in range(COUNT)]
    for s in pack['snapshots']:parts[bucket(s)].append(s)
    refs=[];encoded=[]
    for i,rows in enumerate(parts):
        raw=encode({'schema':PART,'generated_at':pack['generated_at'],'snapshots':rows})
        if len(raw)>MAX_BYTES:raise ValueError('shard exceeds safe budget')
        refs.append({'path':part_path(i),'count':len(rows),'bytes':len(raw)});encoded.append(raw)
    # Validate all files before changing anything; write the manifest last.
    m={**{k:v for k,v in pack.items() if k!='snapshots'},'schema':MANIFEST,'snapshot_count':len(pack['snapshots']),'parts':refs}
    for ref,raw in zip(refs,encoded):atomic(path.parent/ref['path'],raw)
    atomic(path,encode(m))
    return m
def main():
    p=argparse.ArgumentParser();p.add_argument('--migrate',type=Path,required=True);a=p.parse_args();old=load(a.migrate)
    if not old:raise ValueError('no existing recent form')
    m=json.loads(a.migrate.read_text(encoding='utf-8'))
    if m.get('schema')==LEGACY:save(a.migrate,old)
    print('Verified',len(old['snapshots']),'snapshots')
if __name__=='__main__':main()
