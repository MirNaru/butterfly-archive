"""판정 경계를 보존하고 확대 수준별 지도 표시 파일만 생성합니다. Shapely는 생성 도구에만 필요합니다."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--library-dir',help='기존 Shapely 설치 경로')
args=parser.parse_args()
if args.library_dir: sys.path.insert(0,str(Path(args.library_dir).resolve()))
from shapely.geometry import shape,mapping

folder=Path(__file__).parent/'app/assets'
original=folder/'admin-regions.geojson'
raw=original.read_bytes();data=json.loads(raw)
for level,tolerance,min_area in [('coarse',0.008,0.0004),('medium',0.0015,0.000008)]:
    features=[]
    for feature in data['features']:
        geometry=shape(feature['geometry'])
        polygons=[geometry] if geometry.geom_type=='Polygon' else list(geometry.geoms)
        largest=max(range(len(polygons)),key=lambda i:polygons[i].area)
        special=feature['properties']['level']=='special'
        parts=[]
        for i,polygon in enumerate(polygons):
            if not special and i!=largest and polygon.area<min_area:continue
            simplified=polygon if special else polygon.simplify(tolerance,preserve_topology=True)
            assert simplified.is_valid and not simplified.is_empty
            parts.append({'id':i,'bbox':list(simplified.bounds),'rings':mapping(simplified)['coordinates']})
        features.append({'properties':feature['properties'],'bbox':feature['bbox'],'parts':parts})
    output={'level':level,'source':data['source'],'source_url':data['source_url'],
            'original_sha256':hashlib.sha256(raw).hexdigest(),'tolerance_degrees':tolerance,
            'min_polygon_area_degrees2':min_area,'features':features}
    target=folder/f'admin-regions-{level}.json'
    target.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(level,'bytes',target.stat().st_size,'parts',sum(len(f['parts']) for f in features),'vertices',sum(len(r) for f in features for p in f['parts'] for r in p['rings']))
assert original.read_bytes()==raw
