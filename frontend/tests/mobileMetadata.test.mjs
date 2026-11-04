// 휴대폰 파서가 실제 EXIF를 읽고 손상·미입력·미지원 형식을 구분하는지 검사합니다.
import {readFile} from 'node:fs/promises'
import {test} from 'node:test'
import assert from 'node:assert/strict'
const source=await readFile(new URL('../../backend/app/mobile_web/metadata.js',import.meta.url),'utf8')
const {parseMetadata,inspectPhoto}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
function fixture(){
  const t=Buffer.alloc(180)
  t.write('II');t.writeUInt16LE(42,2);t.writeUInt32LE(8,4);t.writeUInt16LE(2,8)
  // IFD0: camera, Exif pointer
  t.writeUInt16LE(272,10);t.writeUInt16LE(2,12);t.writeUInt32LE(6,14);t.writeUInt32LE(100,18)
  t.writeUInt16LE(34665,22);t.writeUInt16LE(4,24);t.writeUInt32LE(1,26);t.writeUInt32LE(40,30)
  t.writeUInt16LE(2,40)
  t.writeUInt16LE(36867,42);t.writeUInt16LE(2,44);t.writeUInt32LE(20,46);t.writeUInt32LE(110,50)
  t.writeUInt16LE(36881,54);t.writeUInt16LE(2,56);t.writeUInt32LE(7,58);t.writeUInt32LE(140,62)
  t.write('S23-U\0',100);t.write('2026:05:10 12:30:00\0',110);t.write('+09:00\0',140)
  const content=Buffer.concat([Buffer.from('Exif\0\0'),t]),length=Buffer.alloc(2);length.writeUInt16BE(content.length+2)
  return Buffer.concat([Buffer.from([255,216,255,225]),length,content,Buffer.from([255,217])])
}
function raw(bytes){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}
test('휴대폰 원문 촬영 시각과 시간대·기기명 추출',()=>{
  const result=parseMetadata(raw(fixture()))
  assert.equal(result.camera,'S23-U');assert.equal(result.taken_at_raw,'2026:05:10 12:30:00');assert.equal(result.offset_raw,'+09:00');assert.equal(result.latitude,null)
})
test('EXIF 없는 파일은 촬영 시각·좌표를 만들어 내지 않음',()=>{
  const result=parseMetadata(Uint8Array.from([255,216,255,217]).buffer)
  assert.equal(result.taken_at_raw,'');assert.equal(result.latitude,null)
})
test('손상된 EXIF는 경고하고 범위 밖을 읽지 않음',()=>{
  const bytes=fixture();bytes.writeUInt32LE(999999,18)
  const result=parseMetadata(raw(bytes));assert.ok(result.warnings.length)
})
test('GPS의 위도·경도 순서와 남·서 방향 및 0 분모 검증',()=>{
  const t=Buffer.alloc(180)
  t.write('II');t.writeUInt16LE(42,2);t.writeUInt32LE(8,4);t.writeUInt16LE(1,8)
  t.writeUInt16LE(34853,10);t.writeUInt16LE(4,12);t.writeUInt32LE(1,14);t.writeUInt32LE(40,18)
  t.writeUInt16LE(4,40)
  for(let i=0;i<4;i++){
    const at=42+i*12,tag=i+1;t.writeUInt16LE(tag,at)
    if(tag===1||tag===3){t.writeUInt16LE(2,at+2);t.writeUInt32LE(2,at+4);t.write(tag===1?'S\0':'W\0',at+8)}
    else {t.writeUInt16LE(5,at+2);t.writeUInt32LE(3,at+4);t.writeUInt32LE(tag===2?100:124,at+8)}
  }
  for(const [start,parts] of [[100,[37,6,0]],[124,[127,12,0]]])for(let i=0;i<3;i++){t.writeUInt32LE(parts[i],start+i*8);t.writeUInt32LE(1,start+i*8+4)}
  const jpeg=()=>{const data=Buffer.concat([Buffer.from('Exif\0\0'),t]),len=Buffer.alloc(2);len.writeUInt16BE(data.length+2);return raw(Buffer.concat([Buffer.from([255,216,255,225]),len,data,Buffer.from([255,217])]))}
  const result=parseMetadata(jpeg());assert.equal(result.latitude,-37.1);assert.equal(result.longitude,-127.2)
  t.writeUInt32LE(0,104)
  const invalid=parseMetadata(jpeg());assert.equal(invalid.latitude,null);assert.equal(invalid.longitude,null);assert.ok(invalid.warnings.length)
})
test('미지원 HEIC와 파일 크기 제한·파일 해시',async()=>{
  assert.throws(()=>parseMetadata(Uint8Array.from([0,0,0,0]).buffer),/JPEG/)
  await assert.rejects(inspectPhoto({name:'a.heic',size:100}),/JPEG/)
  await assert.rejects(inspectPhoto({name:'a.jpg',size:33*1024*1024}),/32MB/)
  const bytes=fixture(),file={name:'a.jpg',size:bytes.length,arrayBuffer:async()=>raw(bytes)}
  const first=await inspectPhoto(file),second=await inspectPhoto(file)
  assert.match(first.sha256,/^[a-f0-9]{64}$/);assert.equal(first.sha256,second.sha256)
})
