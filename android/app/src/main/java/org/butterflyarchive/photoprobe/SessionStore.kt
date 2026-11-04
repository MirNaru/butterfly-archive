// 세션 쿠키만 Android Keystore AES-GCM으로 암호화해 백업 제외 영역에 저장합니다.
package org.butterflyarchive.photoprobe

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class SavedSession(val token: String, val expiresAt: Long) {
    fun valid(now: Long=System.currentTimeMillis()) = expiresAt > now && token.matches(Regex("[A-Za-z0-9_-]{20,128}"))
}

internal class SessionStore(context: Context, private val name: String="mobile-session") {
    private val file=AtomicFile(File(context.noBackupFilesDir,"$name.enc"))
    private fun key(): SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(name,null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(name,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun save(session: SavedSession) {
        require(session.valid())
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE,key()) }
        val plain=JSONObject().put("token",session.token).put("expires",session.expiresAt).toString().toByteArray(Charsets.UTF_8)
        val encrypted=cipher.doFinal(plain)
        val output=file.startWrite()
        try { output.write(cipher.iv); output.write(encrypted); file.finishWrite(output) }
        catch(e: IOException) { file.failWrite(output); throw e }
    }
    fun load(): SavedSession? {
        if(!file.baseFile.exists()) return null
        val bytes=file.readFully()
        if(bytes.size !in 29..4096) throw IOException("연결 정보 형식 오류")
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12))) }
        val json=JSONObject(String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)),Charsets.UTF_8))
        val session=SavedSession(json.getString("token"),json.getLong("expires"))
        return if(session.valid()) session else { clear(); null }
    }
    fun clear() { file.delete() }
}
