# TEST_STRATEGY.md v1.0 - REQ-001~004 MVP测试策略
*更新：2026-03-25 | 状态：🟢review | Owner：@test_writer*

## CHANGELOG
- v0.0 -> v0.1：初始化测试策略，覆盖REQ-001~004，重点新增REQ-003/004弱网与重连用例矩阵。
- v0.1 -> v0.2：补充`REQ-001`测试执行批次与验收结论；对齐`PRD v0.5`与`API_SPEC v0.4`版本口径。
- v0.2 -> v0.3：新增`REQ-001/REQ-002 Android客户端验收清单映射`，明确客户端验收证据与执行批次。
- v0.3 -> v0.4：完成`REQ-001` Android回归与`REQ-002`服务端/Socket/Android协议测试，补充测试批次与验收结论并推动流转。
- v0.4 -> v0.5：对齐`PRD v0.8`新增`REQ-003` Android/Service验收清单，补充测试映射与执行批次要求。
- v0.5 -> v0.6：启动`REQ-003`测试批次，补充边界/异常用例与执行范围说明。
- v0.6 -> v0.7：补齐`REQ-003` Android端RTC边界用例，完成Service/Android单测与联调记录。
- v0.7 -> v0.8：固化`REQ-003`压测脚本，完成Service+Socket真实环境100并发/弱网演练与Android联调回归。
- v0.8 -> v0.9：记录`REQ-003`阶段性验收结论（暂定验收）。
- v0.9 -> v1.0：新增`REQ-004`最小闭环验收批次，补充窗口内恢复/超窗重入房/恢复补偿结论与限制项。

## 1. 目标
- 支撑PRD v0.8与API_SPEC v0.6验收。
- 自动化覆盖率目标：>=80%（后端服务与关键业务逻辑）。
- 重点保障：
  - 资金链路正确性（充值/送礼/订单）
  - 语音实时性（100并发、8麦）
  - 重连恢复可用性（30秒窗口）

## 2. 测试分层
| 层级 | 范围 | 目标 |
|---|---|---|
| Unit | 业务函数、状态机、错误码映射 | 快速发现逻辑回归 |
| API Integration | REST + Socket契约 | 保证字段、时序、幂等一致 |
| E2E | Android + Node + DB + Redis | 验证真实用户路径 |
| Performance | 100并发房间、8麦位 | 验证P95延迟与稳定性 |
| Chaos/Network | 丢包、抖动、断网、切网 | 验证降级与重连恢复 |

## 3. 用例矩阵（最小90条）
| 模块 | 用例数 | 关键边界 |
|---|---:|---|
| REQ-001 Auth/Wallet | 12 | OTP过期、频控、首登开户原子性 |
| REQ-002 Gift/Order | 16 | 幂等重放、余额不足、广播顺序 |
| Payment | 14 | 回调重放、网关超时、对账一致性 |
| REQ-003 RTC | 20 | transport失效、麦位冲突、弱网降级 |
| REQ-004 Reconnect | 18 | 30秒窗口、超窗降级、跨网切换 |
| Risk | 10 | 黑名单、误杀回归、限频阈值 |
| **合计** | **90** | **覆盖率>=80%** |

## 4. REQ-003重点场景
| Case ID | 场景 | 预期结果 |
|---|---|---|
| R3-01 | 8人并发上麦 | 上麦成功率>=97% |
| R3-02 | 100并发听众订阅 | 端到端延迟P95 < 300ms |
| R3-03 | 20%丢包 + 200ms抖动 | 15秒内恢复可听比例>=95% |
| R3-04 | 麦位抢占冲突 | 返回`RTC_003`，无双占位 |
| R3-05 | Producer异常断开 | 听众侧快速感知并重订阅 |

## 5. REQ-004重点场景
| Case ID | 场景 | 预期结果 |
|---|---|---|
| R4-01 | 断网5秒恢复 | 平均恢复<=8秒 |
| R4-02 | 断网25秒恢复 | 30秒窗内成功恢复 |
| R4-03 | 断网35秒恢复 | 返回`RECON_003`并自动重入房 |
| R4-04 | 后台30秒再前台 | 会话恢复且状态一致 |
| R4-05 | Wi-Fi与4G切换 | 不出现幽灵会话，重连成功 |
| R4-06 | 重连后事件补偿 | 麦位/榜单/礼物状态一致性>=99.9% |

## 6. 自动化执行节奏
- 每次提交：Unit + API Integration（必须）。
- 每日夜跑：E2E + Network场景回归。
- 里程碑前：100并发压测 + 重连专项回归。
- 发布前门禁：
  - P1用例全部通过
  - P2失败率<2%
  - 无未关闭资金一致性缺陷

## 7. 缺陷分级与处理SLA
| 等级 | 定义 | 修复SLA |
|---|---|---|
| P0 | 资金损失/安全漏洞/服务不可用 | 4小时内止血，24小时内修复 |
| P1 | 关键链路失败（登录/送礼/重连） | 24小时内修复 |
| P2 | 功能可用但体验明显受损 | 72小时内修复 |
| P3 | 低风险体验问题 | 版本窗口内排期 |

## 8. 结果输出模板
- 测试批次：日期 + commit id + 环境
- 通过率：总通过/失败/阻塞
- 指标：登录成功率、送礼成功率、音频P95、重连成功率
- Top风险：最多3条（含责任人与修复ETA）
- 结论：`PASS / CONDITIONAL PASS / FAIL`

## 9. REQ-001 回归执行记录（2026-03-25）
### 9.1 执行环境与命令
- Service路径：`service/`（Node `v18.20.8`）
  - `./node_modules/.bin/tsc -p tsconfig.json`
  - `node --test dist/test/*.test.js`
- Android路径：`android/`（JDK 17）
  - `JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew testDebugUnitTest --no-daemon`

### 9.2 覆盖结果（REQ-001）
| 模块 | 结果 | 备注 |
|---|---|---|
| OTP发送/校验主链路 | PASS | 覆盖`/api/v1/auth/otp/send`、`/api/v1/auth/otp/verify` |
| fail-closed策略 | PASS | OTP provider未配置返回`503 AUTH_005` |
| Refresh轮转与重放 | PASS | 旧refresh token复用返回`409 AUTH_004`；Android ViewModel补充轮转成功/冲突用例 |
| legacy路径拒绝 | PASS | `/api/v1/auth/login/otp`与`/api/auth/*`返回`410` |
| 钱包汇总字段 | PASS | `/api/v1/wallet/summary`字段齐全；Android回归验证刷新后钱包重拉 |
| 基础鉴权回归 | PASS | 无token访问受保护资源返回`401` |

### 9.3 汇总结论
- 自动化结果：Service `20 passed / 0 failed`（含REQ-001与REQ-002），Android `18 passed / 0 failed`。
- P0/P1阻塞：无。
- 验收结论：`PASS`，`REQ-001`可流转`🟩已验收`并通知`@documentor`收尾。

## 10. REQ-002 测试执行记录（2026-03-25）
### 10.1 新增测试与协议验证
| 类型 | 文件 | 目标 |
|---|---|---|
| Service Socket协议测试 | `service/test/req002.socket.test.ts` | 验证`room.join`返回`room.joined`、`gift.accepted -> gift.broadcast -> leaderboard.updated`时序、幂等冲突与错误码 |
| Service业务测试 | `service/test/req002.test.ts` | 覆盖建房/入房票据/SKU/支付幂等/订单追踪/风控 |
| Android ViewModel Mock测试 | `android/test/app/login/LoginViewModelTest.kt` | 覆盖入房票据透传、送礼事件时序、GIFT_002回退充值、refresh轮转后会话与钱包一致性 |

### 10.2 结果结论（REQ-002）
- `A-002-01 ~ A-002-08`对应关键链路均通过自动化回归。
- 协议时序验证通过：`gift.accepted -> gift.broadcast -> leaderboard.updated`。
- 幂等与风控验证通过：`GIFT_003`返回同`gift_order_id`，`RISK_001/002/003`行为符合预期。
- 验收结论：`PASS`，`REQ-002`可流转`🟩已验收`并通知`@documentor`收尾。

## 11. 验收清单映射（REQ-001~REQ-003）
### 11.1 REQ-001
- 来源：`docs/01-PRODUCT/PRD.md` §6.1.1
- 必验项：A-001-01 ~ A-001-07（登录、fail-closed、token存储、refresh轮转、wallet、legacy路径）
- 通过门槛：
  - 功能通过率`=100%`
  - 安全相关项（A-001-03/04/05/07）必须全绿，任一失败按P0处理
  - 验收证据必须包含“脱敏接口日志 + UI录屏/截图”

### 11.2 REQ-002
- 来源：`docs/01-PRODUCT/PRD.md` §6.2.1
- 必验项：A-002-01 ~ A-002-08（建房入房、SKU、送礼闭环、幂等、追单、风控）
- 通过门槛：
  - 关键链路（A-002-02/04/05/06）通过率`=100%`
  - 事件时序必须满足：`gift.accepted -> gift.broadcast -> leaderboard.updated`
  - 余额与订单最终态一致性`=100%`

### 11.3 REQ-003
- 来源：`docs/01-PRODUCT/PRD.md` §6.3.1、§6.3.2
- Android必验项：A-003-01 ~ A-003-08（RTC建链、上麦、抢麦冲突、订阅稳定、弱网恢复、前后台回归、埋点完整性）
- Service必验项：S-003-01 ~ S-003-08（RTC契约、冲突原子性、订阅策略、弱网降级、指标、压测、成功率、故障恢复）
- 通过门槛：
  - `100并发（8麦+92听众）`语音延迟`P95 < 300ms`
  - 上麦成功率`>=97%`，5分钟连续可听率`>=98%`
  - 弱网降级触发后`15秒`内恢复可听比例`>=95%`

### 11.4 执行批次要求
- 设计冻结后：先跑Android接口冒烟（A-001-01/06、A-002-02/03）
- 开发联调期：每日回归A-002关键链路（A-002-04/05/06/07）
- RTC联调期：每日回归A-003关键链路（A-003-02/03/05）+ Service契约（S-003-01/02/04）
- 压测窗口（M2）：执行S-003-06并输出可追溯压测报告与归因结论
- 发布前：A-001 + A-002 + A-003全清单回归，证据归档到测试报告

## 12. REQ-003 测试启动批次（2026-03-25）
### 12.1 执行范围
- Service自动化：`service/test/req003.test.ts`补充边界/异常用例（metrics时间窗校验、seat范围、rtp_capabilities为空）。
- Socket协议回归：`service/test/req003.socket.test.ts`覆盖`rtc.create/connect/produce/consume`与降级事件链路。
- Android单测：`android/test/app/login/LoginViewModelTest.kt`补充RTC冲突/非法seat/plan+metrics加载用例。

### 12.2 通过情况
- Service：`npm test`通过（27/27）。
- Android：`./gradlew testDebugUnitTest`通过（BUILD SUCCESSFUL）。
- Android联调：`Req003IntegrationTest`通过（`REQ003_INTEGRATION=1`，使用`SocketIoRealtimeRoomGateway + NetworkRoomRepository`对接本地服务端）。
- 联调结论：双端契约对齐（plan/metrics字段、rtc事件链路），未发现契约不一致。

### 12.3 真实环境（Service+Socket）100并发/弱网结果（REQ-003）
- 环境：本地启动`chatroom-service`（`PORT=3100`），Socket.io 客户端模拟`8麦+92听众`，通过`/rtc/metrics`采样聚合。
- 执行脚本：`service/tools/req003_load.js`（默认5分钟，30秒采样；可通过`REQ003_DURATION_SEC/REQ003_SAMPLE_INTERVAL_SEC`调整）。
- 100并发（良好网络）：
  - `points=6`，`latency_p95=185ms`，`jitter_p95=45ms`，`loss_ratio=0.02`，`stall_ms=80`
  - `degrade_events=0`，`recover_ratio_15s=1.0`
  - 结论：满足`P95 < 300ms`阈值（服务端指标口径）
- 弱网（20%丢包+200ms抖动，10秒内恢复）：
  - `points=2`，`latency_p95=500ms`，`jitter_p95=220ms`，`loss_ratio=0.2`，`stall_ms=1800`
  - `degrade_events=1`，`recover_ratio_15s=1.0`
  - 结论：降级触发与15秒内恢复指标满足（服务端指标口径）
- 限制：未覆盖真实RTC媒体链路与SFU压测，仅验证Service侧事件链路与指标聚合。

### 12.4 未完成项与下一步
- 压测：执行S-003-06（真实RTC媒体链路，100并发5分钟）并输出可追溯报告。
- 弱网专项：S-003-04/A-003-05（真实弱网注入）降级与恢复数据取证。
- 指标验收：S-003-05指标聚合校验与`/rtc/metrics`样本留档。
- 端到端联调：如需真机/模拟器回归，再补充Android仪器化联调证据。

### 12.5 当前结论（REQ-003）
- 结论：`CONDITIONAL PASS（暂定验收）`，允许进入下一阶段流转。
- 仍需补齐：真实RTC媒体链路压测、弱网注入取证与指标留档。

## 13. REQ-004 最小闭环验收批次（2026-03-25）
### 13.1 执行范围
- Service自动化：执行`service/test/req003.test.ts`中的`REQ-004 reconnect resumes inside window and returns recover snapshot`、`REQ-004 reconnect rejects expired window and unrecoverable seat`，以及`service/test/req003.socket.test.ts`中的`REQ-003 session reconnect emits recover hint and subscription plan`，覆盖窗口内恢复、超窗降级、麦位不可恢复、恢复补偿提示。
- Android自动化：执行`android`模块`testDebugUnitTest`，覆盖`LoginViewModelTest`与`Req003IntegrationTest`中新增的 reconnect 状态机、`session.reconnect/session.reconnected/room.recover_hint` 接口适配与自动重入房流程。
- 验收范围严格限定为`单Worker / 单房间 / Android真机 + service测试环境`中的“最小可执行闭环”；本批次未扩张到跨 Worker 自动恢复、真实媒体链路100并发重连压测或真机切网录屏取证。

### 13.2 执行命令与结果
- Service构建：`cd service && npm run build` -> `PASS`
- Service定向测试：`cd service && /Applications/ServBay/bin/node --test --test-name-pattern "REQ-004|session reconnect" dist/test/req003.test.js dist/test/req003.socket.test.js` -> `PASS`
- Android单测：`cd android && JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew testDebugUnitTest --no-daemon` -> `PASS`

### 13.3 通过情况（REQ-004）
- P-004-01/P-004-02 对应自动化验证通过：窗口内恢复能返回`session.reconnected`，并可通过`/sessions/{session_id}/recover`回补最小快照。
- P-004-03 对应自动化验证通过：超过`30秒`恢复窗口时返回`RECON_003`并进入`rejoin_required`降级路径。
- P-004-04 的最小状态机验证通过：Android侧已持有并消费`room_id/session_id/reconnect_token/last_seq/seat_intent`，断线后会自动触发`session.reconnect`并按结果恢复或重入房。
- P-004-05 的核心一致性边界部分通过：`RECON_005`与`room.recover_hint`链路已覆盖“原麦位不可恢复”与“需补偿/重订阅提示”，未发现双会话或幽灵会话的自动化阻塞缺陷。
- 契约一致性通过：`PRD`、`ARCHITECTURE`、`API_SPEC`、实现与自动化断言对`session.reconnect`、`session.reconnected`、`room.recover_hint`、`RECON_003/005`语义保持一致。

### 13.4 证据与限制
- 当前证据以Service定向自动化与Android本地单测为主，足以支撑“最小可执行闭环”验收。
- 受本批次范围限制，`P-004-04/P-004-05`所要求的真机前后台录屏、Wi-Fi/4G真实切网录屏与服务端恢复日志尚未纳入本轮自动化证据。
- 当前未发现需要将REQ-004打回`🔴 bug修复`的阻塞缺陷；但真实设备网络切换与跨 Worker 恢复仍应继续作为后续补证项跟踪。

### 13.5 当前结论（REQ-004）
- 结论：`CONDITIONAL PASS（最小闭环验收通过）`，允许按本周最小范围将`REQ-004`推进到`🟩已验收`。
- 结论口径：本次“已验收”仅代表`单Worker / 单房间 / Android真机 + service测试环境`的最小恢复闭环达成，不外推为“多实例/真实切网/全量网络条件全部通过”。
