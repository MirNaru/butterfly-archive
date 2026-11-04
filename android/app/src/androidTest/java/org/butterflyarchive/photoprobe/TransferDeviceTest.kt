// 합성 사진·시험 세션으로 Android JSON·EXIF·Keystore 동작을 검사합니다. 개인 사진·PC DB는 사용하지 않습니다.
package org.butterflyarchive.photoprobe

import android.content.Context
import android.Manifest
import android.app.Application
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.core.app.ActivityScenario
import androidx.lifecycle.ViewModelProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assume.assumeTrue
import java.io.File
import java.security.GeneralSecurityException
import java.security.KeyStore

@RunWith(AndroidJUnit4::class)
class TransferDeviceTest {
    private val context: Context get()=ApplicationProvider.getApplicationContext()
    @Test fun missingMediaLocationShowsGuidanceWithoutStartingRead() {
        assumeTrue(context.checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION)!=PackageManager.PERMISSION_GRANTED)
        val model=TransferModel(context.applicationContext as Application)
        model.queue.add(QueuePhoto(GalleryPhoto(Uri.parse("content://media/external/images/media/999999999"),"test.jpg")))
        model.readSelection()
        assertFalse(model.busy)
        assertTrue(model.message.contains("사진·촬영 위치 접근 허용"))
        assertEquals(PhotoState.SELECTED,model.queue.single().state)
    }
    @Test fun metadataJsonMatchesExistingContractAndKeepsNullCoordinates() {
        val metadata=PhotoMetadata("a".repeat(64),"test.jpg",123,"JPEG",10,20,1,"test","2026:01:01 12:00:00","+09:00",null,null,"",listOf("시험"))
        val json=metadata.toJson()
        assertEquals(setOf("sha256","filename","size_bytes","format","width","height","orientation","camera","taken_at_raw","offset_raw","latitude","longitude","gps_datum","warnings"),json.keys().asSequence().toSet())
        assertTrue(json.isNull("latitude"));assertTrue(json.isNull("longitude"))
        assertEquals(123,json.getLong("size_bytes"));assertEquals("2026:01:01 12:00:00",json.getString("taken_at_raw"))
    }
    @Test fun sessionIsEncryptedRoundTripsAndRejectsTampering() {
        val name="test-session-${System.nanoTime()}"
        val store=SessionStore(context,name)
        val file=File(context.noBackupFilesDir,"$name.enc")
        try {
            val session=SavedSession("b".repeat(43),System.currentTimeMillis()+60000)
            store.save(session);assertEquals(session,store.load())
            assertFalse(String(file.readBytes(),Charsets.ISO_8859_1).contains(session.token))
            val bytes=file.readBytes();bytes[bytes.lastIndex]=(bytes.last().toInt() xor 1).toByte();file.writeBytes(bytes)
            assertThrows(GeneralSecurityException::class.java) {store.load()}
            store.clear();assertNull(store.load())
        } finally {
            store.clear();KeyStore.getInstance("AndroidKeyStore").apply {load(null);deleteEntry(name)}
        }
    }
    @Test fun originalReaderKeepsSyntheticExifAndDoesNotInventMissingGps() {
        val file=File(context.cacheDir,"test-photo-${System.nanoTime()}.jpg")
        try {
            val bitmap=Bitmap.createBitmap(16,12,Bitmap.Config.ARGB_8888)
            file.outputStream().use {bitmap.compress(Bitmap.CompressFormat.JPEG,90,it)};bitmap.recycle()
            ExifInterface(file).apply {
                setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL,"2026:01:02 03:04:05")
                setAttribute(ExifInterface.TAG_OFFSET_TIME_ORIGINAL,"+09:00");saveAttributes()
            }
            val reader=PhotoMetadataReader(context.contentResolver)
            val firstBytes=file.readBytes()
            val first=reader.read(Uri.fromFile(file),"test.jpg")
            assertArrayEquals(firstBytes,file.readBytes())
            assertEquals("2026:01:02 03:04:05",first.takenAt);assertEquals("+09:00",first.offset)
            assertNull(first.latitude);assertNull(first.longitude);assertEquals(16,first.width);assertEquals(12,first.height)
            ExifInterface(file).apply {setLatLong(37.25,127.5);saveAttributes()}
            val secondBytes=file.readBytes()
            val second=reader.read(Uri.fromFile(file),"test.jpg")
            assertEquals(37.25,second.latitude!!,0.000001);assertEquals(127.5,second.longitude!!,0.000001)
            assertNotEquals(first.sha256,second.sha256)
            assertArrayEquals(secondBytes,file.readBytes())
        } finally {file.delete()}
    }
    @Test fun selectedListSurvivesActivityRecreation() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val model=ViewModelProvider(activity)[TransferModel::class.java]
                model.select(GalleryPhoto(Uri.parse("content://media/external/images/media/999999999"),"test.jpg"),true)
                assertEquals(1,model.queue.size)
            }
            scenario.recreate()
            scenario.onActivity { activity ->
                assertEquals(1,ViewModelProvider(activity)[TransferModel::class.java].queue.size)
            }
        }
    }
}
