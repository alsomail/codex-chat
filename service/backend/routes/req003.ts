import { randomUUID } from "node:crypto";
import type { Request, RequestHandler, Response, Router } from "express";
import { Router as createRouter } from "express";
import type { Server, Socket } from "socket.io";

type ApiCode =
  | "OK"
  | "AUTH_001"
  | "ROOM_001"
  | "ROOM_002"
  | "RTC_001"
  | "RTC_002"
  | "RTC_003"
  | "RTC_004"
  | "RTC_005"
  | "SYS_001";

type DegradeLevel = "FULL_8" | "DEGRADED_6" | "DEGRADED_4";
type TransportDirection = "send" | "recv";
type ConsumerStatus = "ACTIVE" | "PAUSED";

interface AuthUser {
  uid: string;
  device_id: string;
  country: string;
  session_id?: string;
}

interface RtcSession {
  roomId: string;
  workerId: string;
  routerId: string;
  status: "ACTIVE";
  createdAt: Date;
  updatedAt: Date;
}

interface RtcTransport {
  transportId: string;
  roomId: string;
  uid: string;
  socketId: string;
  direction: TransportDirection;
  connected: boolean;
  dtlsParameters: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface SeatState {
  roomId: string;
  seatNo: number;
  uid: string;
  producerId: string;
  seatStatus: "OCCUPIED";
  updatedAt: Date;
}

interface RtcProducer {
  producerId: string;
  roomId: string;
  uid: string;
  seatNo: number;
  transportId: string;
  createdAt: Date;
}

interface RtcConsumer {
  consumerId: string;
  roomId: string;
  uid: string;
  producerId: string;
  priority: number;
  status: ConsumerStatus;
  updatedAt: Date;
}

interface RoomDegradeState {
  level: DegradeLevel;
  activeReason: string | null;
  appliedAt: Date | null;
  updatedAt: Date;
  totalEvents: number;
  recoverWithin15s: number;
  recoveredCount: number;
}

interface NetworkSnapshot {
  packetLoss: number;
  jitterP95: number;
  rtt: number;
  stallMs: number;
}

interface RtcMetricSample {
  roomId: string;
  workerId: string;
  uid: string;
  latencyP95: number;
  jitterP95: number;
  lossRatio: number;
  stallMs: number;
  degradeEvents: number;
  recoverRatio15s: number;
  bucketMinute: string;
  collectedAt: Date;
}

interface RtcPlanSnapshot {
  roomId: string;
  workerId: string;
  activeSpeakers: string[];
  subscriptionLimit: number;
  degradeLevel: DegradeLevel;
  updatedAt: Date;
}

interface RtcMetricPoint {
  room_id: string;
  worker_id: string;
  bucket_minute: string;
  latency_p95: number;
  jitter_p95: number;
  loss_ratio: number;
  stall_ms: number;
  degrade_events: number;
  recover_ratio_15s: number;
}

interface SeatUpdatedEvent {
  room_id: string;
  seat_no: number;
  seat_status: "OCCUPIED" | "IDLE";
  uid: string | null;
  producer_id: string | null;
  action: "OCCUPIED" | "RELEASED" | "CONFLICT";
  error_code?: ApiCode;
}

interface RtcError {
  code: ApiCode;
  message: string;
  seatEvent?: SeatUpdatedEvent;
}

interface ServiceOk<T> {
  ok: true;
  value: T;
}

interface ServiceErr {
  ok: false;
  error: RtcError;
}

type ServiceResult<T> = ServiceOk<T> | ServiceErr;

interface RtcCreateTransportPayload {
  room_id?: unknown;
  direction?: unknown;
}

interface RtcConnectTransportPayload {
  transport_id?: unknown;
  dtls_parameters?: unknown;
}

interface RtcProducePayload {
  transport_id?: unknown;
  kind?: unknown;
  app_data?: unknown;
}

interface RtcConsumePayload {
  room_id?: unknown;
  producer_id?: unknown;
  rtp_capabilities?: unknown;
  network?: unknown;
}

interface RtcPauseResumePayload {
  consumer_id?: unknown;
}

export interface Req003RoomAccess {
  hasRoom(roomId: string): boolean;
  isRoomMember(roomId: string, uid: string): boolean;
}

export interface Req003RouterOptions {
  authMiddleware: RequestHandler;
  roomAccess: Req003RoomAccess;
  service: Req003Service;
}

export interface Req003SocketOptions {
  roomAccess: Req003RoomAccess;
  service: Req003Service;
}

interface CreateTransportInput {
  roomId: string;
  uid: string;
  socketId: string;
  direction: TransportDirection;
  now: Date;
}

interface ConnectTransportInput {
  transportId: string;
  uid: string;
  dtlsParameters: Record<string, unknown>;
  now: Date;
}

interface ProduceInput {
  transportId: string;
  uid: string;
  kind: string;
  seatNo: number;
  now: Date;
}

interface ConsumeInput {
  roomId: string;
  uid: string;
  producerId: string;
  rtpCapabilities: Record<string, unknown>;
  network: NetworkSnapshot | null;
  now: Date;
}

export class Req003Service {
  private readonly sessionByRoomId = new Map<string, RtcSession>();
  private readonly transportsById = new Map<string, RtcTransport>();
  private readonly transportIdsBySocketId = new Map<string, Set<string>>();
  private readonly seatMapByRoomId = new Map<string, Map<number, SeatState>>();
  private readonly producerById = new Map<string, RtcProducer>();
  private readonly consumerById = new Map<string, RtcConsumer>();
  private readonly consumerIdsByRoomUid = new Map<string, Set<string>>();
  private readonly degradeStateByRoomId = new Map<string, RoomDegradeState>();
  private readonly metricSamplesByRoomId = new Map<string, RtcMetricSample[]>();

  getTransportRoomId(transportId: string): string | null {
    return this.transportsById.get(transportId)?.roomId ?? null;
  }

  getRtcPlan(roomId: string): RtcPlanSnapshot {
    const session = this.ensureRoomSession(roomId, new Date());
    return this.buildPlan(roomId, session.updatedAt);
  }

  getRtcMetrics(input: {
    roomId: string;
    from: Date;
    to: Date;
  }): RtcMetricPoint[] {
    const samples = this.metricSamplesByRoomId.get(input.roomId) ?? [];
    const filtered = samples.filter((sample) => {
      const time = sample.collectedAt.getTime();
      return time >= input.from.getTime() && time <= input.to.getTime();
    });

    const grouped = new Map<string, RtcMetricPoint>();
    for (const sample of filtered) {
      const key = `${sample.workerId}:${sample.bucketMinute}`;
      const existing = grouped.get(key);
      if (existing === undefined) {
        grouped.set(key, {
          room_id: sample.roomId,
          worker_id: sample.workerId,
          bucket_minute: sample.bucketMinute,
          latency_p95: sample.latencyP95,
          jitter_p95: sample.jitterP95,
          loss_ratio: sample.lossRatio,
          stall_ms: sample.stallMs,
          degrade_events: sample.degradeEvents,
          recover_ratio_15s: sample.recoverRatio15s,
        });
        continue;
      }

      existing.latency_p95 = Math.max(existing.latency_p95, sample.latencyP95);
      existing.jitter_p95 = Math.max(existing.jitter_p95, sample.jitterP95);
      existing.loss_ratio = Math.max(existing.loss_ratio, sample.lossRatio);
      existing.stall_ms = Math.max(existing.stall_ms, sample.stallMs);
      existing.degrade_events += sample.degradeEvents;
      existing.recover_ratio_15s = Number(
        ((existing.recover_ratio_15s + sample.recoverRatio15s) / 2).toFixed(4),
      );
    }

    return Array.from(grouped.values()).sort((left, right) => {
      if (left.bucket_minute === right.bucket_minute) {
        return left.worker_id.localeCompare(right.worker_id);
      }
      return left.bucket_minute.localeCompare(right.bucket_minute);
    });
  }

  createTransport(input: CreateTransportInput): ServiceResult<{
    room_id: string;
    transport_id: string;
    direction: TransportDirection;
    ice_parameters: Record<string, unknown>;
    dtls_parameters: Record<string, unknown>;
  }> {
    const session = this.ensureRoomSession(input.roomId, input.now);
    const transportId = `tr_${randomUUID().replaceAll("-", "")}`;
    const transport: RtcTransport = {
      transportId,
      roomId: input.roomId,
      uid: input.uid,
      socketId: input.socketId,
      direction: input.direction,
      connected: false,
      dtlsParameters: {},
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.transportsById.set(transportId, transport);

    const socketTransports = this.transportIdsBySocketId.get(input.socketId) ?? new Set<string>();
    socketTransports.add(transportId);
    this.transportIdsBySocketId.set(input.socketId, socketTransports);

    this.recordMetric({
      roomId: input.roomId,
      uid: input.uid,
      workerId: session.workerId,
      latencyP95: 180,
      jitterP95: 40,
      lossRatio: 0.01,
      stallMs: 0,
      degradeEvents: 0,
      now: input.now,
    });

    return {
      ok: true,
      value: {
        room_id: input.roomId,
        transport_id: transportId,
        direction: input.direction,
        ice_parameters: {
          usernameFragment: `ice_${transportId.slice(0, 8)}`,
          password: randomUUID().replaceAll("-", "").slice(0, 24),
          iceLite: true,
        },
        dtls_parameters: {
          role: "auto",
          fingerprints: [
            {
              algorithm: "sha-256",
              value: "AA:BB:CC:DD:EE:FF",
            },
          ],
        },
      },
    };
  }

  connectTransport(input: ConnectTransportInput): ServiceResult<{
    room_id: string;
    transport_id: string;
    connected: boolean;
  }> {
    const transport = this.transportsById.get(input.transportId);
    if (transport === undefined) {
      return this.error("RTC_002", "transport does not exist.");
    }
    if (transport.uid !== input.uid) {
      return this.error("RTC_002", "transport ownership mismatch.");
    }

    transport.connected = true;
    transport.dtlsParameters = input.dtlsParameters;
    transport.updatedAt = input.now;
    const session = this.ensureRoomSession(transport.roomId, input.now);
    this.recordMetric({
      roomId: transport.roomId,
      uid: input.uid,
      workerId: session.workerId,
      latencyP95: 170,
      jitterP95: 35,
      lossRatio: 0.01,
      stallMs: 0,
      degradeEvents: 0,
      now: input.now,
    });

    return {
      ok: true,
      value: {
        room_id: transport.roomId,
        transport_id: transport.transportId,
        connected: true,
      },
    };
  }

  produce(input: ProduceInput): ServiceResult<{
    room_id: string;
    producer_event: {
      room_id: string;
      producer_id: string;
      uid: string;
      seat_no: number;
      kind: "audio";
    };
    seat_updates: SeatUpdatedEvent[];
    subscription_plan: {
      room_id: string;
      subscription_limit: number;
      degrade_level: DegradeLevel;
      active_speakers: string[];
      priority_list: string[];
    };
  }> {
    if (input.kind !== "audio") {
      return this.error("RTC_001", "Only audio producer is supported in MVP.");
    }
    if (input.seatNo < 1 || input.seatNo > 8) {
      return this.error("RTC_003", "seat_no must be in range 1..8.");
    }

    const transport = this.transportsById.get(input.transportId);
    if (transport === undefined) {
      return this.error("RTC_002", "transport does not exist.");
    }
    if (!transport.connected) {
      return this.error("RTC_002", "transport is not connected.");
    }
    if (transport.uid !== input.uid) {
      return this.error("RTC_002", "transport ownership mismatch.");
    }

    const roomSeats = this.seatMapByRoomId.get(transport.roomId) ?? new Map<number, SeatState>();
    this.seatMapByRoomId.set(transport.roomId, roomSeats);

    const existed = roomSeats.get(input.seatNo);
    if (existed !== undefined && existed.uid !== input.uid) {
      const conflict: SeatUpdatedEvent = {
        room_id: transport.roomId,
        seat_no: input.seatNo,
        seat_status: "OCCUPIED",
        uid: existed.uid,
        producer_id: existed.producerId,
        action: "CONFLICT",
        error_code: "RTC_003",
      };
      return this.error("RTC_003", "seat is occupied.", conflict);
    }

    const seatUpdates: SeatUpdatedEvent[] = [];
    for (const [seatNo, state] of roomSeats) {
      if (state.uid === input.uid && seatNo !== input.seatNo) {
        roomSeats.delete(seatNo);
        this.producerById.delete(state.producerId);
        seatUpdates.push({
          room_id: transport.roomId,
          seat_no: seatNo,
          seat_status: "IDLE",
          uid: null,
          producer_id: null,
          action: "RELEASED",
        });
      }
    }

    let producerId: string;
    if (existed !== undefined && existed.uid === input.uid) {
      producerId = existed.producerId;
      existed.updatedAt = input.now;
    } else {
      producerId = `pd_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      roomSeats.set(input.seatNo, {
        roomId: transport.roomId,
        seatNo: input.seatNo,
        uid: input.uid,
        producerId,
        seatStatus: "OCCUPIED",
        updatedAt: input.now,
      });
      this.producerById.set(producerId, {
        producerId,
        roomId: transport.roomId,
        uid: input.uid,
        seatNo: input.seatNo,
        transportId: transport.transportId,
        createdAt: input.now,
      });
    }

    seatUpdates.push({
      room_id: transport.roomId,
      seat_no: input.seatNo,
      seat_status: "OCCUPIED",
      uid: input.uid,
      producer_id: producerId,
      action: "OCCUPIED",
    });

    const session = this.ensureRoomSession(transport.roomId, input.now);
    this.recordMetric({
      roomId: transport.roomId,
      uid: input.uid,
      workerId: session.workerId,
      latencyP95: 185,
      jitterP95: 45,
      lossRatio: 0.02,
      stallMs: 10,
      degradeEvents: 0,
      now: input.now,
    });

    const plan = this.buildPlanPayload(transport.roomId);
    return {
      ok: true,
      value: {
        room_id: transport.roomId,
        producer_event: {
          room_id: transport.roomId,
          producer_id: producerId,
          uid: input.uid,
          seat_no: input.seatNo,
          kind: "audio",
        },
        seat_updates: seatUpdates,
        subscription_plan: plan,
      },
    };
  }

  consume(input: ConsumeInput): ServiceResult<{
    room_id: string;
    consumer_created: {
      room_id: string;
      consumer_id: string;
      producer_id: string;
      rtp_parameters: Record<string, unknown>;
    };
    subscription_plan: {
      room_id: string;
      subscription_limit: number;
      degrade_level: DegradeLevel;
      active_speakers: string[];
      priority_list: string[];
    };
    degrade_applied?: {
      room_id: string;
      degrade_level: DegradeLevel;
      reason: string;
      recover_eta_sec: number;
    };
    degrade_recovered?: {
      room_id: string;
      from_level: DegradeLevel;
      to_level: DegradeLevel;
      elapsed_ms: number;
    };
  }> {
    const producer = this.producerById.get(input.producerId);
    if (producer === undefined || producer.roomId !== input.roomId) {
      return this.error("RTC_005", "producer is unavailable.");
    }

    if (Object.keys(input.rtpCapabilities).length === 0) {
      return this.error("RTC_001", "rtp_capabilities is required.");
    }

    const consumerId = `cs_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const roomSeats = this.seatMapByRoomId.get(input.roomId) ?? new Map<number, SeatState>();
    const priority = this.resolvePriority(roomSeats, producer.uid);

    this.consumerById.set(consumerId, {
      consumerId,
      roomId: input.roomId,
      uid: input.uid,
      producerId: input.producerId,
      priority,
      status: "ACTIVE",
      updatedAt: input.now,
    });
    const roomUidKey = `${input.roomId}:${input.uid}`;
    const consumerIds = this.consumerIdsByRoomUid.get(roomUidKey) ?? new Set<string>();
    consumerIds.add(consumerId);
    this.consumerIdsByRoomUid.set(roomUidKey, consumerIds);

    const session = this.ensureRoomSession(input.roomId, input.now);
    let degradeApplied: {
      room_id: string;
      degrade_level: DegradeLevel;
      reason: string;
      recover_eta_sec: number;
    } | undefined;
    let degradeRecovered: {
      room_id: string;
      from_level: DegradeLevel;
      to_level: DegradeLevel;
      elapsed_ms: number;
    } | undefined;

    if (input.network !== null) {
      const changed = this.applyDegrade(input.roomId, input.network, input.now);
      if (changed?.type === "applied") {
        degradeApplied = changed.payload;
      } else if (changed?.type === "recovered") {
        degradeRecovered = changed.payload;
      }
    }

    const degradeState = this.getDegradeState(input.roomId, input.now);
    this.recordMetric({
      roomId: input.roomId,
      uid: input.uid,
      workerId: session.workerId,
      latencyP95: input.network?.rtt ?? 210,
      jitterP95: input.network?.jitterP95 ?? 70,
      lossRatio: input.network?.packetLoss ?? 0.03,
      stallMs: input.network?.stallMs ?? 40,
      degradeEvents: degradeApplied === undefined ? 0 : 1,
      now: input.now,
    });

    const plan = this.buildPlanPayload(input.roomId);
    return {
      ok: true,
      value: {
        room_id: input.roomId,
        consumer_created: {
          room_id: input.roomId,
          consumer_id: consumerId,
          producer_id: input.producerId,
          rtp_parameters: {
            codec: "opus",
            ptime: 20,
            dtx: true,
            fec: true,
          },
        },
        subscription_plan: {
          ...plan,
          degrade_level: degradeState.level,
        },
        degrade_applied: degradeApplied,
        degrade_recovered: degradeRecovered,
      },
    };
  }

  setConsumerPauseState(input: {
    uid: string;
    consumerId: string;
    pause: boolean;
    now: Date;
  }): ServiceResult<{
    room_id: string;
    consumer_id: string;
    status: ConsumerStatus;
    subscription_plan: {
      room_id: string;
      subscription_limit: number;
      degrade_level: DegradeLevel;
      active_speakers: string[];
      priority_list: string[];
    };
  }> {
    const consumer = this.consumerById.get(input.consumerId);
    if (consumer === undefined || consumer.uid !== input.uid) {
      return this.error("RTC_005", "consumer is unavailable.");
    }

    consumer.status = input.pause ? "PAUSED" : "ACTIVE";
    consumer.updatedAt = input.now;
    const plan = this.buildPlanPayload(consumer.roomId);
    return {
      ok: true,
      value: {
        room_id: consumer.roomId,
        consumer_id: consumer.consumerId,
        status: consumer.status,
        subscription_plan: plan,
      },
    };
  }

  handleSocketDisconnected(socketId: string): Array<{
    room_id: string;
    seat_updates: SeatUpdatedEvent[];
    subscription_plan: {
      room_id: string;
      subscription_limit: number;
      degrade_level: DegradeLevel;
      active_speakers: string[];
      priority_list: string[];
    };
  }> {
    const transportIds = this.transportIdsBySocketId.get(socketId);
    if (transportIds === undefined) {
      return [];
    }

    const updatesByRoom = new Map<string, SeatUpdatedEvent[]>();

    for (const transportId of transportIds) {
      const transport = this.transportsById.get(transportId);
      if (transport === undefined) {
        continue;
      }
      this.transportsById.delete(transportId);

      const roomSeats = this.seatMapByRoomId.get(transport.roomId);
      if (roomSeats !== undefined) {
        for (const [seatNo, seat] of roomSeats) {
          if (seat.uid !== transport.uid) {
            continue;
          }
          roomSeats.delete(seatNo);
          this.producerById.delete(seat.producerId);
          const seatUpdates = updatesByRoom.get(transport.roomId) ?? [];
          seatUpdates.push({
            room_id: transport.roomId,
            seat_no: seatNo,
            seat_status: "IDLE",
            uid: null,
            producer_id: null,
            action: "RELEASED",
          });
          updatesByRoom.set(transport.roomId, seatUpdates);
        }
      }

      const roomUidKey = `${transport.roomId}:${transport.uid}`;
      const consumerIds = this.consumerIdsByRoomUid.get(roomUidKey);
      if (consumerIds !== undefined) {
        for (const consumerId of consumerIds) {
          this.consumerById.delete(consumerId);
        }
        this.consumerIdsByRoomUid.delete(roomUidKey);
      }
    }

    this.transportIdsBySocketId.delete(socketId);

    return Array.from(updatesByRoom.entries()).map(([roomId, seatUpdates]) => ({
      room_id: roomId,
      seat_updates: seatUpdates,
      subscription_plan: this.buildPlanPayload(roomId),
    }));
  }

  private ensureRoomSession(roomId: string, now: Date): RtcSession {
    const existed = this.sessionByRoomId.get(roomId);
    if (existed !== undefined) {
      existed.updatedAt = now;
      return existed;
    }

    const session: RtcSession = {
      roomId,
      workerId: `wk_${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      routerId: `rt_${randomUUID().replaceAll("-", "").slice(0, 8)}`,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    };
    this.sessionByRoomId.set(roomId, session);
    return session;
  }

  private getDegradeState(roomId: string, now: Date): RoomDegradeState {
    const existed = this.degradeStateByRoomId.get(roomId);
    if (existed !== undefined) {
      return existed;
    }

    const state: RoomDegradeState = {
      level: "FULL_8",
      activeReason: null,
      appliedAt: null,
      updatedAt: now,
      totalEvents: 0,
      recoverWithin15s: 0,
      recoveredCount: 0,
    };
    this.degradeStateByRoomId.set(roomId, state);
    return state;
  }

  private buildPlan(roomId: string, updatedAt: Date): RtcPlanSnapshot {
    const session = this.ensureRoomSession(roomId, updatedAt);
    const state = this.getDegradeState(roomId, updatedAt);
    const activeSpeakers = this.getActiveSpeakers(roomId);
    return {
      roomId,
      workerId: session.workerId,
      activeSpeakers,
      subscriptionLimit: resolveSubscriptionLimit(state.level),
      degradeLevel: state.level,
      updatedAt,
    };
  }

  private buildPlanPayload(roomId: string): {
    room_id: string;
    subscription_limit: number;
    degrade_level: DegradeLevel;
    active_speakers: string[];
    priority_list: string[];
  } {
    const plan = this.buildPlan(roomId, new Date());
    return {
      room_id: roomId,
      subscription_limit: plan.subscriptionLimit,
      degrade_level: plan.degradeLevel,
      active_speakers: plan.activeSpeakers,
      priority_list: plan.activeSpeakers,
    };
  }

  private resolvePriority(roomSeats: Map<number, SeatState>, speakerUid: string): number {
    const sorted = Array.from(roomSeats.values()).sort((left, right) => left.seatNo - right.seatNo);
    const index = sorted.findIndex((seat) => seat.uid === speakerUid);
    return index >= 0 ? index + 1 : sorted.length + 1;
  }

  private applyDegrade(
    roomId: string,
    network: NetworkSnapshot,
    now: Date,
  ):
    | {
        type: "applied";
        payload: {
          room_id: string;
          degrade_level: DegradeLevel;
          reason: string;
          recover_eta_sec: number;
        };
      }
    | {
        type: "recovered";
        payload: {
          room_id: string;
          from_level: DegradeLevel;
          to_level: DegradeLevel;
          elapsed_ms: number;
        };
      }
    | null {
    const state = this.getDegradeState(roomId, now);

    const degradeNeeded =
      network.packetLoss >= 0.12 ||
      network.jitterP95 >= 180 ||
      network.rtt >= 450 ||
      network.stallMs >= 1500;

    if (degradeNeeded) {
      const severe =
        network.packetLoss >= 0.2 ||
        network.jitterP95 >= 260 ||
        network.rtt >= 650 ||
        network.stallMs >= 2500;
      const target: DegradeLevel = severe ? "DEGRADED_4" : "DEGRADED_6";
      const reason = resolveDegradeReason(network);
      if (state.level !== target) {
        state.level = target;
        state.activeReason = reason;
        state.appliedAt = now;
        state.updatedAt = now;
        state.totalEvents += 1;
        return {
          type: "applied",
          payload: {
            room_id: roomId,
            degrade_level: target,
            reason,
            recover_eta_sec: 15,
          },
        };
      }
      return null;
    }

    const recoverReady =
      network.packetLoss < 0.05 &&
      network.jitterP95 < 80 &&
      network.rtt < 220 &&
      network.stallMs < 500;

    if (state.level !== "FULL_8" && recoverReady) {
      const fromLevel = state.level;
      const elapsedMs = now.getTime() - (state.appliedAt?.getTime() ?? now.getTime());
      state.level = "FULL_8";
      state.activeReason = null;
      state.appliedAt = null;
      state.updatedAt = now;
      state.recoveredCount += 1;
      if (elapsedMs <= 15_000) {
        state.recoverWithin15s += 1;
      }
      return {
        type: "recovered",
        payload: {
          room_id: roomId,
          from_level: fromLevel,
          to_level: "FULL_8",
          elapsed_ms: elapsedMs,
        },
      };
    }

    return null;
  }

  private getActiveSpeakers(roomId: string): string[] {
    const seats = this.seatMapByRoomId.get(roomId);
    if (seats === undefined) {
      return [];
    }

    return Array.from(seats.values())
      .sort((left, right) => left.seatNo - right.seatNo)
      .map((item) => item.uid)
      .slice(0, 8);
  }

  private recordMetric(input: {
    roomId: string;
    uid: string;
    workerId: string;
    latencyP95: number;
    jitterP95: number;
    lossRatio: number;
    stallMs: number;
    degradeEvents: number;
    now: Date;
  }): void {
    const degradeState = this.getDegradeState(input.roomId, input.now);
    const recoverRatio =
      degradeState.recoveredCount === 0
        ? 1
        : degradeState.recoverWithin15s / degradeState.recoveredCount;

    const sample: RtcMetricSample = {
      roomId: input.roomId,
      workerId: input.workerId,
      uid: input.uid,
      latencyP95: input.latencyP95,
      jitterP95: input.jitterP95,
      lossRatio: Number(input.lossRatio.toFixed(4)),
      stallMs: input.stallMs,
      degradeEvents: input.degradeEvents,
      recoverRatio15s: Number(recoverRatio.toFixed(4)),
      bucketMinute: toMinuteBucket(input.now),
      collectedAt: input.now,
    };

    const samples = this.metricSamplesByRoomId.get(input.roomId) ?? [];
    samples.push(sample);
    if (samples.length > 2400) {
      samples.splice(0, samples.length - 2400);
    }
    this.metricSamplesByRoomId.set(input.roomId, samples);
  }

  private error(code: ApiCode, message: string, seatEvent?: SeatUpdatedEvent): ServiceErr {
    return {
      ok: false,
      error: {
        code,
        message,
        seatEvent,
      },
    };
  }
}

export const createReq003Service = (): Req003Service => {
  return new Req003Service();
};

export const createReq003Router = (options: Req003RouterOptions): Router => {
  const router = createRouter();

  router.get("/rooms/:roomId/rtc/plan", options.authMiddleware, (request, response) => {
    const requestId = resolveRequestId(request);
    const user = readAuthUser(response);
    if (user === null) {
      sendError(response, requestId, 401, "AUTH_001", "Unauthorized request.");
      return;
    }

    const roomId = normalizeString(request.params.roomId);
    if (roomId === null || !options.roomAccess.hasRoom(roomId)) {
      sendError(response, requestId, 404, "ROOM_001", "Room does not exist.");
      return;
    }
    if (!options.roomAccess.isRoomMember(roomId, user.uid)) {
      sendError(response, requestId, 403, "ROOM_002", "Current user is not in room.");
      return;
    }

    const plan = options.service.getRtcPlan(roomId);
    sendSuccess(response, requestId, {
      room_id: roomId,
      worker_id: plan.workerId,
      active_speakers: plan.activeSpeakers,
      subscription_limit: plan.subscriptionLimit,
      degrade_level: plan.degradeLevel,
      updated_at: plan.updatedAt.toISOString(),
    });
  });

  router.get("/rooms/:roomId/rtc/metrics", options.authMiddleware, (request, response) => {
    const requestId = resolveRequestId(request);
    const user = readAuthUser(response);
    if (user === null) {
      sendError(response, requestId, 401, "AUTH_001", "Unauthorized request.");
      return;
    }

    const roomId = normalizeString(request.params.roomId);
    if (roomId === null || !options.roomAccess.hasRoom(roomId)) {
      sendError(response, requestId, 404, "ROOM_001", "Room does not exist.");
      return;
    }
    if (!options.roomAccess.isRoomMember(roomId, user.uid)) {
      sendError(response, requestId, 403, "ROOM_002", "Current user is not in room.");
      return;
    }

    const now = new Date();
    const to = parseOptionalDate(request.query.to) ?? now;
    const from = parseOptionalDate(request.query.from) ?? new Date(to.getTime() - 30 * 60 * 1000);
    if (from.getTime() > to.getTime()) {
      sendError(response, requestId, 400, "RTC_001", "from must be earlier than to.");
      return;
    }

    const points = options.service.getRtcMetrics({
      roomId,
      from,
      to,
    });
    sendSuccess(response, requestId, {
      room_id: roomId,
      from: from.toISOString(),
      to: to.toISOString(),
      metrics: points,
    });
  });

  return router;
};

export const registerReq003SocketHandlers = (
  io: Server,
  options: Req003SocketOptions,
): void => {
  io.on("connection", (socket) => {
    socket.on("rtc.create_transport", (payload: unknown) => {
      const user = readSocketUser(socket);
      if (user === null) {
        emitRtcError(socket, "AUTH_001", "Unauthorized socket request.");
        return;
      }

      const request = payload as RtcCreateTransportPayload;
      const roomId = normalizeString(request.room_id);
      const direction = normalizeDirection(request.direction);
      if (roomId === null || direction === null) {
        emitRtcError(socket, "RTC_001", "room_id and direction are required.");
        return;
      }
      if (!options.roomAccess.hasRoom(roomId)) {
        emitRtcError(socket, "ROOM_001", "Room does not exist.");
        return;
      }
      if (!options.roomAccess.isRoomMember(roomId, user.uid)) {
        emitRtcError(socket, "ROOM_002", "Current user is not in room.");
        return;
      }

      const created = options.service.createTransport({
        roomId,
        uid: user.uid,
        socketId: socket.id,
        direction,
        now: new Date(),
      });
      if (!created.ok) {
        emitRtcError(socket, created.error.code, created.error.message);
        return;
      }

      socket.emit("rtc.transport_created", created.value);
    });

    socket.on("rtc.connect_transport", (payload: unknown) => {
      const user = readSocketUser(socket);
      if (user === null) {
        emitRtcError(socket, "AUTH_001", "Unauthorized socket request.");
        return;
      }

      const request = payload as RtcConnectTransportPayload;
      const transportId = normalizeString(request.transport_id);
      const dtlsParameters = normalizeObject(request.dtls_parameters);
      if (transportId === null || dtlsParameters === null) {
        emitRtcError(socket, "RTC_001", "transport_id and dtls_parameters are required.");
        return;
      }

      const connected = options.service.connectTransport({
        transportId,
        uid: user.uid,
        dtlsParameters,
        now: new Date(),
      });
      if (!connected.ok) {
        emitRtcError(socket, connected.error.code, connected.error.message);
        return;
      }

      socket.emit("rtc.transport_connected", connected.value);
    });

    socket.on("rtc.produce", (payload: unknown) => {
      const user = readSocketUser(socket);
      if (user === null) {
        emitRtcError(socket, "AUTH_001", "Unauthorized socket request.");
        return;
      }

      const request = payload as RtcProducePayload;
      const transportId = normalizeString(request.transport_id);
      const kind = normalizeString(request.kind);
      const seatNo = normalizeSeatNo(request.app_data);
      if (transportId === null || kind === null || seatNo === null) {
        emitRtcError(socket, "RTC_001", "transport_id, kind and app_data.seat_no are required.");
        return;
      }

      const roomId = options.service.getTransportRoomId(transportId);
      if (roomId !== null && !options.roomAccess.isRoomMember(roomId, user.uid)) {
        emitRtcError(socket, "ROOM_002", "Current user is not in room.");
        return;
      }

      const produced = options.service.produce({
        transportId,
        uid: user.uid,
        kind,
        seatNo,
        now: new Date(),
      });
      if (!produced.ok) {
        if (produced.error.seatEvent !== undefined) {
          socket.emit("rtc.seat.updated", produced.error.seatEvent);
        }
        emitRtcError(socket, produced.error.code, produced.error.message);
        return;
      }

      for (const seatUpdate of produced.value.seat_updates) {
        io.to(produced.value.room_id).emit("rtc.seat.updated", seatUpdate);
      }
      io.to(produced.value.room_id).emit("rtc.new_producer", produced.value.producer_event);
      io.to(produced.value.room_id).emit("rtc.subscription_plan", produced.value.subscription_plan);
    });

    socket.on("rtc.consume", (payload: unknown) => {
      const user = readSocketUser(socket);
      if (user === null) {
        emitRtcError(socket, "AUTH_001", "Unauthorized socket request.");
        return;
      }

      const request = payload as RtcConsumePayload;
      const roomId = normalizeString(request.room_id);
      const producerId = normalizeString(request.producer_id);
      const rtpCapabilities = normalizeObject(request.rtp_capabilities);
      if (roomId === null || producerId === null || rtpCapabilities === null) {
        emitRtcError(socket, "RTC_001", "room_id, producer_id and rtp_capabilities are required.");
        return;
      }
      if (!options.roomAccess.isRoomMember(roomId, user.uid)) {
        emitRtcError(socket, "ROOM_002", "Current user is not in room.");
        return;
      }

      const consumed = options.service.consume({
        roomId,
        uid: user.uid,
        producerId,
        rtpCapabilities,
        network: normalizeNetworkSnapshot(request.network),
        now: new Date(),
      });
      if (!consumed.ok) {
        emitRtcError(socket, consumed.error.code, consumed.error.message);
        return;
      }

      socket.emit("rtc.consumer_created", consumed.value.consumer_created);
      socket.emit("rtc.subscription_plan", consumed.value.subscription_plan);
      if (consumed.value.degrade_applied !== undefined) {
        socket.emit("rtc.degrade.applied", consumed.value.degrade_applied);
        socket.emit("rtc.subscription_plan", consumed.value.subscription_plan);
      }
      if (consumed.value.degrade_recovered !== undefined) {
        socket.emit("rtc.degrade.recovered", consumed.value.degrade_recovered);
        socket.emit("rtc.subscription_plan", consumed.value.subscription_plan);
      }
    });

    socket.on("rtc.pause_consumer", (payload: unknown) => {
      handleConsumerPauseResume(socket, options.service, payload, true);
    });

    socket.on("rtc.resume_consumer", (payload: unknown) => {
      handleConsumerPauseResume(socket, options.service, payload, false);
    });

    socket.on("disconnect", () => {
      const updates = options.service.handleSocketDisconnected(socket.id);
      for (const roomUpdate of updates) {
        for (const seatUpdate of roomUpdate.seat_updates) {
          io.to(roomUpdate.room_id).emit("rtc.seat.updated", seatUpdate);
        }
        io.to(roomUpdate.room_id).emit("rtc.subscription_plan", roomUpdate.subscription_plan);
      }
    });
  });
};

const handleConsumerPauseResume = (
  socket: Socket,
  service: Req003Service,
  payload: unknown,
  pause: boolean,
): void => {
  const user = readSocketUser(socket);
  if (user === null) {
    emitRtcError(socket, "AUTH_001", "Unauthorized socket request.");
    return;
  }

  const request = payload as RtcPauseResumePayload;
  const consumerId = normalizeString(request.consumer_id);
  if (consumerId === null) {
    emitRtcError(socket, "RTC_001", "consumer_id is required.");
    return;
  }

  const result = service.setConsumerPauseState({
    uid: user.uid,
    consumerId,
    pause,
    now: new Date(),
  });
  if (!result.ok) {
    emitRtcError(socket, result.error.code, result.error.message);
    return;
  }

  socket.emit(pause ? "rtc.consumer_paused" : "rtc.consumer_resumed", {
    room_id: result.value.room_id,
    consumer_id: result.value.consumer_id,
    status: result.value.status,
  });
  socket.emit("rtc.subscription_plan", result.value.subscription_plan);
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

const emitRtcError = (socket: Socket, code: ApiCode, message: string): void => {
  socket.emit("rtc.error", {
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

const normalizeObject = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const normalizeDirection = (value: unknown): TransportDirection | null => {
  const normalized = normalizeString(value);
  if (normalized === "send" || normalized === "recv") {
    return normalized;
  }
  return null;
};

const normalizeSeatNo = (value: unknown): number | null => {
  const appData = normalizeObject(value);
  const seatNo = appData?.seat_no;
  if (typeof seatNo !== "number" || !Number.isInteger(seatNo)) {
    return null;
  }
  return seatNo;
};

const normalizeNetworkSnapshot = (value: unknown): NetworkSnapshot | null => {
  const network = normalizeObject(value);
  if (network === null) {
    return null;
  }

  const packetLoss = normalizeNumber(network.packet_loss);
  const jitterP95 = normalizeNumber(network.jitter_p95);
  const rtt = normalizeNumber(network.rtt);
  const stallMs = normalizeNumber(network.stall_ms);
  if (packetLoss === null || jitterP95 === null || rtt === null || stallMs === null) {
    return null;
  }

  return {
    packetLoss,
    jitterP95,
    rtt,
    stallMs,
  };
};

const normalizeNumber = (value: unknown): number | null => {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value;
};

const parseOptionalDate = (value: unknown): Date | null => {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
};

const resolveSubscriptionLimit = (level: DegradeLevel): number => {
  switch (level) {
    case "FULL_8":
      return 8;
    case "DEGRADED_6":
      return 6;
    case "DEGRADED_4":
      return 4;
    default:
      return 8;
  }
};

const resolveDegradeReason = (network: NetworkSnapshot): string => {
  if (network.packetLoss >= 0.12) {
    return "packet_loss_high";
  }
  if (network.jitterP95 >= 180) {
    return "jitter_high";
  }
  if (network.rtt >= 450) {
    return "rtt_high";
  }
  return "stall_high";
};

const toMinuteBucket = (date: Date): string => {
  const bucket = new Date(date);
  bucket.setUTCSeconds(0, 0);
  return bucket.toISOString();
};
