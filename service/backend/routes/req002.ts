import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { Server, Socket } from "socket.io";

type ApiCode =
  | "OK"
  | "AUTH_001"
  | "ROOM_001"
  | "ROOM_002"
  | "ROOM_003"
  | "GIFT_001"
  | "GIFT_002"
  | "GIFT_003"
  | "GIFT_004"
  | "PAY_001"
  | "PAY_002"
  | "PAY_004"
  | "RISK_001"
  | "RISK_002"
  | "RISK_003"
  | "SYS_001";

type RoomVisibility = "PUBLIC" | "PRIVATE";
type GiftTier = "LOW" | "MID" | "HIGH";
type GiftOrderStatus =
  | "PENDING"
  | "ACCEPTED"
  | "BROADCASTED"
  | "FINALIZED"
  | "REVERSED";
type RechargeOrderStatus = "PENDING" | "SUCCESS" | "FAILED" | "REVERSED";

interface AuthUser {
  uid: string;
  device_id: string;
  country: string;
  session_id?: string;
}

interface RoomProfile {
  roomId: string;
  ownerUid: string;
  visibility: RoomVisibility;
  topic: string;
  tags: string[];
  language: string;
  status: "OPEN" | "CLOSED";
  createdAt: Date;
}

interface JoinTokenRecord {
  joinToken: string;
  roomId: string;
  uid: string;
  deviceId: string;
  installId: string;
  expiresAt: Date;
  consumed: boolean;
  sessionId: string;
}

interface GiftSku {
  giftSkuId: string;
  tier: GiftTier;
  priceGold: number;
  name: string;
}

interface GiftOrder {
  giftOrderId: string;
  roomId: string;
  fromUid: string;
  toUid: string;
  giftSkuId: string;
  count: number;
  amountGold: number;
  idempotencyKey: string;
  status: GiftOrderStatus;
  reasonCode: ApiCode | null;
  balanceAfter: number | null;
  createdAt: Date;
  acceptedAt: Date | null;
  broadcastedAt: Date | null;
  finalizedAt: Date | null;
  reversedAt: Date | null;
}

interface RechargeOrder {
  rechargeOrderId: string;
  uid: string;
  channel: "GOOGLE_PLAY";
  productId: string;
  amount: string;
  creditedGold: number;
  status: RechargeOrderStatus;
  idempotencyKey: string;
  gatewayTxnId: string;
  reasonCode: ApiCode | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SendGiftResultAccepted {
  ok: true;
  order: GiftOrder;
  balanceAfter: number;
  leaderboard: Array<{ uid: string; total_gold: number }>;
}

interface SendGiftResultRejected {
  ok: false;
  code: ApiCode;
  message: string;
  giftOrderId?: string;
}

type SendGiftResult = SendGiftResultAccepted | SendGiftResultRejected;

interface VerifyPaymentResult {
  order: RechargeOrder;
  walletAfter: {
    wallet_gold: number;
    wallet_bonus_gold: number;
  };
}

interface Req002RouterOptions {
  authMiddleware: RequestHandler;
  service: Req002Service;
}

const defaultRoomPreviews = [
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
];

const defaultGiftCatalogByCountry = new Map<string, GiftSku[]>([
  [
    "AE",
    [
      { giftSkuId: "g_rose_1", tier: "LOW", priceGold: 10, name: "Rose" },
      { giftSkuId: "g_car_1", tier: "MID", priceGold: 300, name: "Sport Car" },
      { giftSkuId: "g_castle_1", tier: "HIGH", priceGold: 1200, name: "Castle" },
    ],
  ],
  [
    "DEFAULT",
    [
      { giftSkuId: "g_rose_1", tier: "LOW", priceGold: 10, name: "Rose" },
      { giftSkuId: "g_star_1", tier: "MID", priceGold: 200, name: "Star" },
      { giftSkuId: "g_trophy_1", tier: "HIGH", priceGold: 1000, name: "Trophy" },
    ],
  ],
]);

const productGoldMap: Record<string, number> = {
  gold_300: 300,
  gold_980: 980,
  gold_1980: 1980,
};

class SlidingWindowLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly maxCount: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string, now: Date): boolean {
    const nowMs = now.getTime();
    const threshold = nowMs - this.windowMs;
    const history = this.buckets.get(key) ?? [];
    const filtered = history.filter((value) => value >= threshold);
    if (filtered.length >= this.maxCount) {
      this.buckets.set(key, filtered);
      return false;
    }
    filtered.push(nowMs);
    this.buckets.set(key, filtered);
    return true;
  }
}

export class Req002Service {
  private readonly rooms = new Map<string, RoomProfile>();
  private readonly roomMembersByRoomId = new Map<string, Set<string>>();
  private readonly joinTokens = new Map<string, JoinTokenRecord>();
  private readonly giftOrders = new Map<string, GiftOrder>();
  private readonly rechargeOrders = new Map<string, RechargeOrder>();
  private readonly giftIdempotency = new Map<string, string>();
  private readonly paymentIdempotency = new Map<string, string>();
  private readonly walletGoldByUid = new Map<string, number>();
  private readonly leaderboardByRoomId = new Map<string, Map<string, number>>();
  private readonly spendByUidPerDay = new Map<string, number>();

  private giftOrderSeq = 0;
  private rechargeOrderSeq = 0;

  private readonly giftLimiter = new SlidingWindowLimiter(30, 60_000);
  private readonly deviceRiskLimiter = new SlidingWindowLimiter(45, 60_000);
  private readonly blockedUids = new Set<string>();
  private readonly blockedDeviceIds = new Set<string>();

  constructor(seed?: { blockedUids?: string[]; blockedDeviceIds?: string[] }) {
    for (const room of defaultRoomPreviews) {
      this.rooms.set(room.roomId, {
        roomId: room.roomId,
        ownerUid: "system",
        visibility: "PUBLIC",
        topic: room.name,
        tags: [],
        language: "ar",
        status: "OPEN",
        createdAt: new Date("2026-03-25T00:00:00.000Z"),
      });
    }

    if (seed?.blockedUids !== undefined) {
      for (const uid of seed.blockedUids) {
        this.blockedUids.add(uid);
      }
    }
    if (seed?.blockedDeviceIds !== undefined) {
      for (const deviceId of seed.blockedDeviceIds) {
        this.blockedDeviceIds.add(deviceId);
      }
    }
  }

  listRoomPreviews(): Array<{
    roomId: string;
    name: string;
    hostName: string;
    onlineCount: number;
  }> {
    const dynamicRooms = Array.from(this.rooms.values())
      .filter((room) => !defaultRoomPreviews.some((item) => item.roomId === room.roomId))
      .map((room) => ({
        roomId: room.roomId,
        name: room.topic,
        hostName: room.ownerUid,
        onlineCount: 1,
      }));
    return [...defaultRoomPreviews, ...dynamicRooms];
  }

  createRoom(input: {
    uid: string;
    visibility: RoomVisibility;
    topic: string;
    tags: string[];
    language: string;
    now: Date;
  }): RoomProfile {
    const roomId = `r_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const room: RoomProfile = {
      roomId,
      ownerUid: input.uid,
      visibility: input.visibility,
      topic: input.topic,
      tags: input.tags,
      language: input.language,
      status: "OPEN",
      createdAt: input.now,
    };
    this.rooms.set(roomId, room);
    this.addRoomMember(roomId, input.uid);
    return room;
  }

  hasRoom(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  isRoomMember(roomId: string, uid: string): boolean {
    const members = this.roomMembersByRoomId.get(roomId);
    if (members === undefined) {
      return false;
    }
    return members.has(uid);
  }

  leaveRoomMember(roomId: string, uid: string): void {
    const members = this.roomMembersByRoomId.get(roomId);
    if (members === undefined) {
      return;
    }
    members.delete(uid);
    if (members.size === 0) {
      this.roomMembersByRoomId.delete(roomId);
    }
  }

  issueJoinToken(input: {
    uid: string;
    roomId: string;
    deviceId: string;
    installId: string;
    now: Date;
  }):
    | {
        ok: true;
        token: JoinTokenRecord;
      }
    | {
        ok: false;
        code: ApiCode;
        message: string;
      } {
    const room = this.rooms.get(input.roomId);
    if (room === undefined || room.status !== "OPEN") {
      return { ok: false, code: "ROOM_001", message: "Room does not exist." };
    }

    if (room.visibility === "PRIVATE" && room.ownerUid !== input.uid) {
      return { ok: false, code: "ROOM_002", message: "No permission to join private room." };
    }

    const token: JoinTokenRecord = {
      joinToken: `jt_${randomUUID().replaceAll("-", "")}`,
      roomId: input.roomId,
      uid: input.uid,
      deviceId: input.deviceId,
      installId: input.installId,
      expiresAt: new Date(input.now.getTime() + 60_000),
      consumed: false,
      sessionId: `sess_room_${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    };
    this.joinTokens.set(token.joinToken, token);
    return { ok: true, token };
  }

  joinRoom(input: {
    uid: string;
    roomId: string;
    joinToken: string;
    now: Date;
  }):
    | {
        ok: true;
        room: RoomProfile;
        sessionId: string;
        leaderboard: Array<{ uid: string; total_gold: number }>;
      }
    | {
        ok: false;
        code: ApiCode;
        message: string;
      } {
    const room = this.rooms.get(input.roomId);
    if (room === undefined) {
      return { ok: false, code: "ROOM_001", message: "Room does not exist." };
    }

    const token = this.joinTokens.get(input.joinToken);
    if (token === undefined || token.roomId !== input.roomId || token.uid !== input.uid) {
      return { ok: false, code: "ROOM_002", message: "Join token is invalid." };
    }
    if (token.expiresAt.getTime() <= input.now.getTime()) {
      return { ok: false, code: "ROOM_003", message: "Join token has expired." };
    }
    if (token.consumed) {
      return { ok: false, code: "ROOM_003", message: "Join token has already been used." };
    }

    token.consumed = true;
    this.addRoomMember(input.roomId, input.uid);
    return {
      ok: true,
      room,
      sessionId: token.sessionId,
      leaderboard: this.getLeaderboardSnapshot(input.roomId),
    };
  }

  listGifts(roomId: string, country: string): GiftSku[] | null {
    if (!this.rooms.has(roomId)) {
      return null;
    }
    return (
      defaultGiftCatalogByCountry.get(country) ??
      defaultGiftCatalogByCountry.get("DEFAULT") ??
      []
    );
  }

  verifyPayment(input: {
    uid: string;
    idempotencyKey: string;
    productId: string;
    purchaseToken: string;
    orderId: string;
    amount: string;
    now: Date;
  }):
    | {
        ok: true;
        result: VerifyPaymentResult;
      }
    | {
        ok: false;
        code: ApiCode;
        message: string;
      } {
    const productGold = productGoldMap[input.productId];
    if (productGold === undefined || input.purchaseToken.length < 8 || input.orderId.length < 8) {
      return {
        ok: false,
        code: "PAY_004",
        message: "Product and purchase token mismatch.",
      };
    }

    const idempotencyScope = `${input.uid}:${input.idempotencyKey}`;
    const existingOrderId = this.paymentIdempotency.get(idempotencyScope);
    if (existingOrderId !== undefined) {
      const existingOrder = this.rechargeOrders.get(existingOrderId);
      if (existingOrder !== undefined) {
        return {
          ok: true,
          result: {
            order: existingOrder,
            walletAfter: {
              wallet_gold: this.ensureWallet(input.uid),
              wallet_bonus_gold: 0,
            },
          },
        };
      }
    }

    const rechargeOrderId = this.nextRechargeOrderId(input.now);
    const walletAfter = this.ensureWallet(input.uid) + productGold;
    this.walletGoldByUid.set(input.uid, walletAfter);

    const order: RechargeOrder = {
      rechargeOrderId,
      uid: input.uid,
      channel: "GOOGLE_PLAY",
      productId: input.productId,
      amount: input.amount,
      creditedGold: productGold,
      status: "SUCCESS",
      idempotencyKey: input.idempotencyKey,
      gatewayTxnId: input.orderId,
      reasonCode: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.rechargeOrders.set(rechargeOrderId, order);
    this.paymentIdempotency.set(idempotencyScope, rechargeOrderId);

    return {
      ok: true,
      result: {
        order,
        walletAfter: {
          wallet_gold: walletAfter,
          wallet_bonus_gold: 0,
        },
      },
    };
  }

  getRechargeOrder(uid: string, orderId: string): RechargeOrder | null {
    const order = this.rechargeOrders.get(orderId);
    if (order === undefined || order.uid !== uid) {
      return null;
    }
    return order;
  }

  getGiftOrder(uid: string, orderId: string): GiftOrder | null {
    const order = this.giftOrders.get(orderId);
    if (order === undefined || order.fromUid !== uid) {
      return null;
    }
    return order;
  }

  sendGift(input: {
    uid: string;
    deviceId: string;
    roomId: string;
    giftSkuId: string;
    count: number;
    toUid: string;
    idempotencyKey: string;
    country: string;
    now: Date;
  }): SendGiftResult {
    const room = this.rooms.get(input.roomId);
    if (room === undefined) {
      return { ok: false, code: "ROOM_001", message: "Room does not exist." };
    }

    if (this.blockedUids.has(input.uid)) {
      return { ok: false, code: "RISK_002", message: "Current account is blocked." };
    }
    if (this.blockedDeviceIds.has(input.deviceId)) {
      return { ok: false, code: "RISK_003", message: "Current device is blocked." };
    }
    if (!this.deviceRiskLimiter.hit(`device:${input.deviceId}`, input.now)) {
      return { ok: false, code: "RISK_003", message: "Suspicious device activity detected." };
    }

    if (!this.giftLimiter.hit(`${input.uid}:${input.roomId}`, input.now)) {
      return { ok: false, code: "RISK_001", message: "Gift send rate is limited." };
    }

    if (!/^[-_a-zA-Z0-9]{16,64}$/.test(input.idempotencyKey)) {
      return { ok: false, code: "GIFT_003", message: "idempotency_key is invalid." };
    }

    if (!Number.isInteger(input.count) || input.count < 1 || input.count > 99) {
      return { ok: false, code: "GIFT_001", message: "gift count is out of range." };
    }

    const idempotencyScope = `${input.uid}:${input.roomId}:${input.idempotencyKey}`;
    const existingOrderId = this.giftIdempotency.get(idempotencyScope);
    if (existingOrderId !== undefined) {
      return {
        ok: false,
        code: "GIFT_003",
        message: "Duplicate idempotency_key detected.",
        giftOrderId: existingOrderId,
      };
    }

    const sku = this.findGiftSku(input.country, input.giftSkuId);
    if (sku === null) {
      return { ok: false, code: "GIFT_001", message: "Gift SKU does not exist." };
    }

    const amountGold = sku.priceGold * input.count;
    if (!this.hitDailySpendLimit(input.uid, amountGold, input.now)) {
      return { ok: false, code: "RISK_001", message: "Gift daily amount is limited." };
    }

    const currentBalance = this.ensureWallet(input.uid);
    if (currentBalance < amountGold) {
      return { ok: false, code: "GIFT_002", message: "Insufficient balance." };
    }

    const giftOrderId = this.nextGiftOrderId(input.now);
    const acceptedAt = new Date(input.now.getTime() + 5);
    const broadcastedAt = new Date(input.now.getTime() + 15);
    const finalizedAt = new Date(input.now.getTime() + 20);
    const balanceAfter = currentBalance - amountGold;
    this.walletGoldByUid.set(input.uid, balanceAfter);
    this.giftIdempotency.set(idempotencyScope, giftOrderId);

    const leaderboard = this.addLeaderboardContribution(input.roomId, input.toUid, amountGold);

    const order: GiftOrder = {
      giftOrderId,
      roomId: input.roomId,
      fromUid: input.uid,
      toUid: input.toUid,
      giftSkuId: sku.giftSkuId,
      count: input.count,
      amountGold,
      idempotencyKey: input.idempotencyKey,
      status: "FINALIZED",
      reasonCode: null,
      balanceAfter,
      createdAt: input.now,
      acceptedAt,
      broadcastedAt,
      finalizedAt,
      reversedAt: null,
    };
    this.giftOrders.set(giftOrderId, order);

    return {
      ok: true,
      order,
      balanceAfter,
      leaderboard,
    };
  }

  getLeaderboardSnapshot(roomId: string): Array<{ uid: string; total_gold: number }> {
    const board = this.leaderboardByRoomId.get(roomId);
    if (board === undefined) {
      return [];
    }

    return Array.from(board.entries())
      .map(([uid, totalGold]) => ({ uid, total_gold: totalGold }))
      .sort((left, right) => right.total_gold - left.total_gold)
      .slice(0, 20);
  }

  private ensureWallet(uid: string): number {
    const existing = this.walletGoldByUid.get(uid);
    if (existing !== undefined) {
      return existing;
    }

    const defaultBalance = 10_000;
    this.walletGoldByUid.set(uid, defaultBalance);
    return defaultBalance;
  }

  private findGiftSku(country: string, giftSkuId: string): GiftSku | null {
    const catalog =
      defaultGiftCatalogByCountry.get(country) ??
      defaultGiftCatalogByCountry.get("DEFAULT") ??
      [];
    return catalog.find((gift) => gift.giftSkuId === giftSkuId) ?? null;
  }

  private nextGiftOrderId(now: Date): string {
    this.giftOrderSeq += 1;
    return `gft_${formatDateForId(now)}_${String(this.giftOrderSeq).padStart(4, "0")}`;
  }

  private nextRechargeOrderId(now: Date): string {
    this.rechargeOrderSeq += 1;
    return `rch_${formatDateForId(now)}_${String(this.rechargeOrderSeq).padStart(4, "0")}`;
  }

  private hitDailySpendLimit(uid: string, amountGold: number, now: Date): boolean {
    const dailyKey = `${uid}:${now.toISOString().slice(0, 10)}`;
    const current = this.spendByUidPerDay.get(dailyKey) ?? 0;
    if (current + amountGold > 50_000) {
      return false;
    }
    this.spendByUidPerDay.set(dailyKey, current + amountGold);
    return true;
  }

  private addLeaderboardContribution(
    roomId: string,
    uid: string,
    amountGold: number,
  ): Array<{ uid: string; total_gold: number }> {
    let board = this.leaderboardByRoomId.get(roomId);
    if (board === undefined) {
      board = new Map<string, number>();
      this.leaderboardByRoomId.set(roomId, board);
    }

    const current = board.get(uid) ?? 0;
    board.set(uid, current + amountGold);
    return this.getLeaderboardSnapshot(roomId);
  }

  private addRoomMember(roomId: string, uid: string): void {
    const members = this.roomMembersByRoomId.get(roomId) ?? new Set<string>();
    members.add(uid);
    this.roomMembersByRoomId.set(roomId, members);
  }
}

export const createReq002Service = (
  seed?: { blockedUids?: string[]; blockedDeviceIds?: string[] },
): Req002Service => {
  return new Req002Service(seed);
};

export const createReq002Router = (options: Req002RouterOptions): Router => {
  const router = createRouter();

  router.post("/rooms", options.authMiddleware, (request, response) => {
    const requestId = resolveRequestId(request);
    const user = readAuthUser(response);
    if (user === null) {
      sendError(response, requestId, 401, "AUTH_001", "Unauthorized request.");
      return;
    }

    const visibility = normalizeVisibility(request.body?.visibility);
    const topic = normalizeString(request.body?.topic);
    const tags = normalizeTags(request.body?.tags);
    const language = normalizeString(request.body?.language) ?? "ar";
    if (visibility === null || topic === null || topic.length < 3) {
      sendError(response, requestId, 400, "ROOM_001", "Invalid room create payload.");
      return;
    }

    const room = options.service.createRoom({
      uid: user.uid,
      visibility,
      topic,
      tags,
      language,
      now: new Date(),
    });

    sendSuccess(response, requestId, {
      room_id: room.roomId,
      owner_uid: room.ownerUid,
      visibility: room.visibility,
      status: room.status,
      created_at: room.createdAt.toISOString(),
    });
  });

  router.post("/rooms/:roomId/join-token", options.authMiddleware, (request, response) => {
    const requestId = resolveRequestId(request);
    const user = readAuthUser(response);
    if (user === null) {
      sendError(response, requestId, 401, "AUTH_001", "Unauthorized request.");
      return;
    }

    const roomId = normalizeString(request.params.roomId);
    if (roomId === null) {
      sendError(response, requestId, 400, "ROOM_001", "room_id is required.");
      return;
    }

    const deviceId = normalizeString(request.body?.device_id) ?? user.device_id;
    const installId = normalizeString(request.body?.install_id) ?? "install_default";

    const issued = options.service.issueJoinToken({
      uid: user.uid,
      roomId,
      deviceId,
      installId,
      now: new Date(),
    });
    if (!issued.ok) {
      sendError(
        response,
        requestId,
        resolveStatusByCode(issued.code),
        issued.code,
        issued.message,
      );
      return;
    }

    sendSuccess(response, requestId, {
      join_token: issued.token.joinToken,
      expires_at: issued.token.expiresAt.toISOString(),
      room_id: issued.token.roomId,
      session_id: issued.token.sessionId,
    });
  });

  router.get("/rooms/:roomId/gifts", options.authMiddleware, (request, response) => {
    const requestId = resolveRequestId(request);
    const user = readAuthUser(response);
    if (user === null) {
      sendError(response, requestId, 401, "AUTH_001", "Unauthorized request.");
      return;
    }

    const roomId = normalizeString(request.params.roomId);
    if (roomId === null) {
      sendError(response, requestId, 400, "ROOM_001", "room_id is required.");
      return;
    }

    const country = normalizeString(request.query.country) ?? user.country;
    const gifts = options.service.listGifts(roomId, country);
    if (gifts === null) {
      sendError(response, requestId, 404, "ROOM_001", "Room does not exist.");
      return;
    }

    sendSuccess(response, requestId, {
      room_id: roomId,
      gifts: gifts.map((gift) => ({
        gift_sku_id: gift.giftSkuId,
        tier: gift.tier,
        price_gold: gift.priceGold,
        name: gift.name,
      })),
    });
  });

  router.post("/payments/googleplay/verify", options.authMiddleware, (request, response) => {
    const requestId = resolveRequestId(request);
    const user = readAuthUser(response);
    if (user === null) {
      sendError(response, requestId, 401, "AUTH_001", "Unauthorized request.");
      return;
    }

    const idempotencyKey = normalizeString(request.header("x-idempotency-key"));
    if (idempotencyKey === null || !/^[-_a-zA-Z0-9]{16,64}$/.test(idempotencyKey)) {
      sendError(response, requestId, 400, "PAY_001", "X-Idempotency-Key is required.");
      return;
    }

    const productId = normalizeString(request.body?.product_id);
    const purchaseToken = normalizeString(request.body?.purchase_token);
    const orderId = normalizeString(request.body?.order_id);
    const amount = normalizeString(request.body?.amount);

    if (productId === null || purchaseToken === null || orderId === null || amount === null) {
      sendError(response, requestId, 400, "PAY_001", "Invalid payment verification payload.");
      return;
    }

    const verified = options.service.verifyPayment({
      uid: user.uid,
      idempotencyKey,
      productId,
      purchaseToken,
      orderId,
      amount,
      now: new Date(),
    });
    if (!verified.ok) {
      sendError(
        response,
        requestId,
        resolveStatusByCode(verified.code),
        verified.code,
        verified.message,
      );
      return;
    }

    sendSuccess(response, requestId, {
      recharge_order_id: verified.result.order.rechargeOrderId,
      credited_gold: verified.result.order.creditedGold,
      wallet_after: verified.result.walletAfter,
      status: verified.result.order.status,
    });
  });

  router.get("/orders/recharge/:orderId", options.authMiddleware, (request, response) => {
    const requestId = resolveRequestId(request);
    const user = readAuthUser(response);
    if (user === null) {
      sendError(response, requestId, 401, "AUTH_001", "Unauthorized request.");
      return;
    }

    const orderId = normalizeString(request.params.orderId);
    if (orderId === null) {
      sendError(response, requestId, 400, "PAY_001", "order_id is required.");
      return;
    }

    const order = options.service.getRechargeOrder(user.uid, orderId);
    if (order === null) {
      sendError(response, requestId, 404, "PAY_001", "Recharge order does not exist.");
      return;
    }

    sendSuccess(response, requestId, {
      recharge_order_id: order.rechargeOrderId,
      status: order.status,
      credited_gold: order.creditedGold,
      reason_code: order.reasonCode,
      updated_at: order.updatedAt.toISOString(),
    });
  });

  router.get("/orders/gift/:orderId", options.authMiddleware, (request, response) => {
    const requestId = resolveRequestId(request);
    const user = readAuthUser(response);
    if (user === null) {
      sendError(response, requestId, 401, "AUTH_001", "Unauthorized request.");
      return;
    }

    const orderId = normalizeString(request.params.orderId);
    if (orderId === null) {
      sendError(response, requestId, 400, "GIFT_004", "order_id is required.");
      return;
    }

    const order = options.service.getGiftOrder(user.uid, orderId);
    if (order === null) {
      sendError(response, requestId, 404, "GIFT_004", "Gift order does not exist.");
      return;
    }

    sendSuccess(response, requestId, {
      gift_order_id: order.giftOrderId,
      status: order.status,
      room_id: order.roomId,
      from_uid: order.fromUid,
      to_uid: order.toUid,
      gift_sku_id: order.giftSkuId,
      count: order.count,
      amount_gold: order.amountGold,
      idempotency_key: order.idempotencyKey,
      balance_after: order.balanceAfter,
      reason_code: order.reasonCode,
      updated_at: resolveOrderUpdatedAt(order).toISOString(),
    });
  });

  return router;
};

export const registerReq002SocketHandlers = (
  io: Server,
  service: Req002Service,
): void => {
  io.on("connection", (socket) => {
    socket.on("room.join", (payload: unknown) => {
      const user = readSocketUser(socket);
      if (user === null) {
        emitRoomJoinFailed(socket, "AUTH_001", "Unauthorized socket request.");
        return;
      }

      const roomId = normalizeString((payload as Record<string, unknown>)?.room_id);
      const joinToken = normalizeString((payload as Record<string, unknown>)?.join_token);
      if (roomId === null || joinToken === null) {
        emitRoomJoinFailed(socket, "ROOM_001", "room_id and join_token are required.");
        return;
      }

      const joined = service.joinRoom({
        uid: user.uid,
        roomId,
        joinToken,
        now: new Date(),
      });
      if (!joined.ok) {
        emitRoomJoinFailed(socket, joined.code, joined.message);
        return;
      }

      void socket.join(roomId);
      const onlineCount = io.sockets.adapter.rooms.get(roomId)?.size ?? 1;
      socket.emit("room.joined", {
        room_id: roomId,
        session_id: joined.sessionId,
        online_count: onlineCount,
        seats: [],
        leaderboard: joined.leaderboard,
      });
    });

    socket.on("room.leave", (payload: unknown) => {
      const user = readSocketUser(socket);
      const roomId = normalizeString((payload as Record<string, unknown>)?.room_id);
      if (roomId !== null) {
        void socket.leave(roomId);
        if (user !== null) {
          service.leaveRoomMember(roomId, user.uid);
        }
      }
    });

    socket.on("gift.send", (payload: unknown) => {
      const user = readSocketUser(socket);
      if (user === null) {
        socket.emit("gift.rejected", {
          error_code: "AUTH_001",
          message: "Unauthorized socket request.",
        });
        return;
      }

      const roomId = normalizeString((payload as Record<string, unknown>)?.room_id);
      const giftSkuId = normalizeString((payload as Record<string, unknown>)?.gift_sku_id);
      const toUid = normalizeString((payload as Record<string, unknown>)?.to_uid);
      const idempotencyKey = normalizeString(
        (payload as Record<string, unknown>)?.idempotency_key,
      );
      const count = (payload as Record<string, unknown>)?.count;

      if (
        roomId === null ||
        giftSkuId === null ||
        toUid === null ||
        idempotencyKey === null ||
        typeof count !== "number"
      ) {
        socket.emit("gift.rejected", {
          error_code: "GIFT_001",
          message: "gift.send payload is invalid.",
        });
        return;
      }

      const result = service.sendGift({
        uid: user.uid,
        deviceId: user.device_id,
        roomId,
        giftSkuId,
        count,
        toUid,
        idempotencyKey,
        country: user.country,
        now: new Date(),
      });

      if (!result.ok) {
        socket.emit("gift.rejected", {
          error_code: result.code,
          message: result.message,
          gift_order_id: result.giftOrderId,
        });
        return;
      }

      const acceptedEvent = {
        room_id: result.order.roomId,
        gift_order_id: result.order.giftOrderId,
        balance_after: result.balanceAfter,
        status: "ACCEPTED",
      };
      socket.emit("gift.accepted", acceptedEvent);

      const broadcastEvent = {
        room_id: result.order.roomId,
        gift_order_id: result.order.giftOrderId,
        from_uid: result.order.fromUid,
        to_uid: result.order.toUid,
        gift_sku_id: result.order.giftSkuId,
        count: result.order.count,
        amount_gold: result.order.amountGold,
      };
      io.to(result.order.roomId).emit("gift.broadcast", broadcastEvent);
      io.to(result.order.roomId).emit("leaderboard.updated", {
        room_id: result.order.roomId,
        leaderboard: result.leaderboard,
      });
    });
  });
};

const resolveOrderUpdatedAt = (order: GiftOrder): Date => {
  return (
    order.finalizedAt ??
    order.reversedAt ??
    order.broadcastedAt ??
    order.acceptedAt ??
    order.createdAt
  );
};

const resolveRequestId = (request: Request): string => {
  const header = normalizeString(request.header("x-request-id"));
  return header ?? `req_${randomUUID().replaceAll("-", "")}`;
};

const sendSuccess = (
  response: Response,
  requestId: string,
  data: object,
): void => {
  response.status(200).json({
    request_id: requestId,
    code: "OK",
    message: "success",
    data,
  });
};

const sendError = (
  response: Response,
  requestId: string,
  status: number,
  code: ApiCode,
  message: string,
): void => {
  response.status(status).json({
    request_id: requestId,
    code,
    message,
  });
};

const readAuthUser = (response: Response): AuthUser | null => {
  const user = response.locals.user as AuthUser | undefined;
  if (user === undefined || typeof user.uid !== "string") {
    return null;
  }
  return user;
};

const readSocketUser = (socket: Socket): AuthUser | null => {
  const user = socket.data.user as AuthUser | undefined;
  if (user === undefined || typeof user.uid !== "string") {
    return null;
  }
  return user;
};

const emitRoomJoinFailed = (
  socket: Socket,
  code: ApiCode,
  message: string,
): void => {
  socket.emit("room.join_failed", {
    error_code: code,
    message,
  });
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

const normalizeVisibility = (value: unknown): RoomVisibility | null => {
  const normalized = normalizeString(value);
  if (normalized === "PUBLIC" || normalized === "PRIVATE") {
    return normalized;
  }
  return null;
};

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeString(item))
    .filter((item): item is string => item !== null)
    .slice(0, 8);
};

const formatDateForId = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

const resolveStatusByCode = (code: ApiCode): number => {
  switch (code) {
    case "AUTH_001":
      return 401;
    case "ROOM_001":
      return 404;
    case "ROOM_002":
      return 403;
    case "ROOM_003":
      return 409;
    case "GIFT_001":
      return 400;
    case "GIFT_002":
      return 402;
    case "GIFT_003":
      return 409;
    case "GIFT_004":
      return 409;
    case "PAY_001":
      return 400;
    case "PAY_002":
      return 409;
    case "PAY_004":
      return 422;
    case "RISK_001":
      return 429;
    case "RISK_002":
      return 403;
    case "RISK_003":
      return 403;
    case "SYS_001":
      return 500;
    case "OK":
      return 200;
    default:
      return 400;
  }
};
