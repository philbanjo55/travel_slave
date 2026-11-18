import sys, json; sys.path.insert(0, sys.path[0]); from cand import search
qs = [l.split('|', 1) for l in open(sys.argv[1]).read().strip().splitlines() if l.strip()]
allr = {}
import time
for tag, q in qs:
    time.sleep(2)
    for r in search(q, 25):
        if not r['free'] or not r['w'] or max(r['w'], r['h']) < 1500 or r['mime'] not in ('image/jpeg', 'image/png', 'image/tiff'): continue
        if r['key'] in allr: continue
        r['tag'] = tag; allr[r['key']] = r
        print(f"{tag}\t{r['w']}x{r['h']}\t{r['lic']}\t{r['date'][:10]}\t{r['key'][5:]}\t|{r['artist'][:30]}|\t{r['desc'][:90]}")
json.dump(list(allr.values()), open(sys.argv[2], 'w'), indent=1, ensure_ascii=False)
