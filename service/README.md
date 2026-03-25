# chatroom-service

Node.js + TypeScript service for REQ-001 auth login.

## Environment
- Node.js 14+
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
- `GET /api/v1/rooms/demo` (JWT required)
- JWT access/refresh token issue
- refresh token hash persistence (no plaintext storage)
- First-login wallet bootstrap
- Socket.io JWT auth middleware
- Optional in-memory auth store when `DATABASE_URL` is not configured

Core auth route is in `backend/routes/auth.ts`.
