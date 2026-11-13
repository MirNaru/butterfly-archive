// 선택·전송 상태를 메모리에 유지하고 작업을 순차 처리합니다. 사진 정보는 디스크에 저장하지 않습니다.
package org.butterflyarchive.photoprobe

import android.app.Application
import android.Manifest
import android.content.pm.PackageManager
import android.content.ContentResolver
import android.content.ContentUris
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.MediaStore
import android.util.LruCache
import android.util.Size
import androidx.lifecycle.AndroidViewModel
import org.json.JSONObject
import java.io.IOException
import java.security.GeneralSecurityException
import java.util.concurrent.Executors

internal const val PAGE_SIZE=12
internal const val MAX_SELECTION=500
internal enum class PhotoState(val label: String) {
    SELECTED("정보 읽기 전"),READY("전송 대기"),READ_FAILED("읽기 실패"),
    SENDING("전송 중"),SENT("PC 대기함에 전송 완료"),DUPLICATE("PC에 이미 전송한 파일"),
    LOCAL_DUPLICATE("선택 목록에 같은 내용의 파일이 있음"),FAILED("전송 실패")
}
internal data class GalleryPhoto(val uri: Uri,val name: String)
internal data class QueuePhoto(val photo: GalleryPhoto,val metadata: PhotoMetadata?=null,val state: PhotoState=PhotoState.SELECTED,val error: String="")

internal class TransferModel(application: Application): AndroidViewModel(application) {
    private val resolver=application.contentResolver
    private val sessions=SessionStore(application)
    private val api=MobileApiClient(application,sessions)
    private val worker=Executors.newSingleThreadExecutor()
    private val main=Handler(Looper.getMainLooper())
    private val thumbnails=object: LruCache<String,Bitmap>(8*1024*1024) { override fun sizeOf(key: String,value: Bitmap)=value.byteCount }
    var listener: (() -> Unit)?=null
    var busy=false; private set
    var message="PC에서 연결 코드를 발급해 연결해 주세요."; private set
    var connectionLabel="미연결"; private set
    var connected=false; private set
    var gallery: List<GalleryPhoto> = emptyList(); private set
    val queue=ArrayList<QueuePhoto>()
    var galleryOffset=0; private set
    var hasNext=false; private set
    var queuePage=0; private set
    var queueMode=false; private set
    @Volatile private var cancelled=false
    @Volatile private var closed=false
    private var nextSendAt=0L
    private var sharedPending = emptyList<Uri>()
    var cooldownUntil=0L; private set
    fun thumbnail(uri: Uri): Bitmap?=thumbnails.get(uri.toString())
    private fun emit() { if(!closed) listener?.invoke() }
    private fun post(block: () -> Unit) { main.post { if(!closed){block();emit()} } }
    private fun update(uri: Uri, transform: (QueuePhoto) -> QueuePhoto) {
        val index=queue.indexOfFirst { it.photo.uri==uri }
        if(index>=0) queue[index]=transform(queue[index])
    }
    private fun errorText(error: Throwable): String = when(error) {
        is javax.net.ssl.SSLException -> "집 안 서버의 인증서를 확인하지 못했습니다. PC 설정을 확인해 주세요."
        is java.net.SocketTimeoutException -> "응답을 확인하지 못했습니다. 재시도하면 파일 해시로 중복을 확인합니다."
        is ApiFailure -> error.message.orEmpty()
        is GeneralSecurityException -> "저장된 연결 정보를 읽거나 암호화하지 못했습니다. 연결 정보를 지우고 다시 연결해 주세요."
        is SecurityException -> "사진 또는 네트워크 접근 권한을 확인해 주세요."
        is UnsupportedOperationException -> "사진 원본을 제공받지 못했습니다. 사진 속 위치 정보 접근 권한과 파일 상태를 확인해 주세요."
        is org.json.JSONException -> "사진 정보 또는 서버 응답 형식을 확인해 주세요."
        is IllegalArgumentException -> error.message ?: "입력값을 확인해 주세요."
        else -> if(cancelled) "작업을 중단했습니다. 전송 실패 항목은 재시도해 주세요." else error.message ?: "집 안 Wi-Fi와 PC 서버 연결을 확인해 주세요."
    }
    private fun runJob(block: () -> Unit, done: (() -> Unit)?=null) {
        if(busy||closed) return
        busy=true;cancelled=false;emit()
        worker.execute {
            try { block() }
            catch(e: IOException) { post { message=errorText(e); if(e is ApiFailure&&e.status==401){connected=false;connectionLabel="재연결 필요"} } }
            catch(e: GeneralSecurityException) { post { connected=false;connectionLabel="재연결 필요";message=errorText(e) } }
            catch(e: SecurityException) { post { message=errorText(e) } }
            catch(e: UnsupportedOperationException) { post { message=errorText(e) } }
            catch(e: org.json.JSONException) { post { message=errorText(e) } }
            catch(e: IllegalArgumentException) { post { message=errorText(e) } }
            catch(e: InterruptedException) { cancelled=true;post { message="작업이 중단되었습니다." };Thread.currentThread().interrupt() }
            finally { post { busy=false;done?.invoke() } }
        }
    }
    fun login(code: String,label: String) {
        if(!code.matches(Regex("[A-Fa-f0-9]{12}"))||label.length !in 1..80){message="연결 코드 12자리와 기기 이름을 확인해 주세요.";emit();return}
        runJob({
            api.request("login",JSONObject().put("code",code.uppercase()).put("label",label),true)
            verifySession()
        })
    }
    private fun verifySession() {
        val result=api.request("session")
        val label=result.getString("label")
        post { connected=true;connectionLabel=label+" · PC 연결됨";message="집 안 PC에 연결했습니다. 전송할 사진을 선택해 주세요." }
    }
    fun checkConnection() { runJob({ verifySession() }) }
    fun sendShared(uris: List<Uri> = emptyList()) {
        if (uris.isNotEmpty()) {
            val incoming = uris.filter { it.scheme == ContentResolver.SCHEME_CONTENT }
            val combined = (sharedPending + incoming).distinct()
            if (combined.size > MAX_SELECTION || incoming.isEmpty()) {
                message = "공유할 사진을 최대 500장까지 선택해 주세요."
                emit()
                return
            }
            sharedPending = combined
        }
        if (busy || sharedPending.isEmpty()) return
        val pending = sharedPending
        runJob({
            verifySession()
            var completed = 0
            var failed = 0
            for (uri in pending) {
                if (cancelled) break
                try {
                    val delay = (nextSendAt - SystemClock.elapsedRealtime()).coerceAtLeast(0)
                    if (delay > 0) Thread.sleep(delay)
                    if (cancelled) break
                    nextSendAt = SystemClock.elapsedRealtime() + 700
                    val maxBytes = 32 * 1024 * 1024
                    val image = resolver.openInputStream(uri)?.use { it.readNBytes(maxBytes + 1) }
                        ?: throw IOException("공유 사진을 열지 못했습니다.")
                    if (image.size > maxBytes) throw IOException("사진 한 장은 32MB 이하여야 합니다.")
                    val png = image.size >= 4 && image[0] == 0x89.toByte() &&
                        image[1] == 0x50.toByte() && image[2] == 0x4e.toByte() && image[3] == 0x47.toByte()
                    val result = api.request("photos/original", image = image, png = png)
                    if (result.optString("status") !in setOf("received", "duplicate"))
                        throw IOException("서버의 저장 결과를 확인하지 못했습니다.")
                    completed++
                    post { sharedPending = sharedPending - uri }
                } catch (error: ApiFailure) {
                    if (error.status in setOf(401, 429) || error.status >= 500) throw error
                    failed++
                    post { message = errorText(error) }
                } catch (error: IOException) {
                    failed++
                    post { message = errorText(error) }
                }
            }
            post { message = "공유 사진 · 완료 또는 중복 ${completed}장 · 실패 ${failed}장 · 남은 ${sharedPending.size}장" }
        })
    }
    fun logout() { runJob({ api.request("logout",JSONObject()); post { connected=false;connectionLabel="미연결";message="로그아웃했습니다." } }) }
    fun forgetConnection() { runJob({ sessions.clear();post { connected=false;connectionLabel="미연결";message="이 기기의 연결 정보를 지웠습니다. PC 연결 관리에서 이전 세션도 해제할 수 있습니다." } }) }
    private fun loadThumbnail(photo: GalleryPhoto) {
        if(thumbnail(photo.uri)!=null) return
        try { thumbnails.put(photo.uri.toString(),resolver.loadThumbnail(photo.uri,Size(144,144),null)) }
        catch(e: IOException) { /* 미리보기 실패는 원본 정보 읽기와 별도로 처리합니다. */ }
        catch(e: SecurityException) { /* 사진 접근 해제 시 원본 읽기에서 오류를 표시합니다. */ }
    }
    fun browse(offset: Int=galleryOffset) {
        runJob({
            val rows=ArrayList<GalleryPhoto>()
            val args=Bundle().apply {
                putString(ContentResolver.QUERY_ARG_SQL_SELECTION,"${MediaStore.Images.Media.MIME_TYPE} IN (?, ?)")
                putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS,arrayOf("image/jpeg","image/png"))
                putStringArray(ContentResolver.QUERY_ARG_SORT_COLUMNS,arrayOf(MediaStore.Images.Media._ID))
                putInt(ContentResolver.QUERY_ARG_SORT_DIRECTION,ContentResolver.QUERY_SORT_DIRECTION_DESCENDING)
                putInt(ContentResolver.QUERY_ARG_LIMIT,PAGE_SIZE+1);putInt(ContentResolver.QUERY_ARG_OFFSET,offset.coerceAtLeast(0))
            }
            val cursor=resolver.query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,arrayOf(MediaStore.Images.Media._ID,MediaStore.Images.Media.DISPLAY_NAME),args,null)
                ?: throw IOException("사진 목록을 읽지 못했습니다.")
            cursor.use { while(it.moveToNext()&&rows.size<=PAGE_SIZE) rows.add(GalleryPhoto(ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,it.getLong(0)),it.getString(1) ?: "사진")) }
            for(photo in rows.take(PAGE_SIZE)){if(cancelled) break;loadThumbnail(photo)}
            post { gallery=rows.take(PAGE_SIZE);galleryOffset=offset.coerceAtLeast(0);hasNext=rows.size>PAGE_SIZE;queueMode=false;message=if(rows.isEmpty()) "표시할 JPEG·PNG가 없습니다. 사진 접근 권한을 확인해 주세요." else "사진을 체크한 뒤 선택 정보 읽기를 눌러 주세요." }
        })
    }
    fun select(photo: GalleryPhoto,selected: Boolean) {
        if(busy) return
        if(selected&&queue.none { it.photo.uri==photo.uri }){
            if(queue.size>=MAX_SELECTION){message="한 번에 최대 500장까지 선택해 주세요.";emit();return}
            queue.add(QueuePhoto(photo))
        } else if(!selected) queue.removeAll { it.photo.uri==photo.uri }
        emit()
    }
    fun explainPhotoPermission() {
        message="사진 또는 촬영 위치 접근이 허용되지 않았습니다. 사진·촬영 위치 접근 허용에서 사진을 선택해 주세요. 창이 열리지 않으면 사진 권한 설정 열기에서 권한 상태를 확인해 주세요."
        emit()
    }
    fun clearQueue() { if(!busy){queue.clear();queuePage=0;message="선택 목록을 비웠습니다. PC 자료와 휴대폰 사진은 유지됩니다.";emit()} }
    fun showQueue(page: Int=0) {
        val last=((queue.size-1).coerceAtLeast(0))/PAGE_SIZE
        queuePage=page.coerceIn(0,last);queueMode=true
        val photos=queue.drop(queuePage*PAGE_SIZE).take(PAGE_SIZE).map { it.photo }
        runJob({for(photo in photos){if(cancelled) break;loadThumbnail(photo)}})
    }
    fun readSelection() {
        if(getApplication<Application>().checkSelfPermission(Manifest.permission.ACCESS_MEDIA_LOCATION)!=PackageManager.PERMISSION_GRANTED){
            message="사진·촬영 위치 접근 허용을 먼저 눌러 주세요. 권한을 허용한 뒤 선택 정보 읽기를 다시 누르시면 됩니다.";emit();return
        }
        val selected=queue.toList()
        if(selected.isEmpty()) {message="먼저 사진을 선택해 주세요.";emit();return}
        runJob({
            val reader=PhotoMetadataReader(resolver)
            val seen=HashSet<String>()
            for((index,item) in selected.withIndex()){
                if(cancelled) break
                try {
                    val metadata=if(item.state in setOf(PhotoState.SENT,PhotoState.DUPLICATE)) item.metadata!! else reader.read(item.photo.uri,item.photo.name)
                    val state=if(!seen.add(metadata.sha256)) PhotoState.LOCAL_DUPLICATE else if(item.state in setOf(PhotoState.SENT,PhotoState.DUPLICATE)) item.state else PhotoState.READY
                    post { update(item.photo.uri) { it.copy(metadata=metadata,state=state,error="") };message="정보 읽는 중 ${index+1} / ${selected.size}" }
                } catch(e: IOException) { post { update(item.photo.uri) { it.copy(metadata=null,state=PhotoState.READ_FAILED,error=errorText(e)) } } }
                catch(e: SecurityException) { post { update(item.photo.uri) { it.copy(metadata=null,state=PhotoState.READ_FAILED,error=errorText(e)) } } }
                catch(e: UnsupportedOperationException) { post { update(item.photo.uri) { it.copy(metadata=null,state=PhotoState.READ_FAILED,error=errorText(e)) } } }
                catch(e: IllegalArgumentException) { post { update(item.photo.uri) { it.copy(metadata=null,state=PhotoState.READ_FAILED,error=errorText(e)) } } }
            }
            post { message=if(cancelled) "읽기를 중단했습니다. 남은 사진은 다시 읽어 주세요." else "촬영 날짜와 GPS를 확인한 뒤 전송 버튼을 눌러 주세요." }
        },{ if(listener!=null) showQueue(queuePage) else queueMode=true })
    }
    fun send(retry: Boolean) {
        if(SystemClock.elapsedRealtime()<cooldownUntil){message="요청 제한 대기 중입니다. 잠시 후 다시 시도해 주세요.";emit();return}
        val pending=queue.filter { it.metadata!=null&&it.state==if(retry) PhotoState.FAILED else PhotoState.READY }
        if(pending.isEmpty()) return
        runJob({
            verifySession()
            for((index,item) in pending.withIndex()){
                if(cancelled){markRemaining(pending.drop(index),"전송을 중단했습니다.");break}
                val delay=(nextSendAt-SystemClock.elapsedRealtime()).coerceAtLeast(0)
                if(delay>0) Thread.sleep(delay)
                if(cancelled){markRemaining(pending.drop(index),"전송을 중단했습니다.");break}
                nextSendAt=SystemClock.elapsedRealtime()+700
                post { update(item.photo.uri) { it.copy(state=PhotoState.SENDING,error="") };message="전송 중 ${index+1} / ${pending.size}" }
                try {
                    val result=api.request("photos",item.metadata!!.toJson())
                    val state=when(result.getString("status")){"received"->PhotoState.SENT;"duplicate"->PhotoState.DUPLICATE;else->throw IOException("서버의 저장 결과를 확인하지 못했습니다.")}
                    val note=when(result.optString("existing_status")){"discarded"->"PC에서 이전에 삭제한 대기 자료입니다.";"registered"->"이미 관찰 기록으로 등록된 자료입니다.";else->""}
                    post { update(item.photo.uri) { it.copy(state=state,error=note) } }
                } catch(e: IOException) {
                    post { update(item.photo.uri) { it.copy(state=PhotoState.FAILED,error=errorText(e)) } }
                    if(e is ApiFailure&&(e.status==401||e.status==429)) {
                        if(e.status==429) post { cooldownUntil=SystemClock.elapsedRealtime()+60000 }
                        if(e.status==401) post { connected=false;connectionLabel="재연결 필요" }
                        markRemaining(pending.drop(index+1),errorText(e));break
                    }
                    if(e !is ApiFailure){markRemaining(pending.drop(index+1),"연결을 확인한 뒤 재시도해 주세요.");break}
                }
            }
            post { message="전송 처리가 끝났습니다. 완료·중복·실패 상태와 PC 대기함을 확인해 주세요." }
        },{ for(index in queue.indices) if(queue[index].state==PhotoState.SENDING) queue[index]=queue[index].copy(state=PhotoState.FAILED,error="저장 결과를 확인하지 못했습니다. 재시도하면 중복을 확인합니다.") })
    }
    private fun markRemaining(items: List<QueuePhoto>,message: String) { post { for(item in items) update(item.photo.uri) { it.copy(state=PhotoState.FAILED,error=message) } } }
    fun cancel() { cancelled=true;api.cancelCurrent() }
    override fun onCleared() { closed=true;listener=null;cancel();worker.shutdownNow();thumbnails.evictAll();super.onCleared() }
}
