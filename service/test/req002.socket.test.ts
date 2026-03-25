import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "socket.io";
import {
  createReq002Service,
  registerReq002SocketHandlers,
} from "../backend/routes/req002";

type JsonRecord = Record<string, unknown>;

interface SocketUser {
  uid: string;
  device_id: string;
  country: string;
  session_id?: string;
}

type SocketHandler = (payload: unknown) => void;
type ConnectionHandler = (socket: unknown) => void;

class FakeSocket {
  readonly data: { user?: SocketUser };
  readonly emittedEvents: Array<{ event: string; payload: JsonRecord }> = [];
  private readonly handlers = new Map<string, SocketHandler>();

  constructor(
    private readonly io: FakeIo,
    user?: SocketUser,
  ) {
    this.data = user === undefined ? {} : { user };
  }

  on(event: string, handler: (...args: unknown[]) => void): this {
    this.handlers.set(event, (payload) => {
      handler(payload);
    });
    return this;
  }

  emit(event: string, payload?: unknown): boolean {
    this.emittedEvents.push({
      event,
      payload: toJsonRecord(payload),
    });
    return true;
  }

  join(roomId: string): Promise<void> {
    this.io.addToRoom(roomId, this);
    return Promise.resolve();
  }

  leave(roomId: string): Promise<void> {
    this.io.removeFromRoom(roomId, this);
    return Promise.resolve();
  }

  trigger(event: string, payload: unknown): void {
    const handler = this.handlers.get(event);
    if (handler === undefined) {
      throw new Error(`missing socket handler for event ${event}`);
    }
    handler(payload);
  }
}

class FakeIo {
  readonly rooms = new Map<string, Set<FakeSocket>>();
  readonly sockets = {
    adapter: {
      rooms: this.rooms,
    },
  };

  private connectionHandler: ConnectionHandler | null = null;

  on(event: string, handler: ConnectionHandler): this {
    if (event === "connection") {
      this.connectionHandler = handler;
    }
    return this;
  }

  to(roomId: string): { emit: (event: string, payload: unknown) => void } {
    return {
      emit: (event: string, payload: unknown) => {
        const members = this.rooms.get(roomId);
        if (members === undefined) {
          return;
        }
        for (const member of members) {
          member.emit(event, payload);
        }
      },
    };
  }

  connect(socket: FakeSocket): void {
    if (this.connectionHandler === null) {
      throw new Error("connection handler is not registered");
    }
    this.connectionHandler(socket);
  }

  addToRoom(roomId: string, socket: FakeSocket): void {
    const members = this.rooms.get(roomId) ?? new Set<FakeSocket>();
    members.add(socket);
    this.rooms.set(roomId, members);
  }

  removeFromRoom(roomId: string, socket: FakeSocket): void {
    const members = this.rooms.get(roomId);
    if (members === undefined) {
      return;
    }
    members.delete(socket);
    if (members.size === 0) {
      this.rooms.delete(roomId);
    }
  }
}

const toJsonRecord = (payload: unknown): JsonRecord => {
  if (payload !== null && typeof payload === "object") {
    return payload as JsonRecord;
  }
  return {};
};

const findEmittedEvent = (
  socket: FakeSocket,
  event: string,
): JsonRecord | null => {
  const matched = socket.emittedEvents.find((item) => item.event === event);
  return matched?.payload ?? null;
};

test("REQ-002 socket room.join returns room.joined payload", () => {
  const service = createReq002Service();
  const io = new FakeIo();
  registerReq002SocketHandlers(io as unknown as Server, service);

  const socket = new FakeSocket(io, {
    uid: "u_socket_joiner",
    device_id: "device-socket-1",
    country: "AE",
  });
  io.connect(socket);

  const now = new Date();
  const room = service.createRoom({
    uid: "u_socket_joiner",
    visibility: "PUBLIC",
    topic: "Socket Join Room",
    tags: [],
    language: "ar",
    now,
  });
  const issued = service.issueJoinToken({
    uid: "u_socket_joiner",
    roomId: room.roomId,
    deviceId: "device-socket-1",
    installId: "install-socket-1",
    now,
  });
  assert.equal(issued.ok, true);
  if (!issued.ok) {
    return;
  }

  socket.trigger("room.join", {
    room_id: room.roomId,
    join_token: issued.token.joinToken,
  });

  const payload = findEmittedEvent(socket, "room.joined");
  assert.notEqual(payload, null);
  assert.equal(payload?.room_id, room.roomId);
  assert.equal(payload?.session_id, issued.token.sessionId);
  assert.equal(payload?.online_count, 1);
});

test("REQ-002 socket gift.send emits accepted then broadcast then leaderboard", () => {
  const service = createReq002Service();
  const io = new FakeIo();
  registerReq002SocketHandlers(io as unknown as Server, service);

  const socket = new FakeSocket(io, {
    uid: "u_socket_gifter",
    device_id: "device-socket-2",
    country: "AE",
  });
  io.connect(socket);

  const now = new Date();
  const room = service.createRoom({
    uid: "u_socket_gifter",
    visibility: "PUBLIC",
    topic: "Socket Gift Room",
    tags: [],
    language: "ar",
    now,
  });
  const issued = service.issueJoinToken({
    uid: "u_socket_gifter",
    roomId: room.roomId,
    deviceId: "device-socket-2",
    installId: "install-socket-2",
    now,
  });
  assert.equal(issued.ok, true);
  if (!issued.ok) {
    return;
  }

  socket.trigger("room.join", {
    room_id: room.roomId,
    join_token: issued.token.joinToken,
  });

  socket.trigger("gift.send", {
    room_id: room.roomId,
    gift_sku_id: "g_rose_1",
    count: 2,
    to_uid: "u_receiver",
    idempotency_key: "gift_20260325_socket_seq_000001",
  });

  const acceptedIndex = socket.emittedEvents.findIndex(
    (item) => item.event === "gift.accepted",
  );
  const broadcastIndex = socket.emittedEvents.findIndex(
    (item) => item.event === "gift.broadcast",
  );
  const leaderboardIndex = socket.emittedEvents.findIndex(
    (item) => item.event === "leaderboard.updated",
  );
  assert.equal(acceptedIndex >= 0, true);
  assert.equal(broadcastIndex > acceptedIndex, true);
  assert.equal(leaderboardIndex > broadcastIndex, true);

  const acceptedPayload = socket.emittedEvents[acceptedIndex]?.payload;
  const broadcastPayload = socket.emittedEvents[broadcastIndex]?.payload;
  const leaderboardPayload = socket.emittedEvents[leaderboardIndex]?.payload;
  assert.equal(acceptedPayload?.room_id, room.roomId);
  assert.equal(typeof acceptedPayload?.gift_order_id, "string");
  assert.equal(broadcastPayload?.gift_sku_id, "g_rose_1");
  assert.equal(broadcastPayload?.count, 2);
  assert.equal(leaderboardPayload?.room_id, room.roomId);
  assert.equal(Array.isArray(leaderboardPayload?.leaderboard), true);
});

test("REQ-002 socket duplicate idempotency returns GIFT_003 with same order id", () => {
  const service = createReq002Service();
  const io = new FakeIo();
  registerReq002SocketHandlers(io as unknown as Server, service);

  const socket = new FakeSocket(io, {
    uid: "u_socket_idem",
    device_id: "device-socket-3",
    country: "AE",
  });
  io.connect(socket);

  const now = new Date();
  const room = service.createRoom({
    uid: "u_socket_idem",
    visibility: "PUBLIC",
    topic: "Socket Idempotency Room",
    tags: [],
    language: "ar",
    now,
  });
  const issued = service.issueJoinToken({
    uid: "u_socket_idem",
    roomId: room.roomId,
    deviceId: "device-socket-3",
    installId: "install-socket-3",
    now,
  });
  assert.equal(issued.ok, true);
  if (!issued.ok) {
    return;
  }

  socket.trigger("room.join", {
    room_id: room.roomId,
    join_token: issued.token.joinToken,
  });

  const idempotencyKey = "gift_20260325_socket_idem_000001";
  socket.trigger("gift.send", {
    room_id: room.roomId,
    gift_sku_id: "g_rose_1",
    count: 1,
    to_uid: "u_receiver",
    idempotency_key: idempotencyKey,
  });
  socket.trigger("gift.send", {
    room_id: room.roomId,
    gift_sku_id: "g_rose_1",
    count: 1,
    to_uid: "u_receiver",
    idempotency_key: idempotencyKey,
  });

  const acceptedPayload = findEmittedEvent(socket, "gift.accepted");
  const rejectedPayload = socket.emittedEvents
    .filter((item) => item.event === "gift.rejected")
    .at(-1)?.payload;
  assert.notEqual(acceptedPayload, null);
  assert.notEqual(rejectedPayload, undefined);
  assert.equal(rejectedPayload?.error_code, "GIFT_003");
  assert.equal(rejectedPayload?.gift_order_id, acceptedPayload?.gift_order_id);
});

test("REQ-002 socket protocol rejects unauthorized and malformed requests", () => {
  const service = createReq002Service();
  const io = new FakeIo();
  registerReq002SocketHandlers(io as unknown as Server, service);

  const unauthorizedSocket = new FakeSocket(io);
  io.connect(unauthorizedSocket);
  unauthorizedSocket.trigger("room.join", {
    room_id: "room_x",
    join_token: "jt_invalid",
  });
  const unauthorizedJoin = findEmittedEvent(unauthorizedSocket, "room.join_failed");
  assert.notEqual(unauthorizedJoin, null);
  assert.equal(unauthorizedJoin?.error_code, "AUTH_001");

  const malformedSocket = new FakeSocket(io, {
    uid: "u_socket_malformed",
    device_id: "device-socket-4",
    country: "AE",
  });
  io.connect(malformedSocket);
  malformedSocket.trigger("gift.send", {
    room_id: "room_x",
    gift_sku_id: "g_rose_1",
    count: 1,
    // missing to_uid and idempotency_key on purpose
  });
  const malformedGift = findEmittedEvent(malformedSocket, "gift.rejected");
  assert.notEqual(malformedGift, null);
  assert.equal(malformedGift?.error_code, "GIFT_001");
});
