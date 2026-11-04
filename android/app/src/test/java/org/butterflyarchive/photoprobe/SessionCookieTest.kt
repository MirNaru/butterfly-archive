// 기존 서버 쿠키의 보안 범위와 만료 조건을 확인합니다.
package org.butterflyarchive.photoprobe
import org.junit.Assert.*
import org.junit.Test

class SessionCookieTest {
    private val token="a".repeat(43)
    private val header="$SESSION_COOKIE=$token; HttpOnly; Max-Age=2592000; Path=/; SameSite=strict; Secure"
    @Test fun acceptsExistingServerCookie() {
        val session=sessionCookie(listOf(header),1000)
        assertEquals(token,session.token);assertEquals(2592001000L,session.expiresAt)
        assertTrue(session.valid(1000));assertFalse(session.valid(session.expiresAt))
    }
    @Test fun rejectsInsecureOrUnscopedCookies() {
        for(value in listOf(header.replace("; Secure",""),header.replace("; HttpOnly",""),
            header.replace("Path=/","Path=/m"),header+"; Domain=192.168.75.181",header.replace("SameSite=strict","SameSite=none"),
            header.replace("2592000","0"),header.replace("2592000","9999999"))) {
            assertThrows(IllegalArgumentException::class.java) {sessionCookie(listOf(value),1000)}
        }
    }
    @Test fun rejectsMissingOrAmbiguousSessionCookies() {
        assertThrows(java.io.IOException::class.java) {sessionCookie(emptyList(),1000)}
        assertThrows(java.io.IOException::class.java) {sessionCookie(listOf(header,header),1000)}
        assertFalse(SavedSession("bad;cookie",999999).valid(1000))
    }
}
