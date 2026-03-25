# DEMAND_ENTRANCE v0.5 - 全局需求进度总表
*更新：2026-03-25 | 维护角色：@documentor | 状态：🟢active*

## 重建说明
- 原需求总表缺失，当前版本依据 `docs/00-ENTRANCE/DOC_STRUCTURE.md` 3.1 字段定义，以及 `docs/01-PRODUCT/PRD.md` 中既有的 `REQ-001 ~ REQ-004` 重建。
- 本轮由 `@product_mgr` 完成需求拆解与交棒，初始将 `REQ-001 ~ REQ-004` 推进至 `🟢待设计 / @arch_perf_dev`；后续状态以本表为准滚动推进。

## 需求总表
| 需求 ID | 描述 | 状态 | 当前负责人 | 核心依赖文档 | 阻塞或备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| REQ-001 | 注册/登录 + 钱包开通 | 🟩已验收 | `-` | `docs/01-PRODUCT/PRD.md` §6.1、§6.1.1；`docs/02-ARCHITECTURE/ARCHITECTURE.md` §11、§11.10；`docs/02-ARCHITECTURE/API_SPEC.md` §3.1、§6.1；`docs/04-TESTING/TEST_STRATEGY.md` §9、§10 | `@test_writer`已完成回归：服务端认证链路（OTP/refresh/wallet/legacy）+ Android登录/refresh/wallet/UI状态回归通过；`@documentor`已补齐Android收尾记录与踩坑沉淀（见`DEBUG_NOTES`）。 |
| REQ-002 | 创建/加入房间 + 礼物消费闭环 | 🟩已验收 | `-` | `docs/01-PRODUCT/PRD.md` §5、§6.2、§6.2.1、§6.2.2；`docs/02-ARCHITECTURE/ARCHITECTURE.md` §12；`docs/02-ARCHITECTURE/API_SPEC.md` §3.2、§3.3、§4.3、§6.2；`docs/04-TESTING/TEST_STRATEGY.md` §11 | `@test_writer`已完成服务端单元/集成+Socket协议测试，Android端完成建房/入房/送礼时序与错误码回归；`@documentor`已完成REQ-002收尾文档归档（见`DEBUG_NOTES`/`CHANGELOG`）。 |
| REQ-003 | 群聊音频（8麦位，100并发） | 🟩已验收 | `-` | `docs/01-PRODUCT/PRD.md` §5、§6.3、§6.3.1、§6.3.2、§6.3.3；`docs/02-ARCHITECTURE/ARCHITECTURE.md` §13；`docs/02-ARCHITECTURE/API_SPEC.md` §3.4、§4、§6.3；`docs/04-TESTING/TEST_STRATEGY.md` §11.3、§12.3、§12.5 | `@feature_dev`已完成REQ-003服务端/Android开发：新增RTC协商REST（plan/metrics）与Socket `rtc.*`链路、麦位冲突与弱网降级事件；本地验证通过 `cd service && npm test`、`cd android && JAVA_HOME=$(/usr/libexec/java_home -v 17) ./gradlew testDebugUnitTest --no-daemon`。`@test_writer`已补齐Service边界用例与Android RTC用例；已跑Service+Android单测均通过；已固化压测脚本`service/tools/req003_load.js`并完成Service+Socket真实环境100并发/弱网演练（P95=185ms，降级恢复15s内=100%，详见`TEST_STRATEGY` §12.3）；Android联调`Req003IntegrationTest`通过。当前按`TEST_STRATEGY` §12.5 记录为`CONDITIONAL PASS（阶段验收通过）`，文档侧完成收尾归档并维持`🟩已验收`；真实RTC媒体链路压测、弱网注入取证与真机/模拟器联调证据列为后续补证项继续跟踪。 |
| REQ-004 | 退出/掉线重连（30秒窗口） | 🟩已验收 | `-` | `docs/01-PRODUCT/PRD.md` §5、§6.4；`docs/02-ARCHITECTURE/ARCHITECTURE.md` §14；`docs/02-ARCHITECTURE/API_SPEC.md` §3.5、§4、§6.4；`docs/04-TESTING/TEST_STRATEGY.md` §13 | `@test_writer`已完成REQ-004最小闭环验收：Service定向自动化覆盖窗口内恢复、超窗`RECON_003`、原麦位不可恢复`RECON_005`与`room.recover_hint`；Android单测通过并验证`session.reconnect/session.reconnected`状态机。当前按`TEST_STRATEGY` §13记为`CONDITIONAL PASS（最小闭环验收通过）`，仅覆盖`单Worker / 单房间 / Android真机 + service测试环境`，真实切网/真机录屏证据继续后补。 |

## 交棒说明
- `REQ-001`与`REQ-002`已完成文档收尾：`DEBUG_NOTES`补齐Android与礼物闭环复盘，`CHANGELOG`完成事件归档；需求状态保持`🟩已验收`，负责人留空。
- `REQ-003`已完成测试与文档沉淀：当前按`TEST_STRATEGY` §12.5 记为`CONDITIONAL PASS（阶段验收通过）`，总表维持`🟩已验收`并留空负责人；真实RTC媒体链路压测、弱网注入取证与真机/模拟器联调证据继续在后续批次补齐。
- `REQ-004`已完成测试验收：`@test_writer`已执行Service定向自动化与Android单测，确认窗口内恢复、超窗重入房、恢复补偿提示与原麦位不可恢复边界通过；当前按`TEST_STRATEGY` §13记为`CONDITIONAL PASS（最小闭环验收通过）`，总表推进至`🟩已验收`并留空负责人，真实真机切网/录屏证据列为后续补证项。
- 其余`🟢待设计`需求仍由`@arch_perf_dev`读取本表与`docs/01-PRODUCT/PRD.md`，继续冻结架构与接口协议。
