import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  createAuthRouter,
  createHttpAuthMiddleware,
  verifyAccessToken,
} from "../backend/routes/auth";

const accessSecret = "access-secret-1234567890";
const refreshSecret = "refresh-secret-1234567890";
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
      otpVerifier:
        options?.otpVerifier === null
          ? undefined
          : options?.otpVerifier ?? (async ({ otp }) => otp === demoOtp),
      now: () => new Date("2026-03-24T00:00:00.000Z"),
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

test("REQ-001 login via /otp/verify returns JWT and first login true", async () => {
  await withServer(async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone: "+971500000001",
      otp: demoOtp,
      deviceId: "device-alpha-01",
      country: "AE",
      language: "ar",
    });

    assert.equal(response.status, 200);
    assert.equal(typeof response.body.accessToken, "string");
    assert.equal(typeof response.body.refreshToken, "string");

    const user = response.body.user as JsonRecord;
    assert.equal(user.firstLogin, true);
    const wallet = response.body.wallet as JsonRecord;
    assert.equal(wallet.walletGold, 0);
    assert.equal(wallet.walletBonusGold, 0);
  });
});

test("POST /otp/send accepts a valid request", async () => {
  await withServer(async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/v1/auth/otp/send`, {
      phone: "+971500000000",
    });

    assert.equal(response.status, 200);
    assert.equal(typeof response.body.requestId, "string");
  });
});

test("second login via /otp/verify is not first login", async () => {
  await withServer(async (baseUrl) => {
    const payload = {
      phone: "+971500000002",
      otp: demoOtp,
      deviceId: "device-beta-01",
      country: "AE",
      language: "ar",
    };

    const first = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, payload);
    const second = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, payload);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const user = second.body.user as JsonRecord;
    assert.equal(user.firstLogin, false);
  });
});

test("legacy /login/otp is rejected to enforce API spec path", async () => {
  await withServer(async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/v1/auth/login/otp`, {
      phone: "+971500000099",
      otp: demoOtp,
      deviceId: "device-legacy-01",
      country: "AE",
      language: "ar",
    });

    assert.equal(response.status, 404);
  });
});

test("refresh token rotates refresh_id and returns a new access token", async () => {
  await withServer(async (baseUrl) => {
    const login = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone: "+971500000111",
      otp: demoOtp,
      deviceId: "device-refresh-01",
      country: "AE",
      language: "ar",
    });

    assert.equal(login.status, 200);
    const refreshed = await postJson(`${baseUrl}/api/v1/auth/refresh`, {
      refreshToken: login.body.refreshToken,
      deviceId: "device-refresh-01",
    });

    assert.equal(refreshed.status, 200);
    assert.equal(typeof refreshed.body.accessToken, "string");
    assert.equal(typeof refreshed.body.refreshToken, "string");
    assert.notEqual(refreshed.body.refreshToken, login.body.refreshToken);
  });
});

test("otp verify returns 503 when verifier is not configured", async () => {
  await withServer(
    async (baseUrl) => {
      const response = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
        phone: "+971500000003",
        otp: demoOtp,
        deviceId: "device-without-provider-01",
        country: "AE",
        language: "en",
      });

      assert.equal(response.status, 503);
    },
    { otpVerifier: null },
  );
});

test("invalid otp returns 401", async () => {
  await withServer(async (baseUrl) => {
    const response = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone: "+971500000003",
      otp: "000000",
      deviceId: "device-gamma-01",
      country: "AE",
      language: "en",
    });

    assert.equal(response.status, 401);
  });
});

test("rate limit blocks the 7th failed attempt in one minute", async () => {
  await withServer(async (baseUrl) => {
    for (let i = 0; i < 6; i += 1) {
      const response = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
        phone: "+971500000004",
        otp: "111111",
        deviceId: "device-rate-01",
        country: "AE",
        language: "en",
      });
      assert.equal(response.status, 401);
    }

    const blocked = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone: "+971500000004",
      otp: "111111",
      deviceId: "device-rate-01",
      country: "AE",
      language: "en",
    });
    assert.equal(blocked.status, 429);
  });
});

test("authorized token can read room preview", async () => {
  await withServer(async (baseUrl) => {
    const login = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
      phone: "+971500000005",
      otp: demoOtp,
      deviceId: "device-room-01",
      country: "AE",
      language: "en",
    });

    assert.equal(login.status, 200);
    const token = login.body.accessToken as string;
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
