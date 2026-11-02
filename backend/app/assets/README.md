# 지역 경계 자료

- 행정경계: 국가데이터처 SGIS, 2025년 6월 30일 기준 시도 17개·시군구 252개입니다. [공식 배포 자료](https://www.data.go.kr/data/15129688/fileData.do)의 SHP를 원본 PRJ 기준에서 WGS84로 변환했습니다. 원본 다운로드의 SHA256은 GeoJSON의 original_sha256에 보존합니다. 이용허락범위는 제한 없음입니다.
- 표시용 행정경계는 약 40m 수준으로 단순화하고 좌표 소수점 여섯 자리를 보존합니다. 법적 경계·측량·경계 인접 위치의 정밀 판정용 자료가 아닙니다.
- 마라도: 같은 SGIS 서귀포시 경계에서 마라도 위치의 섬 도형을 분리한 사용자 지정 참고 지역입니다.
- 한라산: 사용자가 요청한 고도 기준 참고 지역입니다. [Mapzen Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)의 N33E126 HGT 고도 격자에서 해발 1,000m 이상 면을 삼각형 선형 보간으로 추출하고, 한라산의 연결된 주 영역을 약 10m 수준으로 단순화했습니다. 3601×3601 격자이며 고도 기준은 자료의 해발 고도입니다. 원본 파일 SHA256과 추출 방법은 해당 Feature 속성에 보존합니다. 국립공원 경계나 종의 실제 서식 고도 하한을 의미하지 않습니다.
- 고도 자료 출처: Mapzen. SRTM data courtesy of the U.S. Geological Survey. [제공자별 출처·이용조건](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)을 따릅니다. 이 파일은 가공 결과이며 USGS가 가공을 승인하거나 보증했다는 의미가 아닙니다.
- 실행 중에는 이 로컬 파일을 사용하며 경계·고도 서비스를 자동 호출하지 않습니다. 개인 관찰이나 사진은 포함하지 않습니다.
- 이름 표시는 경계와 별도로 관리합니다. [전남광주통합특별시 공식 홈페이지](https://www.jeonnam.go.kr/)의 현행 명칭을 적용하며, 옛 광주·전남 도형은 각 원래 참고 범위를 보존합니다. [인천시의회 행정체제 개편 안내](https://www.icouncil.go.kr/webzine/webzineno/webzineNoDetail.do?menu_no=004&menumain=04&no_seq=2175)에 따라 옛 동구는 제물포구의 일부로 표시합니다. 옛 중구·서구의 새 구역 분할은 이 파일만으로 판정하지 않고 확인 필요로 표시합니다. 도형을 새 법적 경계로 바꾼 자료가 아닙니다.
