package com.chatroom.app.login

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description

@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    @Test
    fun `invalid phone shows validation error`() = runTest {
        val viewModel = buildViewModel()
        viewModel.onPhoneChanged("123")
        viewModel.onOtpChanged("123456")

        viewModel.onLoginClicked()

        assertEquals(
            "Please enter a valid E.164 phone number.",
            viewModel.uiState.value.errorMessage,
        )
    }

    @Test
    fun `invalid otp length shows validation error`() = runTest {
        val viewModel = buildViewModel()
        viewModel.onPhoneChanged("+971500000101")
        viewModel.onOtpChanged("123")

        viewModel.onLoginClicked()

        assertEquals("OTP should be 6 digits.", viewModel.uiState.value.errorMessage)
    }

    @Test
    fun `login success enters room preview state`() = runTest {
        val fakeAuth = FakeAuthRepository()
        val fakeRooms = FakeRoomRepository()
        val viewModel = buildViewModel(authRepository = fakeAuth, roomRepository = fakeRooms)
        viewModel.onPhoneChanged("+971500000102")
        viewModel.onOtpChanged("123456")

        viewModel.onLoginClicked()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.isLoginSuccess)
        assertEquals(2, viewModel.uiState.value.rooms.size)
        assertEquals("room-001", viewModel.uiState.value.rooms.first().roomId)
    }

    @Test
    fun `login failure keeps user on login screen`() = runTest {
        val fakeAuth = FakeAuthRepository(shouldFailLogin = true)
        val viewModel = buildViewModel(authRepository = fakeAuth)
        viewModel.onPhoneChanged("+971500000103")
        viewModel.onOtpChanged("123456")

        viewModel.onLoginClicked()
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.isLoginSuccess)
        assertEquals("OTP is invalid or expired.", viewModel.uiState.value.errorMessage)
    }

    @Test
    fun `refresh session rotates token and reloads wallet summary`() = runTest {
        val fakeAuth = FakeAuthRepository(
            walletSummaries = listOf(
                WalletSummary(
                    walletGold = 1_000,
                    walletBonusGold = 10,
                    frozenGold = 0,
                    totalSpentGold = 200,
                    spent30dGold = 100,
                    riskLevel = "LOW",
                ),
                WalletSummary(
                    walletGold = 2_048,
                    walletBonusGold = 20,
                    frozenGold = 0,
                    totalSpentGold = 300,
                    spent30dGold = 150,
                    riskLevel = "LOW",
                ),
            ),
        )
        val realtime = FakeRealtimeGateway()
        val viewModel = buildViewModel(authRepository = fakeAuth, realtimeGateway = realtime)
        viewModel.onPhoneChanged("+971500000106")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onRefreshSessionClicked()
        advanceUntilIdle()

        assertEquals(1, fakeAuth.refreshCalls)
        assertEquals(2, realtime.connectCalls)
        assertEquals(1, realtime.disconnectCalls)
        assertEquals("sess-refresh-001", viewModel.uiState.value.sessionId)
        assertEquals(2_048L, viewModel.uiState.value.walletSummary?.walletGold)
    }

    @Test
    fun `refresh replay conflict surfaces AUTH_004 error`() = runTest {
        val fakeAuth = FakeAuthRepository(shouldFailRefresh = true)
        val viewModel = buildViewModel(authRepository = fakeAuth, realtimeGateway = FakeRealtimeGateway())
        viewModel.onPhoneChanged("+971500000107")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onRefreshSessionClicked()
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.errorMessage?.contains("AUTH_004") == true)
    }

    @Test
    fun `create room updates active room id`() = runTest {
        val fakeRooms = FakeRoomRepository()
        val realtime = FakeRealtimeGateway()
        val viewModel = buildViewModel(
            roomRepository = fakeRooms,
            realtimeGateway = realtime,
        )
        viewModel.onPhoneChanged("+971500000104")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onCreateRoomTopicChanged("Android Created Room")
        viewModel.onCreateRoomClicked()
        advanceUntilIdle()

        assertEquals("room-900", viewModel.uiState.value.activeRoomId)
        assertTrue(viewModel.uiState.value.rooms.any { it.roomId == "room-900" })
    }

    @Test
    fun `join room relays issued join token to realtime gateway`() = runTest {
        val fakeRooms = FakeRoomRepository()
        val realtime = FakeRealtimeGateway()
        val viewModel = buildViewModel(
            roomRepository = fakeRooms,
            realtimeGateway = realtime,
        )
        viewModel.onPhoneChanged("+971500000108")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onJoinRoomClicked("room-001")
        advanceUntilIdle()

        val joinCall = fakeRooms.lastJoinTokenCall
        assertNotNull(joinCall)
        assertEquals("room-001", joinCall?.roomId)
        assertEquals("device-test-001", joinCall?.deviceId)
        assertEquals("android_install_main", joinCall?.installId)
        assertEquals(fakeRooms.joinTokenResult.joinToken, realtime.lastJoinToken)
        assertEquals("room-001", realtime.lastJoinRoomId)
        assertTrue(viewModel.uiState.value.eventLogs.any { it.contains("room.joined") })
    }

    @Test
    fun `gift success follows accepted broadcast leaderboard protocol order`() = runTest {
        val fakeRooms = FakeRoomRepository()
        val realtime = FakeRealtimeGateway()
        val viewModel = buildViewModel(
            roomRepository = fakeRooms,
            realtimeGateway = realtime,
        )
        viewModel.onPhoneChanged("+971500000109")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onJoinRoomClicked("room-001")
        advanceUntilIdle()
        viewModel.onLoadGiftsClicked("room-001")
        advanceUntilIdle()
        viewModel.onGiftTargetChanged("u_receiver")
        viewModel.onGiftCountChanged("2")
        viewModel.onSendGiftClicked("g_rose_1")
        advanceUntilIdle()

        val logs = viewModel.uiState.value.eventLogs
        val acceptedIndex = logs.indexOfFirst { it.contains("gift.accepted") }
        val broadcastIndex = logs.indexOfFirst { it.contains("gift.broadcast") }
        val leaderboardIndex = logs.indexOfFirst { it.contains("leaderboard.updated") }
        assertTrue(acceptedIndex >= 0)
        assertTrue(broadcastIndex > acceptedIndex)
        assertTrue(leaderboardIndex > broadcastIndex)
        assertEquals("gft-001", viewModel.uiState.value.lastGiftOrderId)
        assertFalse(viewModel.uiState.value.needRecharge)
        assertEquals(1, realtime.sentGiftCommands.size)
        assertEquals("u_receiver", realtime.sentGiftCommands.first().toUid)
    }

    @Test
    fun `gift rejected with GIFT_002 toggles recharge state`() = runTest {
        val fakeRooms = FakeRoomRepository()
        val realtime = FakeRealtimeGateway()
        val viewModel = buildViewModel(
            roomRepository = fakeRooms,
            realtimeGateway = realtime,
        )
        viewModel.onPhoneChanged("+971500000105")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onJoinRoomClicked("room-001")
        advanceUntilIdle()
        viewModel.onLoadGiftsClicked("room-001")
        advanceUntilIdle()
        viewModel.onGiftTargetChanged("u_receiver")
        viewModel.onGiftCountChanged("1")
        realtime.nextGiftRejected = GiftRejectedEvent(
            errorCode = "GIFT_002",
            message = "Insufficient balance.",
            giftOrderId = null,
        )

        viewModel.onSendGiftClicked("g_rose_1")
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.needRecharge)
        assertTrue(viewModel.uiState.value.errorMessage?.contains("GIFT_002") == true)
    }

    @Test
    fun `rtc flow creates transport publishes producer and updates subscription plan`() = runTest {
        val fakeRooms = FakeRoomRepository()
        val realtime = FakeRealtimeGateway()
        val viewModel = buildViewModel(
            roomRepository = fakeRooms,
            realtimeGateway = realtime,
        )
        viewModel.onPhoneChanged("+971500000110")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onJoinRoomClicked("room-001")
        advanceUntilIdle()
        viewModel.onCreateRtcTransportClicked()
        advanceUntilIdle()
        viewModel.onConnectRtcTransportClicked()
        advanceUntilIdle()
        viewModel.onPublishSeatClicked(1)
        advanceUntilIdle()
        viewModel.onConsumeLatestProducerClicked(simulateWeakNetwork = true)
        advanceUntilIdle()

        assertEquals("tr-001", viewModel.uiState.value.rtcTransportId)
        assertEquals("pd-001", viewModel.uiState.value.rtcProducerId)
        assertEquals("cs-001", viewModel.uiState.value.rtcConsumerId)
        assertEquals("DEGRADED_6", viewModel.uiState.value.rtcDegradeLevel)
        assertTrue(viewModel.uiState.value.eventLogs.any { it.contains("rtc.transport_created") })
        assertTrue(viewModel.uiState.value.eventLogs.any { it.contains("rtc.degrade.applied") })
    }

    @Test
    fun `rtc seat conflict surfaces RTC_003 error`() = runTest {
        val fakeRooms = FakeRoomRepository()
        val realtime = FakeRealtimeGateway().apply {
            nextSeatConflict = true
        }
        val viewModel = buildViewModel(
            roomRepository = fakeRooms,
            realtimeGateway = realtime,
        )
        viewModel.onPhoneChanged("+971500000111")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onJoinRoomClicked("room-001")
        advanceUntilIdle()
        viewModel.onCreateRtcTransportClicked()
        advanceUntilIdle()
        viewModel.onConnectRtcTransportClicked()
        advanceUntilIdle()
        viewModel.onPublishSeatClicked(1)
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.errorMessage?.contains("RTC_003") == true)
        assertEquals(null, viewModel.uiState.value.rtcProducerId)
        assertTrue(viewModel.uiState.value.eventLogs.any { it.contains("rtc.seat.updated") })
    }

    @Test
    fun `rtc publish rejects invalid seat number`() = runTest {
        val fakeRooms = FakeRoomRepository()
        val realtime = FakeRealtimeGateway()
        val viewModel = buildViewModel(
            roomRepository = fakeRooms,
            realtimeGateway = realtime,
        )
        viewModel.onPhoneChanged("+971500000112")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onJoinRoomClicked("room-001")
        advanceUntilIdle()
        viewModel.onCreateRtcTransportClicked()
        advanceUntilIdle()
        viewModel.onConnectRtcTransportClicked()
        advanceUntilIdle()
        viewModel.onPublishSeatClicked(9)
        advanceUntilIdle()

        assertEquals("seat_no must be 1..8.", viewModel.uiState.value.errorMessage)
        assertEquals(null, viewModel.uiState.value.rtcProducerId)
    }

    @Test
    fun `rtc plan and metrics load update ui state`() = runTest {
        val fakeRooms = FakeRoomRepository()
        val realtime = FakeRealtimeGateway()
        val viewModel = buildViewModel(
            roomRepository = fakeRooms,
            realtimeGateway = realtime,
        )
        viewModel.onPhoneChanged("+971500000113")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onJoinRoomClicked("room-001")
        advanceUntilIdle()
        viewModel.onLoadRtcPlanClicked()
        advanceUntilIdle()
        viewModel.onLoadRtcMetricsClicked()
        advanceUntilIdle()

        assertEquals(8, viewModel.uiState.value.rtcSubscriptionLimit)
        assertEquals("FULL_8", viewModel.uiState.value.rtcDegradeLevel)
        assertTrue(viewModel.uiState.value.rtcActiveSpeakers.isNotEmpty())
        assertTrue(viewModel.uiState.value.eventLogs.any { it.contains("rtc.plan") })
        assertTrue(viewModel.uiState.value.eventLogs.any { it.contains("rtc.metrics") })
    }

    @Test
    fun `reconnect within window restores session and pulls snapshot`() = runTest {
        val fakeRooms = FakeRoomRepository()
        val realtime = FakeRealtimeGateway()
        val viewModel = buildViewModel(
            roomRepository = fakeRooms,
            realtimeGateway = realtime,
        )
        viewModel.onPhoneChanged("+971500000114")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onJoinRoomClicked("room-001")
        advanceUntilIdle()
        assertNotNull(viewModel.uiState.value.reconnectToken)
        assertNotNull(fakeRooms.lastReconnectTokenCall)

        viewModel.onDisconnected()
        advanceUntilIdle()
        viewModel.onConnected()
        advanceUntilIdle()

        assertEquals("RECOVERED", viewModel.uiState.value.reconnectState)
        assertFalse(viewModel.uiState.value.reconnectPending)
        assertEquals("recon-fake-token", viewModel.uiState.value.reconnectToken)
        assertNotNull(fakeRooms.lastRecoverSnapshotCall)
        assertEquals("sess-room-fake", realtime.lastReconnectCommand?.sessionId)
    }

    @Test
    fun `reconnect over window re-joins room automatically`() = runTest {
        val fakeRooms = FakeRoomRepository()
        val realtime = FakeRealtimeGateway()
        val viewModel = buildViewModel(
            roomRepository = fakeRooms,
            realtimeGateway = realtime,
        )
        viewModel.onPhoneChanged("+971500000115")
        viewModel.onOtpChanged("123456")
        viewModel.onLoginClicked()
        advanceUntilIdle()

        viewModel.onJoinRoomClicked("room-001")
        advanceUntilIdle()
        viewModel.onCreateRtcTransportClicked()
        advanceUntilIdle()
        viewModel.onConnectRtcTransportClicked()
        advanceUntilIdle()
        viewModel.onPublishSeatClicked(1)
        advanceUntilIdle()
        viewModel.onLoadGiftsClicked("room-001")
        advanceUntilIdle()

        viewModel.onDisconnected()
        advanceUntilIdle()
        viewModel.onConnected()
        advanceUntilIdle()

        assertEquals("CONNECTED", viewModel.uiState.value.reconnectState)
        assertFalse(viewModel.uiState.value.reconnectPending)
        assertTrue(fakeRooms.lastJoinTokenCall != null)
        assertTrue(viewModel.uiState.value.eventLogs.any { it.contains("room.joined") })
        assertTrue(viewModel.uiState.value.eventLogs.any { it.contains("session.reconnect") })
        assertTrue(viewModel.uiState.value.eventLogs.any { it.contains("reconnect.token") })
    }

    private fun buildViewModel(
        authRepository: AuthRepository = FakeAuthRepository(),
        roomRepository: RoomRepository = FakeRoomRepository(),
        realtimeGateway: RealtimeRoomGateway = NoopRealtimeRoomGateway(),
    ): LoginViewModel {
        return LoginViewModel(
            authRepository = authRepository,
            roomRepository = roomRepository,
            tokenStore = ProcessMemoryTokenStore(),
            deviceInfoProvider = FakeDeviceInfoProvider(),
            realtimeGateway = realtimeGateway,
        )
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class MainDispatcherRule : TestWatcher() {
    private val dispatcher = StandardTestDispatcher()

    override fun starting(description: Description) {
        Dispatchers.setMain(dispatcher)
    }

    override fun finished(description: Description) {
        Dispatchers.resetMain()
    }
}

private class FakeAuthRepository(
    private val shouldFailLogin: Boolean = false,
    private val shouldFailRefresh: Boolean = false,
    private val walletSummaries: List<WalletSummary> = listOf(
        WalletSummary(
            walletGold = 1_000,
            walletBonusGold = 0,
            frozenGold = 0,
            totalSpentGold = 0,
            spent30dGold = 0,
            riskLevel = "LOW",
        ),
    ),
) : AuthRepository {
    var refreshCalls: Int = 0
        private set

    private var walletSummaryIndex: Int = 0

    override suspend fun login(request: LoginRequest): LoginResponse {
        if (shouldFailLogin) {
            throw IllegalStateException("OTP is invalid or expired.")
        }
        return LoginResponse(
            accessToken = "access-token",
            refreshToken = "refresh-token",
            expiresInSeconds = 900,
            sessionId = "sess-test-001",
        )
    }

    override suspend fun refreshSession(
        refreshToken: String,
        sessionId: String,
        deviceId: String,
    ): RefreshResponse {
        refreshCalls += 1
        if (shouldFailRefresh) {
            throw IllegalStateException("AUTH_004: refresh token replay detected.")
        }
        return RefreshResponse(
            accessToken = "access-token-rotated",
            refreshToken = "refresh-token-rotated",
            expiresInSeconds = 900,
            sessionId = "sess-refresh-001",
        )
    }

    override suspend fun fetchWalletSummary(accessToken: String): WalletSummary {
        val cappedIndex = walletSummaryIndex.coerceAtMost(walletSummaries.lastIndex)
        val summary = walletSummaries[cappedIndex]
        walletSummaryIndex += 1
        return summary
    }
}

private class FakeRoomRepository : RoomRepository {
    data class JoinTokenCall(
        val accessToken: String,
        val roomId: String,
        val deviceId: String,
        val installId: String,
    )

    data class ReconnectTokenCall(
        val accessToken: String,
        val roomId: String,
        val sessionId: String,
        val deviceId: String,
        val installId: String,
        val seatIntent: Int?,
    )

    data class RecoverSnapshotCall(
        val accessToken: String,
        val sessionId: String,
    )

    private val rooms = mutableListOf(
        RoomPreview("room-001", "MENA Chill Lounge", "Nora", 72),
        RoomPreview("room-002", "Night Owl Talk", "Omar", 48),
    )
    var lastJoinTokenCall: JoinTokenCall? = null
        private set
    var lastReconnectTokenCall: ReconnectTokenCall? = null
        private set
    var lastRecoverSnapshotCall: RecoverSnapshotCall? = null
        private set
    val joinTokenResult = JoinTokenResult(
        joinToken = "jt-fake-token",
        sessionId = "sess-room-fake",
    )
    val reconnectTokenResult = ReconnectTokenResult(
        roomId = "room-001",
        sessionId = "sess-room-fake",
        reconnectToken = "recon-fake-token",
        expiresAt = "2026-03-25T10:00:30.000Z",
    )
    val reconnectSnapshotResult = ReconnectSnapshotResult(
        roomId = "room-001",
        sessionId = "sess-room-fake",
        snapshotSeq = 4,
        seatState = ReconnectSnapshotSeatState(
            seatNo = 1,
            seatStatus = "RESTORED",
            uid = "u_sender",
            producerId = "pd-001",
            errorCode = null,
        ),
        seatIntent = 1,
        subscriptionLimit = 8,
        degradeLevel = "FULL_8",
        activeSpeakers = listOf("u_sender"),
        leaderboard = listOf(LeaderboardEntry("u_sender", 100L)),
        giftOrders = listOf("gft-001:FINALIZED"),
        resumeCursor = 4,
        needResubscribe = false,
        rejoinRequired = false,
    )

    override suspend fun fetchRecommendedRooms(accessToken: String): List<RoomPreview> {
        return rooms.toList()
    }

    override suspend fun createRoom(
        accessToken: String,
        visibility: String,
        topic: String,
        tags: List<String>,
        language: String,
    ): RoomCreateResult {
        val created = RoomPreview(
            roomId = "room-900",
            name = topic,
            hostName = "u_host",
            onlineCount = 1,
        )
        rooms.add(created)
        return RoomCreateResult(
            roomId = created.roomId,
            ownerUid = "u_host",
            visibility = visibility,
        )
    }

    override suspend fun issueJoinToken(
        accessToken: String,
        roomId: String,
        deviceId: String,
        installId: String,
    ): JoinTokenResult {
        lastJoinTokenCall = JoinTokenCall(
            accessToken = accessToken,
            roomId = roomId,
            deviceId = deviceId,
            installId = installId,
        )
        return joinTokenResult
    }

    override suspend fun issueReconnectToken(
        accessToken: String,
        roomId: String,
        sessionId: String,
        deviceId: String,
        installId: String,
        seatIntent: Int?,
    ): ReconnectTokenResult {
        lastReconnectTokenCall = ReconnectTokenCall(
            accessToken = accessToken,
            roomId = roomId,
            sessionId = sessionId,
            deviceId = deviceId,
            installId = installId,
            seatIntent = seatIntent,
        )
        return reconnectTokenResult.copy(roomId = roomId, sessionId = sessionId)
    }

    override suspend fun recoverReconnectSnapshot(
        accessToken: String,
        sessionId: String,
    ): ReconnectSnapshotResult {
        lastRecoverSnapshotCall = RecoverSnapshotCall(
            accessToken = accessToken,
            sessionId = sessionId,
        )
        return reconnectSnapshotResult.copy(sessionId = sessionId)
    }

    override suspend fun fetchGiftCatalog(
        accessToken: String,
        roomId: String,
        country: String,
    ): List<GiftSku> {
        return listOf(
            GiftSku("g_rose_1", "LOW", 10, "Rose"),
            GiftSku("g_car_1", "MID", 300, "Car"),
        )
    }

    override suspend fun fetchRtcPlan(accessToken: String, roomId: String): RtcPlanResult {
        return RtcPlanResult(
            roomId = roomId,
            workerId = "wk-001",
            activeSpeakers = listOf("u_host"),
            subscriptionLimit = 8,
            degradeLevel = "FULL_8",
        )
    }

    override suspend fun fetchRtcMetrics(accessToken: String, roomId: String): List<RtcMetricPoint> {
        return listOf(
            RtcMetricPoint(
                bucketMinute = "2026-03-25T10:00:00.000Z",
                latencyP95 = 220.0,
                jitterP95 = 60.0,
                lossRatio = 0.02,
                stallMs = 120.0,
                degradeEvents = 1,
                recoverRatio15s = 0.95,
            ),
        )
    }
}

private class FakeDeviceInfoProvider : DeviceInfoProvider {
    override fun deviceId(): String {
        return "device-test-001"
    }
}

private class FakeRealtimeGateway : RealtimeRoomGateway {
    private var listener: RealtimeRoomListener? = null
    var nextGiftRejected: GiftRejectedEvent? = null
    var nextSeatConflict: Boolean = false
    var connectCalls: Int = 0
        private set
    var disconnectCalls: Int = 0
        private set
    var lastJoinRoomId: String? = null
        private set
    var lastJoinToken: String? = null
        private set
    var lastTransportId: String? = null
        private set
    var lastProducerId: String? = null
        private set
    var lastConsumerId: String? = null
        private set
    var lastReconnectCommand: SessionReconnectCommand? = null
        private set
    val sentGiftCommands = mutableListOf<GiftSendCommand>()

    override fun connect(accessToken: String, deviceId: String, listener: RealtimeRoomListener) {
        connectCalls += 1
        this.listener = listener
        listener.onConnected()
    }

    override fun joinRoom(roomId: String, joinToken: String) {
        lastJoinRoomId = roomId
        lastJoinToken = joinToken
        listener?.onRoomJoined(
            RoomJoinedEvent(
                roomId = roomId,
                sessionId = "sess-room-fake",
                onlineCount = 10,
            ),
        )
    }

    override fun leaveRoom(roomId: String) {
        listener?.onDisconnected()
    }

    override fun sendGift(command: GiftSendCommand) {
        sentGiftCommands.add(command)
        val rejected = nextGiftRejected
        if (rejected != null) {
            listener?.onGiftRejected(rejected)
            return
        }
        listener?.onGiftAccepted(
            GiftAcceptedEvent(
                roomId = command.roomId,
                giftOrderId = "gft-001",
                balanceAfter = 100L,
            ),
        )
        listener?.onGiftBroadcast(
            GiftBroadcastEvent(
                roomId = command.roomId,
                giftOrderId = "gft-001",
                fromUid = "u_sender",
                toUid = command.toUid,
                giftSkuId = command.giftSkuId,
                count = command.count,
                amountGold = 10L * command.count,
            ),
        )
        listener?.onLeaderboardUpdated(
            roomId = command.roomId,
            leaderboard = listOf(
                LeaderboardEntry(
                    uid = command.toUid,
                    totalGold = 10L * command.count,
                ),
            ),
        )
    }

    override fun createRtcTransport(command: RtcCreateTransportCommand) {
        lastTransportId = "tr-001"
        listener?.onRtcTransportCreated(
            RtcTransportCreatedEvent(
                roomId = command.roomId,
                transportId = "tr-001",
                direction = command.direction,
            ),
        )
    }

    override fun connectRtcTransport(command: RtcConnectTransportCommand) {
        listener?.onRtcTransportConnected(
            RtcTransportConnectedEvent(
                roomId = "room-001",
                transportId = command.transportId,
                connected = true,
            ),
        )
    }

    override fun produceAudio(command: RtcProduceCommand) {
        if (nextSeatConflict) {
            nextSeatConflict = false
            listener?.onRtcSeatUpdated(
                RtcSeatUpdatedEvent(
                    roomId = "room-001",
                    seatNo = command.seatNo,
                    seatStatus = "OCCUPIED",
                    uid = "u_sender",
                    producerId = "pd-occupied",
                    action = "CONFLICT",
                    errorCode = "RTC_003",
                ),
            )
            listener?.onRtcError(
                RtcErrorEvent(
                    errorCode = "RTC_003",
                    message = "seat is occupied.",
                ),
            )
            return
        }
        lastProducerId = "pd-001"
        listener?.onRtcSeatUpdated(
            RtcSeatUpdatedEvent(
                roomId = "room-001",
                seatNo = command.seatNo,
                seatStatus = "OCCUPIED",
                uid = "u_sender",
                producerId = "pd-001",
                action = "OCCUPIED",
                errorCode = null,
            ),
        )
        listener?.onRtcNewProducer(
            RtcNewProducerEvent(
                roomId = "room-001",
                producerId = "pd-001",
                uid = "u_sender",
                seatNo = command.seatNo,
            ),
        )
    }

    override fun consumeAudio(command: RtcConsumeCommand) {
        lastConsumerId = "cs-001"
        listener?.onRtcConsumerCreated(
            RtcConsumerCreatedEvent(
                roomId = command.roomId,
                consumerId = "cs-001",
                producerId = command.producerId,
            ),
        )
        val degraded = command.network != null
        listener?.onRtcSubscriptionPlan(
            RtcSubscriptionPlanEvent(
                roomId = command.roomId,
                subscriptionLimit = if (degraded) 6 else 8,
                degradeLevel = if (degraded) "DEGRADED_6" else "FULL_8",
                activeSpeakers = listOf("u_sender"),
            ),
        )
        if (degraded) {
            listener?.onRtcDegradeApplied(
                RtcDegradeAppliedEvent(
                    roomId = command.roomId,
                    degradeLevel = "DEGRADED_6",
                    reason = "packet_loss_high",
                    recoverEtaSec = 15,
                ),
            )
        }
    }

    override fun reconnectSession(command: SessionReconnectCommand) {
        lastReconnectCommand = command
        val rejoinRequired = command.lastSeq >= 4
        listener?.onSessionReconnected(
            SessionReconnectedEvent(
                roomId = command.roomId,
                sessionId = command.sessionId,
                resumeOk = !rejoinRequired,
                needResubscribe = !rejoinRequired,
                needSnapshotPull = !rejoinRequired,
                rejoinRequired = rejoinRequired,
                lastSeq = command.lastSeq + 1,
                expiresAt = "2026-03-25T10:00:30.000Z",
                seatNo = if (rejoinRequired) null else 1,
                seatStatus = if (rejoinRequired) "LOST" else "RESTORED",
                errorCode = if (rejoinRequired) "RECON_003" else null,
                reason = if (rejoinRequired) "window expired" else null,
            ),
        )
        if (!rejoinRequired) {
            listener?.onRoomRecoverHint(
                RoomRecoverHintEvent(
                    sessionId = command.sessionId,
                    reason = "snapshot_pull_required",
                    recoverEndpoint = "/api/v1/sessions/${command.sessionId}/recover",
                ),
            )
        } else {
            listener?.onRtcError(
                RtcErrorEvent(
                    errorCode = "RECON_003",
                    message = "recover window expired.",
                ),
            )
        }
    }

    override fun disconnect() {
        disconnectCalls += 1
        listener = null
    }
}
