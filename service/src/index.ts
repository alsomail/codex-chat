import "dotenv/config";
import http from "node:http";
import express from "express";
import { Pool } from "pg";
import { Server } from "socket.io";
import {
  createAuthRouter,
  createEnvOtpVerifier,
  createHttpAuthMiddleware,
  createSocketAuthMiddleware,
} from "../backend/routes/auth";

const port = Number(process.env.PORT ?? "3000");
const corsOrigin = process.env.CORS_ORIGIN ?? "*";

const accessSecret = process.env.JWT_ACCESS_SECRET;
const refreshSecret = process.env.JWT_REFRESH_SECRET;
const databaseUrl = process.env.DATABASE_URL;
const demoOtp = process.env.DEMO_OTP;

if (accessSecret === undefined || accessSecret.length < 16) {
  throw new Error("JWT_ACCESS_SECRET is required and must be 16+ chars.");
}
if (refreshSecret === undefined || refreshSecret.length < 16) {
  throw new Error("JWT_REFRESH_SECRET is required and must be 16+ chars.");
}
if (demoOtp !== undefined && !/^\d{6}$/.test(demoOtp)) {
  throw new Error("DEMO_OTP must be 6 digits when configured.");
}

const app = express();
app.use(express.json({ limit: "128kb" }));

const db =
  databaseUrl !== undefined && databaseUrl.length > 0
    ? new Pool({ connectionString: databaseUrl })
    : undefined;
const verifyHttpAuth = createHttpAuthMiddleware({
  accessTokenSecret: accessSecret,
});

const authRouter = createAuthRouter({
  db,
  accessTokenSecret: accessSecret,
  refreshTokenSecret: refreshSecret,
  otpVerifier:
    demoOtp !== undefined ? createEnvOtpVerifier(demoOtp) : undefined,
});
app.use("/api/v1/auth", authRouter);

app.get("/api/v1/rooms/demo", verifyHttpAuth, (_request, response) => {
  response.status(200).json({
    rooms: [
      {
        roomId: "room_mena_chill_01",
        name: "MENA Chill Lounge",
        hostName: "Nora",
        onlineCount: 72,
      },
      {
        roomId: "room_night_owl_02",
        name: "Night Owl Talk",
        hostName: "Omar",
        onlineCount: 48,
      },
      {
        roomId: "room_gaming_03",
        name: "Gaming Squad Voice",
        hostName: "Rami",
        onlineCount: 39,
      },
    ],
  });
});
app.get("/api/rooms/preview", verifyHttpAuth, (_request, response) => {
  response.status(200).json({
    rooms: [
      {
        roomId: "room_mena_chill_01",
        name: "MENA Chill Lounge",
        hostName: "Nora",
        onlineCount: 72,
      },
      {
        roomId: "room_night_owl_02",
        name: "Night Owl Talk",
        hostName: "Omar",
        onlineCount: 48,
      },
      {
        roomId: "room_gaming_03",
        name: "Gaming Squad Voice",
        hostName: "Rami",
        onlineCount: 39,
      },
    ],
  });
});

app.get("/healthz", (_request, response) => {
  response.status(200).json({ status: "ok", service: "chatroom-service" });
});

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    credentials: true,
  },
});

io.use(createSocketAuthMiddleware({ accessTokenSecret: accessSecret }));

io.on("connection", (socket) => {
  socket.emit("auth:ready", {
    uid: socket.data.user?.uid,
    deviceId: socket.data.user?.device_id,
    country: socket.data.user?.country,
  });
});

server.listen(port, () => {
  // Keep startup logs explicit for quick local debugging.
  console.log(`chatroom-service listening on :${port}`);
  if (db === undefined) {
    console.log("DATABASE_URL is unset, using in-memory auth store.");
  }
  if (demoOtp !== undefined) {
    console.log("DEMO_OTP verifier is enabled for local login.");
  } else {
    console.log(
      "DEMO_OTP is unset; /auth/otp/verify returns 503 until an OTP provider is configured.",
    );
  }
});
