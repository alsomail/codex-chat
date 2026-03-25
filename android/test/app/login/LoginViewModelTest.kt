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
        val fakeAuth = FakeAuthRepository(shouldFail = true)
        val viewModel = buildViewModel(authRepository = fakeAuth)
        viewModel.onPhoneChanged("+971500000103")
        viewModel.onOtpChanged("123456")

        viewModel.onLoginClicked()
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.isLoginSuccess)
        assertEquals("OTP is invalid or expired.", viewModel.uiState.value.errorMessage)
    }

    private fun buildViewModel(
        authRepository: AuthRepository = FakeAuthRepository(),
        roomRepository: RoomRepository = FakeRoomRepository(),
    ): LoginViewModel {
        return LoginViewModel(
            authRepository = authRepository,
            roomRepository = roomRepository,
            tokenStore = ProcessMemoryTokenStore(),
            deviceInfoProvider = FakeDeviceInfoProvider(),
        )
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
private class MainDispatcherRule : TestWatcher() {
    private val dispatcher = StandardTestDispatcher()

    override fun starting(description: Description) {
        Dispatchers.setMain(dispatcher)
    }

    override fun finished(description: Description) {
        Dispatchers.resetMain()
    }
}

private class FakeAuthRepository(
    private val shouldFail: Boolean = false,
) : AuthRepository {
    override suspend fun login(request: LoginRequest): LoginResponse {
        if (shouldFail) {
            throw IllegalStateException("OTP is invalid or expired.")
        }
        return LoginResponse(
            accessToken = "access-token",
            refreshToken = "refresh-token",
            expiresInSeconds = 900,
        )
    }
}

private class FakeRoomRepository : RoomRepository {
    override suspend fun fetchRecommendedRooms(accessToken: String): List<RoomPreview> {
        return listOf(
            RoomPreview("room-001", "MENA Chill Lounge", "Nora", 72),
            RoomPreview("room-002", "Night Owl Talk", "Omar", 48),
        )
    }
}

private class FakeDeviceInfoProvider : DeviceInfoProvider {
    override fun deviceId(): String {
        return "device-test-001"
    }
}
