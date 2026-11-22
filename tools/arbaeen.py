#!/usr/bin/env python3
"""الملاح — دليل زائر الأربعين: أماكن كربلاء والنجف والكوفة والطريق بينها من OpenStreetMap، مصنّفة:
المزارات، المساجد، الحسينيات، الفنادق، المرافق الصحية والخدمية، ونقاط دالة — و«الأماكن المختارة» (قائمة
ثابتة بأهم الأماكن، يُبحث عن كل منها في البيانات نفسها فتؤخذ إحداثياته من الخريطة لا من الذاكرة).
Input: osmium export geojsonseq of the box. Output: <out>/arbaeen.json"""
import json, sys, os, re, math

SRC, OUT, TSVS = sys.argv[1], sys.argv[2], sys.argv[3:]   # TSVS: places.tsv of the Karbala and Najaf map packs
BOX = (31.88, 43.85, 32.78, 44.55)
CITIES = [  # name, lat, lng, radius km — which city a place belongs to (else «الطريق»); Kufa first: it sits inside Najaf's circle
    ('كربلاء', 32.616, 44.033, 14), ('الكوفة', 32.032, 44.398, 5), ('النجف', 31.996, 44.330, 10)]

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


TSV_TAGS = {'tomb': {'historic': 'tomb'}, 'mosque': {'amenity': 'place_of_worship', 'religion': 'muslim'},
            'place_of_worship': {'amenity': 'place_of_worship'}, 'monument': {'historic': 'monument'}, 'memorial': {'historic': 'memorial'},
            'city_gate': {'historic': 'city_gate'}, 'attraction': {'tourism': 'attraction'}, 'viewpoint': {'tourism': 'viewpoint'},
            'hotel': {'tourism': 'hotel'}, 'guest_house': {'tourism': 'guest_house'}, 'hostel': {'tourism': 'hostel'}, 'motel': {'tourism': 'motel'},
            'hospital': {'amenity': 'hospital'}, 'clinic': {'amenity': 'clinic'}, 'doctors': {'amenity': 'doctors'}, 'pharmacy': {'amenity': 'pharmacy'},
            'drinking_water': {'amenity': 'drinking_water'}, 'toilets': {'amenity': 'toilets'}, 'police': {'amenity': 'police'},
            'fire_station': {'amenity': 'fire_station'}, 'community_centre': {'amenity': 'community_centre'}}


def from_tsv(path):
    """the places of a map pack (name, English, lat, lng, kind, area) as features"""
    for n, line in enumerate(open(path, encoding='utf-8')):
        c = line.rstrip('\n').split('\t')
        if n == 0 or len(c) < 5: continue
        tags = TSV_TAGS.get(c[4])
        if not tags: continue
        try: lat, lng = float(c[2]), float(c[3])
        except ValueError: continue
        if not (BOX[0] <= lat <= BOX[2] and BOX[1] <= lng <= BOX[3]): continue
        t = dict(tags, name=c[0])
        if c[1]: t['name:en'] = c[1]
        yield {'properties': t, 'geometry': {'type': 'Point', 'coordinates': [lng, lat]}, 'big': c[4] in ('tomb', 'mosque')}


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


rows, seen, RAW = [], set(), []
import itertools
if True:
    for ft in itertools.chain(*[from_tsv(t) for t in TSVS], features(SRC)):
        RAW.append(ft)
        t = ft.get('properties') or {}
        name = (t.get('name:ar') or t.get('name') or '').strip()
        k = kind(t, name)
        if not k: continue
        if not name and k not in ('water', 'toilets', 'health', 'police'): continue
        p, area = centre(ft.get('geometry') or {})
        if ft.get('center'): p = ft['center']
        if not p: continue
        lng, lat = round(p[0], 5), round(p[1], 5)
        key = (k, name, round(lat * 120), round(lng * 120))      # ~1 km cells; the same name and kind once per cell
        if name and key in seen: continue
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
NOT = re.compile(r'مشتل|مستشفى|مدرسة|مدارس|مقهى|مطعم|فندق|كراج|سوق|اسواق|أسواق|مكتب|كلية|جامعة|صيدلية|مركز|قسم|مكتبة|معهد|محطة|موكب|نقطة|سيطرة|شارع|مجمع|حي |جملونات|مزرعة|باب ')
CHOSEN = [  # title, city, pattern (Arabic name), pattern (English name)
    ('ضريح الإمام الحسين (ع)', 'كربلاء', r'^(ضريح|مرقد|حرم|العتبة|الروضة)\s*(الإمام |الامام |المقدس )?(الحسين|الحسينية)', r'Imam Husayn|Imam Hussein Shrine|Mausoleum of Imam Husayn'),
    ('ضريح أبي الفضل العباس (ع)', 'كربلاء', r'^(ضريح|مرقد|حرم|العتبة|الروضة)\s*(أبي الفضل |ابي الفضل )?(العباس|العباسية)', r'Mausoleum of Abbas|Abbas Shrine|Al-Abbas.s (holy )?shrine'),
    ('بين الحرمين', 'كربلاء', r'^بين الحرمين', r'Between the (two )?holy shrines'),
    ('المخيم الحسيني', 'كربلاء', r'^المخيم الحسيني$', r'Husseini camp'),
    ('مقام الإمام المهدي (عج)', 'كربلاء', r'^مقام (الإمام |الامام )?(المهدي|صاحب الزمان)', r'Mahdi'),
    ('مقام الإمام جعفر الصادق (ع)', 'كربلاء', r'^مقام (الإمام |الامام )?(جعفر |)الصادق', r'Jafar Sadiq'),
    ('مقام كف العباس الأيمن', 'كربلاء', r'^مقام كف العباس الا?يمن', r'Abbas.s Right Hand'),
    ('مقام كف العباس الأيسر', 'كربلاء', r'^مقام كف العباس الا?يسر', r'Abbas.s Left Hand'),
    ('ضريح الحر الرياحي', 'كربلاء', r'^(مرقد|ضريح) الحر', r'Al Hur Shrine'),
    ('ضريح عون بن عبد الله', 'كربلاء', r'^(ضريح|مرقد) عون', r'Aun ibn Abdillah'),
    ('ضريح الإمام علي (ع)', 'النجف', r'^(ضريح|مرقد|حرم|العتبة|الروضة|الحضرة)\s*(العلوية|العلوي|الإمام علي|الامام علي|أمير المؤمنين|امير المؤمنين)', r'Imam Ali (bin Abi Talib|Shrine|Holy)|Tomb of Imam Ali'),
    ('مرقد النبيين هود وصالح (ع)', 'النجف', r'^(مرقد|مقام) (الانبياء |النبيين )?هود', r'prophets Hood'),
    ('مرقد كميل بن زياد', 'النجف', r'^(مرقد|ضريح)( الصحابي الجليل)? كميل', r'Kumayl'),
    ('مسجد الكوفة المعظم', 'الكوفة', r'^(مسجد|جامع) الكوفة', r'Great Mosque of Kufa'),
    ('مرقد مسلم بن عقيل (ع)', 'الكوفة', r'^(مرقد|ضريح) مسلم بن عقيل', r'Muslim ibn Aqil'),
    ('مرقد هانئ بن عروة', 'الكوفة', r'^(مرقد|ضريح) هان[ئي]ء? بن عروة', r'Hani ibn Urwa'),
    ('مرقد المختار الثقفي', 'الكوفة', r'^(مرقد|ضريح) المختار', r'Mukhtar'),
    ('مرقد ميثم التمار', 'الكوفة', r'^(مرقد|ضريح) ميثم', r'Maytham'),
    ('مسجد السهلة المعظم', 'الكوفة', r'^مسجد السهلة', r'Sahlah Mosque'),
    ('مسجد صعصعة بن صوحان', 'الكوفة', r'^مسجد صعصعة', r'Sohhan'),
    ('مقام النبي يونس (ع)', 'الكوفة', r'^مقام نبي الله يونس|^مقام النبي يونس', r'Prophet of Allah Yunus'),
]
chosen = []
for title, cty, pa, pe in CHOSEN:
    best = None
    a, b = next((x[1], x[2]) for x in CITIES if x[0] == cty)
    for r in rows:
        if r['k'] not in ('shrine', 'mosque', 'mark', 'huss') or NOT.search(r['n']): continue
        if not (re.search(pa, r['n']) or (pe and re.search(pe, r.get('e', ''), re.I))): continue
        d = km(r['lat'], r['lng'], a, b)
        if d > 20: continue
        score = {'shrine': 3, 'mosque': 2}.get(r['k'], 1) + (2 if re.search(pa, r['n']) else 0) + math.log10(r.get('a', 1) + 10) / 2 - d / 10
        if not best or score > best[0]: best = (score, r)
    if best:
        r = best[1]
        chosen.append({'t': title, 'n': r['n'], 'lat': r['lat'], 'lng': r['lng'], 'c': r['c']})
        print('✓ %-30s ← %s (%.5f, %.5f) %s' % (title, r['n'], r['lat'], r['lng'], r['c']))
    else:
        print('✗ %-30s not found — left out' % title)

os.makedirs(OUT, exist_ok=True)
from collections import Counter
cnt = Counter((r['k'], r['c']) for r in rows)
print('places', len(rows), dict(Counter(r['k'] for r in rows)))
print(sorted(cnt.items()))
json.dump({'v': 1, 'chosen': chosen, 'places': rows, 'source': 'OpenStreetMap contributors (ODbL)'},
          open(os.path.join(OUT, 'arbaeen.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
print('size', os.path.getsize(os.path.join(OUT, 'arbaeen.json')))
