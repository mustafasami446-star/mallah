#!/usr/bin/env python3
"""الملاح — نشرة الطقس لكل محافظات العراق وأقضيتها ونواحيها.

Runs on GitHub every two hours. Asks MET Norway (free, commercial use allowed, CC BY 4.0) for the
forecast at every district / sub-district centre and on a 0.5° grid over Iraq, and writes:
  weather.json  everything the app shows (48 hours hour by hour, 7 days, the colour grid)
  alerts.json   only the warnings (heavy rain, strong wind, storms, heat, frost) — small, for the phone
                to check in the background
The phones read these two files; nobody's phone talks to the weather service directly.
"""
import json, sys, time, math, datetime as dt
from concurrent.futures import ThreadPoolExecutor
import urllib.request, gzip

UA = 'Mallah/1.0 (github.com/mustafasami446-star/mallah; mustafasami446@gmail.com)'
API = 'https://api.met.no/weatherapi/locationforecast/2.0/'
AREAS = sys.argv[1] if len(sys.argv) > 1 else 'updates/areas.json'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'out'
HOURS, DAYS = 48, 7
TZ = dt.timedelta(hours=3)                                   # Iraq
GRID = dict(lon0=38.75, lat0=29.0, step=0.5, nx=21, ny=18)   # 38.75..48.75 E, 29..37.5 N

# MET symbol codes -> small numbers the app knows (the app draws the icon and the Arabic word)
SYM = ['clearsky', 'fair', 'partlycloudy', 'cloudy', 'fog', 'lightrain', 'rain', 'heavyrain',
       'lightrainshowers', 'rainshowers', 'heavyrainshowers', 'lightrainandthunder', 'rainandthunder',
       'heavyrainandthunder', 'rainshowersandthunder', 'lightsleet', 'sleet', 'lightsnow', 'snow', 'heavysnow',
       'snowshowers', 'sleetshowers', 'heavyrainshowersandthunder', 'lightrainshowersandthunder']


def sym(code):
    if not code: return -1
    base = code.split('_')[0]
    if base in SYM: return SYM.index(base)
    if 'thunder' in base: return SYM.index('rainandthunder')
    if 'snow' in base: return SYM.index('snow')
    if 'sleet' in base: return SYM.index('sleet')
    if 'rain' in base: return SYM.index('rain')
    return -1


def fetch(kind, lat, lon):
    url = '%s%s?lat=%.3f&lon=%.3f' % (API, kind, lat, lon)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip'})
            with urllib.request.urlopen(req, timeout=40) as r:
                b = r.read()
                if r.headers.get('Content-Encoding') == 'gzip': b = gzip.decompress(b)
                return json.loads(b)
        except Exception as e:
            if attempt == 3:
                print('failed', url, e, file=sys.stderr)
                return None
            time.sleep(2 + attempt * 3)


def series(doc):
    """time -> (instant, next1, next6) for one place"""
    out = {}
    for s in (doc or {}).get('properties', {}).get('timeseries', []):
        t = dt.datetime.strptime(s['time'], '%Y-%m-%dT%H:%M:%SZ')
        d = s.get('data', {})
        out[t] = (d.get('instant', {}).get('details', {}), d.get('next_1_hours'), d.get('next_6_hours'), d.get('next_12_hours'))
    return out


def hourly(ser, start):
    """48 hours on the hour; where the forecast becomes 6-hourly the last known 6-hour block fills in"""
    T, W, D, G, R, P, S = [], [], [], [], [], [], []
    times = sorted(ser)
    for h in range(HOURS):
        t = start + dt.timedelta(hours=h)
        if t in ser: inst, n1, n6, n12 = ser[t]; per = 1
        else:
            prev = [x for x in times if x <= t]
            if not prev: inst, n1, n6, n12 = {}, None, None, None
            else: inst, n1, n6, n12 = ser[prev[-1]]
            per = 6
        T.append(round(inst.get('air_temperature', float('nan'))) if 'air_temperature' in inst else None)
        W.append(round(inst['wind_speed'] * 10) if 'wind_speed' in inst else None)
        D.append(round(inst['wind_from_direction'] / 5) * 5 % 360 if 'wind_from_direction' in inst else None)
        G.append(round(inst['wind_speed_of_gust'] * 10) if 'wind_speed_of_gust' in inst else None)
        blk = n1 if (per == 1 and n1) else n6
        det = (blk or {}).get('details', {})
        rain = det.get('precipitation_amount')
        if rain is not None and blk is n6 and per == 1: rain = rain / 6
        if rain is not None and per == 6: rain = rain / 6
        R.append(round(rain * 10) if rain is not None else None)
        pop = det.get('probability_of_precipitation')
        if pop is None: pop = ((n6 or {}).get('details', {}) or {}).get('probability_of_precipitation')
        if pop is None: pop = ((n12 or {}).get('details', {}) or {}).get('probability_of_precipitation')
        P.append(round(pop) if pop is not None else None)
        S.append(sym(((blk or n6 or n12 or {}).get('summary') or {}).get('symbol_code')))
    return dict(t=T, w=W, d=D, g=G, r=R, p=P, s=S)


def daily(ser, day0):
    """7 Iraqi days: max/min temperature, rain total, highest chance of rain, strongest wind / gust, the day's weather"""
    days = [dict(tx=None, tn=None, r=0.0, p=None, w=None, g=None, s=-1, sc=-1, _n=0) for _ in range(DAYS)]
    for t, (inst, n1, n6, n12) in sorted(ser.items()):
        loc = t + TZ
        i = (loc.date() - day0).days
        if not 0 <= i < DAYS: continue
        d = days[i]
        a = inst.get('air_temperature')
        if a is not None:
            d['tx'] = a if d['tx'] is None else max(d['tx'], a)
            d['tn'] = a if d['tn'] is None else min(d['tn'], a)
        for k, src in (('w', 'wind_speed'), ('g', 'wind_speed_of_gust')):
            v = inst.get(src)
            if v is not None: d[k] = v if d[k] is None else max(d[k], v)
        if n6 and t.hour % 6 == 0:          # whole 6-hour blocks, counted once
            det = n6.get('details', {})
            if det.get('air_temperature_max') is not None: d['tx'] = max(d['tx'] if d['tx'] is not None else -99, det['air_temperature_max'])
            if det.get('air_temperature_min') is not None: d['tn'] = min(d['tn'] if d['tn'] is not None else 99, det['air_temperature_min'])
            if det.get('precipitation_amount') is not None: d['r'] += det['precipitation_amount']; d['_n'] += 1
            if det.get('probability_of_precipitation') is not None: d['p'] = max(d['p'] or 0, det['probability_of_precipitation'])
            s = sym((n6.get('summary') or {}).get('symbol_code'))
            # the day's weather: the most significant 6-hour weather (rain beats cloud beats sun)
            if s >= 0 and (d['sc'] < 0 or rank(s) > rank(d['sc'])): d['sc'] = s
    out = dict(tx=[], tn=[], r=[], p=[], w=[], g=[], s=[])
    for d in days:
        out['tx'].append(round(d['tx']) if d['tx'] is not None else None)
        out['tn'].append(round(d['tn']) if d['tn'] is not None else None)
        out['r'].append(round(d['r'] * 10) if d['_n'] else None)
        out['p'].append(round(d['p']) if d['p'] is not None else None)
        out['w'].append(round(d['w'] * 10) if d['w'] is not None else None)
        out['g'].append(round(d['g'] * 10) if d['g'] is not None else None)
        out['s'].append(d['sc'])
    return out


def rank(s):
    n = SYM[s]
    return (5 if 'thunder' in n else 4 if 'heavy' in n else 3 if ('rain' in n or 'snow' in n or 'sleet' in n) else 2 if n in ('fog', 'cloudy') else 1 if n == 'partlycloudy' else 0)


def alerts_for(aid, h, d, start, day0):
    """warnings worth a notification, from the 48 hours and the 7 days"""
    out = []
    def add(k, i, v, when): out.append(dict(a=aid, k=k, t=when, v=v))
    # 48 hours: heavy rain in any 6 hours, strong gusts, thunderstorms
    seen = set()
    for i in range(HOURS):
        when = (start + dt.timedelta(hours=i)).strftime('%Y-%m-%dT%H:00Z')
        r6 = sum((x or 0) for x in h['r'][i:i + 6]) / 10
        if 'rain' not in seen and r6 >= 10: add('rain', i, round(r6), when); seen.add('rain')
        g = h['g'][i] if h['g'][i] is not None else h['w'][i]
        if 'wind' not in seen and g is not None and g >= 170: add('wind', i, round(g * 0.36), when); seen.add('wind')   # km/h
        s = h['s'][i]
        if 'storm' not in seen and s >= 0 and 'thunder' in SYM[s]: add('storm', i, 0, when); seen.add('storm')
    # the next days: heat, frost, a very wet day
    for i in range(DAYS):
        when = (day0 + dt.timedelta(days=i)).isoformat()
        if d['tx'][i] is not None and d['tx'][i] >= 49 and 'heat' not in seen: add('heat', i, d['tx'][i], when); seen.add('heat')
        if d['tn'][i] is not None and d['tn'][i] <= 0 and 'frost' not in seen: add('frost', i, d['tn'][i], when); seen.add('frost')
        if d['r'][i] is not None and d['r'][i] >= 200 and 'rain' not in seen: add('rain', i, round(d['r'][i] / 10), when); seen.add('rain')
    return out


def main():
    areas = json.load(open(AREAS))['areas']
    now = dt.datetime.utcnow().replace(minute=0, second=0, microsecond=0)
    start = now
    day0 = (now + TZ).date()
    pts = [(a['id'], a['c'][1], a['c'][0]) for a in areas]
    grid = [(j, i, GRID['lat0'] + j * GRID['step'], GRID['lon0'] + i * GRID['step']) for j in range(GRID['ny']) for i in range(GRID['nx'])]
    t0 = time.time()
    with ThreadPoolExecutor(8) as ex:                # MET Norway asks for < 20 requests a second
        area_docs = list(ex.map(lambda p: fetch('complete', p[1], p[2]), pts))
        grid_docs = list(ex.map(lambda g: fetch('compact', g[2], g[3]), grid))
    ok = sum(1 for x in area_docs if x) + sum(1 for x in grid_docs if x)
    print('fetched %d/%d in %.0fs' % (ok, len(pts) + len(grid), time.time() - t0))
    if sum(1 for x in area_docs if x) < len(pts) * 0.8: sys.exit('too many failures — keeping the previous forecast')

    A, alerts = {}, []
    for (aid, lat, lon), doc in zip(pts, area_docs):
        if not doc: continue
        ser = series(doc)
        h, d = hourly(ser, start), daily(ser, day0)
        A[aid] = dict(h=h, d=d)
        alerts += alerts_for(aid, h, d, start, day0)
    # the grid: hour by hour temperature, rain, wind (speed + direction); day by day max temperature, rain, wind
    G = dict(GRID, h=dict(t=[], r=[], w=[], d=[]), d=dict(tx=[], tn=[], r=[], w=[]))
    for (j, i, lat, lon), doc in zip(grid, grid_docs):
        ser = series(doc)
        h, d = hourly(ser, start), daily(ser, day0)
        for k in ('t', 'r', 'w', 'd'): G['h'][k].append(h[k])
        for k in ('tx', 'tn', 'r', 'w'): G['d'][k].append(d[k])
    meta = dict(v=1, made=dt.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'), start=start.strftime('%Y-%m-%dT%H:00Z'),
                day0=day0.isoformat(), hours=HOURS, days=DAYS, sym=SYM,
                src='بيانات الطقس: MET Norway (المعهد النرويجي للأرصاد) — CC BY 4.0')
    import os
    os.makedirs(OUT, exist_ok=True)
    json.dump(dict(meta, areas=A, grid=G), open(OUT + '/weather.json', 'w'), separators=(',', ':'))
    json.dump(dict(meta, alerts=alerts), open(OUT + '/alerts.json', 'w'), separators=(',', ':'), ensure_ascii=False)
    print('areas', len(A), 'alerts', len(alerts), 'size', os.path.getsize(OUT + '/weather.json'))
    # a quick look in the log: Basra centre
    for a in areas:
        if a['p'] == 'basra' and a['k'] == 'd' and a['id'] in A:
            x = A[a['id']]
            print(a['ar'], 'T', x['h']['t'][:6], 'P', x['h']['p'][:6], 'W', x['h']['w'][:6], 'days tx', x['d']['tx'], 'p', x['d']['p'], 's', x['d']['s'])
            break


if __name__ == '__main__':
    main()
