#!/usr/bin/env python3
"""Road graphs for offline routing in the Mallah app, from an OpenStreetMap extract.

  python3 tools/roads.py roads.osm.pbf updates/provinces.json out/

Writes out/roads-<id>.bin.gz for Iraq ("iraq") and for every province (its roads plus ~15 km around it),
and out/roads.json listing them.

File format (little-endian, gzip-compressed):
  'MRG1' u32 version | u32 nodes | u32 edges | u32 geomPoints | u32 namesBytes
  nodes:  i32 lat*1e6, i32 lng*1e6                         (junctions and road ends)
  edges:  u32 from, u32 to, u32 length (dm), u8 class, u8 flags, u16 pad, u32 name, u32 geomStart, u16 geomCount, u16 maxspeed
          flags: 1 one-way (from→to only), 2 roundabout, 4 no cars, 8 no feet
  geom:   i32 lat*1e6, i32 lng*1e6                         (the points between the two ends, simplified)
  names:  UTF-8, name i starts at byte offset i (0 = no name), each name ends with \\n
"""
import sys, os, json, gzip, math, struct
from array import array
import osmium
from shapely.geometry import shape, Point
from shapely.prepared import prep

CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street',
           'service', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'track',
           'pedestrian', 'footway', 'path', 'steps', 'cycleway', 'road']
CLS = {c: i for i, c in enumerate(CLASSES)}
NO_CAR = {'pedestrian', 'footway', 'path', 'steps', 'cycleway'}
NO_FOOT = {'motorway', 'motorway_link'}
SKIP_SERVICE = {'parking_aisle', 'driveway', 'drive-through'}


def simplify(pts, tol=0.00003):
    """Douglas–Peucker on (lat, lng) pairs, about 3 m."""
    if len(pts) <= 2:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (y1, x1), (y2, x2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1; L = dx * dx + dy * dy
        best, bi = -1, -1
        for i in range(a + 1, b):
            y, x = pts[i]
            if L == 0: d = (x - x1) ** 2 + (y - y1) ** 2
            else:
                t = max(0, min(1, ((x - x1) * dx + (y - y1) * dy) / L))
                d = (x - x1 - t * dx) ** 2 + (y - y1 - t * dy) ** 2
            if d > best: best, bi = d, i
        if best > tol * tol:
            keep[bi] = True; stack.append((a, bi)); stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def hav(a, b):
    R = 6371008.8
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


class Roads(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.ways = []          # (node ids, coords, cls, flags, name, maxspeed)
        self.use = {}           # node id -> number of way ends / uses

    def way(self, w):
        t = w.tags
        hw = t.get('highway')
        if hw not in CLS: return
        if hw == 'service' and t.get('service') in SKIP_SERVICE: return
        if t.get('area') == 'yes' or t.get('access') in ('private', 'no'): return
        try:
            ids = [n.ref for n in w.nodes]; pts = [(n.lat, n.lon) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(ids) < 2: return
        flags = 0
        ow = t.get('oneway')
        if t.get('junction') in ('roundabout', 'circular'): flags |= 2; ow = ow or 'yes'
        if hw in ('motorway',) and ow is None: ow = 'yes'
        if ow == '-1': ids.reverse(); pts.reverse(); ow = 'yes'
        if ow in ('yes', 'true', '1'): flags |= 1
        if hw in NO_CAR or t.get('motor_vehicle') == 'no' or t.get('motorcar') == 'no': flags |= 4
        if hw in NO_FOOT or t.get('foot') == 'no': flags |= 8
        name = t.get('name:ar') or t.get('name') or t.get('ref') or ''
        ms = 0
        try: ms = int(''.join(c for c in t.get('maxspeed', '') if c.isdigit()) or 0)
        except ValueError: ms = 0
        self.ways.append((ids, pts, CLS[hw], flags, name, min(ms, 200)))
        for i, n in enumerate(ids):
            self.use[n] = self.use.get(n, 0) + (2 if i in (0, len(ids) - 1) else 1)


def build(ways, use):
    """Split ways at junctions into edges (once, for all of Iraq)."""
    node_ix, nodes = {}, array('i')
    edges, geom = [], array('i')
    names, name_ix = bytearray(b'\n'), {'': 0}

    def nid(osm, p):
        i = node_ix.get(osm)
        if i is None:
            i = node_ix[osm] = len(nodes) // 2
            nodes.append(round(p[0] * 1e6)); nodes.append(round(p[1] * 1e6))
        return i

    for ids, pts, cls, flags, name, ms in ways:
        start = 0
        for i in range(1, len(ids)):
            if i < len(ids) - 1 and use.get(ids[i], 0) < 2: continue
            seg = pts[start:i + 1]
            a, b = nid(ids[start], seg[0]), nid(ids[i], seg[-1])
            length = sum(hav(seg[k - 1], seg[k]) for k in range(1, len(seg)))
            mid = simplify(seg)[1:-1]
            if name not in name_ix:
                name_ix[name] = len(names); names += name.encode('utf-8') + b'\n'
            edges.append((a, b, max(1, round(length * 10)), cls, flags, name_ix[name], len(geom) // 2, len(mid), ms))
            for p in mid: geom.append(round(p[0] * 1e6)); geom.append(round(p[1] * 1e6))
            start = i
    return nodes, edges, geom, bytes(names)


def subset(full, inside_node):
    """The edges with at least one end inside the area, renumbered."""
    nodes, edges, geom, names = full
    remap, n2, g2, e2 = {}, array('i'), array('i'), []
    name_map, n_out = {0: 0}, bytearray(b'\n')

    def nid(i):
        j = remap.get(i)
        if j is None:
            j = remap[i] = len(n2) // 2; n2.append(nodes[2 * i]); n2.append(nodes[2 * i + 1])
        return j

    def nm(off):
        j = name_map.get(off)
        if j is None:
            end = names.index(b'\n', off); j = name_map[off] = len(n_out); n_out.extend(names[off:end + 1])
        return j

    for (a, b, ln, cls, fl, name, gs, gc, ms) in edges:
        if not (inside_node(a) or inside_node(b)): continue
        e2.append((nid(a), nid(b), ln, cls, fl, nm(name), len(g2) // 2, gc, ms))
        g2.extend(geom[2 * gs: 2 * (gs + gc)])
    return n2, e2, g2, bytes(n_out)


def write(path, nodes, edges, geom, names):
    out = bytearray(b'MRG1')
    out += struct.pack('<5I', 1, len(nodes) // 2, len(edges), len(geom) // 2, len(names))
    out += nodes.tobytes()
    E = struct.Struct('<IIIBBHIIHH')
    for e in edges: out += E.pack(e[0], e[1], e[2], e[3], e[4], 0, e[5], e[6], min(e[7], 65535), e[8])
    out += geom.tobytes()
    out += names
    with gzip.open(path, 'wb', compresslevel=9) as f: f.write(out)
    return os.path.getsize(path)


def main():
    src, prov_file, outdir = sys.argv[1:4]
    os.makedirs(outdir, exist_ok=True)
    h = Roads()
    h.apply_file(src, locations=True, idx='flex_mem')
    print('ways', len(h.ways), 'nodes used', len(h.use), flush=True)
    listing = []
    full = build(h.ways, h.use)
    h.ways = None; h.use = None
    n, e, g, nm = full
    size = write(os.path.join(outdir, 'roads-iraq.bin.gz'), n, e, g, nm)
    listing.append({'id': 'iraq', 'file': 'roads-iraq.bin.gz', 'size': size, 'nodes': len(n) // 2, 'edges': len(e)})
    print('iraq', listing[-1], flush=True)
    provs = json.load(open(prov_file, encoding='utf-8'))['features']
    for f in provs:
        pid = f['properties']['id']
        poly = shape(f['geometry']).buffer(0.15)
        P = prep(poly)
        minx, miny, maxx, maxy = poly.bounds
        nodes = full[0]
        memo = {}
        def inside(i):
            r = memo.get(i)
            if r is None:
                la, lo = nodes[2 * i] / 1e6, nodes[2 * i + 1] / 1e6
                r = memo[i] = miny <= la <= maxy and minx <= lo <= maxx and P.contains(Point(lo, la))
            return r
        n, e, g, nm = subset(full, inside)
        size = write(os.path.join(outdir, f'roads-{pid}.bin.gz'), n, e, g, nm)
        listing.append({'id': pid, 'file': f'roads-{pid}.bin.gz', 'size': size, 'nodes': len(n) // 2, 'edges': len(e),
                        'bbox': [round(v, 3) for v in (minx, miny, maxx, maxy)]})
        print(pid, listing[-1], flush=True)
    json.dump({'v': 1, 'packs': listing}, open(os.path.join(outdir, 'roads.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
