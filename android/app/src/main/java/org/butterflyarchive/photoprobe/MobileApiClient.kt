// 고정 집 안 HTTPS 주소에 Wi-Fi로 연결하며 쿠키·Origin·요청 크기를 기존 API에 맞춥니다.
package org.butterflyarchive.photoprobe

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import org.json.JSONObject
import java.io.IOException
import java.net.HttpCookie
import java.net.URL
import javax.net.ssl.HttpsURLConnection

internal const val LAN_ORIGIN="https://192.168.75.181:8443"
internal const val SESSION_COOKIE="__Host-butterfly-mobile"
internal class ApiFailure(val status: Int, message: String): IOException(message)

internal fun sessionCookie(headers: List<String>, now: Long=System.currentTimeMillis()): SavedSession {
    val cookie=headers.flatMap { HttpCookie.parse(it) }.singleOrNull { it.name==SESSION_COOKIE }
        ?: throw IOException("연결 응답에 세션 정보가 없습니다.")
    require(cookie.secure && cookie.isHttpOnly && cookie.path=="/" && cookie.domain==null && cookie.maxAge in 1..2592000)
    require(headers.any { it.startsWith("$SESSION_COOKIE=")&&Regex("(?:^|;)\\s*SameSite=Strict(?:;|$)",RegexOption.IGNORE_CASE).containsMatchIn(it) })
    return SavedSession(cookie.value,now+cookie.maxAge*1000).also { require(it.valid(now)) }
}

internal class MobileApiClient(context: Context, private val sessions: SessionStore) {
    private val connectivity=context.getSystemService(ConnectivityManager::class.java)
    @Volatile private var activeConnection: HttpsURLConnection?=null
    fun cancelCurrent() { activeConnection?.disconnect() }
    fun request(route: String, body: JSONObject?=null, login: Boolean=false, image: ByteArray?=null, png: Boolean=false): JSONObject {
        require(route in setOf("login","session","logout","photos","photos/original"))
        require((route=="photos/original")==(image!=null))
        require((route=="login")==login)
        if(connectivity.activeNetwork?.let { connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) }==true)
            throw IOException("VPN 연결을 사용 중입니다. 집 안 Wi-Fi 연결 상태를 확인해 주세요.")
        val network=connectivity.allNetworks.firstOrNull { network ->
            connectivity.getNetworkCapabilities(network)?.let { it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)&&!it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) }==true
        } ?: throw IOException("집 안 Wi-Fi에 연결해 주세요.")
        val session=if(login) null else sessions.load()
        if(!login && session==null && route!="session") throw ApiFailure(401,"PC에서 연결 코드를 발급해 연결해 주세요.")
        val payload=image ?: body?.toString()?.toByteArray(Charsets.UTF_8)
        if(image==null&&payload!=null&&payload.size>32768) throw IOException("사진 정보가 전송 크기 제한을 넘었습니다.")
        val suffix=if(image==null) "" else if(png) "?filename=shared.png" else "?filename=shared.jpg"
        val connection=network.openConnection(URL("$LAN_ORIGIN/m/api/$route$suffix")) as HttpsURLConnection
        activeConnection=connection
        try {
            connection.instanceFollowRedirects=false
            connection.connectTimeout=10000;connection.readTimeout=20000
            connection.useCaches=false
            connection.requestMethod=if(payload==null) "GET" else "POST"
            session?.let { connection.setRequestProperty("Cookie","$SESSION_COOKIE=${it.token}") }
            if(payload!=null) {
                connection.doOutput=true
                connection.setRequestProperty("Content-Type",if(image==null) "application/json" else "application/octet-stream")
                connection.setRequestProperty("Origin",LAN_ORIGIN)
                connection.setRequestProperty("X-Butterfly-Mobile","1")
                connection.setFixedLengthStreamingMode(payload.size)
                connection.outputStream.use { it.write(payload) }
            }
            val status=connection.responseCode
            if(status==401) sessions.clear()
            if(status in 300..399) throw IOException("서버 주소가 변경되었습니다. PC의 집 안 전송 설정을 확인해 주세요.")
            val stream=if(status in 200..299) connection.inputStream else connection.errorStream
            val bytes=stream?.use { it.readNBytes(65537) } ?: ByteArray(0)
            if(bytes.size>65536) throw IOException("서버 응답이 너무 큽니다.")
            val json=try { JSONObject(String(bytes,Charsets.UTF_8)) } catch(e: org.json.JSONException) { throw IOException("서버 응답 형식을 확인해 주세요.",e) }
            if(status !in 200..299) throw ApiFailure(status,json.opt("detail").let { if(it is String) it.take(200) else "요청을 처리하지 못했습니다. ($status)" })
            if(login) {
                val cookies=connection.headerFields.filterKeys { it?.equals("Set-Cookie",true)==true }.values.flatten()
                sessions.save(sessionCookie(cookies))
            }
            if(route=="logout") sessions.clear()
            return json
        } finally { connection.disconnect(); activeConnection=null }
    }
}
