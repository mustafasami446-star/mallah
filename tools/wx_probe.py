import json, urllib.request, gzip, sys
UA = 'Mallah/1.0 (github.com/mustafasami446-star/mallah; mustafasami446@gmail.com)'
r = urllib.request.urlopen(urllib.request.Request('https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=30.5&lon=47.8', headers={'User-Agent': UA}))
d = json.loads(r.read()); ts = d['properties']['timeseries']
print('MET steps', len(ts), ts[0]['time'], ts[-1]['time'])
for i in (0, 1, 70):
    if i < len(ts): print(i, ts[i]['time'], {k: (list(v.get('details', {}).keys()) if isinstance(v, dict) else v) for k, v in ts[i]['data'].items()})
from ecmwf.opendata import Client
import eccodes
c = Client(source='ecmwf')
for params, steps in ((['tpg1', 'tpg5', 'tpg10', 'tpg20'], ['0-24', '24-48', '48-72', '72-96', '96-120', '120-144', '144-168']),
                      (['tpg1'], ['0-24', '12-36']), (['10fgg15', '10fgg20', '10fgg25'], ['0-24', '24-48'])):
    for t in (0, 12):
        try:
            res = c.retrieve(type='ep', param=params, step=steps, time=t, target='ep.grib2')
            print('EP ok', params, steps, res.datetime)
        except Exception as e:
            print('EP fail', params, steps, t, str(e)[:200]); continue
        with open('ep.grib2', 'rb') as f:
            n = 0
            while True:
                h = eccodes.codes_grib_new_from_file(f)
                if h is None: break
                n += 1
                if n <= 12:
                    print(eccodes.codes_get(h, 'shortName'), eccodes.codes_get(h, 'paramId'), eccodes.codes_get(h, 'stepRange'), eccodes.codes_get(h, 'Ni'), eccodes.codes_get(h, 'Nj'),
                          eccodes.codes_get(h, 'iDirectionIncrementInDegrees'), eccodes.codes_get(h, 'latitudeOfFirstGridPointInDegrees'), eccodes.codes_get(h, 'longitudeOfFirstGridPointInDegrees'),
                          round(eccodes.codes_get_double(h, 'max'), 1), eccodes.codes_get(h, 'units'))
                eccodes.codes_release(h)
            print('messages', n)
        break
import os; print('size', os.path.getsize('ep.grib2') if os.path.exists('ep.grib2') else 0)
