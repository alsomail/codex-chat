import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  createAuthRouter,
  createHttpAuthMiddleware,
  createWalletSummaryHandler,
  verifyAccessToken,
} from "../backend/routes/auth";

const accessSecret = "access-secret-1234567890";
const refreshSecret = "refresh-secret-1234567890";
const refreshPepper = "pepper-secret-1234567890";
const demoOtp = "246810";

type JsonRecord = Record<string, unknown>;

type TestOtpVerifier = (request: {
  phone: string;
  otp: string;
  deviceId: string;
}) => Promise<boolean>;

const createTestApp = (options?: { otpVerifier?: TestOtpVerifier | null }) => {
  const app = express();
  app.use(express.json({ limit: "128kb" }));

  app.use(
    "/api/v1/auth",
    createAuthRouter({
      accessTokenSecret: accessSecret,
      refreshTokenSecret: refreshSecret,
      refreshTokenPepper: refreshPepper,
      otpVerifier:
        options?.otpVerifier === null
          ? undefined
          : options?.otpVerifier ?? (async ({ otp }) => otp === demoOtp),
      now: () => new Date("2026-03-24T00:00:00.000Z"),
    }),
  );

  app.use("/api/auth", (_req, res) => {
    res.status(410).json({
      code: "AUTH_001",
      message: "Legacy auth path is deprecated.",
    });
  });

  app.get(
    "/api/v1/wallet/summary",
    createWalletSummaryHandler({
      accessTokenSecret: accessSecret,
    }),
  );

  const verifyHttpAuth = createHttpAuthMiddleware({ accessTokenSecret: accessSecret });
  app.get("/api/v1/rooms/demo", verifyHttpAuth, (_req, res) => {
    res.status(200).json({
      rooms: [
        { roomId: "r1", name: "Room A", hostName: "Alice", onlineCount: 20 },
        { roomId: "r2", name: "Room B", hostName: "Bob", onlineCount: 15 },
      ],
    });
  });

  return app;
};

const withServer = async (
  fn: (baseUrl: string) => Promise<void>,
  options?: { otpVerifier?: TestOtpVerifier | null },
): Promise<void> => {
  const app = createTestApp(options);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
};

const postJson = async (
  url: string,
  payload: JsonRecord,
): Promise<{ status: number; body: JsonRecord }> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();
  const parsed = bodyText.length > 0 ? (JSON.parse(bodyText) as JsonRecord) : {};
  return {
    status: response.status,
    body: parsed,
  };
};

const getJson = async (
  url: string,
  token?: string,
): Promise<{ status: number; body: JsonRecord }> => {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  const bodyText = await response.text();
  const parsed = bodyText.length > 0 ? (JSON.parse(bodyText) as JsonRecord) : {};
  return {
    status: response.status,
    body: parsed,
  };
};

const responseData = (body: JsonRecord): JsonRecord => {
  const data = body.data;
  assert.equal(typeof data, "object");
  assert.notEqual(data, null);
  return data as JsonRecord;
};

test("REQ-001 login via /otp/verify returns JWT and wallet summary", async () => {
  await withServer(async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone_e164: "+971500000001",
      otp_code: demoOtp,
      device_id: "device-alpha-01",
      country: "AE",
      language: "ar",
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.code, "OK");

    const data = responseData(response.body);
    assert.equal(typeof data.access_token, "string");
    assert.equal(typeof data.refresh_token, "string");
    assert.equal(data.is_new_user, true);

    const wallet = data.wallet_summary as JsonRecord;
    assert.equal(wallet.wallet_gold, 0);
    assert.equal(wallet.wallet_bonus_gold, 0);
    assert.equal(wallet.spent_30d_gold, 0);

    // Keep compatibility contract for existing Android integration.
    assert.equal(typeof response.body.accessToken, "string");
    assert.equal(typeof response.body.refreshToken, "string");
  });
});

test("POST /otp/send returns otp_ticket contract", async () => {
  await withServer(async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/v1/auth/otp/send`, {
      phone_e164: "+971500000000",
      device_id: "device-send-01",
      install_id: "install-send-01",
      channel: "login",
    });

    assert.equal(response.status, 200);
    const data = responseData(response.body);
    assert.equal(typeof data.otp_ticket, "string");
    assert.equal(typeof data.expire_at, "string");
    assert.equal(data.resend_after_sec, 60);
  });
});

test("second login via /otp/verify is not a new user", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      phone_e164: "+971500000002",
      otp_code: demoOtp,
      device_id: "device-beta-01",
      country: "AE",
      language: "ar",
    };

    const first = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, payload);
    const second = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, payload);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const secondData = responseData(second.body);
    assert.equal(secondData.is_new_user, false);
  });
});

test("legacy auth paths are rejected", async () => {
  await withServer(async (baseUrl) => {
    const legacyV1 = await postJson(`${baseUrl}/api/v1/auth/login/otp`, {
      phone_e164: "+971500000099",
      otp_code: demoOtp,
      device_id: "device-legacy-01",
    });
    assert.equal(legacyV1.status, 410);

    const legacyRoot = await postJson(`${baseUrl}/api/auth/otp/verify`, {
      phone_e164: "+971500000099",
      otp_code: demoOtp,
      device_id: "device-legacy-01",
    });
    assert.equal(legacyRoot.status, 410);
  });
});

test("refresh rotates tokens and old refresh token reuse returns AUTH_004", async () => {
  await withServer(async (baseUrl) => {
    const login = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone_e164: "+971500000111",
      otp_code: demoOtp,
      device_id: "device-refresh-01",
      country: "AE",
      language: "ar",
    });

    assert.equal(login.status, 200);
    const loginData = responseData(login.body);
    const firstRefreshToken = loginData.refresh_token as string;
    const sessionId = loginData.session_id as string;

    const refreshed = await postJson(`${baseUrl}/api/v1/auth/refresh`, {
      refresh_token: firstRefreshToken,
      session_id: sessionId,
      device_id: "device-refresh-01",
    });

    assert.equal(refreshed.status, 200);
    const refreshedData = responseData(refreshed.body);
    assert.equal(typeof refreshedData.access_token, "string");
    assert.equal(typeof refreshedData.refresh_token, "string");
    assert.notEqual(refreshedData.refresh_token, firstRefreshToken);

    const replayed = await postJson(`${baseUrl}/api/v1/auth/refresh`, {
      refresh_token: firstRefreshToken,
      session_id: sessionId,
      device_id: "device-refresh-01",
    });
    assert.equal(replayed.status, 409);
    assert.equal(replayed.body.code, "AUTH_004");
  });
});

test("wallet summary endpoint returns required REQ-001 fields", async () => {
  await withServer(async (baseUrl) => {
    const login = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone_e164: "+971500000112",
      otp_code: demoOtp,
      device_id: "device-wallet-01",
      country: "AE",
      language: "ar",
    });

    const loginData = responseData(login.body);
    const accessToken = loginData.access_token as string;

    const wallet = await getJson(`${baseUrl}/api/v1/wallet/summary`, accessToken);
    assert.equal(wallet.status, 200);

    const walletData = responseData(wallet.body);
    assert.equal(typeof walletData.wallet_gold, "number");
    assert.equal(typeof walletData.wallet_bonus_gold, "number");
    assert.equal(typeof walletData.frozen_gold, "number");
    assert.equal(typeof walletData.total_spent_gold, "number");
    assert.equal(typeof walletData.spent_30d_gold, "number");
    assert.equal(typeof walletData.risk_level, "string");
  });
});

test("otp verify returns 503 AUTH_005 when verifier is not configured", async () => {
  await withServer(
    async (baseUrl) => {
      const response = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
        phone_e164: "+971500000003",
        otp_code: demoOtp,
        device_id: "device-without-provider-01",
        country: "AE",
        language: "en",
      });

      assert.equal(response.status, 503);
      assert.equal(response.body.code, "AUTH_005");
    },
    { otpVerifier: null },
  );
});

test("invalid otp returns 400 AUTH_002", async () => {
  await withServer(async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone_e164: "+971500000003",
      otp_code: "000000",
      device_id: "device-gamma-01",
      country: "AE",
      language: "en",
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.code, "AUTH_002");
  });
});

test("rate limit blocks the 7th failed attempt in one minute", async () => {
  await withServer(async (baseUrl) => {
    for (let i = 0; i < 6; i += 1) {
      const response = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
        phone_e164: "+971500000004",
        otp_code: "111111",
        device_id: "device-rate-01",
        country: "AE",
        language: "en",
      });
      assert.equal(response.status, 400);
      assert.equal(response.body.code, "AUTH_002");
    }

    const blocked = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone_e164: "+971500000004",
      otp_code: "111111",
      device_id: "device-rate-01",
      country: "AE",
      language: "en",
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, "AUTH_003");
  });
});

test("authorized token can read room preview", async () => {
  await withServer(async (baseUrl) => {
    const login = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone_e164: "+971500000005",
      otp_code: demoOtp,
      device_id: "device-room-01",
      country: "AE",
      language: "en",
    });

    assert.equal(login.status, 200);
    const loginData = responseData(login.body);
    const token = loginData.access_token as string;
    const tokenIdentity = verifyAccessToken(token, accessSecret);
    assert.equal(tokenIdentity?.device_id, "device-room-01");

    const rooms = await getJson(`${baseUrl}/api/v1/rooms/demo`, token);
    assert.equal(rooms.status, 200);
    assert.ok(Array.isArray(rooms.body.rooms));
  });
});

test("missing token is rejected by room preview endpoint", async () => {
  await withServer(async (baseUrl) => {
    const response = await getJson(`${baseUrl}/api/v1/rooms/demo`);
    assert.equal(response.status, 401);
  });
});
