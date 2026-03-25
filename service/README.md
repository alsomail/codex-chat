# chatroom-service

Node.js + TypeScript service for REQ-001 auth login.

## Environment
- Node.js 18+
- PostgreSQL 14+ (optional for demo mode)

## Setup
1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Dev run: `npm run dev`

## Implemented
- `POST /api/v1/auth/otp/send`
- `POST /api/v1/auth/otp/verify`
- `POST /api/v1/auth/refresh`
- `GET /api/v1/wallet/summary`
- `GET /api/v1/rooms/demo` (JWT required)
- `GET /api/v1/rooms/{room_id}/rtc/plan` (REQ-003调试快照)
- `GET /api/v1/rooms/{room_id}/rtc/metrics` (REQ-003分钟级观测)
- Socket `rtc.create_transport/connect_transport/produce/consume/pause_consumer/resume_consumer`
- Socket `rtc.transport_created/new_producer/consumer_created/subscription_plan/degrade/seat.updated`
- JWT access/refresh token issue
- refresh token hash persistence (SHA-256 token + server pepper, no plaintext storage)
- First-login wallet bootstrap
- refresh replay detection (`409 AUTH_004`)
- Socket.io JWT auth middleware
- Optional in-memory auth store when `DATABASE_URL` is not configured

Core auth route is in `backend/routes/auth.ts`.
