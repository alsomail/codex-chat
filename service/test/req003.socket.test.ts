import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "socket.io";
import {
  createReq002Service,
} from "../backend/routes/req002";
import {
  createReq003Service,
  registerReq003SocketHandlers,
} from "../backend/routes/req003";

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
  readonly id: string;
  readonly data: { user?: SocketUser };
  readonly emittedEvents: Array<{ event: string; payload: JsonRecord }> = [];
  private readonly handlers = new Map<string, SocketHandler>();

  constructor(
    private readonly io: FakeIo,
    id: string,
    user?: SocketUser,
  ) {
    this.id = id;
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

test("REQ-003 socket rtc flow emits transport/producer/consumer/degrade events", () => {
  const req002Service = createReq002Service();
  const req003Service = createReq003Service();
  const io = new FakeIo();
  registerReq003SocketHandlers(io as unknown as Server, {
    roomAccess: req002Service,
    service: req003Service,
  });

  const now = new Date();
  const room = req002Service.createRoom({
    uid: "u_rtc_owner",
    visibility: "PUBLIC",
    topic: "REQ-003 Socket Room",
    tags: [],
    language: "ar",
    now,
  });

  const socket = new FakeSocket(io, "socket_rtc_01", {
    uid: "u_rtc_owner",
    device_id: "device-r001",
    country: "AE",
  });
  io.connect(socket);
  void socket.join(room.roomId);

  socket.trigger("rtc.create_transport", {
    room_id: room.roomId,
    direction: "send",
  });

  const transportCreated = findEmittedEvent(socket, "rtc.transport_created");
  assert.notEqual(transportCreated, null);
  assert.equal(transportCreated?.room_id, room.roomId);
  const transportId = transportCreated?.transport_id as string;
  assert.equal(typeof transportId, "string");

  socket.trigger("rtc.connect_transport", {
    transport_id: transportId,
    dtls_parameters: { role: "auto" },
  });

  const transportConnected = findEmittedEvent(socket, "rtc.transport_connected");
  assert.notEqual(transportConnected, null);
  assert.equal(transportConnected?.connected, true);

  socket.trigger("rtc.produce", {
    transport_id: transportId,
    kind: "audio",
    app_data: { seat_no: 1 },
  });

  const seatUpdated = socket.emittedEvents.find((item) => item.event === "rtc.seat.updated")?.payload;
  const newProducer = findEmittedEvent(socket, "rtc.new_producer");
  assert.notEqual(seatUpdated, undefined);
  assert.notEqual(newProducer, null);
  const producerId = newProducer?.producer_id as string;
  assert.equal(typeof producerId, "string");

  socket.trigger("rtc.consume", {
    room_id: room.roomId,
    producer_id: producerId,
    rtp_capabilities: { codecs: ["opus"] },
    network: {
      packet_loss: 0.2,
      jitter_p95: 210,
      rtt: 500,
      stall_ms: 1800,
    },
  });

  const consumerCreated = findEmittedEvent(socket, "rtc.consumer_created");
  const degradeApplied = findEmittedEvent(socket, "rtc.degrade.applied");
  const plan = socket.emittedEvents.filter((item) => item.event === "rtc.subscription_plan").at(-1)?.payload;
  assert.notEqual(consumerCreated, null);
  assert.notEqual(degradeApplied, null);
  assert.notEqual(plan, undefined);
  assert.equal(plan?.degrade_level, "DEGRADED_4");

  socket.trigger("rtc.consume", {
    room_id: room.roomId,
    producer_id: producerId,
    rtp_capabilities: { codecs: ["opus"] },
    network: {
      packet_loss: 0.01,
      jitter_p95: 40,
      rtt: 120,
      stall_ms: 50,
    },
  });

  const degradeRecovered = findEmittedEvent(socket, "rtc.degrade.recovered");
  assert.notEqual(degradeRecovered, null);
});

test("REQ-003 seat conflict returns RTC_003 and emits seat conflict event", () => {
  const req002Service = createReq002Service();
  const req003Service = createReq003Service();
  const io = new FakeIo();
  registerReq003SocketHandlers(io as unknown as Server, {
    roomAccess: req002Service,
    service: req003Service,
  });

  const now = new Date();
  const room = req002Service.createRoom({
    uid: "u_owner",
    visibility: "PUBLIC",
    topic: "REQ-003 Conflict Room",
    tags: [],
    language: "ar",
    now,
  });

  const joined = req002Service.issueJoinToken({
    uid: "u_rival",
    roomId: room.roomId,
    deviceId: "device-rival",
    installId: "install-rival",
    now,
  });
  assert.equal(joined.ok, true);
  if (joined.ok) {
    req002Service.joinRoom({
      uid: "u_rival",
      roomId: room.roomId,
      joinToken: joined.token.joinToken,
      now,
    });
  }

  const ownerSocket = new FakeSocket(io, "socket_owner", {
    uid: "u_owner",
    device_id: "device-owner",
    country: "AE",
  });
  const rivalSocket = new FakeSocket(io, "socket_rival", {
    uid: "u_rival",
    device_id: "device-rival",
    country: "AE",
  });
  io.connect(ownerSocket);
  io.connect(rivalSocket);
  void ownerSocket.join(room.roomId);
  void rivalSocket.join(room.roomId);

  ownerSocket.trigger("rtc.create_transport", {
    room_id: room.roomId,
    direction: "send",
  });
  const ownerTransportId = findEmittedEvent(ownerSocket, "rtc.transport_created")?.transport_id;
  ownerSocket.trigger("rtc.connect_transport", {
    transport_id: ownerTransportId,
    dtls_parameters: { role: "auto" },
  });
  ownerSocket.trigger("rtc.produce", {
    transport_id: ownerTransportId,
    kind: "audio",
    app_data: { seat_no: 2 },
  });

  rivalSocket.trigger("rtc.create_transport", {
    room_id: room.roomId,
    direction: "send",
  });
  const rivalTransportId = findEmittedEvent(rivalSocket, "rtc.transport_created")?.transport_id;
  rivalSocket.trigger("rtc.connect_transport", {
    transport_id: rivalTransportId,
    dtls_parameters: { role: "auto" },
  });
  rivalSocket.trigger("rtc.produce", {
    transport_id: rivalTransportId,
    kind: "audio",
    app_data: { seat_no: 2 },
  });

  const conflictSeat = rivalSocket.emittedEvents
    .filter((item) => item.event === "rtc.seat.updated")
    .at(-1)?.payload;
  const error = rivalSocket.emittedEvents
    .filter((item) => item.event === "rtc.error")
    .at(-1)?.payload;
  assert.notEqual(conflictSeat, undefined);
  assert.equal(conflictSeat?.action, "CONFLICT");
  assert.notEqual(error, undefined);
  assert.equal(error?.error_code, "RTC_003");
});

test("REQ-003 session reconnect emits recover hint and subscription plan", () => {
  const req002Service = createReq002Service();
  const req003Service = createReq003Service();
  const io = new FakeIo();
  registerReq003SocketHandlers(io as unknown as Server, {
    roomAccess: req002Service,
    service: req003Service,
  });

  const now = new Date();
  const room = req002Service.createRoom({
    uid: "u_reconnect_owner",
    visibility: "PUBLIC",
    topic: "REQ-003 Reconnect Room",
    tags: [],
    language: "ar",
    now,
  });

  const socket = new FakeSocket(io, "socket_reconnect_01", {
    uid: "u_reconnect_owner",
    device_id: "device-reconnect",
    country: "AE",
  });
  io.connect(socket);
  void socket.join(room.roomId);

  socket.trigger("rtc.create_transport", {
    room_id: room.roomId,
    direction: "send",
  });
  const transportId = findEmittedEvent(socket, "rtc.transport_created")?.transport_id as string;
  socket.trigger("rtc.connect_transport", {
    transport_id: transportId,
    dtls_parameters: { role: "auto" },
  });
  socket.trigger("rtc.produce", {
    transport_id: transportId,
    kind: "audio",
    app_data: { seat_no: 1 },
  });

  const issued = req003Service.issueReconnectToken({
    roomId: room.roomId,
    sessionId: "sess_reconnect_socket",
    uid: "u_reconnect_owner",
    deviceId: "device-reconnect",
    installId: "install-reconnect",
    seatIntent: 1,
    now,
  });
  assert.equal(issued.ok, true);
  if (!issued.ok) {
    return;
  }

  socket.trigger("session.reconnect", {
    room_id: room.roomId,
    session_id: "sess_reconnect_socket",
    reconnect_token: issued.value.reconnect_token,
    last_seq: 0,
  });

  const reconnected = findEmittedEvent(socket, "session.reconnected");
  const recoverHint = findEmittedEvent(socket, "room.recover_hint");
  const plan = socket.emittedEvents.filter((item) => item.event === "rtc.subscription_plan").at(-1)?.payload;
  assert.notEqual(reconnected, null);
  assert.equal(reconnected?.resume_ok, true);
  assert.notEqual(recoverHint, null);
  assert.equal(recoverHint?.session_id, "sess_reconnect_socket");
  assert.notEqual(plan, undefined);
});
