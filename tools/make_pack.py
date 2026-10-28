#!/usr/bin/env python3
"""Assemble mallah-iraq-map.zip: the vector tiles are STORED (the app reads them straight out of
the ZIP without unpacking), everything else is compressed."""
import zipfile, json, os, sys, datetime
src, out, build, maxzoom, bbox = sys.argv[1:6]
version = f'{build[:4]}-{build[4:6]}-{build[6:8]}'
manifest = {"version": version, "tiles": "iraq.pmtiles", "name": "العراق", "maxzoom": int(maxzoom),
            "bbox": [float(x) for x in bbox.split(',')], "source": f"Protomaps build {build}",
            "attribution": "© OpenStreetMap contributors (ODbL) · Protomaps",
            "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%MZ")}
with zipfile.ZipFile(out, 'w', allowZip64=False) as z:
    z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1), compress_type=zipfile.ZIP_DEFLATED)
    z.write(os.path.join(src, "iraq.pmtiles"), "iraq.pmtiles", compress_type=zipfile.ZIP_STORED)
    for root, _, files in os.walk(src):
        for fn in sorted(files):
            p = os.path.join(root, fn)
            rel = os.path.relpath(p, src).replace(os.sep, '/')
            if rel == "iraq.pmtiles": continue
            z.write(p, rel, compress_type=zipfile.ZIP_DEFLATED)
print(out, os.path.getsize(out), manifest)
