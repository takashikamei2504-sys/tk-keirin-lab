"""Pull public daily split snapshots; validate every archive path before writing."""
from datetime import date,timedelta
import io
import json
from pathlib import Path
import re
import tarfile
from urllib.request import urlopen

BASE='https://micro-odds-production.up.railway.app'

def restore(raw,root,day):
    with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
        members=archive.getmembers();total=0;pending=[]
        for member in members:
            path=member.name
            if not member.isfile() or not (re.fullmatch(r'data/mrt_odds/(snapshots|plans)/'+day+r'/\d{12}/[a-zA-Z0-9-]+\.json',path) or re.fullmatch(r'data/mrt_odds/latest/'+day.replace('-','')+r'\d{4}\.json',path)):raise ValueError('archive_path')
            total+=member.size
            if member.size>1_000_000 or total>200_000_000:raise ValueError('archive_limit')
            data=archive.extractfile(member).read();json.loads(data)
            pending.append((path,data))
        for path,data in pending:
            dest=Path(root)/path;dest.parent.mkdir(parents=True,exist_ok=True)
            if dest.exists() and '/latest/' not in path:
                if json.loads(dest.read_bytes())!=json.loads(data):raise ValueError('immutable_conflict')
            else:dest.write_bytes(data)
        return len(pending)

if __name__=='__main__':
    # Retry three recent days, allowing delayed daily runs to recover.
    from mrt.odds import now,JST
    today=now().astimezone(JST).date()
    for offset in (2,1,0):
        day=(today-timedelta(days=offset)).isoformat()
        with urlopen(BASE+'/api/archive/'+day,timeout=120) as response:raw=response.read(60_000_001)
        if len(raw)>60_000_000:raise ValueError('archive_too_large')
        print(day,restore(raw,Path('.'),day))
