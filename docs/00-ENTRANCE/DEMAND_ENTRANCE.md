# DEMAND_ENTRANCE v0.4 - 全局需求进度总表
*更新：2026-03-25 | 维护角色：@feature_dev | 状态：🟢active*

## 重建说明
- 原需求总表缺失，当前版本依据 `docs/00-ENTRANCE/DOC_STRUCTURE.md` 3.1 字段定义，以及 `docs/01-PRODUCT/PRD.md` 中既有的 `REQ-001 ~ REQ-004` 重建。
- 本轮由 `@product_mgr` 完成需求拆解与交棒，初始将 `REQ-001 ~ REQ-004` 推进至 `🟢待设计 / @arch_perf_dev`；后续状态以本表为准滚动推进。

## 需求总表
| 需求 ID | 描述 | 状态 | 当前负责人 | 核心依赖文档 | 阻塞或备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| REQ-001 | 注册/登录 + 钱包开通 | 🟩已验收 | `-` | `docs/01-PRODUCT/PRD.md` §6.1、§6.1.1；`docs/02-ARCHITECTURE/ARCHITECTURE.md` §11、§11.10；`docs/02-ARCHITECTURE/API_SPEC.md` §3.1、§6.1；`docs/04-TESTING/TEST_STRATEGY.md` §9、§10 | `@test_writer`已完成回归：服务端认证链路（OTP/refresh/wallet/legacy）+ Android登录/refresh/wallet/UI状态回归通过；`@documentor`已补齐Android收尾记录与踩坑沉淀（见`DEBUG_NOTES`）。 |
| REQ-002 | 创建/加入房间 + 礼物消费闭环 | 🟩已验收 | `-` | `docs/01-PRODUCT/PRD.md` §5、§6.2、§6.2.1、§6.2.2；`docs/02-ARCHITECTURE/ARCHITECTURE.md` §12；`docs/02-ARCHITECTURE/API_SPEC.md` §3.2、§3.3、§4.3、§6.2；`docs/04-TESTING/TEST_STRATEGY.md` §11 | `@test_writer`已完成服务端单元/集成+Socket协议测试，Android端完成建房/入房/送礼时序与错误码回归；`@documentor`已完成REQ-002收尾文档归档（见`DEBUG_NOTES`/`CHANGELOG`）。 |
| REQ-003 | 群聊音频（8麦位，100并发） | 🟢待测试 | `@test_writer` | `docs/01-PRODUCT/PRD.md` §5、§6.3、§6.3.1、§6.3.2、§6.3.3；`docs/02-ARCHITECTURE/ARCHITECTURE.md` §13；`docs/02-ARCHITECTURE/API_SPEC.md` §3.4、§4、§6.3；`docs/04-TESTING/TEST_STRATEGY.md` §11.3 | `@feature_dev`已完成REQ-003服务端/Android开发：新增RTC协商REST（plan/metrics）与Socket `rtc.*`链路、麦位冲突与弱网降级事件；本地验证通过 `cd service && npm test`、`cd android && JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew testDebugUnitTest --no-daemon`。 |
| REQ-004 | 退出/掉线重连（30秒窗口） | 🟢待设计 | `@arch_perf_dev` | `docs/01-PRODUCT/PRD.md` §5、§6.4 | 依赖 REQ-003 的 RTC 会话模型；需明确会话快照、重连 Token、事件补偿与跨 Worker 恢复边界。 |

## 交棒说明
- `REQ-001`与`REQ-002`已完成文档收尾：`DEBUG_NOTES`补齐Android与礼物闭环复盘，`CHANGELOG`完成事件归档；需求状态保持`🟩已验收`，负责人留空。
- `REQ-003`已由`@feature_dev`完成开发并交棒`🟢待测试 / @test_writer`：实现`REST rtc/plan + rtc/metrics`、Socket `rtc.create/connect/produce/consume`、`rtc.seat.updated`冲突语义、`rtc.degrade.*`降级恢复事件，以及Android侧RTC事件消费与ViewModel状态串联。
- 其余`🟢待设计`需求仍由`@arch_perf_dev`读取本表与`docs/01-PRODUCT/PRD.md`，继续冻结架构与接口协议。
