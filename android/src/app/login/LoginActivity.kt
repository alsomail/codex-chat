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
import androidx.compose.ui.text.input.KeyboardOptions
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

    if (uiState.isLoginSuccess) {
        RoomPreviewScreen(
            rooms = uiState.rooms,
            country = uiState.country,
            language = uiState.language,
            onBack = viewModel::onBackToLogin,
        )
        return
    }

    LoginScreen(
        uiState = uiState,
        onPhoneChanged = viewModel::onPhoneChanged,
        onOtpChanged = viewModel::onOtpChanged,
        onCountrySelected = viewModel::onCountrySelected,
        onLanguageSelected = viewModel::onLanguageSelected,
        onLoginClicked = viewModel::onLoginClicked,
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
                text = "Login with OTP, then open room preview demo.",
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
private fun RoomPreviewScreen(
    rooms: List<RoomPreview>,
    country: String,
    language: String,
    onBack: () -> Unit,
) {
    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding(),
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(horizontal = 20.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "Rooms Preview",
                style = MaterialTheme.typography.headlineSmall,
            )
            Text(
                text = "Login success, locale $country / $language",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (rooms.isEmpty()) {
                Text(
                    text = "No rooms available yet.",
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(rooms) { room ->
                        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(14.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Text(
                                    text = room.name,
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                Text(
                                    text = "Host: ${room.hostName}",
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                Text(
                                    text = "Online: ${room.onlineCount}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }

            ElevatedButton(
                modifier = Modifier.fillMaxWidth(),
                onClick = onBack,
            ) {
                Text(text = "Back to login")
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
    val isLoading: Boolean = false,
    val isLoginSuccess: Boolean = false,
    val errorMessage: String? = null,
)

data class RoomPreview(
    val roomId: String,
    val name: String,
    val hostName: String,
    val onlineCount: Int,
)

class LoginViewModel(
    private val authRepository: AuthRepository,
    private val roomRepository: RoomRepository,
    private val tokenStore: TokenStore,
    private val deviceInfoProvider: DeviceInfoProvider,
) : ViewModel() {
    private val mutableUiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = mutableUiState.asStateFlow()

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

    fun onLoginClicked() {
        val snapshot = uiState.value
        val validationMessage = validate(snapshot)
        if (validationMessage != null) {
            mutableUiState.update {
                it.copy(errorMessage = validationMessage)
            }
            return
        }
        if (snapshot.isLoading) {
            return
        }

        viewModelScope.launch {
            mutableUiState.update {
                it.copy(isLoading = true, errorMessage = null)
            }

            val request = LoginRequest(
                phone = snapshot.phone,
                otp = snapshot.otp,
                country = snapshot.country,
                language = snapshot.language,
                deviceId = deviceInfoProvider.deviceId(),
            )

            runCatching {
                authRepository.login(request)
            }.onSuccess { response ->
                tokenStore.save(response)
                val rooms = runCatching {
                    roomRepository.fetchRecommendedRooms(response.accessToken)
                }.getOrElse {
                    emptyList()
                }

                mutableUiState.update {
                    it.copy(
                        isLoading = false,
                        isLoginSuccess = true,
                        rooms = rooms,
                        errorMessage = null,
                    )
                }
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

    fun onBackToLogin() {
        mutableUiState.update {
            it.copy(isLoginSuccess = false, errorMessage = null)
        }
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
        return LoginViewModel(
            authRepository = authRepository,
            roomRepository = roomRepository,
            tokenStore = tokenStore,
            deviceInfoProvider = deviceInfoProvider,
        ) as T
    }
}

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
)

interface AuthRepository {
    suspend fun login(request: LoginRequest): LoginResponse
}

interface RoomRepository {
    suspend fun fetchRecommendedRooms(accessToken: String): List<RoomPreview>
}

class NetworkAuthRepository(
    private val baseUrl: String,
) : AuthRepository {
    override suspend fun login(request: LoginRequest): LoginResponse = withContext(Dispatchers.IO) {
        val endpoint = URL("$baseUrl/api/v1/auth/otp/verify")
        val connection = (endpoint.openConnection() as HttpURLConnection).apply {
            requestMethod = methodPost
            connectTimeout = connectTimeoutMs
            readTimeout = readTimeoutMs
            doOutput = true
            setRequestProperty(headerContentType, contentTypeJson)
        }

        val requestBody = JSONObject().apply {
            put("phone", request.phone)
            put("otp", request.otp)
            put("country", request.country)
            put("language", request.language)
            put("deviceId", request.deviceId)
        }

        connection.outputStream.use { output ->
            output.write(requestBody.toString().toByteArray(StandardCharsets.UTF_8))
        }

        val statusCode = connection.responseCode
        val responseBody = readResponseBody(
            connection = connection,
            success = statusCode in successCodeRange,
        )
        if (statusCode !in successCodeRange) {
            val errorMessage = runCatching {
                JSONObject(responseBody).optString("message")
            }.getOrDefault("")
            throw IllegalStateException(errorMessage.ifBlank { genericError })
        }

        val payload = JSONObject(responseBody)
        LoginResponse(
            accessToken = payload.getString("accessToken"),
            refreshToken = payload.getString("refreshToken"),
            expiresInSeconds = payload.getLong("expiresInSeconds"),
        )
    }
}

class NetworkRoomRepository(
    private val baseUrl: String,
) : RoomRepository {
    override suspend fun fetchRecommendedRooms(accessToken: String): List<RoomPreview> =
        withContext(Dispatchers.IO) {
            val endpoint = URL("$baseUrl/api/v1/rooms/demo")
            val connection = (endpoint.openConnection() as HttpURLConnection).apply {
                requestMethod = methodGet
                connectTimeout = connectTimeoutMs
                readTimeout = readTimeoutMs
                setRequestProperty(headerAuthorization, "$bearerPrefix$accessToken")
            }

            val statusCode = connection.responseCode
            val responseBody = readResponseBody(
                connection = connection,
                success = statusCode in successCodeRange,
            )
            if (statusCode !in successCodeRange) {
                throw IllegalStateException(genericError)
            }

            val payload = JSONObject(responseBody)
            val roomsArray = payload.optJSONArray("rooms") ?: JSONArray()
            buildList {
                for (index in 0 until roomsArray.length()) {
                    val room = roomsArray.getJSONObject(index)
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
}

private fun readResponseBody(connection: HttpURLConnection, success: Boolean): String {
    val stream = if (success) {
        connection.inputStream
    } else {
        connection.errorStream
    }
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

interface TokenStore {
    fun save(response: LoginResponse)
}

class ProcessMemoryTokenStore : TokenStore {
    private var session: LoginResponse? = null

    override fun save(response: LoginResponse) {
        session = response
    }

    fun latest(): LoginResponse? {
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
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            fallbackStore.save(response)
            return
        }

        val encryptedPayload = runCatching {
            val payload = JSONObject().apply {
                put("accessToken", response.accessToken)
                put("refreshToken", response.refreshToken)
                put("expiresInSeconds", response.expiresInSeconds)
            }.toString()
            encrypt(payload.toByteArray(StandardCharsets.UTF_8))
        }.getOrNull()

        if (encryptedPayload == null) {
            fallbackStore.save(response)
            return
        }

        preferences.edit().putString(encryptedTokenBlobKey, encryptedPayload).apply()
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

private const val prefFileName = "chatroom.auth.pref"
private const val deviceIdKey = "device_id"
private const val secureTokenPrefFileName = "chatroom.auth.secure.pref"
private const val encryptedTokenBlobKey = "encrypted_token_blob"
private const val tokenKeyAlias = "chatroom_login_token_key"
private const val androidKeyStoreProvider = "AndroidKeyStore"
private const val cipherTransformation = "AES/GCM/NoPadding"

private const val invalidPhoneError = "Please enter a valid E.164 phone number."
private const val invalidOtpError = "OTP should be 6 digits."
private const val genericError = "Login failed. Please try again."

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
