# chatroom-android

Android app project for REQ-001 login.

## Environment
- Android Studio Iguana+ or AGP-compatible IDE
- JDK 17
- Android SDK 35

## Run
1. Create `local.properties` with Android SDK path.
2. Open `android/` in Android Studio.
3. Sync Gradle and run `app` module.

## Implemented
- OTP login UI with Material3 Compose
- Country/language selection
- JWT login + room preview API call (`/api/v1/rooms/demo`)
- Android Keystore-backed encrypted token storage (fallback to in-memory on old devices)
- Device id collection for backend login

Main screen code is in `src/app/login/LoginActivity.kt`.
