const { io } = require("socket.io-client");

const baseUrl = process.env.REQ003_BASE_URL ?? "http://127.0.0.1:3100";
const demoOtp = process.env.REQ003_DEMO_OTP ?? "123456";
const totalProducers = Number(process.env.REQ003_PRODUCERS ?? "8");
const totalListeners = Number(process.env.REQ003_LISTENERS ?? "92");
const durationSec = Number(process.env.REQ003_DURATION_SEC ?? "300");
const sampleIntervalSec = Number(process.env.REQ003_SAMPLE_INTERVAL_SEC ?? "30");

const totalUsers = totalProducers + totalListeners;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const postJson = async (url, token, payload) => {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
};

const getJson = async (url, token) => {
  const res = await fetch(url, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
};

const login = async (index) => {
  const suffix = String(300000 + index).slice(-6);
  const payload = {
    phone_e164: `+9716${suffix}`,
    otp_code: demoOtp,
    device_id: `load-device-${index}`,
    country: "AE",
    language: "ar",
  };
  const res = await postJson(`${baseUrl}/api/v1/auth/otp/verify`, null, payload);
  if (res.status !== 200) {
    throw new Error(`login failed (${index}): ${res.status}`);
  }
  const token = res.body?.data?.access_token;
  if (typeof token !== "string") {
    throw new Error(`login token missing (${index})`);
  }
  return { token, deviceId: payload.device_id };
};

const connectSocket = async (token, deviceId) => {
  const socket = io(baseUrl, {
    transports: ["websocket"],
    auth: { token, deviceId },
    reconnection: false,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket connect timeout")), 5000);
    socket.on("connect", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on("connect_error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  return socket;
};

const waitForEvent = (socket, event, matcher, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, timeoutMs);
    const handler = (payload) => {
      if (!matcher || matcher(payload)) {
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      }
    };
    socket.on(event, handler);
  });

const summarizeMetrics = (metrics) => {
  const summary = {
    points: metrics.length,
    latency_p95: 0,
    jitter_p95: 0,
    loss_ratio: 0,
    stall_ms: 0,
    degrade_events: 0,
    recover_ratio_15s: 0,
  };
  for (const point of metrics) {
    summary.latency_p95 = Math.max(summary.latency_p95, point.latency_p95 ?? 0);
    summary.jitter_p95 = Math.max(summary.jitter_p95, point.jitter_p95 ?? 0);
    summary.loss_ratio = Math.max(summary.loss_ratio, point.loss_ratio ?? 0);
    summary.stall_ms = Math.max(summary.stall_ms, point.stall_ms ?? 0);
    summary.degrade_events += point.degrade_events ?? 0;
    summary.recover_ratio_15s = Math.max(summary.recover_ratio_15s, point.recover_ratio_15s ?? 0);
  }
  return summary;
};

const fetchMetrics = async (roomId, token, from, to) => {
  const metricsRes = await getJson(
    `${baseUrl}/api/v1/rooms/${roomId}/rtc/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    token,
  );
  if (metricsRes.status !== 200) {
    throw new Error(`metrics failed: ${metricsRes.status}`);
  }
  return metricsRes.body?.data?.metrics ?? [];
};

const main = async () => {
  const startTime = new Date();
  const owner = await login(0);

  const roomRes = await postJson(
    `${baseUrl}/api/v1/rooms`,
    owner.token,
    {
      visibility: "PUBLIC",
      topic: "REQ-003 load room",
      tags: ["load"],
      language: "ar",
    },
  );
  if (roomRes.status !== 200) {
    throw new Error(`create room failed: ${roomRes.status}`);
  }
  const roomId = roomRes.body?.data?.room_id;
  if (typeof roomId !== "string") {
    throw new Error("room_id missing");
  }

  const users = [owner];
  for (let i = 1; i < totalUsers; i += 1) {
    users.push(await login(i));
  }

  const joinTokens = [];
  for (let i = 0; i < users.length; i += 1) {
    const user = users[i];
    const joinRes = await postJson(
      `${baseUrl}/api/v1/rooms/${roomId}/join-token`,
      user.token,
      {
        device_id: user.deviceId,
        install_id: `install-${i}`,
      },
    );
    if (joinRes.status !== 200) {
      throw new Error(`join-token failed (${i}): ${joinRes.status}`);
    }
    const token = joinRes.body?.data?.join_token;
    if (typeof token !== "string") {
      throw new Error(`join_token missing (${i})`);
    }
    joinTokens.push(token);
  }

  const sockets = [];
  for (let i = 0; i < users.length; i += 1) {
    const user = users[i];
    const socket = await connectSocket(user.token, user.deviceId);
    sockets.push(socket);
    socket.emit("room.join", {
      room_id: roomId,
      join_token: joinTokens[i],
    });
    await waitForEvent(socket, "room.joined", (payload) => payload?.room_id === roomId, 5000);
  }

  const producerIds = new Array(totalProducers);
  for (let i = 0; i < totalProducers; i += 1) {
    const socket = sockets[i];
    const seatNo = i + 1;
    socket.emit("rtc.create_transport", {
      room_id: roomId,
      direction: "send",
    });
    const created = await waitForEvent(
      socket,
      "rtc.transport_created",
      (payload) => payload?.room_id === roomId,
      5000,
    );
    socket.emit("rtc.connect_transport", {
      transport_id: created.transport_id,
      dtls_parameters: { role: "auto" },
    });
    await waitForEvent(socket, "rtc.transport_connected", null, 5000);

    socket.emit("rtc.produce", {
      transport_id: created.transport_id,
      kind: "audio",
      app_data: { seat_no: seatNo },
    });
    const newProducer = await waitForEvent(
      socket,
      "rtc.new_producer",
      (payload) => payload?.seat_no === seatNo,
      5000,
    );
    producerIds[i] = newProducer.producer_id;
  }

  const rtp = { codecs: ["opus"] };
  const goodNetwork = {
    packet_loss: 0.02,
    jitter_p95: 45,
    rtt: 180,
    stall_ms: 80,
  };

  const listenerStart = totalProducers;
  for (let i = 0; i < totalListeners; i += 1) {
    const socket = sockets[listenerStart + i];
    const producerId = producerIds[i % producerIds.length];
    socket.emit("rtc.consume", {
      room_id: roomId,
      producer_id: producerId,
      rtp_capabilities: rtp,
      network: goodNetwork,
    });
    await waitForEvent(socket, "rtc.consumer_created", null, 5000);
  }

  const endAt = Date.now() + durationSec * 1000;
  while (Date.now() < endAt) {
    await sleep(sampleIntervalSec * 1000);
    for (let i = 0; i < totalListeners; i += 1) {
      const socket = sockets[listenerStart + i];
      const producerId = producerIds[i % producerIds.length];
      socket.emit("rtc.consume", {
        room_id: roomId,
        producer_id: producerId,
        rtp_capabilities: rtp,
        network: goodNetwork,
      });
    }
  }

  await sleep(1000);
  const loadFrom = new Date(startTime.getTime() - 60 * 1000).toISOString();
  const loadTo = new Date(Date.now() + 60 * 1000).toISOString();
  const loadMetrics = await fetchMetrics(roomId, owner.token, loadFrom, loadTo);
  const loadSummary = summarizeMetrics(loadMetrics);

  const weakSocket = sockets[listenerStart];
  const weakNetwork = {
    packet_loss: 0.2,
    jitter_p95: 220,
    rtt: 500,
    stall_ms: 1800,
  };
  const weakStart = new Date();
  weakSocket.emit("rtc.consume", {
    room_id: roomId,
    producer_id: producerIds[0],
    rtp_capabilities: rtp,
    network: weakNetwork,
  });
  await waitForEvent(weakSocket, "rtc.degrade.applied", null, 5000);

  await sleep(10_000);
  weakSocket.emit("rtc.consume", {
    room_id: roomId,
    producer_id: producerIds[0],
    rtp_capabilities: rtp,
    network: goodNetwork,
  });
  await waitForEvent(weakSocket, "rtc.degrade.recovered", null, 5000);

  await sleep(1000);
  const weakFrom = new Date(weakStart.getTime() - 60 * 1000).toISOString();
  const weakTo = new Date(Date.now() + 60 * 1000).toISOString();
  const weakMetrics = await fetchMetrics(roomId, owner.token, weakFrom, weakTo);
  const weakSummary = summarizeMetrics(weakMetrics);

  console.log(JSON.stringify({ room_id: roomId, load: loadSummary, weak: weakSummary }, null, 2));

  for (const socket of sockets) {
    socket.disconnect();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
