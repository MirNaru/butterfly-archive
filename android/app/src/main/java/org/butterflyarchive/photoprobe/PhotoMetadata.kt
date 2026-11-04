// 기존 수신 API와 일치하는 메타데이터만 JSON으로 변환합니다. URI·이미지는 전송하지 않습니다.
package org.butterflyarchive.photoprobe

import org.json.JSONArray
import org.json.JSONObject

internal data class PhotoMetadata(
    val sha256: String, val filename: String, val size: Long, val format: String,
    val width: Int, val height: Int, val orientation: Int, val camera: String,
    val takenAt: String, val offset: String, val latitude: Double?, val longitude: Double?,
    val datum: String, val warnings: List<String>
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("sha256",sha256); put("filename",filename); put("size_bytes",size); put("format",format)
        put("width",width); put("height",height); put("orientation",orientation); put("camera",camera)
        put("taken_at_raw",takenAt); put("offset_raw",offset)
        put("latitude",latitude ?: JSONObject.NULL); put("longitude",longitude ?: JSONObject.NULL)
        put("gps_datum",datum); put("warnings",JSONArray(warnings))
    }
    fun preview() = "촬영 ${takenAt.ifEmpty { "없음" }} · ${offset.ifEmpty { "시간대 확인 필요" }}\n" +
        (if(latitude==null) "유효한 GPS 없음" else "위도 $latitude / 경도 $longitude") +
        (if(warnings.isEmpty()) "" else "\n"+warnings.joinToString(" / "))
}
