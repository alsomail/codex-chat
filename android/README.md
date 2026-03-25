# chatroom-android

Android app project for REQ-001 and REQ-002 demo flow.

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
- JWT login + refresh + wallet summary (`/api/v1/auth/*`, `/api/v1/wallet/summary`)
- Room preview + create/join/gift catalog/recharge/order tracking for REQ-002
- Socket.io room events (`room.joined`, `gift.accepted`, `gift.broadcast`, `leaderboard.updated`, `gift.rejected`)
- Android Keystore-backed encrypted refresh token storage (access token kept in-memory)
- Device id collection for backend login

Main screen code is in `src/app/login/LoginActivity.kt`.
