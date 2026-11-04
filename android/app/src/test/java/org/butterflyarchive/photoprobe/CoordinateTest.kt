// 누락·잘못된 좌표를 실제 위치로 사용하지 않는지 확인합니다.
package org.butterflyarchive.photoprobe
import org.junit.Assert.*
import org.junit.Test
class CoordinateTest {
    @Test fun acceptsValidCoordinatesIncludingZero() {
        assertTrue(validCoordinates(doubleArrayOf(0.0,0.0)))
        assertTrue(validCoordinates(doubleArrayOf(-90.0,180.0)))
    }
    @Test fun rejectsMissingAndInvalidCoordinates() {
        assertFalse(validCoordinates(null))
        assertFalse(validCoordinates(doubleArrayOf(37.0)))
        assertFalse(validCoordinates(doubleArrayOf(Double.NaN,127.0)))
        assertFalse(validCoordinates(doubleArrayOf(91.0,127.0)))
        assertFalse(validCoordinates(doubleArrayOf(37.0,181.0)))
    }
    @Test fun rejectsRedactedRationalsAndPreservesValidZero() {
        assertFalse(validGpsRationals("0/0,0/0,0/0"))
        assertFalse(validGpsRationals("37/1,60/1,0/1"))
        assertFalse(validGpsRationals("37/1,1/1"))
        assertFalse(validGpsRationals(null))
        assertTrue(validGpsRationals("0/1,0/1,0/1"))
        assertTrue(validGpsRationals("37/1,12/1,3456/100"))
    }
}
