import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  createAuthRouter,
  createHttpAuthMiddleware,
} from "../backend/routes/auth";
import {
  createReq002Router,
  createReq002Service,
  type Req002Service,
} from "../backend/routes/req002";
import {
  createReq003Router,
  createReq003Service,
  type Req003Service,
} from "../backend/routes/req003";

const accessSecret = "access-secret-1234567890";
const refreshSecret = "refresh-secret-1234567890";
const refreshPepper = "pepper-secret-1234567890";
const demoOtp = "246810";

type JsonRecord = Record<string, unknown>;

const createReq003App = (req002Service: Req002Service, req003Service: Req003Service) => {
  const app = express();
  app.use(express.json({ limit: "128kb" }));
  app.use(
    "/api/v1/auth",
    createAuthRouter({
      accessTokenSecret: accessSecret,
      refreshTokenSecret: refreshSecret,
      refreshTokenPepper: refreshPepper,
      otpVerifier: async ({ otp }) => otp === demoOtp,
      now: () => new Date("2026-03-25T00:00:00.000Z"),
    }),
  );

  const authMiddleware = createHttpAuthMiddleware({ accessTokenSecret: accessSecret });
  app.use(
    "/api/v1",
    createReq002Router({
      authMiddleware,
      service: req002Service,
    }),
  );
  app.use(
    "/api/v1",
    createReq003Router({
      authMiddleware,
      roomAccess: req002Service,
      service: req003Service,
    }),
  );

  return app;
};

const withServer = async (
  fn: (
    baseUrl: string,
    req002Service: Req002Service,
    req003Service: Req003Service,
  ) => Promise<void>,
): Promise<void> => {
  const req002Service = createReq002Service();
  const req003Service = createReq003Service();
  const app = createReq003App(req002Service, req003Service);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl, req002Service, req003Service);
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
  options?: { token?: string },
): Promise<{ status: number; body: JsonRecord }> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.token !== undefined ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const bodyText = await response.text();
  return {
    status: response.status,
    body: bodyText.length > 0 ? (JSON.parse(bodyText) as JsonRecord) : {},
  };
};

const getJson = async (
  url: string,
  options?: { token?: string },
): Promise<{ status: number; body: JsonRecord }> => {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      ...(options?.token !== undefined ? { Authorization: `Bearer ${options.token}` } : {}),
    },
  });
  const bodyText = await response.text();
  return {
    status: response.status,
    body: bodyText.length > 0 ? (JSON.parse(bodyText) as JsonRecord) : {},
  };
};

const responseData = (body: JsonRecord): JsonRecord => {
  const data = body.data;
  assert.equal(typeof data, "object");
  assert.notEqual(data, null);
  return data as JsonRecord;
};

const loginAndGetToken = async (baseUrl: string, suffix: string): Promise<string> => {
  const loginResponse = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, {
    phone_e164: `+97153000${suffix}`,
    otp_code: demoOtp,
    device_id: `device-req003-${suffix}`,
    country: "AE",
    language: "ar",
  });
  assert.equal(loginResponse.status, 200);
  const loginData = responseData(loginResponse.body);
  const token = loginData.access_token;
  if (typeof token !== "string") {
    throw new Error("access_token must be a string.");
  }
  return token;
};

test("REQ-003 rtc plan/metrics endpoints return frozen contract fields", async () => {
  await withServer(async (baseUrl, _req002Service, req003Service) => {
    const token = await loginAndGetToken(baseUrl, "300001");

    const createRoom = await postJson(
      `${baseUrl}/api/v1/rooms`,
      {
        visibility: "PUBLIC",
        topic: "REQ-003 Metrics Room",
        tags: ["rtc"],
        language: "ar",
      },
      { token },
    );
    assert.equal(createRoom.status, 200);
    const createData = responseData(createRoom.body);
    const roomId = createData.room_id as string;
    const ownerUid = createData.owner_uid as string;

    const transport = req003Service.createTransport({
      roomId,
      uid: ownerUid,
      socketId: "sock_req003_http_owner",
      direction: "send",
      now: new Date("2026-03-25T10:00:00.000Z"),
    });
    assert.equal(transport.ok, true);
    if (!transport.ok) {
      return;
    }

    const connected = req003Service.connectTransport({
      transportId: transport.value.transport_id,
      uid: ownerUid,
      dtlsParameters: { role: "auto" },
      now: new Date("2026-03-25T10:00:01.000Z"),
    });
    assert.equal(connected.ok, true);
    if (!connected.ok) {
      return;
    }

    const produced = req003Service.produce({
      transportId: transport.value.transport_id,
      uid: ownerUid,
      kind: "audio",
      seatNo: 1,
      now: new Date("2026-03-25T10:00:02.000Z"),
    });
    assert.equal(produced.ok, true);
    if (!produced.ok) {
      return;
    }

    const consumed = req003Service.consume({
      roomId,
      uid: ownerUid,
      producerId: produced.value.producer_event.producer_id,
      rtpCapabilities: { codecs: ["opus"] },
      network: {
        packetLoss: 0.2,
        jitterP95: 210,
        rtt: 500,
        stallMs: 1800,
      },
      now: new Date("2026-03-25T10:00:03.000Z"),
    });
    assert.equal(consumed.ok, true);

    const plan = await getJson(`${baseUrl}/api/v1/rooms/${roomId}/rtc/plan`, { token });
    assert.equal(plan.status, 200);
    const planData = responseData(plan.body);
    assert.equal(typeof planData.worker_id, "string");
    assert.equal(Array.isArray(planData.active_speakers), true);
    assert.equal(typeof planData.subscription_limit, "number");
    assert.equal(typeof planData.degrade_level, "string");

    const metrics = await getJson(
      `${baseUrl}/api/v1/rooms/${roomId}/rtc/metrics?from=2026-03-25T09:50:00.000Z&to=2026-03-25T10:10:00.000Z`,
      { token },
    );
    assert.equal(metrics.status, 200);
    const metricsData = responseData(metrics.body);
    const points = metricsData.metrics;
    assert.ok(Array.isArray(points));
    const sample = (points as JsonRecord[])[0];
    assert.equal(typeof sample.latency_p95, "number");
    assert.equal(typeof sample.jitter_p95, "number");
    assert.equal(typeof sample.loss_ratio, "number");
    assert.equal(typeof sample.stall_ms, "number");
    assert.equal(typeof sample.degrade_events, "number");
    assert.equal(typeof sample.recover_ratio_15s, "number");
  });
});

test("REQ-003 rtc plan rejects non-members with ROOM_002", async () => {
  await withServer(async (baseUrl) => {
    const ownerToken = await loginAndGetToken(baseUrl, "300002");
    const outsiderToken = await loginAndGetToken(baseUrl, "300003");

    const createRoom = await postJson(
      `${baseUrl}/api/v1/rooms`,
      {
        visibility: "PUBLIC",
        topic: "REQ-003 ACL Room",
        tags: ["rtc"],
        language: "ar",
      },
      { token: ownerToken },
    );
    assert.equal(createRoom.status, 200);
    const createData = responseData(createRoom.body);
    const roomId = createData.room_id as string;

    const outsiderPlan = await getJson(`${baseUrl}/api/v1/rooms/${roomId}/rtc/plan`, {
      token: outsiderToken,
    });
    assert.equal(outsiderPlan.status, 403);
    assert.equal(outsiderPlan.body.code, "ROOM_002");
  });
});
