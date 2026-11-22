#!/usr/bin/env python3
"""الملاح — دليل زائر الأربعين: أماكن كربلاء والنجف والكوفة والطريق بينها من OpenStreetMap، مصنّفة:
المزارات، المساجد، الحسينيات، الفنادق، المرافق الصحية والخدمية، ونقاط دالة — و«الأماكن المختارة» (قائمة
ثابتة بأهم الأماكن، يُبحث عن كل منها في البيانات نفسها فتؤخذ إحداثياته من الخريطة لا من الذاكرة).
Input: osmium export geojsonseq of the box. Output: <out>/arbaeen.json"""
import json, sys, os, re, math

SRC, OUT = sys.argv[1], sys.argv[2]
CITIES = [  # name, lat, lng, radius km — which city a place belongs to (else «الطريق»)
    ('كربلاء', 32.616, 44.033, 14), ('النجف', 31.996, 44.330, 12), ('الكوفة', 32.035, 44.400, 6)]

SHRINE = re.compile(r'ضريح|مرقد|مقام|العتبة|الروضة|مزار|قبر |شباك|الحضرة|عتبة')
HUSS = re.compile(r'حسيني|حسينيه|husseiniy|hussainiy|husainiy', re.I)
MOSQ = re.compile(r'مسجد|جامع|masjid|mosque', re.I)
MARK = re.compile(r'باب |بوابة|ساحة|تل |مخيم|سيطرة|نصب|برج|جسر|دوار|فلكة|مدخل|ميدان|العمود')


def kind(t, name):
    a, tr, h = t.get('amenity'), t.get('tourism'), t.get('historic')
    if a == 'place_of_worship' or t.get('building') in ('mosque', 'shrine') or h in ('tomb', 'shrine'):
        if t.get('religion') not in (None, 'muslim'): return None
        if SHRINE.search(name) or h in ('tomb', 'shrine') or t.get('building') == 'shrine': return 'shrine'
        if HUSS.search(name): return 'huss'
        return 'mosque' if name else None
    if HUSS.search(name) and (a in ('community_centre', 'social_facility') or t.get('building')): return 'huss'
    if tr in ('hotel', 'motel', 'guest_house', 'hostel', 'apartment'): return 'hotel'
    if a in ('hospital', 'clinic', 'doctors'): return 'health'
    if a == 'pharmacy': return 'pharmacy'
    if a in ('drinking_water', 'water_point'): return 'water'
    if a == 'toilets': return 'toilets'
    if a in ('police', 'fire_station'): return 'police'
    if h or tr in ('attraction', 'viewpoint') or t.get('place') == 'square' or (name and MARK.search(name)): return 'mark'
    return None


def centre(g):
    t, c = g.get('type'), g.get('coordinates')
    if t == 'Point': return c, 0
    if t == 'LineString': pts = c
    elif t == 'Polygon': pts = c[0]
    elif t == 'MultiPolygon': pts = max((p[0] for p in c), key=len)
    else: return None, 0
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    area = (max(xs) - min(xs)) * (max(ys) - min(ys)) * 111 * 111 * 0.85 * 1e6 if t != 'LineString' else 0   # ~m² of the box
    return [sum(xs) / len(xs), sum(ys) / len(ys)], area


def km(a, b, c, d):
    return math.hypot((a - c) * 110.6, (b - d) * 110.6 * math.cos(math.radians(a)))


def city(lat, lng):
    for n, a, b, r in CITIES:
        if km(lat, lng, a, b) <= r: return n
    return 'الطريق'


def features(src):
    """GeoJSON features: from osmium's geojsonseq, or from an Overpass answer (elements with centre and bounds)"""
    if src.endswith('.json'):
        for el in json.load(open(src)).get('elements', []):
            c = el.get('center') or ({'lat': el['lat'], 'lon': el['lon']} if 'lat' in el else None)
            if not c: continue
            b = el.get('bounds')
            if b:
                ring = [[b['minlon'], b['minlat']], [b['maxlon'], b['minlat']], [b['maxlon'], b['maxlat']], [b['minlon'], b['maxlat']], [b['minlon'], b['minlat']]]
                g = {'type': 'Polygon', 'coordinates': [ring]}
                yield {'properties': el.get('tags') or {}, 'geometry': g, 'center': [c['lon'], c['lat']]}
            else:
                yield {'properties': el.get('tags') or {}, 'geometry': {'type': 'Point', 'coordinates': [c['lon'], c['lat']]}}
        return
    with open(src) as f:
        for line in f:
            line = line.strip().lstrip('\x1e')
            if not line: continue
            try: yield json.loads(line)
            except Exception: continue


rows, seen = [], set()
if True:
    for ft in features(SRC):
        t = ft.get('properties') or {}
        name = (t.get('name:ar') or t.get('name') or '').strip()
        k = kind(t, name)
        if not k: continue
        if not name and k not in ('water', 'toilets', 'health', 'police'): continue
        p, area = centre(ft.get('geometry') or {})
        if ft.get('center'): p = ft['center']
        if not p: continue
        lng, lat = round(p[0], 5), round(p[1], 5)
        key = (k, name, round(lat, 3), round(lng, 3))
        if key in seen: continue
        seen.add(key)
        r = {'k': k, 'n': name[:80], 'lat': lat, 'lng': lng, 'c': city(lat, lng)}
        en = t.get('name:en')
        if en and en != name: r['e'] = en[:60]
        if area > 3000: r['a'] = int(area)
        if t.get('opening_hours'): r['h'] = t['opening_hours'][:40]
        if t.get('phone') or t.get('contact:phone'): r['p'] = (t.get('phone') or t.get('contact:phone'))[:30]
        if t.get('beds'): r['b'] = t['beds'][:6]
        rows.append(r)

# the chosen places: each looked for by its names, the biggest match near the expected city wins
CHOSEN = [
    ('ضريح الإمام الحسين (ع)', 'كربلاء', [r'(ضريح|مرقد|حرم|العتبة|الروضة).{0,12}(الحسين|الحسيني)', r'Imam Husayn Shrine|Imam Hussein Shrine']),
    ('ضريح أبي الفضل العباس (ع)', 'كربلاء', [r'(ضريح|مرقد|حرم|العتبة|الروضة).{0,14}(العباس|العباسي)', r'Abbas']),
    ('بين الحرمين', 'كربلاء', [r'بين الحرمين', r'Bain al-Haramain|Between the two']),
    ('التل الزينبي', 'كربلاء', [r'التل الزينبي|تل الزينبي|التل الزينبية', r'Zainabiya']),
    ('المخيم الحسيني', 'كربلاء', [r'المخيم|مخيم الحسين', r'Camp']),
    ('مقام الإمام المهدي (عج)', 'كربلاء', [r'مقام.{0,10}المهدي|مقام صاحب الزمان', r'Mahdi']),
    ('مقام الإمام جعفر الصادق (ع)', 'كربلاء', [r'مقام.{0,10}(جعفر|الصادق)', r'Sadiq']),
    ('مقام كف العباس', 'كربلاء', [r'كف.{0,6}العباس|الكف', r'Kaf']),
    ('ضريح الحر الرياحي', 'كربلاء', [r'الحر.{0,10}(الرياحي|بن يزيد)|الحر الرياحي', r'Hurr']),
    ('ضريح الإمام علي (ع)', 'النجف', [r'(ضريح|مرقد|حرم|العتبة|الروضة|الحضرة).{0,14}(علي|العلوي|العلوية|أمير المؤمنين|امير المؤمنين)', r'Imam Ali (Shrine|Mosque|Holy)']),
    ('مقبرة وادي السلام', 'النجف', [r'وادي السلام', r'Wadi.{0,3}(us|al|as)[- ]?Salaam|Wadi al-Salam']),
    ('مقام النبيين هود وصالح', 'النجف', [r'هود', r'Hud']),
    ('مسجد الكوفة', 'الكوفة', [r'مسجد الكوفة|جامع الكوفة', r'Great Mosque of Kufa|Kufa Mosque']),
    ('ضريح مسلم بن عقيل (ع)', 'الكوفة', [r'مسلم بن عقيل', r'Muslim ibn Aqil']),
    ('ضريح هانئ بن عروة', 'الكوفة', [r'هان[ئي] بن عروة', r'Hani']),
    ('بيت الإمام علي (ع)', 'الكوفة', [r'بيت.{0,10}(الإمام علي|الامام علي|أمير المؤمنين)', r'House of Imam Ali']),
    ('مسجد السهلة', 'الكوفة', [r'السهلة', r'Sahla']),
    ('ضريح ميثم التمار', 'الكوفة', [r'ميثم', r'Maytham']),
    ('ضريح كميل بن زياد', 'النجف', [r'كميل', r'Kumayl']),
]
chosen = []
for title, cty, pats in CHOSEN:
    best = None
    for r in rows:
        hit = re.search(pats[0], r['n']) or (len(pats) > 1 and re.search(pats[1], r.get('e', '') + ' ' + r['n'], re.I))
        if not hit: continue
        a, b = next((x[1], x[2]) for x in CITIES if x[0] == cty)
        d = km(r['lat'], r['lng'], a, b)
        if d > 25: continue
        score = (r['k'] in ('shrine', 'mosque', 'mark')) * 2 + math.log10(r.get('a', 1) + 10) - d / 10
        if not best or score > best[0]: best = (score, r)
    if best:
        r = best[1]
        chosen.append({'t': title, 'n': r['n'], 'lat': r['lat'], 'lng': r['lng'], 'c': r['c']})
        print('✓ %-30s ← %s (%.5f, %.5f) %s' % (title, r['n'], r['lat'], r['lng'], r['c']))
    else:
        print('✗ %-30s not found' % title)

os.makedirs(OUT, exist_ok=True)
from collections import Counter
cnt = Counter((r['k'], r['c']) for r in rows)
print('places', len(rows), dict(Counter(r['k'] for r in rows)))
print(sorted(cnt.items()))
json.dump({'v': 1, 'chosen': chosen, 'places': rows, 'source': 'OpenStreetMap contributors (ODbL)'},
          open(os.path.join(OUT, 'arbaeen.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('size', os.path.getsize(os.path.join(OUT, 'arbaeen.json')))
