# TEST_STRATEGY.md v0.5 - REQ-001~004 MVP测试策略
*更新：2026-03-25 | 状态：🟢review | Owner：@test_writer*

## CHANGELOG
- v0.0 -> v0.1：初始化测试策略，覆盖REQ-001~004，重点新增REQ-003/004弱网与重连用例矩阵。
- v0.1 -> v0.2：补充`REQ-001`测试执行批次与验收结论；对齐`PRD v0.5`与`API_SPEC v0.4`版本口径。
- v0.2 -> v0.3：新增`REQ-001/REQ-002 Android客户端验收清单映射`，明确客户端验收证据与执行批次。
- v0.3 -> v0.4：完成`REQ-001` Android回归与`REQ-002`服务端/Socket/Android协议测试，补充测试批次与验收结论并推动流转。
- v0.4 -> v0.5：对齐`PRD v0.8`新增`REQ-003` Android/Service验收清单，补充测试映射与执行批次要求。

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
