#!/usr/bin/env python3
"""Probe public monthly race-result source and graded racing schedules, no betting changes."""
import urllib.request,csv,io,re,hashlib
from bs4 import BeautifulSoup
def get(url):
 req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (research historical keirin data; information only)"})
 with urllib.request.urlopen(req,timeout=45) as r: return r.read()
base="https://raw.githubusercontent.com/Kenseimk/keirin-data/main/keirin_data/"
for month in ["2025_11","2026_01","2026_06","2026_10","2026_11"]:
 try:
  raw=get(base+month+"_keirin.csv");reader=csv.DictReader(io.StringIO(raw.decode("utf-8-sig",errors="replace")))
  sample=[next(reader) for _ in range(2)]
  print("CSV",month,"bytes",len(raw),"sha256",hashlib.sha256(raw).hexdigest(),"fields",reader.fieldnames)
  for row in sample:print(" ROW",{k:row.get(k) for k in ["race_id","date","venue_slug","race_no","banum","san_ren_tan","rank","player_class","lineup"]})
 except Exception as e:print("CSV_ERROR",month,type(e).__name__,str(e)[:350])
for year in [2025,2026]:
 for name in ["grade","highgrade"]:
  uri=f"https://keirin.kdreams.jp/schedule/{name}/search/{year}/"
  try:
   raw=get(uri);soup=BeautifulSoup(raw,"html.parser")
   print("SCHEDULE",year,name,"bytes",len(raw),"title",soup.title.get_text(" ",strip=True) if soup.title else None)
   tables=soup.select('table')
   print("TABLES",[(len(t.select('tr')),t.get_text(" ",strip=True)[:150]) for t in tables[:8]])
   for table in tables:
    if "開催日程" in table.get_text(" ",strip=True) and "優勝者" in table.get_text(" ",strip=True):
     for tr in table.select("tr")[:5]:
      print(" SCHED_ROW",tr.get_text(" | ",strip=True)[:750])
      print(" COLS",[(td.get("class"),td.get_text(" ",strip=True)[:155], [im.get('alt') for im in td.select('img')]) for td in tr.find_all(["th","td"],recursive=False)])
     break
  except Exception as e:print("SCHEDULE_ERROR",year,name,type(e).__name__,str(e)[:350])
