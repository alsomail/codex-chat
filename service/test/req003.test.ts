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

test("REQ-003 rtc metrics rejects inverted time range", async () => {
  await withServer(async (baseUrl) => {
    const ownerToken = await loginAndGetToken(baseUrl, "300004");

    const createRoom = await postJson(
      `${baseUrl}/api/v1/rooms`,
      {
        visibility: "PUBLIC",
        topic: "REQ-003 Metrics Window Room",
        tags: ["rtc"],
        language: "ar",
      },
      { token: ownerToken },
    );
    assert.equal(createRoom.status, 200);
    const createData = responseData(createRoom.body);
    const roomId = createData.room_id as string;

    const metrics = await getJson(
      `${baseUrl}/api/v1/rooms/${roomId}/rtc/metrics?from=2026-03-25T10:10:00.000Z&to=2026-03-25T10:00:00.000Z`,
      { token: ownerToken },
    );
    assert.equal(metrics.status, 400);
    assert.equal(metrics.body.code, "RTC_001");
  });
});

test("REQ-003 produce rejects out-of-range seat number", () => {
  const req003Service = createReq003Service();
  const created = req003Service.createTransport({
    roomId: "r_req003_edge",
    uid: "u_req003_edge",
    socketId: "sock_req003_edge",
    direction: "send",
    now: new Date("2026-03-25T12:00:00.000Z"),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const connected = req003Service.connectTransport({
    transportId: created.value.transport_id,
    uid: "u_req003_edge",
    dtlsParameters: { role: "auto" },
    now: new Date("2026-03-25T12:00:01.000Z"),
  });
  assert.equal(connected.ok, true);
  if (!connected.ok) {
    return;
  }

  const produced = req003Service.produce({
    transportId: created.value.transport_id,
    uid: "u_req003_edge",
    kind: "audio",
    seatNo: 9,
    now: new Date("2026-03-25T12:00:02.000Z"),
  });
  assert.equal(produced.ok, false);
  if (produced.ok) {
    return;
  }
  assert.equal(produced.error.code, "RTC_003");
});

test("REQ-003 consume rejects empty rtp_capabilities", () => {
  const req003Service = createReq003Service();
  const created = req003Service.createTransport({
    roomId: "r_req003_rtp",
    uid: "u_req003_rtp",
    socketId: "sock_req003_rtp",
    direction: "send",
    now: new Date("2026-03-25T12:10:00.000Z"),
  });
  assert.equal(created.ok, true);
  if (!created.ok) {
    return;
  }

  const connected = req003Service.connectTransport({
    transportId: created.value.transport_id,
    uid: "u_req003_rtp",
    dtlsParameters: { role: "auto" },
    now: new Date("2026-03-25T12:10:01.000Z"),
  });
  assert.equal(connected.ok, true);
  if (!connected.ok) {
    return;
  }

  const produced = req003Service.produce({
    transportId: created.value.transport_id,
    uid: "u_req003_rtp",
    kind: "audio",
    seatNo: 1,
    now: new Date("2026-03-25T12:10:02.000Z"),
  });
  assert.equal(produced.ok, true);
  if (!produced.ok) {
    return;
  }

  const consumed = req003Service.consume({
    roomId: "r_req003_rtp",
    uid: "u_req003_rtp",
    producerId: produced.value.producer_event.producer_id,
    rtpCapabilities: {},
    network: null,
    now: new Date("2026-03-25T12:10:03.000Z"),
  });
  assert.equal(consumed.ok, false);
  if (consumed.ok) {
    return;
  }
  assert.equal(consumed.error.code, "RTC_001");
});

test("REQ-004 reconnect resumes inside window and returns recover snapshot", () => {
  const req003Service = createReq003Service();
  const roomId = "r_req004_window";
  const uid = "u_req004_window";
  const socketId = "sock_req004_window";
  const baseNow = new Date("2026-03-25T13:10:00.000Z");

  const transport = req003Service.createTransport({
    roomId,
    uid,
    socketId,
    direction: "send",
    now: baseNow,
  });
  assert.equal(transport.ok, true);
  if (!transport.ok) {
    return;
  }

  const connected = req003Service.connectTransport({
    transportId: transport.value.transport_id,
    uid,
    dtlsParameters: { role: "auto" },
    now: new Date(baseNow.getTime() + 1000),
  });
  assert.equal(connected.ok, true);
  if (!connected.ok) {
    return;
  }

  const produced = req003Service.produce({
    transportId: transport.value.transport_id,
    uid,
    kind: "audio",
    seatNo: 1,
    now: new Date(baseNow.getTime() + 2000),
  });
  assert.equal(produced.ok, true);
  if (!produced.ok) {
    return;
  }

  const issued = req003Service.issueReconnectToken({
    roomId,
    sessionId: "sess_req004_window",
    uid,
    deviceId: "device-req004-window",
    installId: "install-req004-window",
    seatIntent: 1,
    now: new Date(baseNow.getTime() + 3000),
  });
  assert.equal(issued.ok, true);
  if (!issued.ok) {
    return;
  }

  const reconnected = req003Service.reconnectSession({
    roomId,
    sessionId: "sess_req004_window",
    reconnectToken: issued.value.reconnect_token,
    lastSeq: 0,
    uid,
    now: new Date(baseNow.getTime() + 8000),
  });
  assert.equal(reconnected.ok, true);
  if (!reconnected.ok) {
    return;
  }
  assert.equal(reconnected.value.resume_ok, true);
  assert.equal(reconnected.value.rejoin_required, false);
  assert.equal(reconnected.value.seat_resume.seat_status, "RESTORED");

  const snapshot = req003Service.recoverReconnectSnapshot({
    sessionId: "sess_req004_window",
    uid,
    now: new Date(baseNow.getTime() + 9000),
  });
  assert.equal(snapshot.ok, true);
  if (!snapshot.ok) {
    return;
  }
  assert.equal(snapshot.value.seat_state.seat_status, "RESTORED");
  assert.equal(snapshot.value.subscription_plan.subscription_limit, 8);
  assert.ok(snapshot.value.snapshot_seq >= reconnected.value.last_seq);
});

test("REQ-004 reconnect rejects expired window and unrecoverable seat", () => {
  const expiredService = createReq003Service();
  const roomId = "r_req004_expired";
  const uid = "u_req004_expired";
  const baseNow = new Date("2026-03-25T13:20:00.000Z");

  const expiredToken = expiredService.issueReconnectToken({
    roomId,
    sessionId: "sess_req004_expired",
    uid,
    deviceId: "device-req004-expired",
    installId: "install-req004-expired",
    seatIntent: 1,
    now: baseNow,
  });
  assert.equal(expiredToken.ok, true);
  if (!expiredToken.ok) {
    return;
  }

  const expiredReconnect = expiredService.reconnectSession({
    roomId,
    sessionId: "sess_req004_expired",
    reconnectToken: expiredToken.value.reconnect_token,
    lastSeq: 0,
    uid,
    now: new Date(baseNow.getTime() + 31_000),
  });
  assert.equal(expiredReconnect.ok, false);
  if (expiredReconnect.ok) {
    return;
  }
  assert.equal(expiredReconnect.error.code, "RECON_003");

  const seatLostService = createReq003Service();
  const seatLostToken = seatLostService.issueReconnectToken({
    roomId: "r_req004_seat_lost",
    sessionId: "sess_req004_seat_lost",
    uid: "u_req004_seat_lost",
    deviceId: "device-req004-seat-lost",
    installId: "install-req004-seat-lost",
    seatIntent: 2,
    now: baseNow,
  });
  assert.equal(seatLostToken.ok, true);
  if (!seatLostToken.ok) {
    return;
  }

  const seatLostReconnect = seatLostService.reconnectSession({
    roomId: "r_req004_seat_lost",
    sessionId: "sess_req004_seat_lost",
    reconnectToken: seatLostToken.value.reconnect_token,
    lastSeq: 0,
    uid: "u_req004_seat_lost",
    now: new Date(baseNow.getTime() + 1000),
  });
  assert.equal(seatLostReconnect.ok, false);
  if (seatLostReconnect.ok) {
    return;
  }
  assert.equal(seatLostReconnect.error.code, "RECON_005");
});
