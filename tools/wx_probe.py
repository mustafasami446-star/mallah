import json, urllib.request, gzip, sys
UA = 'Mallah/1.0 (github.com/mustafasami446-star/mallah; mustafasami446@gmail.com)'
r = urllib.request.urlopen(urllib.request.Request('https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=30.5&lon=47.8', headers={'User-Agent': UA}))
d = json.loads(r.read()); ts = d['properties']['timeseries']
print('MET steps', len(ts), ts[0]['time'], ts[-1]['time'])
for i in (0, 1, 70):
    if i < len(ts): print(i, ts[i]['time'], {k: (list(v.get('details', {}).keys()) if isinstance(v, dict) else v) for k, v in ts[i]['data'].items()})
from ecmwf.opendata import Client
c = Client(source='ecmwf')
for params in (['tpg1', 'tpg5', 'tpg10', 'tpg20'], ['10fgg15', '10fgg20', '10fgg25']):
    try:
        res = c.retrieve(type='ep', param=params, target='ep.grib2')
        print('EP ok', params, res.datetime, getattr(res, 'steps', None))
    except Exception as e:
        print('EP fail', params, e)
        continue
    import eccodes
    with open('ep.grib2', 'rb') as f:
        n = 0
        while True:
            h = eccodes.codes_grib_new_from_file(f)
            if h is None: break
            n += 1
            if n <= 40:
                print(eccodes.codes_get(h, 'shortName'), eccodes.codes_get(h, 'stepRange'), eccodes.codes_get(h, 'Ni'), eccodes.codes_get(h, 'Nj'),
                      eccodes.codes_get(h, 'iDirectionIncrementInDegrees'), round(eccodes.codes_get_double(h, 'max'), 1))
            eccodes.codes_release(h)
        print('messages', n)
