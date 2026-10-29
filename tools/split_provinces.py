#!/usr/bin/env python3
"""Split the Iraq map pack into one pack per governorate (province).

Every province pack is self-contained, in the same format as the full pack:
  - the whole of Iraq at low zoom (z0..OVERVIEW_Z), so the country stays visible when zoomed out
  - full detail (up to the pack's max zoom) only for tiles that touch the province
  - fonts, map symbols, and the places inside the province (for offline search)

usage: split_provinces.py <pack dir> <admin.geojsonseq> <out dir> <build YYYYMMDD> <maxzoom>
writes <out dir>/mallah-<id>.zip, <out dir>/provinces.json (outlines for the picker), <out dir>/packs.json
"""
import json, math, os, sys, zipfile, datetime, shutil
from shapely.geometry import shape, box, Point, mapping
from shapely.prepared import prep
from shapely.validation import make_valid
from pmtiles.reader import Reader, MmapSource, all_tiles
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid

OVERVIEW_Z = int(os.environ.get('OVERVIEW_Z', '8'))

# ISO 3166-2 code -> (id, Arabic name, English name). Names are matched too, in case a code is missing.
PROVINCES = [
    ('IQ-BA', 'basra', 'البصرة', 'Basra', ['basra', 'basrah']),
    ('IQ-BG', 'baghdad', 'بغداد', 'Baghdad', ['baghdad']),
    ('IQ-NI', 'nineveh', 'نينوى', 'Nineveh', ['nineveh', 'ninawa', 'ninewa']),
    ('IQ-AR', 'erbil', 'أربيل', 'Erbil', ['erbil', 'arbil', 'hawler']),
    ('IQ-SU', 'sulaymaniyah', 'السليمانية', 'Sulaymaniyah', ['sulaymaniyah', 'sulaimani', 'slemani', 'as sulaymaniyah']),
    ('IQ-DA', 'duhok', 'دهوك', 'Duhok', ['duhok', 'dohuk', 'dahuk']),
    ('IQ-KI', 'kirkuk', 'كركوك', 'Kirkuk', ['kirkuk', "ta'mim", 'tamim']),
    ('IQ-DI', 'diyala', 'ديالى', 'Diyala', ['diyala']),
    ('IQ-SD', 'salahaddin', 'صلاح الدين', 'Saladin', ['saladin', 'salah ad din', 'salahaddin', 'salah al-din', 'salah al din']),
    ('IQ-AN', 'anbar', 'الأنبار', 'Anbar', ['anbar']),
    ('IQ-BB', 'babil', 'بابل', 'Babylon', ['babil', 'babylon']),
    ('IQ-KA', 'karbala', 'كربلاء', 'Karbala', ['karbala']),
    ('IQ-NA', 'najaf', 'النجف', 'Najaf', ['najaf']),
    ('IQ-QA', 'qadisiyah', 'القادسية', 'Al-Qadisiyah', ['qadisiyyah', 'qadisiyah', 'qadisiya', 'diwaniyah', 'al-qadisiyyah']),
    ('IQ-WA', 'wasit', 'واسط', 'Wasit', ['wasit']),
    ('IQ-MU', 'muthanna', 'المثنى', 'Muthanna', ['muthanna']),
    ('IQ-DQ', 'dhiqar', 'ذي قار', 'Dhi Qar', ['dhi qar', 'thi qar', 'dhiqar']),
    ('IQ-MA', 'maysan', 'ميسان', 'Maysan', ['maysan', 'misan']),
    ('IQ-HA', 'halabja', 'حلبجة', 'Halabja', ['halabja']),
]
ALIASES = {'IQ-TS': 'IQ-KI', 'IQ-SW': 'IQ-HA'}


def match(props):
    iso = (props.get('ISO3166-2') or '').strip().upper()
    iso = ALIASES.get(iso, iso)
    for p in PROVINCES:
        if iso == p[0]:
            return p
    if iso and not iso.startswith('IQ-'):
        return None                                # a neighbouring country's province
    names = ' '.join(str(props.get(k, '')) for k in ('name:en', 'name', 'int_name', 'official_name:en')).lower()
    for p in PROVINCES:
        if any(n in names for n in p[4]):
            return p
    return None


def load_provinces(path):
    found = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip().lstrip('\x1e')
            if not line:
                continue
            ft = json.loads(line)
            props = ft.get('properties') or {}
            if str(props.get('admin_level')) != '4' or props.get('boundary') != 'administrative':
                continue
            if (ft.get('geometry') or {}).get('type') not in ('Polygon', 'MultiPolygon'):
                continue
            p = match(props)
            if not p:
                print('skip admin_level=4:', props.get('name'), props.get('ISO3166-2'))
                continue
            g = make_valid(shape(ft['geometry']))
            if p[1] in found:                          # several pieces: keep them all
                g = found[p[1]]['geom'].union(g)
            found[p[1]] = {'iso': p[0], 'id': p[1], 'ar': p[2], 'en': p[3], 'geom': g}
    return list(found.values())


def tile_box(z, x, y):
    n = 2 ** z
    w = x / n * 360 - 180
    e = (x + 1) / n * 360 - 180
    lat = lambda t: math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * t / n))))
    return box(w, lat(y + 1), e, lat(y))


def write_pack(out, pid, ar, en, tiles_path, places_rows, src, version, maxzoom, bbox, build):
    manifest = {'id': pid, 'name': ar, 'name_en': en, 'version': version, 'tiles': pid + '.pmtiles',
                'maxzoom': maxzoom, 'bbox': bbox, 'source': f'Protomaps build {build}',
                'attribution': '© OpenStreetMap contributors (ODbL) · Protomaps',
                'built': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ')}
    with zipfile.ZipFile(out, 'w', allowZip64=False) as z:
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=1), compress_type=zipfile.ZIP_DEFLATED)
        z.write(tiles_path, pid + '.pmtiles', compress_type=zipfile.ZIP_STORED)
        z.writestr('places.tsv', 'name\tname_en\tlat\tlng\tkind\tarea\n' + ''.join(places_rows), compress_type=zipfile.ZIP_DEFLATED)
        for sub in ('fonts', 'sprites'):
            for root, _, files in os.walk(os.path.join(src, sub)):
                for fn in sorted(files):
                    p = os.path.join(root, fn)
                    z.write(p, os.path.relpath(p, src).replace(os.sep, '/'), compress_type=zipfile.ZIP_DEFLATED)


def main(src, admin, outdir, build, maxzoom):
    maxzoom = int(maxzoom)
    version = f'{build[:4]}-{build[4:6]}-{build[6:8]}'
    os.makedirs(outdir, exist_ok=True)
    provs = load_provinces(admin)
    print(len(provs), 'provinces:', ', '.join(p['en'] for p in provs))
    if len(provs) < int(os.environ.get('MIN_PROVINCES', '15')):
        sys.exit('too few provinces found — boundaries look incomplete')
    for p in provs:
        p['region'] = p['geom'].simplify(0.002).buffer(0.02)
        p['prep'] = prep(p['region'])
        p['bounds'] = p['region'].bounds
        p['tmp'] = os.path.join(outdir, p['id'] + '.pmtiles')
        p['fh'] = open(p['tmp'], 'wb')
        p['w'] = Writer(p['fh'])
        p['tiles'] = 0

    # ---- tiles ----
    with open(os.path.join(src, 'iraq.pmtiles'), 'rb') as f:
        get = MmapSource(f)
        header = Reader(get).header()
        metadata = Reader(get).metadata()
        n = 0
        for (z, x, y), data in all_tiles(get):
            tid = zxy_to_tileid(z, x, y)
            if z <= OVERVIEW_Z:
                targets = provs
            else:
                b = tile_box(z, x, y)
                bw, bs, be, bn = b.bounds
                targets = [p for p in provs if not (be < p['bounds'][0] or bw > p['bounds'][2] or bn < p['bounds'][1] or bs > p['bounds'][3])
                           and p['prep'].intersects(b)]
            for p in targets:
                p['w'].write_tile(tid, data)
                p['tiles'] += 1
            n += 1
            if n % 50000 == 0:
                print('tiles', n)
    print('tiles total', n)
    for p in provs:
        w, s, e, nn = p['geom'].bounds
        h = dict(header)
        h.update(min_lon_e7=int(w * 1e7), min_lat_e7=int(s * 1e7), max_lon_e7=int(e * 1e7), max_lat_e7=int(nn * 1e7),
                 center_lon_e7=int((w + e) / 2 * 1e7), center_lat_e7=int((s + nn) / 2 * 1e7), center_zoom=8)
        md = dict(metadata); md['name'] = 'Mallah ' + p['en']
        p['w'].finalize(h, md)
        p['fh'].close()

    # ---- places ----
    rows = {p['id']: [] for p in provs}
    with open(os.path.join(src, 'places.tsv'), encoding='utf-8') as f:
        next(f)
        for line in f:
            c = line.rstrip('\n').split('\t')
            if len(c) < 4:
                continue
            try:
                lat, lng = float(c[2]), float(c[3])
            except ValueError:
                continue
            pt = Point(lng, lat)
            for p in provs:
                bw, bs, be, bn = p['bounds']
                if bw <= lng <= be and bs <= lat <= bn and p['prep'].contains(pt):
                    rows[p['id']].append(line if line.endswith('\n') else line + '\n')

    # ---- zips + index ----
    packs, feats = [], []
    for p in sorted(provs, key=lambda q: q['en']):
        w, s, e, nn = [round(v, 3) for v in p['geom'].bounds]
        out = os.path.join(outdir, f"mallah-{p['id']}.zip")
        write_pack(out, p['id'], p['ar'], p['en'], p['tmp'], rows[p['id']], src, version, maxzoom, [w, s, e, nn], build)
        os.remove(p['tmp'])
        size = os.path.getsize(out)
        packs.append({'id': p['id'], 'name': p['ar'], 'name_en': p['en'], 'file': os.path.basename(out),
                      'size': size, 'bbox': [w, s, e, nn], 'places': len(rows[p['id']]), 'tiles': p['tiles']})
        print(f"{p['id']:14s} {size/1e6:7.1f} MB  {p['tiles']:7d} tiles  {len(rows[p['id']]):6d} places")
        lite = p['geom'].simplify(0.012, preserve_topology=True)
        lp = p['geom'].representative_point()
        geo = json.loads(json.dumps(mapping(lite)), parse_float=lambda v: round(float(v), 3))
        feats.append({'type': 'Feature', 'properties': {'id': p['id'], 'name': p['ar'], 'name_en': p['en'],
                                                         'label': [round(lp.x, 3), round(lp.y, 3)]}, 'geometry': geo})
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(outdir, 'provinces.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    json.dump(packs, open(os.path.join(outdir, 'packs.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main(*sys.argv[1:6])
