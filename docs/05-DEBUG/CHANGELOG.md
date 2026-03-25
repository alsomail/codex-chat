# CHANGELOG.md v0.5
*更新：2026-03-25 22:54 | 状态：🟢review | 维护者：@documentor*

## 文档同步日志
- 2026-03-24 13:31（UTC+8）初始化变更日志文件，用于记录 `sprint-01` 事件驱动的文档更新。

### 文档同步（2026-03-24 13:39）
- [未归类事件] DEMAND_ENTRANCE v0.8已更新
- 消息：PM-EVENT-DEMAND-V08 / 来源：product_mgr
- 内容：docs/01-PRODUCT/DEMAND_ENTRANCE.md 已补充REQ-001验收口径（登录>=99%、JWT强校验、礼物链路ready）与通过门禁。

### 文档同步（2026-03-24 13:46）
- [未归类事件] REQ-001功能代码完成
- 消息：REQ001-EVENT-FEAT-003 / 来源：feature_dev
- 内容：REQ-001功能代码已完成，可以开始测试。请 test_writer 优先回归登录/JWT/refresh 及Android token安全存储路径。

### 文档同步（2026-03-25 11:40）
- [测试验收] REQ-001自动化回归通过
- 消息：REQ001-EVENT-TEST-011 / 来源：test_writer
- 内容：在Node `v18.20.8`环境执行`tsc + node --test`，结果`11/11 PASS`，覆盖AUTH门禁（`AUTH_004`重放拦截、`AUTH_005` fail-closed）与钱包汇总接口字段完整性。

### 文档同步（2026-03-25 11:55）
- [收尾归档] REQ-001切换到已验收并交由documentor收尾
- 消息：REQ001-EVENT-CLOSE-001 / 来源：test_writer
- 内容：`DEMAND_ENTRANCE`将REQ-001状态更新为`🟩已验收`，负责人切换至`@documentor`，等待沉淀踩坑记录与版本变更。

### 文档同步（2026-03-25 12:06）
- [文档沉淀] 完成REQ-001收尾复盘
- 消息：REQ001-EVENT-DOC-001 / 来源：documentor
- 内容：`DEBUG_NOTES.md v0.5`新增“REQ-001收尾复盘”，沉淀实现口径、测试证据、环境坑位与守护项；总表交棒闭环完成。

### 文档同步（2026-03-25 13:18）
- [文档补录] REQ-001 Android代码完成记录补齐
- 消息：REQ001-EVENT-DOC-002 / 来源：documentor
- 内容：`DEBUG_NOTES.md v0.6`新增“REQ-001 Android补录”，补齐Android执行环境、关键验证点、会话一致性与错误码映射踩坑。

### 文档同步（2026-03-25 13:18）
- [收尾归档] REQ-002完成文档沉淀
- 消息：REQ002-EVENT-DOC-001 / 来源：documentor
- 内容：新增“REQ-002收尾复盘”，归档建房/入房/送礼闭环、幂等与风控验证、Android时序一致性结论；`DEMAND_ENTRANCE`同步更新收尾状态。

### 文档同步（2026-03-25 21:17）
- [文档沉淀] REQ-003阶段验收归档与口径对齐
- 消息：REQ003-EVENT-DOC-001 / 来源：documentor
- 内容：`DEBUG_NOTES.md v0.7`新增“REQ-003 文档沉淀”，归档Service/Android/压测脚本与联调结论、阶段结论、未完成项与下一步建议；同步最小修正`DEMAND_ENTRANCE.md`，将`REQ-003`统一表述为“`CONDITIONAL PASS（阶段验收通过）`已归档，补证项继续跟踪”。

### 文档同步（2026-03-25 22:54）
- [文档收尾] REQ-004最小闭环验收后沉淀完成
- 消息：REQ004-EVENT-DOC-001 / 来源：documentor
- 内容：`DEBUG_NOTES.md v0.8`新增“REQ-004 最小闭环收尾复盘”，沉淀窗口内恢复、超窗降级、原麦位不可恢复、Android重连状态机、关键补偿边界与后续补证项；`CHANGELOG`同步记录最小闭环交付，便于后续真机录屏与跨 Worker 补证延续。
