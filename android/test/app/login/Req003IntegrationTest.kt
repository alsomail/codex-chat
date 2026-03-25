package com.chatroom.app.login

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

class Req003IntegrationTest {
    @Test
    fun `req003 android service socket integration`() = runBlocking {
        assumeTrue(System.getenv("REQ003_INTEGRATION") == "1")
        val baseUrl = System.getenv("REQ003_BASE_URL") ?: "http://127.0.0.1:3100"
        val demoOtp = System.getenv("REQ003_DEMO_OTP") ?: "123456"

        val authRepository = NetworkAuthRepository(baseUrl)
        val roomRepository = NetworkRoomRepository(baseUrl)
        val deviceId = "android-int-device-001"

        val login = authRepository.login(
            LoginRequest(
                phone = "+971500009001",
                otp = demoOtp,
                country = "AE",
                language = "ar",
                deviceId = deviceId,
            ),
        )

        val room = roomRepository.createRoom(
            accessToken = login.accessToken,
            visibility = "PUBLIC",
            topic = "REQ-003 Android Integration",
            tags = listOf("rtc", "integration"),
            language = "ar",
        )
        val joinToken = roomRepository.issueJoinToken(
            accessToken = login.accessToken,
            roomId = room.roomId,
            deviceId = deviceId,
            installId = "android-int-install-001",
        )

        val listener = RtcIntegrationListener()
        val gateway = SocketIoRealtimeRoomGateway(baseUrl)
        gateway.connect(login.accessToken, deviceId, listener)
        assertTrue(listener.connectedLatch.await(6, TimeUnit.SECONDS))

        gateway.joinRoom(room.roomId, joinToken.joinToken)
        assertTrue(listener.roomJoinedLatch.await(6, TimeUnit.SECONDS))

        gateway.createRtcTransport(RtcCreateTransportCommand(roomId = room.roomId))
        assertTrue(listener.transportCreatedLatch.await(6, TimeUnit.SECONDS))
        val transportId = listener.transportId.get()
        assertNotNull(transportId)

        gateway.connectRtcTransport(
            RtcConnectTransportCommand(
                transportId = transportId ?: "",
                dtlsParameters = mapOf("role" to "auto"),
            ),
        )
        assertTrue(listener.transportConnectedLatch.await(6, TimeUnit.SECONDS))

        gateway.produceAudio(
            RtcProduceCommand(
                transportId = transportId ?: "",
                seatNo = 1,
            ),
        )
        assertTrue(listener.producerLatch.await(6, TimeUnit.SECONDS))
        val producerId = listener.producerId.get()
        assertNotNull(producerId)

        gateway.consumeAudio(
            RtcConsumeCommand(
                roomId = room.roomId,
                producerId = producerId ?: "",
                network = NetworkSnapshot(
                    packetLoss = 0.2,
                    jitterP95 = 220.0,
                    rtt = 500.0,
                    stallMs = 1800.0,
                ),
            ),
        )
        assertTrue(listener.consumerLatch.await(6, TimeUnit.SECONDS))
        assertTrue(listener.degradeAppliedLatch.await(6, TimeUnit.SECONDS))

        gateway.consumeAudio(
            RtcConsumeCommand(
                roomId = room.roomId,
                producerId = producerId ?: "",
                network = NetworkSnapshot(
                    packetLoss = 0.02,
                    jitterP95 = 45.0,
                    rtt = 180.0,
                    stallMs = 80.0,
                ),
            ),
        )
        assertTrue(listener.degradeRecoveredLatch.await(12, TimeUnit.SECONDS))

        val plan = roomRepository.fetchRtcPlan(login.accessToken, room.roomId)
        assertEquals(room.roomId, plan.roomId)
        assertTrue(plan.subscriptionLimit >= 4)

        val metrics = roomRepository.fetchRtcMetrics(login.accessToken, room.roomId)
        assertTrue(metrics.isNotEmpty())

        assertNull(listener.lastError.get())
        gateway.disconnect()
    }
}

private class RtcIntegrationListener : RealtimeRoomListener {
    val connectedLatch = CountDownLatch(1)
    val roomJoinedLatch = CountDownLatch(1)
    val transportCreatedLatch = CountDownLatch(1)
    val transportConnectedLatch = CountDownLatch(1)
    val producerLatch = CountDownLatch(1)
    val consumerLatch = CountDownLatch(1)
    val degradeAppliedLatch = CountDownLatch(1)
    val degradeRecoveredLatch = CountDownLatch(1)
    val transportId = AtomicReference<String?>()
    val producerId = AtomicReference<String?>()
    val consumerId = AtomicReference<String?>()
    val lastError = AtomicReference<String?>()

    override fun onConnected() {
        connectedLatch.countDown()
    }

    override fun onDisconnected() {
        // no-op
    }

    override fun onRoomJoined(event: RoomJoinedEvent) {
        roomJoinedLatch.countDown()
    }

    override fun onRoomJoinFailed(errorCode: String, message: String) {
        lastError.set("$errorCode: $message")
    }

    override fun onGiftAccepted(event: GiftAcceptedEvent) {
        // no-op
    }

    override fun onGiftBroadcast(event: GiftBroadcastEvent) {
        // no-op
    }

    override fun onLeaderboardUpdated(roomId: String, leaderboard: List<LeaderboardEntry>) {
        // no-op
    }

    override fun onGiftRejected(event: GiftRejectedEvent) {
        // no-op
    }

    override fun onRtcTransportCreated(event: RtcTransportCreatedEvent) {
        transportId.set(event.transportId)
        transportCreatedLatch.countDown()
    }

    override fun onRtcTransportConnected(event: RtcTransportConnectedEvent) {
        transportConnectedLatch.countDown()
    }

    override fun onRtcNewProducer(event: RtcNewProducerEvent) {
        producerId.set(event.producerId)
        producerLatch.countDown()
    }

    override fun onRtcConsumerCreated(event: RtcConsumerCreatedEvent) {
        consumerId.set(event.consumerId)
        consumerLatch.countDown()
    }

    override fun onRtcSubscriptionPlan(event: RtcSubscriptionPlanEvent) {
        // no-op
    }

    override fun onRtcDegradeApplied(event: RtcDegradeAppliedEvent) {
        degradeAppliedLatch.countDown()
    }

    override fun onRtcDegradeRecovered(event: RtcDegradeRecoveredEvent) {
        degradeRecoveredLatch.countDown()
    }

    override fun onRtcSeatUpdated(event: RtcSeatUpdatedEvent) {
        // no-op
    }

    override fun onSessionReconnected(event: SessionReconnectedEvent) {
        // no-op
    }

    override fun onRoomRecoverHint(event: RoomRecoverHintEvent) {
        // no-op
    }

    override fun onRtcError(event: RtcErrorEvent) {
        lastError.set("${event.errorCode}: ${event.message}")
    }

    override fun onError(message: String) {
        lastError.set(message)
    }
}
