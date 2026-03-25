# DEMAND_ENTRANCE v0.1 - 全局需求进度总表
*更新：2026-03-25 | 维护角色：@product_mgr | 状态：🟢active*

## 重建说明
- 原需求总表缺失，当前版本依据 `docs/00-ENTRANCE/DOC_STRUCTURE.md` 3.1 字段定义，以及 `docs/01-PRODUCT/PRD.md` 中既有的 `REQ-001 ~ REQ-004` 重建。
- 本轮由 `@product_mgr` 完成需求拆解与交棒，初始将 `REQ-001 ~ REQ-004` 推进至 `🟢待设计 / @arch_perf_dev`；后续状态以本表为准滚动推进。

## 需求总表
| 需求 ID | 描述 | 状态 | 当前负责人 | 核心依赖文档 | 阻塞或备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| REQ-001 | 注册/登录 + 钱包开通 | 🟢待开发 | `@feature_dev` | `docs/01-PRODUCT/PRD.md` §6.1；`docs/02-ARCHITECTURE/ARCHITECTURE.md` §11；`docs/02-ARCHITECTURE/API_SPEC.md` §3.1 | 架构/接口口径已冻结并完成交棒：规范路径`/api/v1/auth/otp/*`、`/api/v1/auth/refresh`、`/api/v1/wallet/summary`；legacy路径必须`404/410`。P0门禁待开发/联调回归清零：OTP provider异常必须`fail-closed(503 AUTH_005)`、refresh token仅哈希存储（禁止明文/日志泄漏）、refresh轮转与旧token重放拦截（`<=60s`传播）。 |
| REQ-002 | 创建/加入房间 + 礼物消费闭环 | 🟢待设计 | `@arch_perf_dev` | `docs/01-PRODUCT/PRD.md` §5、§6.2 | 需定义房间、订单、支付回调、礼物广播的接口边界与幂等策略，保证收入主链路可追踪。 |
| REQ-003 | 群聊音频（8麦位，100并发） | 🟢待设计 | `@arch_perf_dev` | `docs/01-PRODUCT/PRD.md` §5、§6.3 | 需输出 SFU 基线、弱网降级策略、观测指标与压测口径，作为后续开发与测试统一基准。 |
| REQ-004 | 退出/掉线重连（30秒窗口） | 🟢待设计 | `@arch_perf_dev` | `docs/01-PRODUCT/PRD.md` §5、§6.4 | 依赖 REQ-003 的 RTC 会话模型；需明确会话快照、重连 Token、事件补偿与跨 Worker 恢复边界。 |

## 交棒说明
- `REQ-001`已完成架构冻结与接口对齐，当前由`@feature_dev`进入开发落地与联调回归。
- 其余`🟢待设计`需求仍由`@arch_perf_dev`读取本表与`docs/01-PRODUCT/PRD.md`，继续冻结架构与接口协议。
