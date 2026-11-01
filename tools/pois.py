#!/usr/bin/env python3
"""الملاح — أماكن «اكتشف ما حولك» للعراق كله (وقود، مستشفيات، صيدليات، مطاعم، تسوق، بنوك، مساجد، فنادق)
من OpenStreetMap، مقسّمة إلى مربعات نصف درجة، ليقرأ الهاتف (أو الويب) مربع منطقته فقط.
Input: osmium export geojsonseq of the filtered objects. Output: <out>/<lat>_<lng>.json + index.json"""
import json, sys, os, math
SRC, OUT = sys.argv[1], sys.argv[2]
STEP = 0.5
def kind(t):
    a, s, tr = t.get('amenity'), t.get('shop'), t.get('tourism')
    if a in ('fuel', 'hospital', 'clinic', 'doctors', 'restaurant', 'fast_food', 'cafe', 'pharmacy', 'bank', 'atm'): return a
    if a == 'place_of_worship' and t.get('religion') == 'muslim': return 'mosque'
    if s in ('supermarket', 'mall', 'convenience', 'department_store'): return s
    if a == 'marketplace': return 'marketplace'
    if tr in ('hotel', 'motel', 'guest_house'): return tr
    return None
def point(g):
    t, c = g['type'], g['coordinates']
    if t == 'Point': return c
    if t == 'LineString': pts = c
    elif t == 'Polygon': pts = c[0]
    elif t == 'MultiPolygon': pts = c[0][0]
    else: return None
    return [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)]
tiles, n = {}, 0
with open(SRC) as f:
    for line in f:
        line = line.strip().lstrip('\x1e')
        if not line: continue
        try: ft = json.loads(line)
        except Exception: continue
        t = ft.get('properties') or {}
        k = kind(t)
        if not k: continue
        p = point(ft.get('geometry') or {})
        if not p: continue
        lng, lat = round(p[0], 5), round(p[1], 5)
        name = t.get('name:ar') or t.get('name') or t.get('name:en') or ''
        sub = t.get('addr:street') or (t.get('name:en') if t.get('name:en') != name else '') or ''
        key = '%d_%d' % (math.floor(lat / STEP), math.floor(lng / STEP))
        row = [k, name[:80], lat, lng]
        if sub: row.append(sub[:60])
        tiles.setdefault(key, []).append(row); n += 1
os.makedirs(OUT, exist_ok=True)
for key, rows in tiles.items():
    json.dump(rows, open(os.path.join(OUT, key + '.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
json.dump({'v': 1, 'step': STEP, 'tiles': sorted(tiles), 'count': n, 'source': 'OpenStreetMap contributors (ODbL)'}, open(os.path.join(OUT, 'index.json'), 'w'), separators=(',', ':'))
print('places', n, 'tiles', len(tiles))
