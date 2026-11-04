// 선택한 사진을 원본 요청으로 읽어 메타데이터를 만들며 원본을 수정하거나 저장하지 않습니다.
package org.butterflyarchive.photoprobe

import android.content.ContentResolver
import android.net.Uri
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import java.io.IOException
import java.security.MessageDigest

internal fun validCoordinates(values: DoubleArray?): Boolean = values != null && values.size == 2 &&
    values.all { it.isFinite() } && values[0] in -90.0..90.0 && values[1] in -180.0..180.0

internal fun validGpsRationals(raw: String?): Boolean {
    val parts = raw?.split(',') ?: return false
    if (parts.size != 3) return false
    val values = parts.map { part ->
        val fraction = part.trim().split('/')
        val numerator = fraction.firstOrNull()?.toDoubleOrNull() ?: return false
        val denominator = if (fraction.size == 1) 1.0 else if (fraction.size == 2) fraction[1].toDoubleOrNull() ?: return false else return false
        if (!denominator.isFinite() || denominator <= 0) return false
        numerator / denominator
    }
    return values.all { it.isFinite() && it >= 0 } && values[1] < 60 && values[2] < 60
}

internal class PhotoMetadataReader(private val resolver: ContentResolver) {
    fun read(uri: Uri, filename: String): PhotoMetadata {
        require(filename.length in 1..255 && filename.none { it=='/' || it=='\\' || it=='\u0000' }) { "사진 파일명을 확인해 주세요." }
        val target = MediaStore.setRequireOriginal(uri)
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        val signature = ArrayList<Byte>(8)
        resolver.openInputStream(target)?.use { input ->
            val chunk = ByteArray(65536)
            while (true) {
                if(Thread.currentThread().isInterrupted) throw IOException("사진 읽기가 중단되었습니다.")
                val count = input.read(chunk)
                if (count < 0) break
                size += count
                if (size > 32L * 1024 * 1024) throw IOException("파일 한 장은 32MB 이하여야 합니다.")
                for (i in 0 until minOf(count, 8 - signature.size)) signature.add(chunk[i])
                digest.update(chunk, 0, count)
            }
        } ?: throw IOException("사진을 열지 못했습니다.")
        val magic = signature.map { it.toInt() and 255 }
        val jpeg = magic.take(2) == listOf(255,216)
        val png = magic == listOf(137,80,78,71,13,10,26,10)
        if (!jpeg && !png) throw IOException("JPEG와 PNG만 지원합니다.")
        val exif = resolver.openInputStream(target)?.use { ExifInterface(it) }
            ?: throw IOException("EXIF를 읽지 못했습니다.")
        val latLong = exif.latLong
        val rawValid = validGpsRationals(exif.getAttribute(ExifInterface.TAG_GPS_LATITUDE)) &&
            validGpsRationals(exif.getAttribute(ExifInterface.TAG_GPS_LONGITUDE)) &&
            exif.getAttribute(ExifInterface.TAG_GPS_LATITUDE_REF) in listOf("N","S") &&
            exif.getAttribute(ExifInterface.TAG_GPS_LONGITUDE_REF) in listOf("E","W")
        val datum = exif.getAttribute(ExifInterface.TAG_GPS_MAP_DATUM).orEmpty()
        val valid=rawValid && validCoordinates(latLong) && (datum.isEmpty() || Regex("WGS[ -]?84",RegexOption.IGNORE_CASE).matches(datum))
        val notes=ArrayList<String>()
        if(!valid) notes.add("유효한 촬영 위치가 없습니다. PC에서 확인해 주세요.")
        val date=exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL).orEmpty()
        val offset=exif.getAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL).orEmpty()
        if(date.isEmpty()) notes.add("촬영 날짜가 없습니다. PC에서 확인해 주세요.")
        if(offset.isEmpty()) notes.add("촬영 시간대가 없습니다. 한국 시각인지 확인해 주세요.")
        val camera=exif.getAttribute(ExifInterface.TAG_MODEL).orEmpty()
        require(date.length<=100&&offset.length<=100&&datum.length<=100&&camera.length<=200) { "촬영 정보 길이가 서버 제한을 넘었습니다." }
        if(size==0L) throw IOException("빈 사진 파일입니다.")
        val bounds=android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds=true }
        resolver.openInputStream(target)?.use { android.graphics.BitmapFactory.decodeStream(it,null,bounds); Unit }
            ?: throw IOException("사진 크기 정보를 열지 못했습니다.")
        val rawOrientation=exif.getAttributeInt(ExifInterface.TAG_ORIENTATION,1)
        val orientation=if(rawOrientation==0) 1 else rawOrientation
        if(rawOrientation==0) notes.add("사진 회전 방향이 미지정 상태여서 표시용 기본 방향을 사용합니다.")
        require(orientation in 1..8 && bounds.outWidth in 1..60000 && bounds.outHeight in 1..60000) { "사진 크기와 회전 정보를 확인해 주세요." }
        return PhotoMetadata(digest.digest().joinToString("") { "%02x".format(it) },filename,size,if(jpeg) "JPEG" else "PNG",
            bounds.outWidth,bounds.outHeight,orientation,camera,date,offset,if(valid) latLong!![0] else null,if(valid) latLong!![1] else null,datum,notes)
    }
}
