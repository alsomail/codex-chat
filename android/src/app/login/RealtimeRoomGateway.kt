package com.chatroom.app.login

import com.chatroom.app.BuildConfig
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.WebSocket
import org.json.JSONArray
import org.json.JSONObject

data class RoomJoinedEvent(
    val roomId: String,
    val sessionId: String,
    val onlineCount: Int,
)

data class GiftAcceptedEvent(
    val roomId: String,
    val giftOrderId: String,
    val balanceAfter: Long,
)

data class GiftBroadcastEvent(
    val roomId: String,
    val giftOrderId: String,
    val fromUid: String,
    val toUid: String,
    val giftSkuId: String,
    val count: Int,
    val amountGold: Long,
)

data class LeaderboardEntry(
    val uid: String,
    val totalGold: Long,
)

data class RtcTransportCreatedEvent(
    val roomId: String,
    val transportId: String,
    val direction: String,
)

data class RtcTransportConnectedEvent(
    val roomId: String,
    val transportId: String,
    val connected: Boolean,
)

data class RtcNewProducerEvent(
    val roomId: String,
    val producerId: String,
    val uid: String,
    val seatNo: Int,
)

data class RtcConsumerCreatedEvent(
    val roomId: String,
    val consumerId: String,
    val producerId: String,
)

data class RtcSubscriptionPlanEvent(
    val roomId: String,
    val subscriptionLimit: Int,
    val degradeLevel: String,
    val activeSpeakers: List<String>,
)

data class RtcDegradeAppliedEvent(
    val roomId: String,
    val degradeLevel: String,
    val reason: String,
    val recoverEtaSec: Int,
)

data class RtcDegradeRecoveredEvent(
    val roomId: String,
    val fromLevel: String,
    val toLevel: String,
    val elapsedMs: Long,
)

data class RtcSeatUpdatedEvent(
    val roomId: String,
    val seatNo: Int,
    val seatStatus: String,
    val uid: String?,
    val producerId: String?,
    val action: String,
    val errorCode: String?,
)

data class RtcErrorEvent(
    val errorCode: String,
    val message: String,
)

data class GiftRejectedEvent(
    val errorCode: String,
    val message: String,
    val giftOrderId: String?,
)

data class SessionReconnectCommand(
    val roomId: String,
    val sessionId: String,
    val reconnectToken: String,
    val lastSeq: Long,
)

data class SessionReconnectedEvent(
    val roomId: String,
    val sessionId: String,
    val resumeOk: Boolean,
    val needResubscribe: Boolean,
    val needSnapshotPull: Boolean,
    val rejoinRequired: Boolean,
    val lastSeq: Long,
    val expiresAt: String,
    val seatNo: Int?,
    val seatStatus: String,
    val errorCode: String?,
    val reason: String?,
)

data class RoomRecoverHintEvent(
    val sessionId: String,
    val reason: String,
    val recoverEndpoint: String,
)

interface RealtimeRoomListener {
    fun onConnected()
    fun onDisconnected()
    fun onRoomJoined(event: RoomJoinedEvent)
    fun onRoomJoinFailed(errorCode: String, message: String)
    fun onGiftAccepted(event: GiftAcceptedEvent)
    fun onGiftBroadcast(event: GiftBroadcastEvent)
    fun onLeaderboardUpdated(roomId: String, leaderboard: List<LeaderboardEntry>)
    fun onGiftRejected(event: GiftRejectedEvent)
    fun onRtcTransportCreated(event: RtcTransportCreatedEvent)
    fun onRtcTransportConnected(event: RtcTransportConnectedEvent)
    fun onRtcNewProducer(event: RtcNewProducerEvent)
    fun onRtcConsumerCreated(event: RtcConsumerCreatedEvent)
    fun onRtcSubscriptionPlan(event: RtcSubscriptionPlanEvent)
    fun onRtcDegradeApplied(event: RtcDegradeAppliedEvent)
    fun onRtcDegradeRecovered(event: RtcDegradeRecoveredEvent)
    fun onRtcSeatUpdated(event: RtcSeatUpdatedEvent)
    fun onSessionReconnected(event: SessionReconnectedEvent)
    fun onRoomRecoverHint(event: RoomRecoverHintEvent)
    fun onRtcError(event: RtcErrorEvent)
    fun onError(message: String)
}

data class GiftSendCommand(
    val roomId: String,
    val giftSkuId: String,
    val count: Int,
    val toUid: String,
    val idempotencyKey: String,
)

data class RtcCreateTransportCommand(
    val roomId: String,
    val direction: String = "send",
)

data class RtcConnectTransportCommand(
    val transportId: String,
    val dtlsParameters: Map<String, Any> = emptyMap(),
)

data class RtcProduceCommand(
    val transportId: String,
    val seatNo: Int,
)

data class NetworkSnapshot(
    val packetLoss: Double,
    val jitterP95: Double,
    val rtt: Double,
    val stallMs: Double,
)

data class RtcConsumeCommand(
    val roomId: String,
    val producerId: String,
    val network: NetworkSnapshot? = null,
)

enum class SocketTransportMode(
    val displayName: String,
    val transports: Array<String>,
) {
    POLLING_AND_WEBSOCKET(
        displayName = "polling+websocket",
        transports = arrayOf("polling", WebSocket.NAME),
    ),
    WEBSOCKET_ONLY(
        displayName = "websocket-only",
        transports = arrayOf(WebSocket.NAME),
    ),
    ;

    companion object {
        fun fromLabel(label: String?): SocketTransportMode {
            val normalized = label?.trim().orEmpty()
            return entries.firstOrNull {
                it.displayName.equals(normalized, ignoreCase = true)
            } ?: default()
        }

        fun default(): SocketTransportMode {
            return if (BuildConfig.DEBUG) {
                POLLING_AND_WEBSOCKET
            } else {
                WEBSOCKET_ONLY
            }
        }
    }
}

fun defaultSocketTransportMode(): SocketTransportMode = SocketTransportMode.default()

interface RealtimeRoomGateway {
    fun connect(
        accessToken: String,
        deviceId: String,
        transportMode: SocketTransportMode,
        listener: RealtimeRoomListener,
    )
    fun joinRoom(roomId: String, joinToken: String)
    fun leaveRoom(roomId: String)
    fun sendGift(command: GiftSendCommand)
    fun createRtcTransport(command: RtcCreateTransportCommand)
    fun connectRtcTransport(command: RtcConnectTransportCommand)
    fun produceAudio(command: RtcProduceCommand)
    fun consumeAudio(command: RtcConsumeCommand)
    fun reconnectSession(command: SessionReconnectCommand)
    fun disconnect()
}

class NoopRealtimeRoomGateway : RealtimeRoomGateway {
    private var listener: RealtimeRoomListener? = null

    override fun connect(
        accessToken: String,
        deviceId: String,
        transportMode: SocketTransportMode,
        listener: RealtimeRoomListener,
    ) {
        this.listener = listener
        listener.onError("Realtime gateway is not configured.")
    }

    override fun joinRoom(roomId: String, joinToken: String) {
        listener?.onRoomJoinFailed("ROOM_001", "Realtime gateway is unavailable.")
    }

    override fun leaveRoom(roomId: String) {
        // no-op
    }

    override fun sendGift(command: GiftSendCommand) {
        listener?.onGiftRejected(
            GiftRejectedEvent(
                errorCode = "SYS_001",
                message = "Realtime gateway is unavailable.",
                giftOrderId = null,
            ),
        )
    }

    override fun createRtcTransport(command: RtcCreateTransportCommand) {
        listener?.onRtcError(
            RtcErrorEvent(
                errorCode = "SYS_001",
                message = "Realtime gateway is unavailable.",
            ),
        )
    }

    override fun connectRtcTransport(command: RtcConnectTransportCommand) {
        listener?.onRtcError(
            RtcErrorEvent(
                errorCode = "SYS_001",
                message = "Realtime gateway is unavailable.",
            ),
        )
    }

    override fun produceAudio(command: RtcProduceCommand) {
        listener?.onRtcError(
            RtcErrorEvent(
                errorCode = "SYS_001",
                message = "Realtime gateway is unavailable.",
            ),
        )
    }

    override fun consumeAudio(command: RtcConsumeCommand) {
        listener?.onRtcError(
            RtcErrorEvent(
                errorCode = "SYS_001",
                message = "Realtime gateway is unavailable.",
            ),
        )
    }

    override fun reconnectSession(command: SessionReconnectCommand) {
        listener?.onRtcError(
            RtcErrorEvent(
                errorCode = "SYS_001",
                message = "Realtime gateway is unavailable.",
            ),
        )
    }

    override fun disconnect() {
        listener = null
    }
}

class SocketIoRealtimeRoomGateway(
    private val baseUrl: String,
) : RealtimeRoomGateway {
    private var socket: Socket? = null
    private var listener: RealtimeRoomListener? = null

    override fun connect(
        accessToken: String,
        deviceId: String,
        transportMode: SocketTransportMode,
        listener: RealtimeRoomListener,
    ) {
        if (socket?.connected() == true) {
            this.listener = listener
            listener.onConnected()
            return
        }

        this.listener = listener
        val options = IO.Options().apply {
            forceNew = true
            reconnection = true
            transports = transportMode.transports
            auth = mapOf(
                "token" to accessToken,
                "deviceId" to deviceId,
            )
        }
        val instance = IO.socket(baseUrl, options)
        instance.on(Socket.EVENT_CONNECT) {
            this.listener?.onConnected()
        }
        instance.on(Socket.EVENT_DISCONNECT) {
            this.listener?.onDisconnected()
        }
        instance.on(Socket.EVENT_CONNECT_ERROR) { args ->
            val message = args.firstOrNull()?.toString() ?: "Socket connect failed."
            this.listener?.onError(message)
        }
        instance.on("room.joined") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onRoomJoined(
                    RoomJoinedEvent(
                        roomId = payload.optString("room_id"),
                        sessionId = payload.optString("session_id"),
                        onlineCount = payload.optInt("online_count"),
                    ),
                )
            }
        }
        instance.on("room.join_failed") { args ->
            val payload = parseJsonObject(args)
            this.listener?.onRoomJoinFailed(
                errorCode = payload?.optString("error_code").orEmpty(),
                message = payload?.optString("message").orEmpty(),
            )
        }
        instance.on("gift.accepted") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onGiftAccepted(
                    GiftAcceptedEvent(
                        roomId = payload.optString("room_id"),
                        giftOrderId = payload.optString("gift_order_id"),
                        balanceAfter = payload.optLong("balance_after"),
                    ),
                )
            }
        }
        instance.on("gift.broadcast") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onGiftBroadcast(
                    GiftBroadcastEvent(
                        roomId = payload.optString("room_id"),
                        giftOrderId = payload.optString("gift_order_id"),
                        fromUid = payload.optString("from_uid"),
                        toUid = payload.optString("to_uid"),
                        giftSkuId = payload.optString("gift_sku_id"),
                        count = payload.optInt("count"),
                        amountGold = payload.optLong("amount_gold"),
                    ),
                )
            }
        }
        instance.on("leaderboard.updated") { args ->
            parseJsonObject(args)?.let { payload ->
                val leaderboard = payload.optJSONArray("leaderboard") ?: JSONArray()
                val items = buildList {
                    for (index in 0 until leaderboard.length()) {
                        val item = leaderboard.optJSONObject(index) ?: continue
                        add(
                            LeaderboardEntry(
                                uid = item.optString("uid"),
                                totalGold = item.optLong("total_gold"),
                            ),
                        )
                    }
                }
                this.listener?.onLeaderboardUpdated(
                    roomId = payload.optString("room_id"),
                    leaderboard = items,
                )
            }
        }
        instance.on("gift.rejected") { args ->
            val payload = parseJsonObject(args)
            this.listener?.onGiftRejected(
                GiftRejectedEvent(
                    errorCode = payload?.optString("error_code").orEmpty(),
                    message = payload?.optString("message").orEmpty(),
                    giftOrderId = payload?.optString("gift_order_id")?.takeIf { it.isNotBlank() },
                ),
            )
        }
        instance.on("rtc.transport_created") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onRtcTransportCreated(
                    RtcTransportCreatedEvent(
                        roomId = payload.optString("room_id"),
                        transportId = payload.optString("transport_id"),
                        direction = payload.optString("direction"),
                    ),
                )
            }
        }
        instance.on("rtc.transport_connected") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onRtcTransportConnected(
                    RtcTransportConnectedEvent(
                        roomId = payload.optString("room_id"),
                        transportId = payload.optString("transport_id"),
                        connected = payload.optBoolean("connected"),
                    ),
                )
            }
        }
        instance.on("rtc.new_producer") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onRtcNewProducer(
                    RtcNewProducerEvent(
                        roomId = payload.optString("room_id"),
                        producerId = payload.optString("producer_id"),
                        uid = payload.optString("uid"),
                        seatNo = payload.optInt("seat_no"),
                    ),
                )
            }
        }
        instance.on("rtc.consumer_created") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onRtcConsumerCreated(
                    RtcConsumerCreatedEvent(
                        roomId = payload.optString("room_id"),
                        consumerId = payload.optString("consumer_id"),
                        producerId = payload.optString("producer_id"),
                    ),
                )
            }
        }
        instance.on("rtc.subscription_plan") { args ->
            parseJsonObject(args)?.let { payload ->
                val activeSpeakers = payload.optJSONArray("active_speakers") ?: JSONArray()
                val speakerList = buildList {
                    for (index in 0 until activeSpeakers.length()) {
                        val uid = activeSpeakers.optString(index)
                        if (uid.isNotBlank()) {
                            add(uid)
                        }
                    }
                }
                this.listener?.onRtcSubscriptionPlan(
                    RtcSubscriptionPlanEvent(
                        roomId = payload.optString("room_id"),
                        subscriptionLimit = payload.optInt("subscription_limit"),
                        degradeLevel = payload.optString("degrade_level"),
                        activeSpeakers = speakerList,
                    ),
                )
            }
        }
        instance.on("rtc.degrade.applied") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onRtcDegradeApplied(
                    RtcDegradeAppliedEvent(
                        roomId = payload.optString("room_id"),
                        degradeLevel = payload.optString("degrade_level"),
                        reason = payload.optString("reason"),
                        recoverEtaSec = payload.optInt("recover_eta_sec"),
                    ),
                )
            }
        }
        instance.on("rtc.degrade.recovered") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onRtcDegradeRecovered(
                    RtcDegradeRecoveredEvent(
                        roomId = payload.optString("room_id"),
                        fromLevel = payload.optString("from_level"),
                        toLevel = payload.optString("to_level"),
                        elapsedMs = payload.optLong("elapsed_ms"),
                    ),
                )
            }
        }
        instance.on("rtc.seat.updated") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onRtcSeatUpdated(
                    RtcSeatUpdatedEvent(
                        roomId = payload.optString("room_id"),
                        seatNo = payload.optInt("seat_no"),
                        seatStatus = payload.optString("seat_status"),
                        uid = payload.optString("uid").takeIf { it.isNotBlank() },
                        producerId = payload.optString("producer_id").takeIf { it.isNotBlank() },
                        action = payload.optString("action"),
                        errorCode = payload.optString("error_code").takeIf { it.isNotBlank() },
                    ),
                )
            }
        }
        instance.on("session.reconnected") { args ->
            parseJsonObject(args)?.let { payload ->
                val seatResume = payload.optJSONObject("seat_resume")
                this.listener?.onSessionReconnected(
                    SessionReconnectedEvent(
                        roomId = payload.optString("room_id"),
                        sessionId = payload.optString("session_id"),
                        resumeOk = payload.optBoolean("resume_ok"),
                        needResubscribe = payload.optBoolean("need_resubscribe"),
                        needSnapshotPull = payload.optBoolean("need_snapshot_pull"),
                        rejoinRequired = payload.optBoolean("rejoin_required"),
                        lastSeq = payload.optLong("last_seq"),
                        expiresAt = payload.optString("expires_at"),
                        seatNo = seatResume?.optInt("seat_no")?.takeIf { it > 0 },
                        seatStatus = seatResume?.optString("seat_status").orEmpty(),
                        errorCode = payload.optString("error_code").takeIf { it.isNotBlank() },
                        reason = payload.optString("message").takeIf { it.isNotBlank() },
                    ),
                )
            }
        }
        instance.on("room.recover_hint") { args ->
            parseJsonObject(args)?.let { payload ->
                this.listener?.onRoomRecoverHint(
                    RoomRecoverHintEvent(
                        sessionId = payload.optString("session_id"),
                        reason = payload.optString("reason"),
                        recoverEndpoint = payload.optString("recover_endpoint"),
                    ),
                )
            }
        }
        instance.on("rtc.error") { args ->
            val payload = parseJsonObject(args)
            this.listener?.onRtcError(
                RtcErrorEvent(
                    errorCode = payload?.optString("error_code").orEmpty(),
                    message = payload?.optString("message").orEmpty(),
                ),
            )
        }

        instance.connect()
        socket = instance
    }

    override fun joinRoom(roomId: String, joinToken: String) {
        socket?.emit(
            "room.join",
            JSONObject().apply {
                put("room_id", roomId)
                put("join_token", joinToken)
            },
        )
    }

    override fun leaveRoom(roomId: String) {
        socket?.emit(
            "room.leave",
            JSONObject().apply {
                put("room_id", roomId)
            },
        )
    }

    override fun sendGift(command: GiftSendCommand) {
        socket?.emit(
            "gift.send",
            JSONObject().apply {
                put("room_id", command.roomId)
                put("gift_sku_id", command.giftSkuId)
                put("count", command.count)
                put("to_uid", command.toUid)
                put("idempotency_key", command.idempotencyKey)
            },
        )
    }

    override fun createRtcTransport(command: RtcCreateTransportCommand) {
        socket?.emit(
            "rtc.create_transport",
            JSONObject().apply {
                put("room_id", command.roomId)
                put("direction", command.direction)
            },
        )
    }

    override fun connectRtcTransport(command: RtcConnectTransportCommand) {
        socket?.emit(
            "rtc.connect_transport",
            JSONObject().apply {
                put("transport_id", command.transportId)
                put("dtls_parameters", mapToJsonObject(command.dtlsParameters))
            },
        )
    }

    override fun produceAudio(command: RtcProduceCommand) {
        socket?.emit(
            "rtc.produce",
            JSONObject().apply {
                put("transport_id", command.transportId)
                put("kind", "audio")
                put(
                    "app_data",
                    JSONObject().apply {
                        put("seat_no", command.seatNo)
                    },
                )
            },
        )
    }

    override fun consumeAudio(command: RtcConsumeCommand) {
        socket?.emit(
            "rtc.consume",
            JSONObject().apply {
                put("room_id", command.roomId)
                put("producer_id", command.producerId)
                put(
                    "rtp_capabilities",
                    JSONObject().apply {
                        put("codecs", JSONArray().apply { put("opus") })
                    },
                )
                command.network?.let { snapshot ->
                    put(
                        "network",
                        JSONObject().apply {
                            put("packet_loss", snapshot.packetLoss)
                            put("jitter_p95", snapshot.jitterP95)
                            put("rtt", snapshot.rtt)
                            put("stall_ms", snapshot.stallMs)
                        },
                    )
                }
            },
        )
    }

    override fun reconnectSession(command: SessionReconnectCommand) {
        socket?.emit(
            "session.reconnect",
            JSONObject().apply {
                put("room_id", command.roomId)
                put("session_id", command.sessionId)
                put("reconnect_token", command.reconnectToken)
                put("last_seq", command.lastSeq)
            },
        )
    }

    override fun disconnect() {
        socket?.disconnect()
        socket?.off()
        socket = null
    }
}

private fun parseJsonObject(args: Array<out Any>): JSONObject? {
    val first = args.firstOrNull() ?: return null
    return when (first) {
        is JSONObject -> first
        is String -> runCatching { JSONObject(first) }.getOrNull()
        else -> null
    }
}

private fun mapToJsonObject(input: Map<String, Any>): JSONObject {
    val result = JSONObject()
    input.forEach { (key, value) ->
        when (value) {
            is Number,
            is Boolean,
            is String,
            -> result.put(key, value)
            is Map<*, *> -> {
                @Suppress("UNCHECKED_CAST")
                result.put(key, mapToJsonObject(value as Map<String, Any>))
            }
            else -> result.put(key, value.toString())
        }
    }
    return result
}
