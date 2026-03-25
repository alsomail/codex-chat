# DEBUG_NOTES.md v0.6
*更新：2026-03-25 13:18 | 状态：🟢review | 维护者：@documentor*

## CHANGELOG
- v0.1 -> v0.2：新增REQ-001阶段总结（diff/changelog）、风险与优化建议、凌晨汇总报告主线程。
- v0.2 -> v0.3：新增REQ-003/004联调失败排查模板（弱网/重连），并补充故障升级规则。
- v0.3 -> v0.4：按并行协作通讯协议完成状态冲突对齐，更新REQ-001主线程结论与风险优先级。
- v0.4 -> v0.5：补充REQ-001收尾复盘（实现口径、测试验收结果、踩坑记录、后续守护项），用于M1前复用。
- v0.5 -> v0.6：补录REQ-001 Android交付证据，新增REQ-002收尾复盘（建房/入房/送礼闭环、幂等与风控）。

## REQ-001 收尾复盘（2026-03-25）
### 1) 交付结论
- 状态结论：`REQ-001`已完成开发、测试、验收，进入文档收尾阶段（总表已流转至`🟩已验收`）。
- 自动化回归结果：`11 passed / 0 failed / 0 blocked`。
- 验收覆盖：OTP发送/校验、OTP provider异常fail-closed(`503 AUTH_005`)、Refresh轮转与重放拦截(`409 AUTH_004`)、legacy路径拒绝、`wallet/summary`字段完整性与鉴权校验。

### 2) 本轮落地口径（与PRD/API_SPEC对齐）
- 认证主路径固定为：`/api/v1/auth/otp/send`、`/api/v1/auth/otp/verify`、`/api/v1/auth/refresh`、`/api/v1/wallet/summary`。
- legacy路径统一拒绝：`/api/v1/auth/login/otp`与`/api/auth/*`返回`410`，不再返回成功体。
- Refresh安全策略落地：仅存`refresh_token_hash`，采用`SHA-256(token + pepper)`；旧refresh token复用返回`AUTH_004`。
- 响应结构对齐：主结构使用`request_id/code/message/data`，并兼容历史`camelCase`字段，降低Android联调切换成本。

### 3) 踩坑记录（供后续REQ复用）
| 分类 | 现象 | 根因 | 处理方式 | 预防建议 |
|---|---|---|---|---|
| 运行时环境 | 本地Node 14无法执行`node --test` | `node:test`与`node:assert/strict`在旧版本不可用 | 使用`nvm use 18`切换到`v18.20.8`后执行测试 | 测试前置脚本统一校验Node版本`>=18` |
| npm配置 | `npm test`触发用户侧认证配置报错（`_auth`） | 用户全局`.npmrc`历史配置不兼容新npm | 用`tsc + node --test`直跑，规避与业务无关阻塞 | 在README增加“全局npm配置异常排查”小节 |
| 联调兼容 | API字段命名由`camelCase`向`snake_case`收敛，客户端存在存量依赖 | 历史实现与API_SPEC演进节奏不一致 | 服务端短期双字段兼容，保障联调连续性 | 在REQ-002前冻结“字段变更策略+废弃窗口” |
| 安全门禁 | Refresh轮转后旧token复用与“无效token”混在同一错误类别 | 错误码语义边界未拆分 | 明确重放返回`AUTH_004`，其余非法token走`AUTH_001` | 测试模板中固定增加“重放 vs 无效token”断言 |

### 4) 后续守护项（进入REQ-002前）
1. 在CI增加Node版本守护（避免再次出现环境差异导致的伪失败）。
2. 对`AUTH_004`、`AUTH_005`建立趋势监控，便于灰度期快速识别重放与OTP供应商异常。
3. 客户端联调窗口结束后，下线冗余`camelCase`兼容字段，保持接口收敛。

## REQ-001 Android补录（2026-03-25）
### 1) 本次补录范围
- 对齐`TEST_STRATEGY`中REQ-001 Android验收证据，补齐“代码完成 -> 测试通过 -> 文档归档”闭环记录。
- 关注点聚焦：Android登录态维持、refresh轮转一致性、钱包摘要回拉、异常码映射。

### 2) 交付证据摘要
- 执行环境：`android/` + JDK 17；命令：`./gradlew testDebugUnitTest --no-daemon`。
- 关键验证：登录成功后token持久化、refresh冲突返回`AUTH_004`、钱包刷新后UI状态一致。
- 与服务端协同结果：认证主链路与Android状态机行为一致，无额外协议分叉。

### 3) Android侧踩坑补充
| 分类 | 现象 | 处理方式 | 后续守护 |
|---|---|---|---|
| 会话一致性 | refresh轮转成功后，旧会话缓存可能短暂滞后 | 在ViewModel中串行化refresh与wallet刷新动作 | 保持“refresh成功后强制钱包回拉”门禁用例 |
| 错误码映射 | `AUTH_004`与通用鉴权失败文案易混淆 | 客户端区分“重放冲突”与“普通失效”提示 | UI错误码映射表固定纳入发布前回归 |

## REQ-002 收尾复盘（2026-03-25）
### 1) 交付结论
- 状态结论：`REQ-002`已完成开发、测试、验收，当前完成文档归档并维持`🟩已验收`。
- 验收覆盖：建房/入房票据、礼物扣费闭环、订单追踪、幂等重放、风险拦截、Android时序一致性。
- 协议时序结论：`gift.accepted -> gift.broadcast -> leaderboard.updated`验证通过。

### 2) 关键沉淀
- 服务端链路：`req002.test.ts`与`req002.socket.test.ts`覆盖业务规则与Socket事件顺序。
- Android链路：ViewModel测试覆盖入房票据透传、送礼失败回退充值、refresh后会话与钱包一致性。
- 风控与幂等：`GIFT_003`重复请求返回同`gift_order_id`，`RISK_001/002/003`行为符合预期。

### 3) 后续复用建议（面向REQ-003/004）
1. 复用REQ-002的“事件时序断言模板”，在语音重连场景增加`session.recovered`顺序校验。
2. 将礼物订单`gift_order_id`追踪链路扩展到重连补偿日志，降低跨Worker排障成本。
3. 保留Android关键链路每日冒烟（建房/入房/送礼）直到REQ-003接口冻结完成。

## 并行协作通讯协议记录（冲突对齐）
| 时间（UTC+8） | 参与角色 | 冲突点 | 对齐结论 | 动作 |
|---------------|----------|--------|----------|------|
| 2026-03-24 11:00 | documentor + product_mgr + feature_dev | REQ-001在不同文档中出现`🟢review`与`🟡draft`双状态 | 以`01-PRODUCT/DEMAND_ENTRANCE.md v0.7`为主源，REQ-001回退为`🟡draft` | PROJECT_OVERVIEW与DEBUG_NOTES同步修正 |
| 2026-03-24 11:05 | documentor + arch_perf_dev | ARCH-001截止与“是否已补时序图”描述不一致 | 统一为“基线冻结，待补跨Worker重连恢复图/压测模板” | 主线程阻塞从“礼物订单时序”扩展为“重连恢复图+压测报告” |
| 2026-03-24 11:10 | documentor + test_writer | REQ-003/004是否进入可联调阶段表述不统一 | 以联调清单与测试策略落地为准，状态保留`🟢review` | DEMAND_ENTRANCE补主线程备注，推进联调执行 |

## 阶段总结：REQ-001（注册/登录 + 钱包开通）
### 变更来源
- `docs/01-PRODUCT/PRD.md` v0.3
- `docs/01-PRODUCT/DEMAND_ENTRANCE.md` v0.7
- `docs/00-ENTRANCE/PROJECT_OVERVIEW.md` v0.3
- `docs/02-ARCHITECTURE/ARCHITECTURE.md` v0.1
- `docs/02-ARCHITECTURE/API_SPEC.md` v0.2

### REQ-001 diff（v0.1 -> v0.2）
| 维度 | v0.1（基线） | v0.2（新增/明确） | 影响 |
|------|--------------|-------------------|------|
| 登录流程 | 登录后入房 | 增加“首登即开户（wallet_gold/bonus/vip/risk_level）” | 建立充值与送礼前置条件，减少首单流失 |
| 变现入口 | 泛化“后续可充值” | 明确“礼物面板触发充值”+ 首充礼包/首礼任务 | 缩短首充路径，提高首充转化 |
| 合规口径 | 未明确 | 增加“虚拟币为站内权益，不可退款/不可现金等价流通”提示 | 降低支付争议与投诉风险 |
| 安全策略 | 基础鉴权 | 补充设备指纹、登录频控、异地登录告警 | 降低撞库/批量注册风险 |
| 验收标准 | 定性描述 | 明确注册入房成功率>=95%、首登开户成功率>=99.9% | 便于测试与上线门禁 |

### REQ-001 changelog（可追踪项）
- [新增] 首登自动开户字段：`wallet_gold`、`wallet_bonus_gold`、`vip_level`、`risk_level`。
- [新增] 首充引导：首充礼包 + 首礼任务，形成“登录 -> 充值 -> 送礼”闭环。
- [新增] 合规文案：虚拟币/礼物仅站内权益，不支持退款与现金流通。
- [新增] 安全控制：设备指纹、登录频控、异地登录告警。
- [新增] 可验收指标：注册入房与开户成功率目标写入PRD。
- [回滚确认] 主线程状态从“可开发准备（🟢review）”修正为“带阻塞评审（🟡draft）”。
- [新增阻塞] OTP回退口令、明文Token存储、接口路径偏差，需开发修复后二次复审。

## 风险与优化建议
| 类型 | 风险/问题 | 优化建议（主线程） | Owner |
|------|-----------|---------------------|-------|
| 支付依赖 | 第三方支付促销与费率波动，首充转化不稳定 | 预留多支付通道抽象层，配置化管理促销活动与支付路由 | arch_perf_dev + feature_dev |
| 弱网体验 | 弱网下充值回调慢、送礼确认延迟，用户误判失败 | 增加“订单最终态回执 + 队列中提示 + 超时重查”三段式反馈 | feature_dev |
| 风控误伤 | 频控阈值过严导致正常用户送礼失败 | 按国家/设备信誉分级阈值，灰度发布并观察拦截率 | product_mgr + test_writer |
| 对账闭环 | 充值成功但到账异常会引发财务差异 | 建立T+1对账任务与异常工单自动分派，保留审计字段180天 | arch_perf_dev |
| 安全合规 | REQ-001存在Token存储明文与OTP回退口令风险 | 改为加密存储、一次性OTP、失败锁定策略并补安全回归 | feature_dev + test_writer |

## 凌晨汇总报告主线程（2026-03-24）
- 进展：REQ-001 diff/changelog已沉淀，且并行协作冲突已完成一次对齐。
- 结论：主线程以`DEMAND_ENTRANCE v0.7`为准，REQ-001当前状态为`🟡draft`（待阻塞修复）。
- 阻塞：① REQ-001安全阻塞（OTP回退口令/Token明文）；② ARCH-001待补跨Worker重连恢复图与压测模板。
- 协同建议：`feature_dev`先清理REQ-001安全阻塞，`arch_perf_dev`补齐恢复图，`test_writer`执行安全+重连专项回归。

## 下一轮建议（2026-03-24白天）
1. 冻结REQ-001接口字段，输出API契约草案（避免前后端字段反复）。
2. 完成充值回调幂等设计评审（订单号、幂等键、回滚策略）。
3. 准备“首登开户成功率”埋点与压测脚本，提前验证99.9%目标。

## REQ-003/004 故障排查模板（新增）
### A. 基础信息
- 故障ID：`INC-YYYYMMDD-XXX`
- 发生时间（UTC+8）：
- 影响范围：房间数 / 用户数 / 国家
- 版本信息：Android版本、后端commit、SFU节点

### B. 现场症状（勾选）
- [ ] 无法上麦（`rtc.produce`失败）
- [ ] 有连接无声音（订阅成功但不可听）
- [ ] 高频重连（1分钟>=3次）
- [ ] 超过30秒恢复窗口失败（`RECON_003`）
- [ ] 重连后状态错乱（麦位/榜单/礼物）

### C. 必采日志与指标
- 客户端：`session_id`, `room_id`, `last_seq`, 网络类型(Wi-Fi/4G), 前后台切换时间点
- 网关日志：`request_id`, `error_code`, `reconnect_token`校验结果
- SFU日志：`transport_id`, `producer_id`, `consumer_id`, 丢包率、抖动、RTT
- 指标快照（故障前后10分钟）：
  - `e2e_latency_p95`
  - `reconnect_success_total / reconnect_attempt_total`
  - `rtc_join_mic_success_total`
  - `packet_loss`, `jitter`

### D. 快速判责树（10分钟内）
1. 若`reconnect_token`失效或超窗：归类`RECON_001/003`，走重入房降级路径。
2. 若`transport_id`缺失或失效：归类`RTC_002`，重建transport并重订阅。
3. 若恢复后状态不一致：触发`/sessions/{id}/recover`并核对`last_seq`回放。
4. 若多节点同现高丢包：优先排查网络/运营商链路，再查SFU资源。

### E. 恢复动作SOP
- Step 1：客户端显示“正在恢复语音”，禁止重复触发手动重连。
- Step 2：发起`session.reconnect`，失败则自动重入`room.join`。
- Step 3：必要时调用`/sessions/{session_id}/recover`补偿关键事件。
- Step 4：校验三项一致性：麦位、榜单、礼物订单最终态。
- Step 5：记录恢复耗时（平均、P95）与是否触发降级。

### F. 复盘输出（24小时内）
- Root Cause：
- 直接修复项（代码/配置）：
- 预防项（监控/告警/压测）：
- Owner + ETA：

## 故障升级规则（P级）
- P0：资金不一致或大面积无法入房/重连失败率>50%，立即全员响应。
- P1：重连成功率跌破85%持续10分钟，或音频P95>300ms持续5分钟。
- P2：局部机型/运营商异常，可通过降级策略恢复。
