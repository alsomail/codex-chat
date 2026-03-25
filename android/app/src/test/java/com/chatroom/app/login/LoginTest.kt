package test.app.login

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.ConcurrentHashMap
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows

class LoginTest {
    private lateinit var now: MutableClock
    private lateinit var otpVerifier: FakeOtpVerifier
    private lateinit var walletRepository: InMemoryWalletRepository
    private lateinit var sessionRepository: InMemorySessionRepository
    private lateinit var webrtcProbe: FakeWebRtcProbe
    private lateinit var jwtSigner: FakeJwtSigner
    private lateinit var loginService: LoginService

    @BeforeEach
    fun setUp() {
        now = MutableClock.parse("2026-03-23T01:00:00Z")
        otpVerifier = FakeOtpVerifier()
        walletRepository = InMemoryWalletRepository()
        sessionRepository = InMemorySessionRepository()
        webrtcProbe = FakeWebRtcProbe()
        jwtSigner = FakeJwtSigner()
        loginService = LoginService(
            otpVerifier = otpVerifier,
            walletRepository = walletRepository,
            sessionRepository = sessionRepository,
            webrtcProbe = webrtcProbe,
            jwtSigner = jwtSigner,
            clock = now,
        )
    }

    @Test
    fun `first login creates wallet and includes required jwt claims`() {
        otpVerifier.allowOtp("18800001111", "123456")
        webrtcProbe.setStatus("device-a", WebRtcStatus.SUPPORTED)

        val result = loginService.login(
            LoginCommand(
                uid = "u-100",
                phone = "18800001111",
                otp = "123456",
                deviceId = "device-a",
                country = "AE",
            ),
        )

        assertEquals("u-100", result.uid)
        assertTrue(result.walletCreated)
        assertEquals(0L, result.wallet.walletGold)
        assertEquals(0L, result.wallet.walletBonusGold)
        assertEquals(0, result.wallet.vipLevel)
        assertEquals("LOW", result.wallet.riskLevel)
        assertTrue(result.jwt.contains("uid=u-100"))
        assertTrue(result.jwt.contains("device_id=device-a"))
        assertTrue(result.jwt.contains("country=AE"))
        assertFalse(result.degradedAudioMode)
    }

    @Test
    fun `repeat login keeps one wallet record`() {
        otpVerifier.allowOtp("18800001111", "123456")
        webrtcProbe.setStatus("device-a", WebRtcStatus.SUPPORTED)

        loginService.login(
            LoginCommand("u-100", "18800001111", "123456", "device-a", "AE"),
        )
        val second = loginService.login(
            LoginCommand("u-100", "18800001111", "123456", "device-a", "AE"),
        )

        assertFalse(second.walletCreated)
        assertEquals(1, walletRepository.count())
    }

    @Test
    fun `invalid otp is rejected`() {
        otpVerifier.allowOtp("18800001111", "123456")

        assertThrows<AuthException.InvalidOtp> {
            loginService.login(
                LoginCommand("u-100", "18800001111", "654321", "device-a", "AE"),
            )
        }
    }

    @Test
    fun `otp retry over limit is blocked`() {
        otpVerifier.allowOtp("18800001111", "123456")

        repeat(5) {
            runCatching {
                loginService.login(
                    LoginCommand(
                        uid = "u-100",
                        phone = "18800001111",
                        otp = "999999",
                        deviceId = "device-a",
                        country = "AE",
                    ),
                )
            }
        }

        val ex = assertThrows<AuthException.TooManyAttempts> {
            loginService.login(
                LoginCommand("u-100", "18800001111", "123456", "device-a", "AE"),
            )
        }
        assertEquals("18800001111", ex.phone)
    }

    @Test
    fun `webrtc unsupported sets degraded mode but does not block login`() {
        otpVerifier.allowOtp("18800001111", "123456")
        webrtcProbe.setStatus("device-a", WebRtcStatus.UNSUPPORTED)

        val result = loginService.login(
            LoginCommand("u-100", "18800001111", "123456", "device-a", "AE"),
        )

        assertTrue(result.degradedAudioMode)
        assertEquals("WEBRTC_UNSUPPORTED", result.reconnectHint)
    }

    @Test
    fun `reconnect succeeds within 30 seconds for same user and device`() {
        otpVerifier.allowOtp("18800001111", "123456")
        webrtcProbe.setStatus("device-a", WebRtcStatus.SUPPORTED)
        val login = loginService.login(
            LoginCommand("u-100", "18800001111", "123456", "device-a", "AE"),
        )

        now.plusSeconds(25)
        val restored = loginService.reconnect(
            ReconnectCommand(
                uid = "u-100",
                deviceId = "device-a",
                previousSessionId = login.sessionId,
            ),
        )

        assertTrue(restored)
    }

    @Test
    fun `reconnect fails after 30 seconds timeout`() {
        otpVerifier.allowOtp("18800001111", "123456")
        webrtcProbe.setStatus("device-a", WebRtcStatus.SUPPORTED)
        val login = loginService.login(
            LoginCommand("u-100", "18800001111", "123456", "device-a", "AE"),
        )

        now.plusSeconds(31)
        val restored = loginService.reconnect(
            ReconnectCommand(
                uid = "u-100",
                deviceId = "device-a",
                previousSessionId = login.sessionId,
            ),
        )

        assertFalse(restored)
    }

    @Test
    fun `reconnect fails when device id changes`() {
        otpVerifier.allowOtp("18800001111", "123456")
        webrtcProbe.setStatus("device-a", WebRtcStatus.SUPPORTED)
        val login = loginService.login(
            LoginCommand("u-100", "18800001111", "123456", "device-a", "AE"),
        )

        val restored = loginService.reconnect(
            ReconnectCommand(
                uid = "u-100",
                deviceId = "device-b",
                previousSessionId = login.sessionId,
            ),
        )

        assertFalse(restored)
    }
}

private data class LoginCommand(
    val uid: String,
    val phone: String,
    val otp: String,
    val deviceId: String,
    val country: String,
)

private data class Wallet(
    val walletGold: Long,
    val walletBonusGold: Long,
    val vipLevel: Int,
    val riskLevel: String,
)

private data class LoginResult(
    val uid: String,
    val jwt: String,
    val wallet: Wallet,
    val walletCreated: Boolean,
    val degradedAudioMode: Boolean,
    val reconnectHint: String?,
    val sessionId: String,
)

private data class Session(
    val id: String,
    val uid: String,
    val deviceId: String,
    val loginAt: Instant,
)

private data class ReconnectCommand(
    val uid: String,
    val deviceId: String,
    val previousSessionId: String,
)

private enum class WebRtcStatus {
    SUPPORTED,
    UNSUPPORTED,
}

private sealed class AuthException(message: String) : RuntimeException(message) {
    data class InvalidOtp(val phone: String) : AuthException("Invalid otp for $phone")
    data class TooManyAttempts(val phone: String) : AuthException("Too many attempts for $phone")
}

private class LoginService(
    private val otpVerifier: OtpVerifier,
    private val walletRepository: WalletRepository,
    private val sessionRepository: SessionRepository,
    private val webrtcProbe: WebRtcProbe,
    private val jwtSigner: JwtSigner,
    private val clock: Clock,
) {
    private val failedAttempts = ConcurrentHashMap<String, Int>()
    private val maxAttempts = 5
    private val reconnectWindow = Duration.ofSeconds(30)
    private var sessionSequence = 0

    fun login(command: LoginCommand): LoginResult {
        val attemptCount = failedAttempts.getOrDefault(command.phone, 0)
        if (attemptCount >= maxAttempts) {
            throw AuthException.TooManyAttempts(command.phone)
        }

        if (!otpVerifier.verify(command.phone, command.otp)) {
            failedAttempts[command.phone] = attemptCount + 1
            throw AuthException.InvalidOtp(command.phone)
        }
        failedAttempts.remove(command.phone)

        val walletCreated = walletRepository.createIfAbsent(command.uid)
        val wallet = walletRepository.get(command.uid)
        val jwt = jwtSigner.sign(
            mapOf(
                "uid" to command.uid,
                "device_id" to command.deviceId,
                "country" to command.country,
            ),
        )

        val sessionId = "s-${++sessionSequence}"
        sessionRepository.save(
            Session(
                id = sessionId,
                uid = command.uid,
                deviceId = command.deviceId,
                loginAt = Instant.now(clock),
            ),
        )

        val webrtcStatus = webrtcProbe.probe(command.deviceId)
        return LoginResult(
            uid = command.uid,
            jwt = jwt,
            wallet = wallet,
            walletCreated = walletCreated,
            degradedAudioMode = webrtcStatus == WebRtcStatus.UNSUPPORTED,
            reconnectHint = if (webrtcStatus == WebRtcStatus.UNSUPPORTED) "WEBRTC_UNSUPPORTED" else null,
            sessionId = sessionId,
        )
    }

    fun reconnect(command: ReconnectCommand): Boolean {
        val session = sessionRepository.get(command.previousSessionId) ?: return false
        if (session.uid != command.uid || session.deviceId != command.deviceId) {
            return false
        }

        val elapsed = Duration.between(session.loginAt, Instant.now(clock))
        return elapsed <= reconnectWindow
    }
}

private interface OtpVerifier {
    fun verify(phone: String, otp: String): Boolean
}

private class FakeOtpVerifier : OtpVerifier {
    private val valid = ConcurrentHashMap<String, String>()

    fun allowOtp(phone: String, otp: String) {
        valid[phone] = otp
    }

    override fun verify(phone: String, otp: String): Boolean {
        return valid[phone] == otp
    }
}

private interface WalletRepository {
    fun createIfAbsent(uid: String): Boolean
    fun get(uid: String): Wallet
}

private class InMemoryWalletRepository : WalletRepository {
    private val data = ConcurrentHashMap<String, Wallet>()

    override fun createIfAbsent(uid: String): Boolean {
        val inserted = data.putIfAbsent(
            uid,
            Wallet(
                walletGold = 0L,
                walletBonusGold = 0L,
                vipLevel = 0,
                riskLevel = "LOW",
            ),
        )
        return inserted == null
    }

    override fun get(uid: String): Wallet {
        return data.getValue(uid)
    }

    fun count(): Int {
        return data.size
    }
}

private interface SessionRepository {
    fun save(session: Session)
    fun get(sessionId: String): Session?
}

private class InMemorySessionRepository : SessionRepository {
    private val data = ConcurrentHashMap<String, Session>()

    override fun save(session: Session) {
        data[session.id] = session
    }

    override fun get(sessionId: String): Session? {
        return data[sessionId]
    }
}

private interface WebRtcProbe {
    fun probe(deviceId: String): WebRtcStatus
}

private class FakeWebRtcProbe : WebRtcProbe {
    private val statuses = ConcurrentHashMap<String, WebRtcStatus>()

    override fun probe(deviceId: String): WebRtcStatus {
        return statuses[deviceId] ?: WebRtcStatus.SUPPORTED
    }

    fun setStatus(deviceId: String, status: WebRtcStatus) {
        statuses[deviceId] = status
    }
}

private interface JwtSigner {
    fun sign(claims: Map<String, String>): String
}

private class FakeJwtSigner : JwtSigner {
    override fun sign(claims: Map<String, String>): String {
        return claims.entries.joinToString(prefix = "jwt:", separator = ";") { "${it.key}=${it.value}" }
    }
}

private class MutableClock private constructor(
    private var now: Instant,
) : Clock() {
    override fun getZone(): ZoneOffset {
        return ZoneOffset.UTC
    }

    override fun withZone(zone: java.time.ZoneId): Clock {
        return this
    }

    override fun instant(): Instant {
        return now
    }

    fun plusSeconds(seconds: Long) {
        now = now.plusSeconds(seconds)
    }

    companion object {
        fun parse(value: String): MutableClock {
            return MutableClock(Instant.parse(value))
        }
    }
}
