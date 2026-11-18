# fetch.py <list.tsv: id<TAB>File:key> <outdir> [width]  -> outdir/<id>.jpg (raw thumb) + outdir/meta.json
import sys, json, os, subprocess, time, urllib.parse, re
sys.path.insert(0, sys.path[0]); from cand import api, strip, fix, UA, FREE
lst = [l.rstrip('\n').split('\t') for l in open(sys.argv[1]) if l.strip() and not l.startswith('#')]
out = sys.argv[2]; W = int(sys.argv[3]) if len(sys.argv) > 3 else 1920
mp = out + '/meta.json'; meta = json.load(open(mp)) if os.path.exists(mp) else {}
for pid, key in lst:
    fn = f'{out}/{pid}.jpg'
    if os.path.exists(fn) and open(fn, 'rb').read(3) == b'\xff\xd8\xff' and pid in meta: continue
    j = api({'action': 'query', 'titles': key, 'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata', 'iiurlwidth': W})
    p = j['query']['pages'][0]; ii = p['imageinfo'][0]; em = ii['extmetadata']
    g = lambda k: strip(em.get(k, {}).get('value'))
    m = {'key': p['title'], 'page': ii['descriptionurl'], 'w': ii['width'], 'h': ii['height'], 'license': g('LicenseShortName'),
         'license_url': g('LicenseUrl'), 'artist': g('Artist'), 'credit': g('Credit')[:200], 'attr_required': g('AttributionRequired'),
         'desc': g('ImageDescription')[:300], 'date': g('DateTimeOriginal')[:40], 'free': bool(FREE.match(g('LicenseShortName')))}
    url = fix(ii.get('thumburl') or ii['url'])
    for k in range(12):
        subprocess.run(['curl', '-sS', '-A', UA, '-o', fn, url])
        if open(fn, 'rb').read(3) == b'\xff\xd8\xff': break
        time.sleep(10 + 5 * k)
    m['ok'] = open(fn, 'rb').read(3) == b'\xff\xd8\xff'
    meta[pid] = m; json.dump(meta, open(mp, 'w'), indent=1, ensure_ascii=False)
    print(pid, m['ok'], m['license'], m['artist'][:40], flush=True); time.sleep(3)
