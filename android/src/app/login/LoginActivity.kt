package com.chatroom.app.login

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.ElevatedButton
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.chatroom.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.util.Locale
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey

class LoginActivity : ComponentActivity() {
    private val viewModel: LoginViewModel by viewModels {
        LoginViewModelFactory(applicationContext)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            Surface(
                modifier = Modifier.fillMaxSize(),
                color = MaterialTheme.colorScheme.background,
            ) {
                LoginRoute(viewModel = viewModel)
            }
        }
    }
}

@Composable
private fun LoginRoute(
    viewModel: LoginViewModel,
) {
    val uiState by viewModel.uiState.collectAsState()

    if (!uiState.isLoginSuccess) {
        LoginScreen(
            uiState = uiState,
            onPhoneChanged = viewModel::onPhoneChanged,
            onOtpChanged = viewModel::onOtpChanged,
            onCountrySelected = viewModel::onCountrySelected,
            onLanguageSelected = viewModel::onLanguageSelected,
            onLoginClicked = viewModel::onLoginClicked,
        )
        return
    }

    ReqWorkspaceScreen(
        uiState = uiState,
        onBack = viewModel::onBackToLogin,
        onRefreshSession = viewModel::onRefreshSessionClicked,
        onReloadWallet = viewModel::onReloadWalletClicked,
        onCreateRoomTopicChanged = viewModel::onCreateRoomTopicChanged,
        onCreateRoomVisibilityChanged = viewModel::onCreateRoomVisibilityChanged,
        onCreateRoom = viewModel::onCreateRoomClicked,
        onJoinRoom = viewModel::onJoinRoomClicked,
        onLoadGifts = viewModel::onLoadGiftsClicked,
        onGiftTargetChanged = viewModel::onGiftTargetChanged,
        onGiftCountChanged = viewModel::onGiftCountChanged,
        onSendGift = viewModel::onSendGiftClicked,
        onRetryLastGift = viewModel::onRetryLastGiftClicked,
        onRecharge = viewModel::onRechargeClicked,
        onQueryGiftOrder = viewModel::onQueryLastGiftOrderClicked,
        onCreateRtcTransport = viewModel::onCreateRtcTransportClicked,
        onConnectRtcTransport = viewModel::onConnectRtcTransportClicked,
        onPublishSeat = { viewModel.onPublishSeatClicked(1) },
        onConsumeProducer = { viewModel.onConsumeLatestProducerClicked(false) },
        onConsumeWeakNetwork = { viewModel.onConsumeLatestProducerClicked(true) },
        onLoadRtcPlan = viewModel::onLoadRtcPlanClicked,
        onLoadRtcMetrics = viewModel::onLoadRtcMetricsClicked,
    )
}

@Composable
private fun LoginScreen(
    uiState: LoginUiState,
    onPhoneChanged: (String) -> Unit,
    onOtpChanged: (String) -> Unit,
    onCountrySelected: (String) -> Unit,
    onLanguageSelected: (String) -> Unit,
    onLoginClicked: () -> Unit,
) {
    val headerGradient = Brush.linearGradient(
        colors = listOf(Color(0xFFE9F4FF), Color(0xFFF7F2E9)),
    )

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .background(brush = headerGradient)
            .statusBarsPadding(),
        containerColor = Color.Transparent,
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 24.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                text = "Sign in to ChatRoom",
                style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = "REQ-001 login + wallet + refresh, then continue to REQ-002 room and gifts.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = uiState.phone,
                onValueChange = onPhoneChanged,
                label = { Text(text = "Phone") },
                placeholder = { Text(text = "+971500000000") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            )

            OutlinedTextField(
                modifier = Modifier.fillMaxWidth(),
                value = uiState.otp,
                onValueChange = onOtpChanged,
                label = { Text(text = "OTP") },
                placeholder = { Text(text = "6-digit code") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            )

            Text(
                text = "Country",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            SelectableChipRow(
                values = supportedCountries,
                selected = uiState.country,
                onSelected = onCountrySelected,
            )

            Text(
                text = "Language",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            SelectableChipRow(
                values = supportedLanguages,
                selected = uiState.language,
                onSelected = onLanguageSelected,
            )

            if (uiState.isLoading) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            }

            uiState.errorMessage?.let { message ->
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            ElevatedButton(
                modifier = Modifier.fillMaxWidth(),
                onClick = onLoginClicked,
                enabled = !uiState.isLoading,
                contentPadding = PaddingValues(vertical = 12.dp),
            ) {
                Text(text = "Login and continue")
            }
        }
    }
}

@Composable
private fun ReqWorkspaceScreen(
    uiState: LoginUiState,
    onBack: () -> Unit,
    onRefreshSession: () -> Unit,
    onReloadWallet: () -> Unit,
    onCreateRoomTopicChanged: (String) -> Unit,
    onCreateRoomVisibilityChanged: (String) -> Unit,
    onCreateRoom: () -> Unit,
    onJoinRoom: (String) -> Unit,
    onLoadGifts: (String) -> Unit,
    onGiftTargetChanged: (String) -> Unit,
    onGiftCountChanged: (String) -> Unit,
    onSendGift: (String) -> Unit,
    onRetryLastGift: () -> Unit,
    onRecharge: () -> Unit,
    onQueryGiftOrder: () -> Unit,
    onCreateRtcTransport: () -> Unit,
    onConnectRtcTransport: () -> Unit,
    onPublishSeat: () -> Unit,
    onConsumeProducer: () -> Unit,
    onConsumeWeakNetwork: () -> Unit,
    onLoadRtcPlan: () -> Unit,
    onLoadRtcMetrics: () -> Unit,
) {
    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding(),
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 18.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Text(
                    text = "REQ-001 / REQ-002 Workspace",
                    style = MaterialTheme.typography.headlineSmall,
                )
                Text(
                    text = "Locale ${uiState.country}/${uiState.language} · Socket ${if (uiState.realtimeConnected) "connected" else "disconnected"}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            item {
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("REQ-003 RTC", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "transport=${uiState.rtcTransportId ?: "-"} producer=${uiState.rtcProducerId ?: "-"} consumer=${uiState.rtcConsumerId ?: "-"}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Text(
                            "plan=${uiState.rtcDegradeLevel}/${uiState.rtcSubscriptionLimit} speakers=${uiState.rtcActiveSpeakers.joinToString().ifBlank { "-" }}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ElevatedButton(onClick = onCreateRtcTransport) {
                                Text("Create Tr")
                            }
                            ElevatedButton(onClick = onConnectRtcTransport) {
                                Text("Connect Tr")
                            }
                            ElevatedButton(onClick = onPublishSeat) {
                                Text("Publish")
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ElevatedButton(onClick = onConsumeProducer) {
                                Text("Consume")
                            }
                            ElevatedButton(onClick = onConsumeWeakNetwork) {
                                Text("WeakNet")
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ElevatedButton(onClick = onLoadRtcPlan) {
                                Text("Load Plan")
                            }
                            ElevatedButton(onClick = onLoadRtcMetrics) {
                                Text("Load Metrics")
                            }
                        }
                    }
                }
            }
            item {
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("REQ-001 Session", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "session_id: ${uiState.sessionId ?: "-"}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        uiState.walletSummary?.let { wallet ->
                            Text(
                                "wallet=${wallet.walletGold}, bonus=${wallet.walletBonusGold}, frozen=${wallet.frozenGold}, risk=${wallet.riskLevel}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                        } ?: Text(
                            "Wallet summary unavailable.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ElevatedButton(onClick = onRefreshSession) {
                                Text("Refresh")
                            }
                            ElevatedButton(onClick = onReloadWallet) {
                                Text("Reload Wallet")
                            }
                        }
                    }
                }
            }
            item {
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("REQ-002 Create Room", style = MaterialTheme.typography.titleMedium)
                        OutlinedTextField(
                            modifier = Modifier.fillMaxWidth(),
                            value = uiState.createRoomTopic,
                            onValueChange = onCreateRoomTopicChanged,
                            label = { Text("Room topic") },
                            singleLine = true,
                        )
                        SelectableChipRow(
                            values = listOf("PUBLIC", "PRIVATE"),
                            selected = uiState.createRoomVisibility,
                            onSelected = onCreateRoomVisibilityChanged,
                        )
                        ElevatedButton(onClick = onCreateRoom) {
                            Text("Create Room")
                        }
                    }
                }
            }
            item {
                Text("Room List", style = MaterialTheme.typography.titleMedium)
            }
            if (uiState.rooms.isEmpty()) {
                item {
                    Text("No rooms loaded yet.")
                }
            } else {
                items(uiState.rooms, key = { room -> room.roomId }) { room ->
                    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(room.name, style = MaterialTheme.typography.titleSmall)
                            Text(
                                "room=${room.roomId} host=${room.hostName} online=${room.onlineCount}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                ElevatedButton(onClick = { onJoinRoom(room.roomId) }) {
                                    Text("Join")
                                }
                                ElevatedButton(onClick = { onLoadGifts(room.roomId) }) {
                                    Text("Gifts")
                                }
                            }
                        }
                    }
                }
            }
            item {
                ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text("Gift Send", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "active_room=${uiState.activeRoomId ?: "-"} gift_order=${uiState.lastGiftOrderId ?: "-"}",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        OutlinedTextField(
                            modifier = Modifier.fillMaxWidth(),
                            value = uiState.giftTargetUid,
                            onValueChange = onGiftTargetChanged,
                            label = { Text("to_uid") },
                            singleLine = true,
                        )
                        OutlinedTextField(
                            modifier = Modifier.fillMaxWidth(),
                            value = uiState.giftCountInput,
                            onValueChange = onGiftCountChanged,
                            label = { Text("count (1-99)") },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                        if (uiState.gifts.isEmpty()) {
                            Text("Load gifts from a room first.")
                        } else {
                            uiState.gifts.forEach { gift ->
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(
                                        "${gift.name}(${gift.tier}) · ${gift.priceGold} gold",
                                        modifier = Modifier.weight(1f),
                                        style = MaterialTheme.typography.bodySmall,
                                    )
                                    ElevatedButton(onClick = { onSendGift(gift.giftSkuId) }) {
                                        Text("Send")
                                    }
                                }
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            ElevatedButton(onClick = onRetryLastGift) {
                                Text("Retry Last Gift")
                            }
                            ElevatedButton(onClick = onQueryGiftOrder) {
                                Text("Query Gift Order")
                            }
                        }
                        if (uiState.needRecharge) {
                            ElevatedButton(onClick = onRecharge) {
                                Text("Recharge 980 Gold")
                            }
                        }
                    }
                }
            }
            item {
                uiState.statusMessage?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                uiState.errorMessage?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
            item {
                Text("Event Logs", style = MaterialTheme.typography.titleMedium)
            }
            if (uiState.eventLogs.isEmpty()) {
                item {
                    Text("No events yet.")
                }
            } else {
                items(uiState.eventLogs) { log ->
                    Text(log, style = MaterialTheme.typography.bodySmall)
                }
            }
            item {
                ElevatedButton(
                    modifier = Modifier.fillMaxWidth(),
                    onClick = onBack,
                ) {
                    Text("Back to login")
                }
            }
        }
    }
}

@Composable
private fun SelectableChipRow(
    values: List<String>,
    selected: String,
    onSelected: (String) -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        values.forEach { value ->
            val isSelected = value == selected
            AssistChip(
                onClick = { onSelected(value) },
                label = { Text(text = value) },
                colors = AssistChipDefaults.assistChipColors(
                    containerColor = if (isSelected) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.surface
                    },
                    labelColor = if (isSelected) {
                        MaterialTheme.colorScheme.onPrimaryContainer
                    } else {
                        MaterialTheme.colorScheme.onSurface
                    },
                ),
            )
        }
    }
}

data class LoginUiState(
    val phone: String = "",
    val otp: String = "",
    val country: String = defaultCountry,
    val language: String = defaultLanguage,
    val rooms: List<RoomPreview> = emptyList(),
    val gifts: List<GiftSku> = emptyList(),
    val walletSummary: WalletSummary? = null,
    val isLoading: Boolean = false,
    val isLoginSuccess: Boolean = false,
    val realtimeConnected: Boolean = false,
    val sessionId: String? = null,
    val activeRoomId: String? = null,
    val reconnectToken: String? = null,
    val reconnectExpiresAt: String? = null,
    val reconnectLastSeq: Long = 0L,
    val reconnectSeatIntent: Int? = null,
    val reconnectState: String = "CONNECTED",
    val reconnectPending: Boolean = false,
    val createRoomTopic: String = "Night Owl Talk",
    val createRoomVisibility: String = "PUBLIC",
    val giftTargetUid: String = "u_host",
    val giftCountInput: String = "1",
    val lastGiftOrderId: String? = null,
    val lastGiftCommand: GiftSendCommand? = null,
    val rtcTransportId: String? = null,
    val rtcProducerId: String? = null,
    val rtcConsumerId: String? = null,
    val rtcSubscriptionLimit: Int = 8,
    val rtcDegradeLevel: String = "FULL_8",
    val rtcActiveSpeakers: List<String> = emptyList(),
    val needRecharge: Boolean = false,
    val statusMessage: String? = null,
    val errorMessage: String? = null,
    val eventLogs: List<String> = emptyList(),
)

data class RoomPreview(
    val roomId: String,
    val name: String,
    val hostName: String,
    val onlineCount: Int,
)

data class WalletSummary(
    val walletGold: Long,
    val walletBonusGold: Long,
    val frozenGold: Long,
    val totalSpentGold: Long,
    val spent30dGold: Long,
    val riskLevel: String,
)

data class GiftSku(
    val giftSkuId: String,
    val tier: String,
    val priceGold: Long,
    val name: String,
)

data class LoginRequest(
    val phone: String,
    val otp: String,
    val country: String,
    val language: String,
    val deviceId: String,
)

data class LoginResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresInSeconds: Long,
    val sessionId: String,
)

data class RefreshResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresInSeconds: Long,
    val sessionId: String,
)

data class RoomCreateResult(
    val roomId: String,
    val ownerUid: String,
    val visibility: String,
)

data class JoinTokenResult(
    val joinToken: String,
    val sessionId: String,
)

data class ReconnectTokenResult(
    val roomId: String,
    val sessionId: String,
    val reconnectToken: String,
    val expiresAt: String,
)

data class ReconnectSnapshotSeatState(
    val seatNo: Int?,
    val seatStatus: String,
    val uid: String?,
    val producerId: String?,
    val errorCode: String?,
)

data class ReconnectSnapshotResult(
    val roomId: String,
    val sessionId: String,
    val snapshotSeq: Long,
    val seatState: ReconnectSnapshotSeatState,
    val seatIntent: Int?,
    val subscriptionLimit: Int,
    val degradeLevel: String,
    val activeSpeakers: List<String>,
    val leaderboard: List<LeaderboardEntry>,
    val giftOrders: List<String>,
    val resumeCursor: Long,
    val needResubscribe: Boolean,
    val rejoinRequired: Boolean,
)

data class RechargeVerifyResult(
    val rechargeOrderId: String,
    val creditedGold: Long,
    val status: String,
)

data class RechargeOrderStatus(
    val rechargeOrderId: String,
    val status: String,
    val reasonCode: String?,
)

data class GiftOrderStatus(
    val giftOrderId: String,
    val status: String,
    val reasonCode: String?,
    val amountGold: Long,
)

data class RtcPlanResult(
    val roomId: String,
    val workerId: String,
    val activeSpeakers: List<String>,
    val subscriptionLimit: Int,
    val degradeLevel: String,
)

data class RtcMetricPoint(
    val bucketMinute: String,
    val latencyP95: Double,
    val jitterP95: Double,
    val lossRatio: Double,
    val stallMs: Double,
    val degradeEvents: Int,
    val recoverRatio15s: Double,
)

class LoginViewModel(
    private val authRepository: AuthRepository,
    private val roomRepository: RoomRepository,
    private val tokenStore: TokenStore,
    private val deviceInfoProvider: DeviceInfoProvider,
    private val realtimeGateway: RealtimeRoomGateway,
) : ViewModel(), RealtimeRoomListener {
    private val mutableUiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = mutableUiState.asStateFlow()

    private var activeDeviceId: String? = null

    fun onPhoneChanged(value: String) {
        mutableUiState.update {
            it.copy(phone = value.trim(), errorMessage = null)
        }
    }

    fun onOtpChanged(value: String) {
        val digitsOnly = value.filter(Char::isDigit).take(otpLength)
        mutableUiState.update {
            it.copy(otp = digitsOnly, errorMessage = null)
        }
    }

    fun onCountrySelected(value: String) {
        mutableUiState.update {
            it.copy(country = value, errorMessage = null)
        }
    }

    fun onLanguageSelected(value: String) {
        mutableUiState.update {
            it.copy(language = value, errorMessage = null)
        }
    }

    fun onCreateRoomTopicChanged(value: String) {
        mutableUiState.update {
            it.copy(createRoomTopic = value, errorMessage = null)
        }
    }

    fun onCreateRoomVisibilityChanged(value: String) {
        mutableUiState.update {
            it.copy(createRoomVisibility = value, errorMessage = null)
        }
    }

    fun onGiftTargetChanged(value: String) {
        mutableUiState.update {
            it.copy(giftTargetUid = value.trim(), errorMessage = null)
        }
    }

    fun onGiftCountChanged(value: String) {
        val normalized = value.filter(Char::isDigit).take(2)
        mutableUiState.update {
            it.copy(giftCountInput = normalized, errorMessage = null)
        }
    }

    fun onLoginClicked() {
        val snapshot = uiState.value
        val validationMessage = validate(snapshot)
        if (validationMessage != null) {
            mutableUiState.update { it.copy(errorMessage = validationMessage) }
            return
        }
        if (snapshot.isLoading) {
            return
        }

        viewModelScope.launch {
            mutableUiState.update { it.copy(isLoading = true, errorMessage = null, statusMessage = null) }
            val request = LoginRequest(
                phone = snapshot.phone,
                otp = snapshot.otp,
                country = snapshot.country,
                language = snapshot.language,
                deviceId = deviceInfoProvider.deviceId(),
            )

            runCatching { authRepository.login(request) }
                .onSuccess { response ->
                    activeDeviceId = request.deviceId
                    tokenStore.save(response)
                    realtimeGateway.connect(response.accessToken, request.deviceId, this@LoginViewModel)
                    val rooms = runCatching {
                        roomRepository.fetchRecommendedRooms(response.accessToken)
                    }.getOrElse { emptyList() }
                    val wallet = runCatching {
                        authRepository.fetchWalletSummary(response.accessToken)
                    }.getOrNull()
                    mutableUiState.update {
                        it.copy(
                            isLoading = false,
                            isLoginSuccess = true,
                            sessionId = response.sessionId,
                            rooms = rooms,
                            walletSummary = wallet,
                            statusMessage = "Login success.",
                            errorMessage = null,
                        )
                    }
                }
                .onFailure { throwable ->
                    mutableUiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = throwable.message ?: genericError,
                        )
                    }
                }
        }
    }

    fun onRefreshSessionClicked() {
        val session = tokenStore.latest()
        val deviceId = activeDeviceId
        if (session == null || deviceId.isNullOrBlank()) {
            mutableUiState.update {
                it.copy(errorMessage = "No active session.")
            }
            return
        }

        viewModelScope.launch {
            mutableUiState.update { it.copy(isLoading = true, errorMessage = null) }
            runCatching {
                authRepository.refreshSession(
                    refreshToken = session.refreshToken,
                    sessionId = session.sessionId,
                    deviceId = deviceId,
                )
            }.onSuccess { refreshed ->
                tokenStore.save(
                    LoginResponse(
                        accessToken = refreshed.accessToken,
                        refreshToken = refreshed.refreshToken,
                        expiresInSeconds = refreshed.expiresInSeconds,
                        sessionId = refreshed.sessionId,
                    ),
                )
                realtimeGateway.disconnect()
                realtimeGateway.connect(refreshed.accessToken, deviceId, this@LoginViewModel)
                mutableUiState.update {
                    it.copy(
                        isLoading = false,
                        sessionId = refreshed.sessionId,
                        statusMessage = "Refresh rotated successfully.",
                        errorMessage = null,
                    )
                }
                onReloadWalletClicked()
            }.onFailure { throwable ->
                mutableUiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = throwable.message ?: genericError,
                    )
                }
            }
        }
    }

    fun onReloadWalletClicked() {
        val session = tokenStore.latest()
        if (session == null) {
            mutableUiState.update { it.copy(errorMessage = "Session is missing.") }
            return
        }

        viewModelScope.launch {
            runCatching { authRepository.fetchWalletSummary(session.accessToken) }
                .onSuccess { wallet ->
                    mutableUiState.update {
                        it.copy(
                            walletSummary = wallet,
                            statusMessage = "Wallet summary updated.",
                            errorMessage = null,
                        )
                    }
                }
                .onFailure { throwable ->
                    mutableUiState.update {
                        it.copy(errorMessage = throwable.message ?: genericError)
                    }
                }
        }
    }

    fun onCreateRoomClicked() {
        val session = tokenStore.latest()
        val snapshot = uiState.value
        if (session == null) {
            mutableUiState.update { it.copy(errorMessage = "Session is missing.") }
            return
        }

        val topic = snapshot.createRoomTopic.trim()
        if (topic.length < 3) {
            mutableUiState.update { it.copy(errorMessage = "Room topic must be at least 3 chars.") }
            return
        }

        viewModelScope.launch {
            runCatching {
                roomRepository.createRoom(
                    accessToken = session.accessToken,
                    visibility = snapshot.createRoomVisibility,
                    topic = topic,
                    tags = listOf("android", "req002"),
                    language = snapshot.language,
                )
            }.onSuccess { created ->
                val updatedRooms = roomRepository.fetchRecommendedRooms(session.accessToken)
                mutableUiState.update {
                    it.copy(
                        rooms = updatedRooms,
                        activeRoomId = created.roomId,
                        statusMessage = "Room ${created.roomId} created.",
                        errorMessage = null,
                    )
                }
                appendEvent("create_room -> ${created.roomId}")
            }.onFailure { throwable ->
                mutableUiState.update { it.copy(errorMessage = throwable.message ?: genericError) }
            }
        }
    }

    fun onJoinRoomClicked(roomId: String) {
        val session = tokenStore.latest()
        val deviceId = activeDeviceId
        if (session == null || deviceId.isNullOrBlank()) {
            mutableUiState.update { it.copy(errorMessage = "Session is missing.") }
            return
        }

        viewModelScope.launch {
            runCatching {
                roomRepository.issueJoinToken(
                    accessToken = session.accessToken,
                    roomId = roomId,
                    deviceId = deviceId,
                    installId = "android_install_main",
                )
            }.onSuccess { token ->
                realtimeGateway.joinRoom(roomId = roomId, joinToken = token.joinToken)
                mutableUiState.update {
                    it.copy(
                        activeRoomId = roomId,
                        statusMessage = "Join token issued, waiting room.joined.",
                        errorMessage = null,
                    )
                }
                appendEvent("join_token -> ${token.joinToken.take(16)}...")
            }.onFailure { throwable ->
                mutableUiState.update {
                    it.copy(errorMessage = throwable.message ?: genericError)
                }
            }
        }
    }

    fun onLoadGiftsClicked(roomId: String) {
        val session = tokenStore.latest()
        val snapshot = uiState.value
        if (session == null) {
            mutableUiState.update { it.copy(errorMessage = "Session is missing.") }
            return
        }

        viewModelScope.launch {
            runCatching {
                roomRepository.fetchGiftCatalog(
                    accessToken = session.accessToken,
                    roomId = roomId,
                    country = snapshot.country,
                )
            }.onSuccess { gifts ->
                mutableUiState.update {
                    it.copy(
                        activeRoomId = roomId,
                        gifts = gifts,
                        statusMessage = "Gift catalog loaded.",
                        errorMessage = null,
                    )
                }
                appendEvent("load_gifts -> room=$roomId size=${gifts.size}")
            }.onFailure { throwable ->
                mutableUiState.update { it.copy(errorMessage = throwable.message ?: genericError) }
            }
        }
    }

    fun onSendGiftClicked(giftSkuId: String) {
        val snapshot = uiState.value
        val roomId = snapshot.activeRoomId
        if (roomId.isNullOrBlank()) {
            mutableUiState.update { it.copy(errorMessage = "Please join a room first.") }
            return
        }
        val count = snapshot.giftCountInput.toIntOrNull()
        if (count == null || count !in 1..99) {
            mutableUiState.update { it.copy(errorMessage = "Gift count must be 1~99.") }
            return
        }
        if (snapshot.giftTargetUid.isBlank()) {
            mutableUiState.update { it.copy(errorMessage = "to_uid is required.") }
            return
        }

        val command = GiftSendCommand(
            roomId = roomId,
            giftSkuId = giftSkuId,
            count = count,
            toUid = snapshot.giftTargetUid,
            idempotencyKey = buildGiftIdempotencyKey(),
        )
        mutableUiState.update {
            it.copy(
                lastGiftCommand = command,
                needRecharge = false,
                errorMessage = null,
                statusMessage = "gift.send emitted.",
            )
        }
        appendEvent("gift.send -> ${command.idempotencyKey}")
        realtimeGateway.sendGift(command)
    }

    fun onRetryLastGiftClicked() {
        val last = uiState.value.lastGiftCommand
        if (last == null) {
            mutableUiState.update { it.copy(errorMessage = "No previous gift command.") }
            return
        }
        appendEvent("gift.retry -> ${last.idempotencyKey}")
        realtimeGateway.sendGift(last)
    }

    fun onCreateRtcTransportClicked() {
        val roomId = uiState.value.activeRoomId
        if (roomId.isNullOrBlank()) {
            mutableUiState.update { it.copy(errorMessage = "Join a room before creating transport.") }
            return
        }
        realtimeGateway.createRtcTransport(
            RtcCreateTransportCommand(
                roomId = roomId,
                direction = "send",
            ),
        )
        appendEvent("rtc.create_transport -> room=$roomId")
    }

    fun onConnectRtcTransportClicked() {
        val transportId = uiState.value.rtcTransportId
        if (transportId.isNullOrBlank()) {
            mutableUiState.update { it.copy(errorMessage = "No transport_id. Create transport first.") }
            return
        }
        realtimeGateway.connectRtcTransport(
            RtcConnectTransportCommand(
                transportId = transportId,
                dtlsParameters = mapOf("role" to "auto"),
            ),
        )
        appendEvent("rtc.connect_transport -> $transportId")
    }

    fun onPublishSeatClicked(seatNo: Int = 1) {
        val transportId = uiState.value.rtcTransportId
        if (transportId.isNullOrBlank()) {
            mutableUiState.update { it.copy(errorMessage = "No transport_id. Connect transport first.") }
            return
        }
        if (seatNo !in 1..8) {
            mutableUiState.update { it.copy(errorMessage = "seat_no must be 1..8.") }
            return
        }
        mutableUiState.update {
            it.copy(reconnectSeatIntent = seatNo, errorMessage = null)
        }
        realtimeGateway.produceAudio(
            RtcProduceCommand(
                transportId = transportId,
                seatNo = seatNo,
            ),
        )
        appendEvent("rtc.produce -> seat=$seatNo")
    }

    fun onConsumeLatestProducerClicked(simulateWeakNetwork: Boolean = false) {
        val snapshot = uiState.value
        val roomId = snapshot.activeRoomId
        val producerId = snapshot.rtcProducerId
        if (roomId.isNullOrBlank() || producerId.isNullOrBlank()) {
            mutableUiState.update { it.copy(errorMessage = "No available producer to consume.") }
            return
        }

        val network = if (simulateWeakNetwork) {
            NetworkSnapshot(
                packetLoss = 0.2,
                jitterP95 = 220.0,
                rtt = 500.0,
                stallMs = 1800.0,
            )
        } else {
            null
        }
        realtimeGateway.consumeAudio(
            RtcConsumeCommand(
                roomId = roomId,
                producerId = producerId,
                network = network,
            ),
        )
        appendEvent("rtc.consume -> producer=$producerId weak=$simulateWeakNetwork")
    }

    fun onLoadRtcPlanClicked() {
        val session = tokenStore.latest()
        val roomId = uiState.value.activeRoomId
        if (session == null || roomId.isNullOrBlank()) {
            mutableUiState.update { it.copy(errorMessage = "Session or room is missing.") }
            return
        }

        viewModelScope.launch {
            runCatching {
                roomRepository.fetchRtcPlan(
                    accessToken = session.accessToken,
                    roomId = roomId,
                )
            }.onSuccess { plan ->
                mutableUiState.update {
                    it.copy(
                        rtcSubscriptionLimit = plan.subscriptionLimit,
                        rtcDegradeLevel = plan.degradeLevel,
                        rtcActiveSpeakers = plan.activeSpeakers,
                        statusMessage = "RTC plan refreshed from worker ${plan.workerId}.",
                        errorMessage = null,
                    )
                }
                appendEvent("rtc.plan -> limit=${plan.subscriptionLimit} level=${plan.degradeLevel}")
            }.onFailure { throwable ->
                mutableUiState.update { it.copy(errorMessage = throwable.message ?: genericError) }
            }
        }
    }

    fun onLoadRtcMetricsClicked() {
        val session = tokenStore.latest()
        val roomId = uiState.value.activeRoomId
        if (session == null || roomId.isNullOrBlank()) {
            mutableUiState.update { it.copy(errorMessage = "Session or room is missing.") }
            return
        }

        viewModelScope.launch {
            runCatching {
                roomRepository.fetchRtcMetrics(
                    accessToken = session.accessToken,
                    roomId = roomId,
                )
            }.onSuccess { metrics ->
                val latest = metrics.lastOrNull()
                mutableUiState.update {
                    it.copy(
                        statusMessage = if (latest == null) {
                            "RTC metrics empty."
                        } else {
                            "RTC metrics p95=${latest.latencyP95}ms loss=${latest.lossRatio}"
                        },
                        errorMessage = null,
                    )
                }
                appendEvent("rtc.metrics -> points=${metrics.size}")
            }.onFailure { throwable ->
                mutableUiState.update { it.copy(errorMessage = throwable.message ?: genericError) }
            }
        }
    }

    fun onRechargeClicked() {
        val session = tokenStore.latest()
        if (session == null) {
            mutableUiState.update { it.copy(errorMessage = "Session is missing.") }
            return
        }

        viewModelScope.launch {
            val idempotencyKey = buildPaymentIdempotencyKey()
            runCatching {
                roomRepository.verifyGooglePlayRecharge(
                    accessToken = session.accessToken,
                    idempotencyKey = idempotencyKey,
                    productId = "gold_980",
                    purchaseToken = "purchase_android_${UUID.randomUUID().toString().replace("-", "")}",
                    orderId = "gp_order_${UUID.randomUUID().toString().replace("-", "").take(16)}",
                    amount = "4.99",
                )
            }.onSuccess { recharge ->
                val order = roomRepository.queryRechargeOrder(
                    accessToken = session.accessToken,
                    orderId = recharge.rechargeOrderId,
                )
                mutableUiState.update {
                    it.copy(
                        needRecharge = false,
                        statusMessage = "Recharge ${order.status} (+${recharge.creditedGold} gold).",
                        errorMessage = null,
                    )
                }
                appendEvent("recharge -> ${order.rechargeOrderId}:${order.status}")
                onReloadWalletClicked()
            }.onFailure { throwable ->
                mutableUiState.update {
                    it.copy(errorMessage = throwable.message ?: genericError)
                }
            }
        }
    }

    fun onQueryLastGiftOrderClicked() {
        val session = tokenStore.latest()
        val orderId = uiState.value.lastGiftOrderId
        if (session == null || orderId.isNullOrBlank()) {
            mutableUiState.update { it.copy(errorMessage = "No gift order to query.") }
            return
        }

        viewModelScope.launch {
            runCatching {
                roomRepository.queryGiftOrder(
                    accessToken = session.accessToken,
                    orderId = orderId,
                )
            }.onSuccess { order ->
                mutableUiState.update {
                    it.copy(
                        statusMessage = "Gift order ${order.giftOrderId} -> ${order.status}",
                        errorMessage = null,
                    )
                }
                appendEvent("gift_order -> ${order.giftOrderId}:${order.status}")
            }.onFailure { throwable ->
                mutableUiState.update {
                    it.copy(errorMessage = throwable.message ?: genericError)
                }
            }
        }
    }

    fun onBackToLogin() {
        realtimeGateway.disconnect()
        mutableUiState.update {
            LoginUiState()
        }
    }

    override fun onConnected() {
        dispatchUiUpdate {
            it.copy(realtimeConnected = true, statusMessage = "Socket connected.")
        }
        maybeReconnectRoom()
    }

    override fun onDisconnected() {
        dispatchUiUpdate {
            it.copy(
                realtimeConnected = false,
                reconnectPending = true,
                reconnectState = "RECONNECTING",
                statusMessage = "Socket disconnected, waiting reconnect.",
            )
        }
    }

    override fun onRoomJoined(event: RoomJoinedEvent) {
        dispatchUiUpdate {
            it.copy(
                activeRoomId = event.roomId,
                sessionId = event.sessionId,
                reconnectToken = null,
                reconnectLastSeq = 0L,
                rtcTransportId = null,
                rtcProducerId = null,
                rtcConsumerId = null,
                rtcActiveSpeakers = emptyList(),
                rtcDegradeLevel = "FULL_8",
                rtcSubscriptionLimit = 8,
                statusMessage = "room.joined session=${event.sessionId}",
                errorMessage = null,
                reconnectPending = false,
                reconnectState = "CONNECTED",
                reconnectExpiresAt = null,
            )
        }
        appendEvent("room.joined -> online=${event.onlineCount}")
        refreshReconnectToken(event.roomId, event.sessionId)
    }

    override fun onRoomJoinFailed(errorCode: String, message: String) {
        dispatchUiUpdate {
            it.copy(errorMessage = "$errorCode: $message")
        }
        appendEvent("room.join_failed -> $errorCode")
    }

    override fun onGiftAccepted(event: GiftAcceptedEvent) {
        dispatchUiUpdate {
            it.copy(
                lastGiftOrderId = event.giftOrderId,
                needRecharge = false,
                statusMessage = "gift.accepted order=${event.giftOrderId}",
                errorMessage = null,
            )
        }
        appendEvent("gift.accepted -> balance=${event.balanceAfter}")
    }

    override fun onGiftBroadcast(event: GiftBroadcastEvent) {
        dispatchUiUpdate {
            it.copy(
                statusMessage = "gift.broadcast amount=${event.amountGold}",
                errorMessage = null,
            )
        }
        appendEvent("gift.broadcast -> ${event.giftSkuId} x${event.count}")
    }

    override fun onLeaderboardUpdated(roomId: String, leaderboard: List<LeaderboardEntry>) {
        val top = leaderboard.firstOrNull()
        appendEvent("leaderboard.updated -> room=$roomId top=${top?.uid ?: "-"}")
    }

    override fun onGiftRejected(event: GiftRejectedEvent) {
        dispatchUiUpdate {
            it.copy(
                needRecharge = event.errorCode == "GIFT_002",
                lastGiftOrderId = event.giftOrderId ?: it.lastGiftOrderId,
                errorMessage = "${event.errorCode}: ${event.message}",
            )
        }
        appendEvent("gift.rejected -> ${event.errorCode}")
    }

    override fun onRtcTransportCreated(event: RtcTransportCreatedEvent) {
        dispatchUiUpdate {
            it.copy(
                rtcTransportId = event.transportId,
                statusMessage = "rtc.transport_created ${event.transportId}",
                errorMessage = null,
            )
        }
        appendEvent("rtc.transport_created -> ${event.transportId}")
    }

    override fun onRtcTransportConnected(event: RtcTransportConnectedEvent) {
        dispatchUiUpdate {
            it.copy(
                statusMessage = "rtc.transport_connected ${event.transportId}",
                errorMessage = null,
            )
        }
        appendEvent("rtc.transport_connected -> ${event.connected}")
    }

    override fun onRtcNewProducer(event: RtcNewProducerEvent) {
        dispatchUiUpdate {
            it.copy(
                rtcProducerId = event.producerId,
                statusMessage = "rtc.new_producer seat=${event.seatNo}",
                errorMessage = null,
            )
        }
        appendEvent("rtc.new_producer -> ${event.producerId}")
    }

    override fun onRtcConsumerCreated(event: RtcConsumerCreatedEvent) {
        dispatchUiUpdate {
            it.copy(
                rtcConsumerId = event.consumerId,
                statusMessage = "rtc.consumer_created ${event.consumerId}",
                errorMessage = null,
            )
        }
        appendEvent("rtc.consumer_created -> ${event.consumerId}")
    }

    override fun onRtcSubscriptionPlan(event: RtcSubscriptionPlanEvent) {
        dispatchUiUpdate {
            it.copy(
                rtcSubscriptionLimit = event.subscriptionLimit,
                rtcDegradeLevel = event.degradeLevel,
                rtcActiveSpeakers = event.activeSpeakers,
                statusMessage = "rtc.subscription_plan ${event.degradeLevel}/${event.subscriptionLimit}",
                errorMessage = null,
            )
        }
        appendEvent("rtc.subscription_plan -> ${event.degradeLevel}/${event.subscriptionLimit}")
    }

    override fun onRtcDegradeApplied(event: RtcDegradeAppliedEvent) {
        dispatchUiUpdate {
            it.copy(
                rtcDegradeLevel = event.degradeLevel,
                statusMessage = "rtc.degrade.applied ${event.degradeLevel}",
                errorMessage = null,
            )
        }
        appendEvent("rtc.degrade.applied -> ${event.reason}")
    }

    override fun onRtcDegradeRecovered(event: RtcDegradeRecoveredEvent) {
        dispatchUiUpdate {
            it.copy(
                rtcDegradeLevel = event.toLevel,
                statusMessage = "rtc.degrade.recovered ${event.fromLevel}->${event.toLevel}",
                errorMessage = null,
            )
        }
        appendEvent("rtc.degrade.recovered -> ${event.elapsedMs}ms")
    }

    override fun onRtcSeatUpdated(event: RtcSeatUpdatedEvent) {
        if (event.action == "RELEASED" && uiState.value.rtcProducerId == event.producerId) {
            dispatchUiUpdate {
                it.copy(rtcProducerId = null)
            }
        }
        if (event.action == "OCCUPIED") {
            dispatchUiUpdate {
                it.copy(reconnectSeatIntent = event.seatNo)
            }
        }
        appendEvent("rtc.seat.updated -> seat=${event.seatNo} action=${event.action}")
    }

    override fun onSessionReconnected(event: SessionReconnectedEvent) {
        dispatchUiUpdate {
            it.copy(
                reconnectPending = false,
                reconnectState = if (event.resumeOk) "RECOVERED" else "REJOIN_REQUIRED",
                reconnectLastSeq = event.lastSeq,
                reconnectExpiresAt = event.expiresAt,
                statusMessage = if (event.resumeOk) {
                    "session.reconnected ${event.sessionId}"
                } else {
                    "session.reconnected requires rejoin"
                },
                errorMessage = event.errorCode?.let { code -> "$code: ${event.reason ?: "reconnect failed"}" },
            )
        }
        appendEvent("session.reconnected -> resume=${event.resumeOk} seq=${event.lastSeq}")
        if (event.rejoinRequired || !event.resumeOk) {
            rejoinRoomAfterReconnect(event.roomId)
            return
        }
        if (event.needSnapshotPull || event.needResubscribe) {
            refreshReconnectSnapshot(event.sessionId)
        }
    }

    override fun onRoomRecoverHint(event: RoomRecoverHintEvent) {
        appendEvent("room.recover_hint -> ${event.reason}")
        val session = tokenStore.latest()
        if (session == null) {
            return
        }
        val currentSessionId = uiState.value.sessionId
        if (currentSessionId.isNullOrBlank()) {
            return
        }
        if (currentSessionId != event.sessionId) {
            return
        }
        refreshReconnectSnapshot(event.sessionId)
    }

    override fun onRtcError(event: RtcErrorEvent) {
        dispatchUiUpdate {
            it.copy(
                errorMessage = "${event.errorCode}: ${event.message}",
                reconnectState = if (event.errorCode.startsWith("RECON_")) "REJOIN_REQUIRED" else it.reconnectState,
            )
        }
        appendEvent("rtc.error -> ${event.errorCode}")
    }

    override fun onError(message: String) {
        dispatchUiUpdate { it.copy(errorMessage = message) }
        appendEvent("socket.error -> $message")
    }

    override fun onCleared() {
        realtimeGateway.disconnect()
        super.onCleared()
    }

    private fun validate(snapshot: LoginUiState): String? {
        if (!phoneRegex.matches(snapshot.phone)) {
            return invalidPhoneError
        }
        if (snapshot.otp.length != otpLength) {
            return invalidOtpError
        }
        return null
    }

    private fun dispatchUiUpdate(update: (LoginUiState) -> LoginUiState) {
        viewModelScope.launch {
            mutableUiState.update(update)
        }
    }

    private fun appendEvent(message: String) {
        dispatchUiUpdate {
            val nextSeq = it.reconnectLastSeq + 1
            val logLine = "[${System.currentTimeMillis()}][seq=$nextSeq] $message"
            val logs = (it.eventLogs + logLine).takeLast(40)
            it.copy(eventLogs = logs, reconnectLastSeq = nextSeq)
        }
    }

    private fun maybeReconnectRoom() {
        val snapshot = uiState.value
        if (!snapshot.reconnectPending) {
            return
        }
        if (snapshot.activeRoomId.isNullOrBlank()) {
            return
        }
        if (snapshot.sessionId.isNullOrBlank()) {
            return
        }
        if (snapshot.reconnectToken.isNullOrBlank()) {
            return
        }

        realtimeGateway.reconnectSession(
            SessionReconnectCommand(
                roomId = snapshot.activeRoomId,
                sessionId = snapshot.sessionId,
                reconnectToken = snapshot.reconnectToken,
                lastSeq = snapshot.reconnectLastSeq,
            ),
        )
        appendEvent("session.reconnect -> ${snapshot.sessionId}")
    }

    private fun refreshReconnectToken(roomId: String, sessionId: String) {
        val session = tokenStore.latest() ?: return
        val deviceId = activeDeviceId ?: return
        viewModelScope.launch {
            runCatching {
                roomRepository.issueReconnectToken(
                    accessToken = session.accessToken,
                    roomId = roomId,
                    sessionId = sessionId,
                    deviceId = deviceId,
                    installId = "android_install_main",
                    seatIntent = uiState.value.reconnectSeatIntent,
                )
            }.onSuccess { token ->
                mutableUiState.update {
                    it.copy(
                        reconnectToken = token.reconnectToken,
                        reconnectExpiresAt = token.expiresAt,
                        reconnectState = "CONNECTED",
                    )
                }
                appendEvent("reconnect.token -> ${token.expiresAt}")
                if (uiState.value.reconnectPending) {
                    maybeReconnectRoom()
                }
            }.onFailure { throwable ->
                dispatchUiUpdate {
                    it.copy(errorMessage = throwable.message ?: genericError)
                }
            }
        }
    }

    private fun refreshReconnectSnapshot(sessionId: String) {
        val session = tokenStore.latest() ?: return
        viewModelScope.launch {
            runCatching {
                roomRepository.recoverReconnectSnapshot(
                    accessToken = session.accessToken,
                    sessionId = sessionId,
                )
            }.onSuccess { snapshot ->
                mutableUiState.update {
                    it.copy(
                        rtcSubscriptionLimit = snapshot.subscriptionLimit,
                        rtcDegradeLevel = snapshot.degradeLevel,
                        rtcActiveSpeakers = snapshot.activeSpeakers,
                        rtcProducerId = snapshot.seatState.producerId,
                        reconnectLastSeq = snapshot.resumeCursor,
                        reconnectState = if (snapshot.rejoinRequired) "REJOIN_REQUIRED" else "RECOVERED",
                        statusMessage = "reconnect snapshot ${snapshot.snapshotSeq}",
                        errorMessage = null,
                    )
                }
                appendEvent("reconnect.snapshot -> seq=${snapshot.snapshotSeq}")
            }.onFailure { throwable ->
                dispatchUiUpdate {
                    it.copy(errorMessage = throwable.message ?: genericError)
                }
            }
        }
    }

    private fun rejoinRoomAfterReconnect(roomId: String) {
        if (roomId.isBlank()) {
            return
        }
        val current = uiState.value
        if (current.reconnectState == "REJOIN_REQUIRED" && current.reconnectPending) {
            return
        }
        dispatchUiUpdate {
            it.copy(
                reconnectPending = true,
                reconnectState = "REJOIN_REQUIRED",
                statusMessage = "Rejoining room after reconnect failure.",
            )
        }
        onJoinRoomClicked(roomId)
    }
}

class LoginViewModelFactory(
    private val context: Context,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        val tokenStore = SecureTokenStore(context = context)
        val deviceInfoProvider = AndroidDeviceInfoProvider(context = context)
        val authRepository = NetworkAuthRepository(baseUrl = authBaseUrl)
        val roomRepository = NetworkRoomRepository(baseUrl = authBaseUrl)
        val realtimeGateway = SocketIoRealtimeRoomGateway(baseUrl = authBaseUrl)
        return LoginViewModel(
            authRepository = authRepository,
            roomRepository = roomRepository,
            tokenStore = tokenStore,
            deviceInfoProvider = deviceInfoProvider,
            realtimeGateway = realtimeGateway,
        ) as T
    }
}

interface AuthRepository {
    suspend fun login(request: LoginRequest): LoginResponse
    suspend fun refreshSession(refreshToken: String, sessionId: String, deviceId: String): RefreshResponse {
        throw UnsupportedOperationException("Refresh API is not available.")
    }

    suspend fun fetchWalletSummary(accessToken: String): WalletSummary {
        throw UnsupportedOperationException("Wallet summary API is not available.")
    }
}

interface RoomRepository {
    suspend fun fetchRecommendedRooms(accessToken: String): List<RoomPreview>
    suspend fun createRoom(
        accessToken: String,
        visibility: String,
        topic: String,
        tags: List<String>,
        language: String,
    ): RoomCreateResult {
        throw UnsupportedOperationException("Create room API is not available.")
    }

    suspend fun issueJoinToken(
        accessToken: String,
        roomId: String,
        deviceId: String,
        installId: String,
    ): JoinTokenResult {
        throw UnsupportedOperationException("Join token API is not available.")
    }

    suspend fun issueReconnectToken(
        accessToken: String,
        roomId: String,
        sessionId: String,
        deviceId: String,
        installId: String,
        seatIntent: Int?,
    ): ReconnectTokenResult {
        throw UnsupportedOperationException("Reconnect token API is not available.")
    }

    suspend fun recoverReconnectSnapshot(
        accessToken: String,
        sessionId: String,
    ): ReconnectSnapshotResult {
        throw UnsupportedOperationException("Reconnect snapshot API is not available.")
    }

    suspend fun fetchGiftCatalog(
        accessToken: String,
        roomId: String,
        country: String,
    ): List<GiftSku> {
        throw UnsupportedOperationException("Gift catalog API is not available.")
    }

    suspend fun verifyGooglePlayRecharge(
        accessToken: String,
        idempotencyKey: String,
        productId: String,
        purchaseToken: String,
        orderId: String,
        amount: String,
    ): RechargeVerifyResult {
        throw UnsupportedOperationException("Recharge API is not available.")
    }

    suspend fun queryRechargeOrder(accessToken: String, orderId: String): RechargeOrderStatus {
        throw UnsupportedOperationException("Recharge order query API is not available.")
    }

    suspend fun queryGiftOrder(accessToken: String, orderId: String): GiftOrderStatus {
        throw UnsupportedOperationException("Gift order query API is not available.")
    }

    suspend fun fetchRtcPlan(accessToken: String, roomId: String): RtcPlanResult {
        throw UnsupportedOperationException("RTC plan API is not available.")
    }

    suspend fun fetchRtcMetrics(accessToken: String, roomId: String): List<RtcMetricPoint> {
        throw UnsupportedOperationException("RTC metrics API is not available.")
    }
}

class NetworkAuthRepository(
    private val baseUrl: String,
) : AuthRepository {
    override suspend fun login(request: LoginRequest): LoginResponse = withContext(Dispatchers.IO) {
        val response = httpPost(
            url = "$baseUrl/api/v1/auth/otp/verify",
            body = JSONObject().apply {
                put("phone_e164", request.phone)
                put("otp_code", request.otp)
                put("country", request.country)
                put("language", request.language)
                put("device_id", request.deviceId)
            },
        )
        val root = parseRoot(response)
        val data = parseEnvelope(root)
        LoginResponse(
            accessToken = pickString(data, root, "access_token", "accessToken"),
            refreshToken = pickString(data, root, "refresh_token", "refreshToken"),
            expiresInSeconds = pickLong(data, root, "expires_in_sec", "expiresInSeconds"),
            sessionId = pickString(data, root, "session_id", "sessionId"),
        )
    }

    override suspend fun refreshSession(
        refreshToken: String,
        sessionId: String,
        deviceId: String,
    ): RefreshResponse = withContext(Dispatchers.IO) {
        val response = httpPost(
            url = "$baseUrl/api/v1/auth/refresh",
            body = JSONObject().apply {
                put("refresh_token", refreshToken)
                put("session_id", sessionId)
                put("device_id", deviceId)
            },
        )
        val root = parseRoot(response)
        val data = parseEnvelope(root)
        RefreshResponse(
            accessToken = pickString(data, root, "access_token", "accessToken"),
            refreshToken = pickString(data, root, "refresh_token", "refreshToken"),
            expiresInSeconds = pickLong(data, root, "expires_in_sec", "expiresInSeconds"),
            sessionId = pickString(data, root, "session_id", "sessionId"),
        )
    }

    override suspend fun fetchWalletSummary(accessToken: String): WalletSummary =
        withContext(Dispatchers.IO) {
            val response = httpGet(
                url = "$baseUrl/api/v1/wallet/summary",
                accessToken = accessToken,
            )
            val root = parseRoot(response)
            val data = parseEnvelope(root)
            WalletSummary(
                walletGold = pickLong(data, root, "wallet_gold"),
                walletBonusGold = pickLong(data, root, "wallet_bonus_gold"),
                frozenGold = pickLong(data, root, "frozen_gold"),
                totalSpentGold = pickLong(data, root, "total_spent_gold"),
                spent30dGold = pickLong(data, root, "spent_30d_gold"),
                riskLevel = pickString(data, root, "risk_level"),
            )
        }
}

class NetworkRoomRepository(
    private val baseUrl: String,
) : RoomRepository {
    override suspend fun fetchRecommendedRooms(accessToken: String): List<RoomPreview> =
        withContext(Dispatchers.IO) {
            val response = httpGet(
                url = "$baseUrl/api/v1/rooms/demo",
                accessToken = accessToken,
            )
            val root = parseRoot(response)
            val roomsArray = root.optJSONArray("rooms") ?: JSONArray()
            buildList {
                for (index in 0 until roomsArray.length()) {
                    val room = roomsArray.optJSONObject(index) ?: continue
                    add(
                        RoomPreview(
                            roomId = room.optString("roomId"),
                            name = room.optString("name"),
                            hostName = room.optString("hostName"),
                            onlineCount = room.optInt("onlineCount"),
                        ),
                    )
                }
            }
        }

    override suspend fun createRoom(
        accessToken: String,
        visibility: String,
        topic: String,
        tags: List<String>,
        language: String,
    ): RoomCreateResult = withContext(Dispatchers.IO) {
        val response = httpPost(
            url = "$baseUrl/api/v1/rooms",
            accessToken = accessToken,
            body = JSONObject().apply {
                put("visibility", visibility)
                put("topic", topic)
                put("tags", JSONArray(tags))
                put("language", language)
            },
        )
        val data = parseEnvelope(parseRoot(response))
        RoomCreateResult(
            roomId = data.optString("room_id"),
            ownerUid = data.optString("owner_uid"),
            visibility = data.optString("visibility"),
        )
    }

    override suspend fun issueJoinToken(
        accessToken: String,
        roomId: String,
        deviceId: String,
        installId: String,
    ): JoinTokenResult = withContext(Dispatchers.IO) {
        val response = httpPost(
            url = "$baseUrl/api/v1/rooms/$roomId/join-token",
            accessToken = accessToken,
            body = JSONObject().apply {
                put("device_id", deviceId)
                put("install_id", installId)
            },
        )
        val data = parseEnvelope(parseRoot(response))
        JoinTokenResult(
            joinToken = data.optString("join_token"),
            sessionId = data.optString("session_id"),
        )
    }

    override suspend fun issueReconnectToken(
        accessToken: String,
        roomId: String,
        sessionId: String,
        deviceId: String,
        installId: String,
        seatIntent: Int?,
    ): ReconnectTokenResult = withContext(Dispatchers.IO) {
        val response = httpPost(
            url = "$baseUrl/api/v1/rooms/$roomId/reconnect-token",
            accessToken = accessToken,
            body = JSONObject().apply {
                put("session_id", sessionId)
                put("device_id", deviceId)
                put("install_id", installId)
                if (seatIntent != null) {
                    put("seat_intent", seatIntent)
                }
            },
        )
        val data = parseEnvelope(parseRoot(response))
        ReconnectTokenResult(
            roomId = data.optString("room_id"),
            sessionId = data.optString("session_id"),
            reconnectToken = data.optString("reconnect_token"),
            expiresAt = data.optString("expires_at"),
        )
    }

    override suspend fun recoverReconnectSnapshot(
        accessToken: String,
        sessionId: String,
    ): ReconnectSnapshotResult = withContext(Dispatchers.IO) {
        val response = httpPost(
            url = "$baseUrl/api/v1/sessions/$sessionId/recover",
            accessToken = accessToken,
            body = JSONObject(),
        )
        val data = parseEnvelope(parseRoot(response))
        val seatState = data.optJSONObject("seat_state")
        val leaderboardArray = data.optJSONArray("leaderboard") ?: JSONArray()
        val giftOrdersArray = data.optJSONArray("gift_orders") ?: JSONArray()
        ReconnectSnapshotResult(
            roomId = data.optString("room_id"),
            sessionId = data.optString("session_id"),
            snapshotSeq = data.optLong("snapshot_seq"),
            seatState = ReconnectSnapshotSeatState(
                seatNo = if (seatState?.has("seat_no") == true && !seatState.isNull("seat_no")) {
                    seatState.optInt("seat_no")
                } else {
                    null
                },
                seatStatus = seatState?.optString("seat_status").orEmpty(),
                uid = seatState?.optString("uid").takeIf { !it.isNullOrBlank() },
                producerId = seatState?.optString("producer_id").takeIf { !it.isNullOrBlank() },
                errorCode = seatState?.optString("error_code").takeIf { !it.isNullOrBlank() },
            ),
            seatIntent = if (data.has("seat_intent") && !data.isNull("seat_intent")) {
                data.optInt("seat_intent")
            } else {
                null
            },
            subscriptionLimit = data.optJSONObject("subscription_plan")?.optInt("subscription_limit")
                ?: data.optInt("subscription_limit"),
            degradeLevel = data.optJSONObject("subscription_plan")?.optString("degrade_level")
                ?: data.optString("degrade_level"),
            activeSpeakers = buildList {
                val speakers = data.optJSONObject("subscription_plan")?.optJSONArray("active_speakers")
                    ?: data.optJSONArray("active_speakers")
                    ?: JSONArray()
                for (index in 0 until speakers.length()) {
                    val uid = speakers.optString(index)
                    if (uid.isNotBlank()) {
                        add(uid)
                    }
                }
            },
            leaderboard = buildList {
                for (index in 0 until leaderboardArray.length()) {
                    val item = leaderboardArray.optJSONObject(index) ?: continue
                    add(
                        LeaderboardEntry(
                            uid = item.optString("uid"),
                            totalGold = item.optLong("total_gold"),
                        ),
                    )
                }
            },
            giftOrders = buildList {
                for (index in 0 until giftOrdersArray.length()) {
                    val item = giftOrdersArray.optJSONObject(index) ?: continue
                    add("${item.optString("gift_order_id")}:${item.optString("status")}")
                }
            },
            resumeCursor = data.optLong("resume_cursor"),
            needResubscribe = data.optBoolean("need_resubscribe"),
            rejoinRequired = data.optBoolean("rejoin_required"),
        )
    }

    override suspend fun fetchGiftCatalog(
        accessToken: String,
        roomId: String,
        country: String,
    ): List<GiftSku> = withContext(Dispatchers.IO) {
        val encodedCountry = URLEncoder.encode(country, StandardCharsets.UTF_8.name())
        val response = httpGet(
            url = "$baseUrl/api/v1/rooms/$roomId/gifts?country=$encodedCountry",
            accessToken = accessToken,
        )
        val data = parseEnvelope(parseRoot(response))
        val gifts = data.optJSONArray("gifts") ?: JSONArray()
        buildList {
            for (index in 0 until gifts.length()) {
                val item = gifts.optJSONObject(index) ?: continue
                add(
                    GiftSku(
                        giftSkuId = item.optString("gift_sku_id"),
                        tier = item.optString("tier"),
                        priceGold = item.optLong("price_gold"),
                        name = item.optString("name"),
                    ),
                )
            }
        }
    }

    override suspend fun verifyGooglePlayRecharge(
        accessToken: String,
        idempotencyKey: String,
        productId: String,
        purchaseToken: String,
        orderId: String,
        amount: String,
    ): RechargeVerifyResult = withContext(Dispatchers.IO) {
        val response = httpPost(
            url = "$baseUrl/api/v1/payments/googleplay/verify",
            accessToken = accessToken,
            extraHeaders = mapOf("x-idempotency-key" to idempotencyKey),
            body = JSONObject().apply {
                put("product_id", productId)
                put("purchase_token", purchaseToken)
                put("order_id", orderId)
                put("amount", amount)
            },
        )
        val data = parseEnvelope(parseRoot(response))
        RechargeVerifyResult(
            rechargeOrderId = data.optString("recharge_order_id"),
            creditedGold = data.optLong("credited_gold"),
            status = data.optString("status"),
        )
    }

    override suspend fun queryRechargeOrder(accessToken: String, orderId: String): RechargeOrderStatus =
        withContext(Dispatchers.IO) {
            val response = httpGet(
                url = "$baseUrl/api/v1/orders/recharge/$orderId",
                accessToken = accessToken,
            )
            val data = parseEnvelope(parseRoot(response))
            RechargeOrderStatus(
                rechargeOrderId = data.optString("recharge_order_id"),
                status = data.optString("status"),
                reasonCode = data.optString("reason_code").takeIf { it.isNotBlank() },
            )
        }

    override suspend fun queryGiftOrder(accessToken: String, orderId: String): GiftOrderStatus =
        withContext(Dispatchers.IO) {
            val response = httpGet(
                url = "$baseUrl/api/v1/orders/gift/$orderId",
                accessToken = accessToken,
            )
            val data = parseEnvelope(parseRoot(response))
            GiftOrderStatus(
                giftOrderId = data.optString("gift_order_id"),
                status = data.optString("status"),
                reasonCode = data.optString("reason_code").takeIf { it.isNotBlank() },
                amountGold = data.optLong("amount_gold"),
            )
        }

    override suspend fun fetchRtcPlan(accessToken: String, roomId: String): RtcPlanResult =
        withContext(Dispatchers.IO) {
            val response = httpGet(
                url = "$baseUrl/api/v1/rooms/$roomId/rtc/plan",
                accessToken = accessToken,
            )
            val data = parseEnvelope(parseRoot(response))
            val speakers = data.optJSONArray("active_speakers") ?: JSONArray()
            val activeSpeakers = buildList {
                for (index in 0 until speakers.length()) {
                    val uid = speakers.optString(index)
                    if (uid.isNotBlank()) {
                        add(uid)
                    }
                }
            }
            RtcPlanResult(
                roomId = data.optString("room_id"),
                workerId = data.optString("worker_id"),
                activeSpeakers = activeSpeakers,
                subscriptionLimit = data.optInt("subscription_limit"),
                degradeLevel = data.optString("degrade_level"),
            )
        }

    override suspend fun fetchRtcMetrics(
        accessToken: String,
        roomId: String,
    ): List<RtcMetricPoint> = withContext(Dispatchers.IO) {
        val response = httpGet(
            url = "$baseUrl/api/v1/rooms/$roomId/rtc/metrics",
            accessToken = accessToken,
        )
        val data = parseEnvelope(parseRoot(response))
        val metrics = data.optJSONArray("metrics") ?: JSONArray()
        buildList {
            for (index in 0 until metrics.length()) {
                val item = metrics.optJSONObject(index) ?: continue
                add(
                    RtcMetricPoint(
                        bucketMinute = item.optString("bucket_minute"),
                        latencyP95 = item.optDouble("latency_p95"),
                        jitterP95 = item.optDouble("jitter_p95"),
                        lossRatio = item.optDouble("loss_ratio"),
                        stallMs = item.optDouble("stall_ms"),
                        degradeEvents = item.optInt("degrade_events"),
                        recoverRatio15s = item.optDouble("recover_ratio_15s"),
                    ),
                )
            }
        }
    }
}

private data class HttpResponse(
    val statusCode: Int,
    val body: String,
)

private fun httpPost(
    url: String,
    body: JSONObject,
    accessToken: String? = null,
    extraHeaders: Map<String, String> = emptyMap(),
): HttpResponse {
    val endpoint = URL(url)
    val connection = (endpoint.openConnection() as HttpURLConnection).apply {
        requestMethod = methodPost
        connectTimeout = connectTimeoutMs
        readTimeout = readTimeoutMs
        doOutput = true
        setRequestProperty(headerContentType, contentTypeJson)
        if (!accessToken.isNullOrBlank()) {
            setRequestProperty(headerAuthorization, "$bearerPrefix$accessToken")
        }
        for ((key, value) in extraHeaders) {
            setRequestProperty(key, value)
        }
    }
    connection.outputStream.use { output ->
        output.write(body.toString().toByteArray(StandardCharsets.UTF_8))
    }
    val statusCode = connection.responseCode
    val responseBody = readResponseBody(
        connection = connection,
        success = statusCode in successCodeRange,
    )
    return HttpResponse(statusCode = statusCode, body = responseBody)
}

private fun httpGet(
    url: String,
    accessToken: String? = null,
): HttpResponse {
    val endpoint = URL(url)
    val connection = (endpoint.openConnection() as HttpURLConnection).apply {
        requestMethod = methodGet
        connectTimeout = connectTimeoutMs
        readTimeout = readTimeoutMs
        if (!accessToken.isNullOrBlank()) {
            setRequestProperty(headerAuthorization, "$bearerPrefix$accessToken")
        }
    }
    val statusCode = connection.responseCode
    val responseBody = readResponseBody(
        connection = connection,
        success = statusCode in successCodeRange,
    )
    return HttpResponse(statusCode = statusCode, body = responseBody)
}

private fun parseRoot(response: HttpResponse): JSONObject {
    val root = if (response.body.isBlank()) JSONObject() else JSONObject(response.body)
    if (response.statusCode !in successCodeRange) {
        val code = root.optString("code").ifBlank { "SYS_001" }
        val message = root.optString("message").ifBlank { genericError }
        throw ApiException(code, message)
    }
    return root
}

private fun parseEnvelope(root: JSONObject): JSONObject {
    return root.optJSONObject("data") ?: root
}

private fun pickString(primary: JSONObject, fallback: JSONObject, vararg keys: String): String {
    for (key in keys) {
        val value = primary.optString(key)
        if (value.isNotBlank()) {
            return value
        }
        val fallbackValue = fallback.optString(key)
        if (fallbackValue.isNotBlank()) {
            return fallbackValue
        }
    }
    throw IllegalStateException("missing required field: ${keys.joinToString()}")
}

private fun pickLong(primary: JSONObject, fallback: JSONObject, vararg keys: String): Long {
    for (key in keys) {
        if (primary.has(key)) {
            return primary.optLong(key)
        }
        if (fallback.has(key)) {
            return fallback.optLong(key)
        }
    }
    throw IllegalStateException("missing required field: ${keys.joinToString()}")
}

private fun readResponseBody(connection: HttpURLConnection, success: Boolean): String {
    val stream = if (success) connection.inputStream else connection.errorStream
    if (stream == null) {
        return ""
    }
    return stream.use { input ->
        BufferedReader(InputStreamReader(input, StandardCharsets.UTF_8)).use { reader ->
            buildString {
                var line = reader.readLine()
                while (line != null) {
                    append(line)
                    line = reader.readLine()
                }
            }
        }
    }
}

class ApiException(
    val code: String,
    override val message: String,
) : IllegalStateException("$code: $message")

interface TokenStore {
    fun save(response: LoginResponse)
    fun latest(): LoginResponse?
}

class ProcessMemoryTokenStore : TokenStore {
    private var session: LoginResponse? = null

    override fun save(response: LoginResponse) {
        session = response
    }

    override fun latest(): LoginResponse? {
        return session
    }
}

class SecureTokenStore(
    context: Context,
    private val fallbackStore: TokenStore = ProcessMemoryTokenStore(),
) : TokenStore {
    private val preferences: SharedPreferences =
        context.getSharedPreferences(secureTokenPrefFileName, Context.MODE_PRIVATE)

    override fun save(response: LoginResponse) {
        // Keep access token in memory to avoid disk persistence for short-lived token.
        fallbackStore.save(response)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            return
        }

        val encryptedPayload = runCatching {
            val payload = JSONObject().apply {
                put("refreshToken", response.refreshToken)
                put("sessionId", response.sessionId)
                put("expiresInSeconds", response.expiresInSeconds)
            }.toString()
            encrypt(payload.toByteArray(StandardCharsets.UTF_8))
        }.getOrNull() ?: return

        preferences.edit().putString(encryptedTokenBlobKey, encryptedPayload).apply()
    }

    override fun latest(): LoginResponse? {
        return fallbackStore.latest()
    }

    private fun encrypt(value: ByteArray): String {
        val cipher = Cipher.getInstance(cipherTransformation)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        val encrypted = cipher.doFinal(value)
        val combined = ByteArray(cipher.iv.size + encrypted.size)
        System.arraycopy(cipher.iv, 0, combined, 0, cipher.iv.size)
        System.arraycopy(encrypted, 0, combined, cipher.iv.size, encrypted.size)
        return Base64.encodeToString(combined, Base64.NO_WRAP)
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(androidKeyStoreProvider).apply { load(null) }
        val existingKey = keyStore.getKey(tokenKeyAlias, null) as? SecretKey
        if (existingKey != null) {
            return existingKey
        }

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            androidKeyStoreProvider,
        )
        val keySpec = KeyGenParameterSpec.Builder(
            tokenKeyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build()
        keyGenerator.init(keySpec)
        return keyGenerator.generateKey()
    }
}

interface DeviceInfoProvider {
    fun deviceId(): String
}

class AndroidDeviceInfoProvider(
    private val context: Context,
) : DeviceInfoProvider {
    private val preferences: SharedPreferences =
        context.getSharedPreferences(prefFileName, Context.MODE_PRIVATE)

    override fun deviceId(): String {
        val saved = preferences.getString(deviceIdKey, null)
        if (!saved.isNullOrBlank()) {
            return saved
        }

        val androidId = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID,
        )?.lowercase(Locale.US)
        val resolved = if (androidId.isNullOrBlank()) {
            UUID.randomUUID().toString()
        } else {
            androidId
        }
        preferences.edit().putString(deviceIdKey, resolved).apply()
        return resolved
    }
}

private fun buildGiftIdempotencyKey(): String {
    val suffix = UUID.randomUUID().toString().replace("-", "").take(12)
    return "gift_${System.currentTimeMillis()}_$suffix"
}

private fun buildPaymentIdempotencyKey(): String {
    val suffix = UUID.randomUUID().toString().replace("-", "").take(12)
    return "pay_${System.currentTimeMillis()}_$suffix"
}

private const val prefFileName = "chatroom.auth.pref"
private const val deviceIdKey = "device_id"
private const val secureTokenPrefFileName = "chatroom.auth.secure.pref"
private const val encryptedTokenBlobKey = "encrypted_token_blob"
private const val tokenKeyAlias = "chatroom_login_token_key"
private const val androidKeyStoreProvider = "AndroidKeyStore"
private const val cipherTransformation = "AES/GCM/NoPadding"

private const val invalidPhoneError = "Please enter a valid E.164 phone number."
private const val invalidOtpError = "OTP should be 6 digits."
private const val genericError = "Request failed. Please retry."

private const val defaultCountry = "AE"
private const val defaultLanguage = "ar"

private const val otpLength = 6
private val phoneRegex = Regex("^\\+?[1-9]\\d{7,14}$")
private const val authBaseUrl = BuildConfig.API_BASE_URL

private const val methodPost = "POST"
private const val methodGet = "GET"
private const val headerContentType = "Content-Type"
private const val headerAuthorization = "Authorization"
private const val contentTypeJson = "application/json"
private const val bearerPrefix = "Bearer "

private val supportedCountries = listOf("AE", "SA", "EG", "US")
private val supportedLanguages = listOf("ar", "en")

private const val connectTimeoutMs = 10_000
private const val readTimeoutMs = 10_000
private val successCodeRange = 200..299
