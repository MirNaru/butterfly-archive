// 명시적으로 요청한 경우에만 실제 집 안 HTTPS의 인증 거부 응답을 확인합니다. 자료는 전송하지 않습니다.
package org.butterflyarchive.photoprobe

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LanConnectionDeviceTest {
    @Test fun internalHttpsIsTrustedAndUnauthenticatedSessionIsRejected() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("verifyLan")=="1")
        val context=ApplicationProvider.getApplicationContext<Context>()
        val sessions=SessionStore(context,"test-empty-session")
        val error=assertThrows(ApiFailure::class.java) { MobileApiClient(context,sessions).request("session") }
        assertEquals(401,error.status)
    }
}
