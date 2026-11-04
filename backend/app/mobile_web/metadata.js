// 선택한 파일의 EXIF만 읽습니다. 파일명·수정 시각·현재 위치로 촬영 정보를 추정하지 않습니다.
function tiff(bytes, diagnostic) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const valid = (offset, size) => { if (!Number.isSafeInteger(offset) || offset < 0 || offset + size > bytes.length) throw new Error('EXIF 범위를 확인해 주세요.') }
  valid(0, 8)
  const order = view.getUint16(0)
  if (order !== 0x4949 && order !== 0x4d4d) throw new Error('EXIF 바이트 순서를 확인해 주세요.')
  const little = order === 0x4949
  const u16 = n => { valid(n, 2); return view.getUint16(n, little) }
  const u32 = n => { valid(n, 4); return view.getUint32(n, little) }
  if (u16(2) !== 42) throw new Error('EXIF 형식을 확인해 주세요.')
  function directory(offset, isGps=false) {
    const total = u16(offset), result = new Map()
    if (total > 4096) throw new Error('EXIF 항목 수가 너무 많습니다.')
    valid(offset+2, total*12)
    for (let i=0;i<total;i++) {
      const at=offset+2+i*12, tag=u16(at), type=u16(at+2), count=u32(at+4)
      if(isGps)diagnostic.gps_tags.push(tag)
      const field=isGps&&[1,2,3,4].includes(tag)?{tag,type,count,in_bounds:null,zero_denominator:null,all_numerators_zero:null,direction_valid:null}:null
      if(field)diagnostic.gps_fields.push(field)
      const size=({1:1,2:1,3:2,4:4,5:8,7:1})[type]
      if (!size || count>65536) continue
      const n=size*count, start=n<=4 ? at+8 : u32(at+8)
      if(field)field.in_bounds=Number.isSafeInteger(start)&&start>=0&&start+n<=bytes.length
      valid(start,n)
      if (type===2) result.set(tag,new TextDecoder('ascii').decode(bytes.subarray(start,start+n)).replace(/\0.*$/s,'').trim())
      else if (type===3 && count===1) result.set(tag,u16(start))
      else if (type===4 && count===1) result.set(tag,u32(start))
      else if (type===5) {
        const values=[]
        if(field){field.zero_denominator=false;field.all_numerators_zero=count>0}
        for(let j=0;j<count;j++){
          const numerator=u32(start+j*8),divisor=u32(start+j*8+4)
          if(field){field.zero_denominator ||= divisor===0;field.all_numerators_zero &&= numerator===0}
          values.push(divisor?numerator/divisor:NaN)
        }
        result.set(tag,values)
      }
      if(field&&(tag===1||tag===3))field.direction_valid=(tag===1?['N','S']:['E','W']).includes(result.get(tag))
    }
    return result
  }
  const root=directory(u32(4))
  diagnostic.gps_pointer=root.has(34853)
  const details=root.has(34665)?directory(root.get(34665)):new Map(), gps=root.has(34853)?directory(root.get(34853),true):new Map()
  for(const [tag,ref,limit] of [[2,1,90],[4,3,180]]){
    const parts=gps.get(tag)
    diagnostic.gps_checks.push({tag,parts_valid:Array.isArray(parts)&&parts.length===3&&parts.every(n=>Number.isFinite(n)&&n>=0),
      minutes_seconds_valid:Array.isArray(parts)&&parts.length===3&&parts[1]>=0&&parts[1]<60&&parts[2]>=0&&parts[2]<60,
      range_valid:Array.isArray(parts)&&parts.length===3&&parts.every(Number.isFinite)&&parts[0]+parts[1]/60+parts[2]/3600<=limit,
      direction_valid:(ref===1?['N','S']:['E','W']).includes(gps.get(ref))})
  }
  const result={orientation:root.get(274)||1,camera:root.get(272)||'',taken_at_raw:details.get(36867)||'',offset_raw:details.get(36881)||'',gps_datum:gps.get(18)||'',latitude:null,longitude:null,warnings:[]}
  if(gps.size) {
    function degree(tag,ref,positive,negative,limit){
      const parts=gps.get(tag), direction=gps.get(ref)
      if(!Array.isArray(parts)||parts.length!==3||!parts.every(n=>Number.isFinite(n)&&n>=0)||parts[1]>=60||parts[2]>=60||![positive,negative].includes(direction))throw new Error('GPS 형식을 확인해 주세요.')
      const value=parts[0]+parts[1]/60+parts[2]/3600
      if(value>limit)throw new Error('GPS 범위를 확인해 주세요.')
      return value*(direction===negative?-1:1)
    }
    try {
      if(result.gps_datum && !/^WGS[ -]?84$/i.test(result.gps_datum))throw new Error('GPS 좌표계가 WGS84인지 확인해 주세요.')
      const lat=degree(2,1,'N','S',90),lng=degree(4,3,'E','W',180)
      result.latitude=lat;result.longitude=lng
    }catch(error){result.warnings.push('선택된 파일의 GPS 항목을 읽지 못했습니다. '+error.message+' 원본 파일에서 같은 사진을 다시 선택해 비교해 주세요.')}
  }
  return result
}

export function parseMetadata(buffer, diagnostic={}) {
  Object.assign(diagnostic,{exif_blocks:0,gps_pointer:false,gps_tags:[],gps_fields:[],gps_checks:[],errors:[]})
  const bytes=new Uint8Array(buffer),view=new DataView(buffer)
  const empty={orientation:1,camera:'',taken_at_raw:'',offset_raw:'',latitude:null,longitude:null,gps_datum:'',warnings:[]}
  let format, metadata=empty, width=0, height=0
  if(bytes[0]===0xff&&bytes[1]===0xd8)format='JPEG'
  else if(bytes.length>=8&&bytes.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]))format='PNG'
  else throw new Error('JPEG·PNG 원본 파일을 선택해 주세요. HEIC·동영상은 아직 지원하지 않습니다.')
  try {
    if(format==='JPEG') {
      for(let at=2;at+4<=bytes.length;) {
        if(bytes[at]!==255)break
        let code=at+1;while(bytes[code]===255)code++
        const marker=bytes[code];at=code+1
        if(marker===0xda||marker===0xd9)break
        if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue
        if(at+2>bytes.length)throw new Error('JPEG 파일이 잘렸습니다.')
        const length=view.getUint16(at)
        if(length<2||at+length>bytes.length)throw new Error('JPEG EXIF 범위를 확인해 주세요.')
        if(marker===0xe1&&length>=8&&String.fromCharCode(...bytes.slice(at+2,at+8))==='Exif\0\0'){diagnostic.exif_blocks++;metadata=tiff(bytes.subarray(at+8,at+length),diagnostic)}
        if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=7){height=view.getUint16(at+3);width=view.getUint16(at+5)}
        at+=length
      }
    }else {
      for(let at=8;at+12<=bytes.length;) {
        const length=view.getUint32(at),type=String.fromCharCode(...bytes.slice(at+4,at+8))
        if(length>bytes.length-at-12)throw new Error('PNG 파일이 잘렸습니다.')
        if(type==='eXIf'){diagnostic.exif_blocks++;metadata=tiff(bytes.subarray(at+8,at+8+length),diagnostic)}
        if(type==='IHDR'&&length>=8){width=view.getUint32(at+8);height=view.getUint32(at+12)}
        at+=length+12
      }
    }
  }catch(error){diagnostic.errors.push(error.message);metadata.warnings.push(error.message)}
  if(metadata.latitude===null&&diagnostic.gps_tags.length)diagnostic.errors.push(...metadata.warnings)
  if(metadata.latitude===null&&!metadata.warnings.length)metadata.warnings.push('선택된 파일에 촬영 GPS 정보가 없습니다. 갤러리에 위치가 보인다면 원본 파일 선택으로 비교해 주세요.')
  return {format,width,height,...metadata}
}

export async function inspectPhoto(file, diagnostic={}) {
  if(!file.size||file.size>32*1024*1024)throw new Error('사진 한 장은 32MB 이하여야 합니다.')
  if(!/\.(jpe?g|png)$/i.test(file.name))throw new Error('JPEG·PNG 파일을 선택해 주세요. HEIC·동영상은 아직 지원하지 않습니다.')
  const buffer=await file.arrayBuffer(),metadata=parseMetadata(buffer,diagnostic)
  const hash=await crypto.subtle.digest('SHA-256',buffer)
  return {...metadata,sha256:Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join(''),filename:file.name,size_bytes:file.size}
}
