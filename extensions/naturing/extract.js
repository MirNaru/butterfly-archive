// 공개 관찰 페이지의 표시 정보를 추출합니다.
export function extractObservation(manual = false) {
  const match = location.pathname.match(/^\/o\/(\d+)\/?$/);
  if (location.hostname !== 'www.naturing.net' || !match) throw new Error('네이처링 관찰 상세 페이지를 열어 주세요.');
  const headings = [...document.querySelectorAll('h1')];
  const heading = headings.find(e => e.innerText.trim() && !e.querySelector('a'));
  if (!heading) throw new Error('종명 제목을 찾지 못했습니다. 페이지 구성을 확인해 주세요.');
  const title = heading.innerText.trim();
  const scientific = title.match(/[A-Z][a-z]+\s+[a-z]+(?:\s+[a-z]+)?/)?.[0] || '';
  const korean = title.replace(scientific, '').trim();
  const infoHeading = [...document.querySelectorAll('h2')].find(e => e.innerText.trim() === '관찰정보');
  const section = infoHeading?.parentElement;
  if (!section) throw new Error('관찰정보 영역을 찾지 못했습니다.');
  const text = section.innerText;
  function field(label, next) {
    const start = text.indexOf(label);
    if (start < 0) return '';
    const rest = text.slice(start + label.length).trim();
    const ends = next.map(x => rest.indexOf(x)).filter(x => x >= 0);
    return rest.slice(0, ends.length ? Math.min(...ends) : rest.length).trim();
  }
  const place = field('위치', ['고도', '날씨', '관찰시각']);
  let unavailable = '';
  // 비공개·미입력 안내에서는 수동 읽기도 지도 좌표를 읽지 않습니다.
  if (/(?:게시자.*(?:요청|비공개)|(?:위치|위치정보).*(?:공개되지|비공개|숨겨|숨김))/.test(place.replace(/\s+/g, ''))) {
    unavailable = 'private_location';
  }
  const placeText = place.replace(/[\s.]/g, '');
  if (!placeText || /(?:위치|정보).*(?:없습니다|없음|미입력|미등록|입력하지않|입력되지않)|^(?:미입력|미등록|없음)$/.test(placeText)) {
    unavailable ||= 'missing_location';
  }
  if (unavailable && !manual) return { source_id: match[1], skip_reason: unavailable };
  const map = unavailable ? null : document.getElementById('map');
  function coordinate(name, min, max) {
    const raw = map?.getAttribute(name);
    if (!raw?.trim()) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value >= min && value <= max ? value : null;
  }
  let latitude = coordinate('data-lat', -90, 90), longitude = coordinate('data-lng', -180, 180);
  if (latitude === null || longitude === null) {
    if (!manual) return { source_id: match[1], skip_reason: 'missing_location' };
    latitude = null; longitude = null; unavailable ||= 'missing_location';
  }
  const observed = field('관찰시각', ['지도 확대', '50m', '100m', 'Kakao']);
  const date = observed.match(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일(?:\s*(?:오전|오후)\s*\d{1,2}시(?:\s*\d{1,2}분)?)?/);
  return { source: 'naturing', source_id: match[1], url: `https://www.naturing.net/o/${match[1]}`, korean_name: korean, scientific_name: scientific, observed_raw: date?.[0] || '', place_raw: unavailable ? '' : place, altitude_raw: field('고도', ['날씨', '관찰시각']), weather_raw: field('날씨', ['관찰시각']), latitude, longitude, ...(manual ? {manual_capture:true, location_status:unavailable || 'public'} : {}), location_accuracy: 'unknown', review_status: 'pending', collected_at: new Date().toISOString() };
}

// 업데이트 이전에 확장 저장소에 보관한 자료에도 같은 제외 규칙을 적용합니다.
export function hasPrivateLocation(record) {
  return record.skip_reason === 'private_location' || /(?:게시자.*(?:요청|비공개)|(?:위치|위치정보).*(?:공개되지|비공개|숨겨|숨김))/.test((record.place_raw || '').replace(/\s+/g, ''));
}

// 예전 보관 자료도 위치 미입력·좌표 누락을 확인한 뒤 전송합니다.
export function hasExcludedLocation(record) {
  const place = (record.place_raw || '').replace(/[\s.]/g, '');
  return hasPrivateLocation(record) || record.skip_reason === 'missing_location' || !place
    || /(?:위치|정보).*(?:없습니다|없음|미입력|미등록|입력하지않|입력되지않)|^(?:미입력|미등록|없음)$/.test(place)
    || !Number.isFinite(record.latitude) || record.latitude < -90 || record.latitude > 90
    || !Number.isFinite(record.longitude) || record.longitude < -180 || record.longitude > 180;
}

