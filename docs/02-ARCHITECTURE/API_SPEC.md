# API_SPEC.md v0.7 - REQ-001~004 MVP接口规范（最终草案）
*更新：2026-03-25 | 状态：🟢review | Tokens: 0/2M*

CHANGELOG
- v0.0 -> v0.1：补齐REQ-001/002接口、Socket事件、错误码、验收与风控口径。
- v0.1 -> v0.2：补齐REQ-003/004（RTC协商、会话恢复）接口契约与验收映射，形成可开发草案。
- v0.2 -> v0.3：补充`REQ-001`认证联调固定口径，冻结规范路径、OTP/Refresh请求响应、legacy路径回归要求与刷新轮转错误码。
- v0.3 -> v0.4：对齐`PRD v0.5`口径，修正遗留`v0.4`引用；补齐REQ-001钱包汇总字段示例（累计消费/近30天消费）并明确向后兼容要求。
- v0.4 -> v0.5：对齐`PRD v0.7`新增Android验收清单（§6.1.1），补齐REQ-001客户端约束、登录后房间预览联调口径与验收映射。
- v0.5 -> v0.6：冻结`REQ-002`接口细节（建房/入房票据/礼物SKU/充值校验/订单追踪）、幂等语义与A-002客户端验收映射。
- v0.6 -> v0.7：基于`PRD v0.8`冻结`REQ-003`接口细节（RTC建链字段约束、弱网降级事件、错误码与A-003/S-003映射）。

## 1. 目标与范围
- 对齐`PRD v0.8`，冻结MVP接口契约：登录/钱包/充值/入房/送礼/音频通话/掉线重连。
- 支持四项需求验收口径：
  - REQ-001：登录成功率 >= 99%
  - REQ-002：礼物链路联调ready
  - REQ-003：100并发端到端语音延迟P95 < 300ms
  - REQ-004：30秒窗口重连恢复成功率 >= 85%
- 协议：REST(JSON over HTTPS) + Socket.io(Event over WebSocket)。

## 2. 通用规范
### 2.1 环境与版本
- Base URL: `/api/v1`
- Socket Namespace: `/room`
- 时间格式：ISO 8601 UTC（示例：`2026-03-24T10:30:00Z`）

### 2.2 鉴权
- `Authorization: Bearer <jwt_access_token>`
- Access Token 默认有效期：2小时
- Refresh Token 默认有效期：30天（服务端可提前失效）
- 认证规范路径仅允许`/api/v1/auth/*`；legacy路径`/api/auth/*`与`/api/v1/auth/login/otp`必须拒绝访问
- 认证响应统一追加`Cache-Control: no-store`
- Android约束：`refresh_token`只允许进入Keystore/EncryptedSharedPreferences，`access_token`仅内存驻留

### 2.3 幂等与追踪
- `POST /payments/googleplay/verify`与`gift.send`必须携带幂等键（16~64）
- 统一返回`request_id`用于日志追踪与审计

### 2.4 响应结构
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {}
}
```

## 3. REST API（MVP）
### 3.1 认证与账户（REQ-001）
#### 认证联调固定口径
- 规范路径：
  - `POST /api/v1/auth/otp/send`
  - `POST /api/v1/auth/otp/verify`
  - `POST /api/v1/auth/refresh`
  - `GET /api/v1/wallet/summary`
  - `GET /api/v1/rooms/demo`（登录成功后的房间预览联调路径）
- legacy路径：
  - `POST /api/auth/otp/send`
  - `POST /api/auth/otp/verify`
  - `POST /api/v1/auth/login/otp`
- legacy路径必须返回`404`或`410`，不得再返回成功体。

#### POST `/auth/otp/send`
- 发送登录OTP验证码
- 请求体：
```json
{
  "phone_e164": "+9665XXXXXXX",
  "device_id": "and_dev_001",
  "install_id": "install_001",
  "channel": "login"
}
```
- 成功返回：
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {
    "otp_ticket": "otpt_123",
    "expire_at": "2026-03-25T10:30:00Z",
    "resend_after_sec": 60
  }
}
```
- 失败关闭：OTP provider异常时返回`503 AUTH_005`，不得回退静态口令。

#### POST `/auth/otp/verify`
- OTP登录并签发JWT，首登自动开钱包并返回`wallet_summary`（余额/冻结/累计消费/近30天消费/风险等级）
- 请求体：
```json
{
  "phone_e164": "+9665XXXXXXX",
  "otp_ticket": "otpt_123",
  "otp_code": "123456",
  "device_id": "and_dev_001",
  "install_id": "install_001"
}
```
- 成功返回：
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {
    "access_token": "jwt_access_xxx",
    "expires_in_sec": 7200,
    "refresh_token": "refresh_xxx",
    "refresh_expires_at": "2026-04-24T10:30:00Z",
    "session_id": "sess_001",
    "is_new_user": true,
    "wallet_summary": {
      "wallet_gold": 0,
      "wallet_bonus_gold": 0,
      "frozen_gold": 0,
      "total_spent_gold": 0,
      "spent_30d_gold": 0,
      "risk_level": "LOW"
    }
  }
}
```
- 服务端约束：`user upsert + wallet bootstrap + risk init + refresh session insert`必须在同一事务中完成，任一步失败则整单回滚且不签发token。
- 客户端兼容约束（过渡期）：服务端可同时返回`snake_case(data)`与历史`camelCase`字段；客户端完成切换后回收历史字段。

#### POST `/auth/refresh`
- 刷新Access Token
- 请求体：
```json
{
  "session_id": "sess_001",
  "refresh_token": "refresh_xxx",
  "device_id": "and_dev_001"
}
```
- 成功返回：
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {
    "access_token": "jwt_access_new",
    "expires_in_sec": 7200,
    "refresh_token": "refresh_new",
    "refresh_expires_at": "2026-04-24T11:00:00Z",
    "session_id": "sess_001",
    "issued_at": "2026-03-25T11:00:00Z"
  }
}
```
- 轮转约束：
  - 服务端只存`refresh_token_hash`，不得落明文refresh token。
  - 刷新成功后旧refresh token立即失效；跨实例传播窗口`<=60s`。
  - 重复使用已轮转token返回`AUTH_004`。
  - 客户端收到`AUTH_004`后必须清理本地token并强制回到登录态，不得静默重试旧token。

#### GET `/wallet/summary`
- 查询钱包余额、冻结、累计消费、近30天消费
- 成功返回字段最少包含：`wallet_gold`、`wallet_bonus_gold`、`frozen_gold`、`total_spent_gold`、`spent_30d_gold`、`risk_level`
- 字段口径说明：
  - `total_spent_gold`与`spent_30d_gold`会与`REQ-002`账务/订单口径对齐；在`REQ-002`未落地前允许返回`0`，但字段必须保留以保证客户端兼容。
- 成功返回示例：
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {
    "wallet_gold": 120,
    "wallet_bonus_gold": 0,
    "frozen_gold": 0,
    "total_spent_gold": 80,
    "spent_30d_gold": 80,
    "risk_level": "LOW"
  }
}
```

#### GET `/rooms/demo`（REQ-001 Android联调辅助）
- 登录成功后的房间预览接口（用于验证“登录 -> 入房准备”最短链路）
- Header：`Authorization: Bearer <jwt_access_token>`
- 成功返回字段：`rooms[].roomId/name/hostName/onlineCount`
- 失败返回：`401 AUTH_001`（token无效或过期）

#### Android客户端约束（REQ-001）
- OTP错误（`AUTH_002`）：留在登录页，允许用户重试或重新获取验证码。
- OTP服务异常（`AUTH_005`）：只能提示“稍后重试”，禁止出现任何回退口令/固定验证码入口。
- Refresh重放（`AUTH_004`）：清理本地会话，强制重登。
- legacy路径（`/api/auth/*`, `/api/v1/auth/login/otp`）返回`404/410`时，客户端必须兜底为统一登录失败提示，禁止崩溃。

### 3.2 支付与账务（REQ-001/002）
#### POST `/payments/googleplay/verify`
- 校验Google Play购买凭证并入账Gold
- Header：`X-Idempotency-Key`必填
- 请求体：
```json
{
  "product_id": "gold_980",
  "purchase_token": "gp_tok_xxx",
  "order_id": "GPA.1234-5678-9012-34567",
  "currency": "USD",
  "amount": "9.99"
}
```
- 成功返回：
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {
    "recharge_order_id": "rch_20260325_0001",
    "credited_gold": 980,
    "wallet_after": {
      "wallet_gold": 1680,
      "wallet_bonus_gold": 0
    },
    "status": "SUCCESS"
  }
}
```
- 幂等规则：同一`uid + X-Idempotency-Key`重复调用，必须返回同一`recharge_order_id`与最终状态。

#### GET `/orders/recharge/{order_id}`
- 查询充值订单状态：`PENDING/SUCCESS/FAILED/REVERSED`
- 成功返回示例：
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {
    "recharge_order_id": "rch_20260325_0001",
    "status": "SUCCESS",
    "credited_gold": 980,
    "reason_code": null,
    "updated_at": "2026-03-25T12:00:00Z"
  }
}
```

#### GET `/orders/gift/{order_id}`
- 查询送礼订单最终态（弱网回补）
- 成功返回示例：
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {
    "gift_order_id": "gft_20260325_0008",
    "status": "FINALIZED",
    "room_id": "r_1001",
    "from_uid": "u_1001",
    "to_uid": "u_9002",
    "gift_sku_id": "g_rose_1",
    "count": 10,
    "amount_gold": 1000,
    "idempotency_key": "gift_20260325_x001",
    "balance_after": 8600,
    "reason_code": null,
    "updated_at": "2026-03-25T12:05:00Z"
  }
}
```
- 状态语义：`PENDING/ACCEPTED/BROADCASTED/FINALIZED/REVERSED`；客户端应以最终态驱动补偿UI。

### 3.3 房间与礼物（REQ-002）
#### POST `/rooms`
- 创建房间（公开/私密、主题、标签）
- 请求体：
```json
{
  "visibility": "PUBLIC",
  "topic": "Night Owl Talk",
  "tags": ["chill", "music"],
  "language": "ar"
}
```
- 成功返回：
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {
    "room_id": "r_1001",
    "owner_uid": "u_1001",
    "visibility": "PUBLIC",
    "status": "OPEN",
    "created_at": "2026-03-25T12:10:00Z"
  }
}
```

#### POST `/rooms/{room_id}/join-token`
- 获取入房Socket临时票据
- 请求体：
```json
{
  "device_id": "and_dev_001",
  "install_id": "install_001"
}
```
- 成功返回：
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {
    "join_token": "jt_xxx",
    "expires_at": "2026-03-25T12:11:00Z",
    "room_id": "r_1001",
    "session_id": "sess_room_001"
  }
}
```
- 约束：`join_token`默认TTL `60s`，一次性消费；重复使用返回`ROOM_003`。

#### GET `/rooms/{room_id}/gifts`
- 拉取礼物SKU（低/中/高价位，支持国家过滤）
- Query：`country=AE&currency=AED`
- 成功返回示例：
```json
{
  "request_id": "req_01HT...",
  "code": "OK",
  "message": "success",
  "data": {
    "room_id": "r_1001",
    "gifts": [
      { "gift_sku_id": "g_rose_1", "tier": "LOW", "price_gold": 10, "name": "Rose" },
      { "gift_sku_id": "g_car_1", "tier": "MID", "price_gold": 300, "name": "Sport Car" },
      { "gift_sku_id": "g_castle_1", "tier": "HIGH", "price_gold": 1200, "name": "Castle" }
    ]
  }
}
```

### 3.4 RTC协商辅助（REQ-003）
#### GET `/rooms/{room_id}/rtc/plan`
- 获取当前房间RTC策略快照（用于客户端调试与测试取证）。
- 成功返回字段：`worker_id`, `active_speakers`, `subscription_limit`, `degrade_level`, `updated_at`。
- 约束：仅房间成员可读取；非成员返回`ROOM_002`。

#### GET `/rooms/{room_id}/rtc/metrics`
- 获取房间分钟级观测聚合（用于压测验收取证，不用于业务渲染）。
- Query：`from=2026-03-25T10:00:00Z&to=2026-03-25T10:10:00Z`
- 成功返回字段最少包含：`latency_p95`, `jitter_p95`, `loss_ratio`, `stall_ms`, `degrade_events`, `recover_ratio_15s`。
- 约束：默认仅返回最近`30分钟`窗口数据。

### 3.5 重连辅助（REQ-004）
#### POST `/rooms/{room_id}/reconnect-token`
- 续签`reconnect_token`（仅房间在线会话可调用）
- 成功返回：`reconnect_token`, `expires_at`, `session_id`

#### POST `/sessions/{session_id}/recover`
- 拉取恢复快照（麦位、订阅、未确认关键事件）
- 用于`session.reconnected.need_resubscribe=true`后的快速补偿

## 4. Socket.io 事件（最终草案）
### 4.1 Client -> Server
- `room.join`
```json
{ "room_id": "r_1001", "join_token": "jt_xxx" }
```
- `room.leave`
```json
{ "room_id": "r_1001" }
```
- `gift.send`
```json
{
  "room_id": "r_1001",
  "gift_sku_id": "g_rose_1",
  "count": 10,
  "to_uid": "u_9002",
  "idempotency_key": "gift_20260324_x001",
  "client_seq": 101
}
```
- 约束：
  - `idempotency_key`必填，长度16~64；
  - `count`范围`1~99`；
  - 同一`uid + room_id + idempotency_key`重复请求返回同一`gift_order_id`。
- `rtc.create_transport`
```json
{ "room_id": "r_1001", "direction": "send" }
```
- `rtc.connect_transport`
```json
{ "transport_id": "tr_abc", "dtls_parameters": {} }
```
- `rtc.produce`
```json
{
  "transport_id": "tr_abc",
  "kind": "audio",
  "rtp_parameters": {},
  "app_data": { "seat_no": 1 }
}
```
- `rtc.consume`
```json
{ "room_id": "r_1001", "producer_id": "pd_001", "rtp_capabilities": {} }
```
- `rtc.pause_consumer` / `rtc.resume_consumer`
- `session.reconnect`
```json
{
  "room_id": "r_1001",
  "session_id": "s_1234",
  "last_seq": 1011,
  "reconnect_token": "recon_xxx"
}
```

### 4.2 Server -> Client
- `room.joined`：入房成功，返回在线人数、麦位、榜单快照
- `gift.accepted`：扣币成功，返回`gift_order_id`与新余额
- `gift.broadcast`：房间礼物动效广播
- `leaderboard.updated`：贡献榜增量更新
- `gift.rejected`：送礼失败，含`error_code`
- `rtc.transport_created`：返回`transport_id/ice/dtls`
- `rtc.new_producer`：新上麦流可订阅通知
- `rtc.consumer_created`：返回`consumer_id/rtp_parameters`
- `rtc.subscription_plan`：返回当前订阅路数、优先级列表、降级等级
- `rtc.degrade.applied`：返回`degrade_level`, `reason`, `recover_eta_sec`
- `rtc.degrade.recovered`：返回`from_level`, `to_level`, `elapsed_ms`
- `rtc.seat.updated`：返回麦位占用变化（占用/释放/冲突失败）
- `session.reconnected`
```json
{
  "resume_ok": true,
  "need_resubscribe": false,
  "need_snapshot_pull": false,
  "missed_events": []
}
```
- `room.recover_hint`：提示客户端拉`/sessions/{id}/recover`补偿

### 4.3 时序约束
1. `gift.send`必须先落订单再广播，不允许“已广播未落单”。
2. `rtc.produce`成功后方可触发`rtc.new_producer`广播。
3. `session.reconnect`优先恢复原会话；超过30秒窗口才降级为`room.join`。
4. `session.reconnected.need_resubscribe=true`时，客户端必须在5秒内重建consumer。
5. `gift.rejected`仅在订单未进入`ACCEPTED`前返回；若已进入`ACCEPTED`但客户端未收到事件，必须通过`GET /orders/gift/{order_id}`补偿。
6. `rtc.degrade.applied`触发后，服务端需在同一会话内同步`rtc.subscription_plan`，客户端据此调整订阅。
7. 麦位释放必须先广播`rtc.seat.updated`再回收`producer`，避免听众侧残留僵尸订阅。

## 5. 错误码（扩展到REQ-004）
| 错误码 | HTTP/事件 | 含义 | 客户端动作 |
|---|---|---|---|
| OK | 200 | 成功 | 正常渲染 |
| AUTH_001 | 401 | token无效或过期 | 刷新token，失败则重登 |
| AUTH_002 | 400 | OTP错误或过期 | 提示重试/重新获取验证码 |
| AUTH_003 | 429 | 登录频率超限 | 冷却后重试 |
| AUTH_004 | 409 | refresh token已轮转或被重放 | 丢弃本地旧token并强制重登 |
| AUTH_005 | 503 | OTP服务不可用（fail-closed） | 提示稍后重试，不允许回退口令 |
| USER_001 | 403 | 账号被限制登录 | 显示封禁提示 |
| ROOM_001 | 404 | 房间不存在 | 返回房间列表 |
| ROOM_002 | 403 | 房间无权限加入 | 请求房主授权 |
| ROOM_003 | 409 | 房间已满/麦位冲突 | 提示稍后重试 |
| GIFT_001 | 400 | 礼物SKU不存在/已下架 | 刷新礼物列表 |
| GIFT_002 | 402 | 余额不足 | 拉起充值 |
| GIFT_003 | 409 | 幂等冲突（重复送礼） | 查询订单最终态 |
| GIFT_004 | 409 | 礼物订单状态不一致 | 拉取`/orders/gift/{id}` |
| PAY_001 | 400 | 凭证格式非法 | 提示重新支付 |
| PAY_002 | 409 | 凭证已使用 | 查询充值订单 |
| PAY_003 | 502 | 支付网关超时 | 客户端轮询订单状态 |
| PAY_004 | 422 | 商品与凭证不匹配 | 阻断并告警 |
| RTC_001 | 422 | RTP能力不兼容 | 重新协商能力 |
| RTC_002 | 404 | transport不存在 | 重建transport |
| RTC_003 | 409 | 麦位冲突/不可用 | 重新申请麦位 |
| RTC_004 | 429 | 触发实时保护降级（弱网/超载） | 按`rtc.subscription_plan`降级 |
| RTC_005 | 410 | producer已失效/麦位已释放 | 拉取最新麦位并重订阅 |
| RECON_001 | 401 | reconnect_token失效 | 降级重新入房 |
| RECON_002 | 404 | session不存在 | 降级重新入房 |
| RECON_003 | 410 | 超过30秒恢复窗口 | 降级重新入房 |
| RECON_004 | 409 | 会话迁移需重订阅 | 拉恢复快照后重订阅 |
| RISK_001 | 429 | 触发分钟级送礼限额 | 冷却后重试 |
| RISK_002 | 403 | 命中设备/账号黑名单 | 阻断并提示申诉 |
| RISK_003 | 403 | 异常IP/设备聚类命中 | 二次校验或阻断 |
| SYS_001 | 500 | 服务器内部错误 | 指数退避重试 |

## 6. 验收映射（REQ-001~004）
### 6.1 REQ-001 登录与钱包
- 登录成功率：>= 99.0%（7日滚动）
- 首登开户成功率：>= 99.9%
- 篡改/过期token拒绝率：= 100%
- 旧refresh token轮转失效传播：<= 60秒
- legacy认证路径命中：灰度后应为0
- Android验收清单映射（PRD §6.1.1）：A-001-01 ~ A-001-07 全部通过

### 6.2 REQ-002 礼物链路
- 送礼请求成功率：>= 99.5%
- `gift.accepted -> gift.broadcast`一致性：100%
- 订单幂等正确率：= 100%
- 日对账差异率：< 0.1%
- Android验收清单映射（PRD §6.2.1）：A-002-01 ~ A-002-08 全部通过

### 6.3 REQ-003 音频通话
- 100并发(8麦)下端到端延迟P95 < 300ms
- 上麦成功率 >= 97%
- 5分钟连续可听率 >= 98%
- 弱网降级后15秒恢复可听比例 >= 95%
- Android验收清单映射（PRD §6.3.1）：A-003-01 ~ A-003-08 全部通过
- Service验收清单映射（PRD §6.3.2）：S-003-01 ~ S-003-08 全部通过

REQ-003关键映射：
- A-003-01/02：`room.joined` + `rtc.transport_created` + `rtc.new_producer`
- A-003-03：`RTC_003` + `rtc.seat.updated`
- A-003-04：`rtc.consumer_created` + `rtc.subscription_plan`
- A-003-05：`rtc.degrade.applied` + `rtc.degrade.recovered`
- A-003-08：`GET /rooms/{room_id}/rtc/metrics`字段完整

### 6.4 REQ-004 掉线重连
- 30秒窗口重连成功率 >= 85%
- 重连恢复时长：平均 <= 8秒，P95 <= 15秒
- 重连后关键状态一致性（麦位/榜单/礼物订单）>= 99.9%

### 6.5 埋点事件
- `auth_login_success_total`
- `gift_send_success_total`
- `rtc_join_mic_success_total`
- `reconnect_attempt_total`
- `reconnect_success_total`
- `reconnect_window_expired_total`

## 7. 测试覆盖评审（test_writer视角）
当前仓库仍未发现自动化测试文件，状态为“待补齐”。建议最小覆盖：

| 模块 | 最小用例数 | 关键边界 |
|---|---:|---|
| Auth | 12 | OTP过期、重复验证码、异地设备 |
| Wallet/Payment | 14 | 重复回调、幂等重放、网关超时 |
| Room/Gift | 16 | 并发送礼、广播顺序、余额不足 |
| RTC | 20 | transport失效、麦位冲突、弱网降级 |
| Reconnect | 18 | 30秒窗内恢复、超窗降级、事件补偿 |
| Risk | 10 | 限频、黑名单、误杀回归 |
| **合计** | **90** | 目标覆盖率 >= 80% |

## 8. 风控风险评估（更新）
| 风险 | 概率 | 影响 | 等级 | 缓解措施 |
|---|---|---|---|---|
| 高频刷礼导致资损 | 中 | 高 | P1 | 分钟级限额 + 幂等键 + 设备聚类 |
| 支付回调重放 | 中 | 高 | P1 | 回调签名 + 去重表 + 状态机 |
| 弱网重连频繁失败 | 中 | 高 | P1 | 30秒恢复窗口 + 快照补偿 + 降级重入房 |
| 重连后状态错乱（榜单/麦位） | 中 | 中 | P2 | `last_seq`回放 + 一致性校验任务 |
| 风控误杀正常用户 | 中 | 中 | P2 | 阈值分层 + 灰度策略 + 申诉通道 |

## 9. REQ-003/004实施排期（建议）
- D6（2026-03-29）：完成`rtc.*`服务端基础流程与麦位冲突处理
- D7（2026-03-30）：完成客户端弱网降级与活跃说话人优先订阅
- D8（2026-03-31）：完成`session.reconnect`与`/sessions/{id}/recover`
- D9（2026-04-01）：回归测试（断网、切后台、跨网切换）
- D10（2026-04-02）：100并发压测 + 重连验收报告
