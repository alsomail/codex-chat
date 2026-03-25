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

const accessSecret = "access-secret-1234567890";
const refreshSecret = "refresh-secret-1234567890";
const refreshPepper = "pepper-secret-1234567890";
const demoOtp = "246810";

type JsonRecord = Record<string, unknown>;

const createReq002App = (service: Req002Service) => {
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
      service,
    }),
  );

  return app;
};

const withServer = async (
  fn: (baseUrl: string, service: Req002Service) => Promise<void>,
): Promise<void> => {
  const service = createReq002Service();
  const app = createReq002App(service);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl, service);
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
  options?: { token?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: JsonRecord }> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options?.token !== undefined ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options?.headers ?? {}),
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
    phone_e164: `+97150000${suffix}`,
    otp_code: demoOtp,
    device_id: `device-req002-${suffix}`,
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

test("REQ-002 create room, issue join-token and query gifts", async () => {
  await withServer(async (baseUrl) => {
    const token = await loginAndGetToken(baseUrl, "200001");

    const createRoom = await postJson(
      `${baseUrl}/api/v1/rooms`,
      {
        visibility: "PUBLIC",
        topic: "REQ-002 Test Room",
        tags: ["chill", "music"],
        language: "ar",
      },
      { token },
    );
    assert.equal(createRoom.status, 200);
    const createData = responseData(createRoom.body);
    assert.equal(typeof createData.room_id, "string");
    const roomId = createData.room_id as string;

    const issueJoinToken = await postJson(
      `${baseUrl}/api/v1/rooms/${roomId}/join-token`,
      {
        device_id: "and_dev_001",
        install_id: "install_001",
      },
      { token },
    );
    assert.equal(issueJoinToken.status, 200);
    const joinData = responseData(issueJoinToken.body);
    assert.equal(typeof joinData.join_token, "string");
    assert.equal(typeof joinData.session_id, "string");

    const gifts = await getJson(
      `${baseUrl}/api/v1/rooms/${roomId}/gifts?country=AE`,
      { token },
    );
    assert.equal(gifts.status, 200);
    const giftData = responseData(gifts.body);
    const giftItems = giftData.gifts;
    assert.ok(Array.isArray(giftItems));
    const tiers = new Set(
      giftItems.map((item) => (item as JsonRecord).tier as string),
    );
    assert.ok(tiers.has("LOW"));
    assert.ok(tiers.has("MID"));
    assert.ok(tiers.has("HIGH"));
  });
});

test("REQ-002 payment verify keeps idempotency and supports recharge query", async () => {
  await withServer(async (baseUrl) => {
    const token = await loginAndGetToken(baseUrl, "200002");

    const idempotencyKey = "pay_20260325_key_0001";
    const payload = {
      channel: "GOOGLE_PLAY",
      product_id: "gold_980",
      purchase_token: "purchase_token_abc12345",
      order_id: "gp_order_12345678",
      amount: "4.99",
      currency: "USD",
    };

    const firstVerify = await postJson(
      `${baseUrl}/api/v1/payments/googleplay/verify`,
      payload,
      {
        token,
        headers: { "x-idempotency-key": idempotencyKey },
      },
    );
    assert.equal(firstVerify.status, 200);
    const firstData = responseData(firstVerify.body);
    assert.equal(firstData.status, "SUCCESS");
    assert.equal(typeof firstData.recharge_order_id, "string");
    const rechargeOrderId = firstData.recharge_order_id as string;

    const secondVerify = await postJson(
      `${baseUrl}/api/v1/payments/googleplay/verify`,
      payload,
      {
        token,
        headers: { "x-idempotency-key": idempotencyKey },
      },
    );
    assert.equal(secondVerify.status, 200);
    const secondData = responseData(secondVerify.body);
    assert.equal(secondData.recharge_order_id, rechargeOrderId);

    const orderQuery = await getJson(
      `${baseUrl}/api/v1/orders/recharge/${rechargeOrderId}`,
      { token },
    );
    assert.equal(orderQuery.status, 200);
    const orderData = responseData(orderQuery.body);
    assert.equal(orderData.status, "SUCCESS");
  });
});

test("REQ-002 gift flow supports insufficient balance, recharge and duplicate idempotency", async () => {
  const service = createReq002Service();
  const now = new Date("2026-03-25T00:00:00.000Z");
  const room = service.createRoom({
    uid: "u_sender",
    visibility: "PUBLIC",
    topic: "Gift Test Room",
    tags: [],
    language: "ar",
    now,
  });

  const insufficient = service.sendGift({
    uid: "u_sender",
    deviceId: "device-001",
    roomId: room.roomId,
    giftSkuId: "g_castle_1",
    count: 9,
    toUid: "u_receiver",
    idempotencyKey: "gift_20260325_insufficient_01",
    country: "AE",
    now,
  });
  assert.equal(insufficient.ok, false);
  if (!insufficient.ok) {
    assert.equal(insufficient.code, "GIFT_002");
  }

  const recharged = service.verifyPayment({
    uid: "u_sender",
    idempotencyKey: "pay_20260325_recharge_01",
    productId: "gold_980",
    purchaseToken: "purchase_token_recharge_01",
    orderId: "gp_order_recharge_01",
    amount: "4.99",
    now: new Date("2026-03-25T00:00:05.000Z"),
  });
  assert.equal(recharged.ok, true);

  const idempotencyKey = "gift_20260325_normal_000001";
  const firstSend = service.sendGift({
    uid: "u_sender",
    deviceId: "device-001",
    roomId: room.roomId,
    giftSkuId: "g_castle_1",
    count: 9,
    toUid: "u_receiver",
    idempotencyKey,
    country: "AE",
    now: new Date("2026-03-25T00:00:10.000Z"),
  });
  assert.equal(firstSend.ok, true);
  if (!firstSend.ok) {
    return;
  }
  assert.equal(firstSend.order.status, "FINALIZED");

  const duplicate = service.sendGift({
    uid: "u_sender",
    deviceId: "device-001",
    roomId: room.roomId,
    giftSkuId: "g_castle_1",
    count: 9,
    toUid: "u_receiver",
    idempotencyKey,
    country: "AE",
    now: new Date("2026-03-25T00:00:20.000Z"),
  });
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) {
    assert.equal(duplicate.code, "GIFT_003");
    assert.equal(duplicate.giftOrderId, firstSend.order.giftOrderId);
  }

  const order = service.getGiftOrder("u_sender", firstSend.order.giftOrderId);
  assert.notEqual(order, null);
  assert.equal(order?.status, "FINALIZED");
});

test("REQ-002 risk codes include RISK_001 RISK_002 RISK_003", () => {
  const now = new Date("2026-03-25T00:00:00.000Z");

  const blockedUidService = createReq002Service({
    blockedUids: ["u_blocked"],
  });
  const roomA = blockedUidService.createRoom({
    uid: "host_a",
    visibility: "PUBLIC",
    topic: "Room A",
    tags: [],
    language: "ar",
    now,
  });
  const blockedUidResult = blockedUidService.sendGift({
    uid: "u_blocked",
    deviceId: "device-a",
    roomId: roomA.roomId,
    giftSkuId: "g_rose_1",
    count: 1,
    toUid: "u_receiver",
    idempotencyKey: "gift_20260325_blocked_uid_01",
    country: "AE",
    now,
  });
  assert.equal(blockedUidResult.ok, false);
  if (!blockedUidResult.ok) {
    assert.equal(blockedUidResult.code, "RISK_002");
  }

  const blockedDeviceService = createReq002Service({
    blockedDeviceIds: ["device-risk-3"],
  });
  const roomB = blockedDeviceService.createRoom({
    uid: "host_b",
    visibility: "PUBLIC",
    topic: "Room B",
    tags: [],
    language: "ar",
    now,
  });
  const blockedDeviceResult = blockedDeviceService.sendGift({
    uid: "u_sender",
    deviceId: "device-risk-3",
    roomId: roomB.roomId,
    giftSkuId: "g_rose_1",
    count: 1,
    toUid: "u_receiver",
    idempotencyKey: "gift_20260325_blocked_device_01",
    country: "AE",
    now,
  });
  assert.equal(blockedDeviceResult.ok, false);
  if (!blockedDeviceResult.ok) {
    assert.equal(blockedDeviceResult.code, "RISK_003");
  }

  const rateLimitedService = createReq002Service();
  const roomC = rateLimitedService.createRoom({
    uid: "host_c",
    visibility: "PUBLIC",
    topic: "Room C",
    tags: [],
    language: "ar",
    now,
  });

  let lastResult:
    | ReturnType<typeof rateLimitedService.sendGift>
    | null = null;
  for (let index = 0; index < 31; index += 1) {
    lastResult = rateLimitedService.sendGift({
      uid: "u_rate",
      deviceId: "device-rate-001",
      roomId: roomC.roomId,
      giftSkuId: "g_rose_1",
      count: 1,
      toUid: "u_receiver",
      idempotencyKey: `gift_20260325_rate_${String(index).padStart(6, "0")}`,
      country: "AE",
      now,
    });
  }
  assert.notEqual(lastResult, null);
  assert.equal(lastResult?.ok, false);
  if (lastResult !== null && !lastResult.ok) {
    assert.equal(lastResult.code, "RISK_001");
  }
});

test("REQ-002 join-token can only be consumed once", () => {
  const service = createReq002Service();
  const now = new Date("2026-03-25T00:00:00.000Z");
  const room = service.createRoom({
    uid: "u_host",
    visibility: "PUBLIC",
    topic: "Join Token Room",
    tags: [],
    language: "ar",
    now,
  });

  const issue = service.issueJoinToken({
    uid: "u_joiner",
    roomId: room.roomId,
    deviceId: "device-join-01",
    installId: "install-join-01",
    now,
  });
  assert.equal(issue.ok, true);
  if (!issue.ok) {
    return;
  }

  const firstJoin = service.joinRoom({
    uid: "u_joiner",
    roomId: room.roomId,
    joinToken: issue.token.joinToken,
    now: new Date("2026-03-25T00:00:10.000Z"),
  });
  assert.equal(firstJoin.ok, true);

  const secondJoin = service.joinRoom({
    uid: "u_joiner",
    roomId: room.roomId,
    joinToken: issue.token.joinToken,
    now: new Date("2026-03-25T00:00:20.000Z"),
  });
  assert.equal(secondJoin.ok, false);
  if (!secondJoin.ok) {
    assert.equal(secondJoin.code, "ROOM_003");
  }
});
