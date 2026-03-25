# DOC_STRUCTURE.md v2.0 - 文档管理与串行协作规则
*更新：2026-03-25 | 维护者：@documentor | 状态：🟩approved*

## 1. 文档树结构 (瘦身版)
```text
docs/
├── 00-ENTRANCE/
│   ├── DEMAND_ENTRANCE.md    # ★ 全局唯一进度/状态/负责人总表
│   ├── PROJECT_OVERVIEW.md   # 项目终极目标
│   └── DOC_STRUCTURE.md      # 本文件
├── 01-PRODUCT/
│   └── COMPETITIVE_ANALYSIS.md      # 竞品分析
│   └── PRD.md                # 包含需求，验收标准
├── 02-ARCHITECTURE/
│   ├── ARCHITECTURE.md       # 系统设计
│   └── API_SPEC.md           # 接口协议
├── 04-TESTING/
│   └── TEST_STRATEGY.md      # 测试与联调方案
└── 05-DEBUG/
    ├── CHANGELOG.md          # 版本更新历史
    └── DEBUG_NOTES.md        # 踩坑记录
```

## 2. 文档通用规则
- **串行原则**：本项目采用单线程串行开发，**所有进度流转只认 `docs/00-ENTRANCE/DEMAND_ENTRANCE.md`**，严禁角色私自创建自己的进度表。
- **最少读取**：每次新对话只读 `DEMAND_ENTRANCE.md` + 角色强依赖的 1-2 个交付物文档，严禁一次性把所有文档喂给 AI。
- **增量更新**：更新文档时优先追加增量信息，不要无谓重写全文。
- **Markdown 标准**：所有文档统一使用 Markdown 格式。
- **状态流转**：状态统一使用：🟡待拆解、🟢待设计、🟢待开发、🟢待测试、🔴bug修复、🟩已验收、⚫已废弃。

## 3. 全局总表 (DEMAND_ENTRANCE) 规则
`docs/00-ENTRANCE/DEMAND_ENTRANCE.md` 是整个项目唯一的心脏，所有人围绕它转。

### 3.1 表格字段定义
| 需求 ID | 描述 | 状态 | 当前负责人 | 核心依赖文档 | 阻塞或备注 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| REQ-xxx | 短名称 | 见状态规范 | `@角色名` | 执行此任务必须读的文档 | 卡点或联调记录 |

### 3.2 更新铁律 (交棒机制)
- **任何角色完成任务后，必须去该表更新自己负责的行。**
- **必须改状态**：任务推进后，状态向下一步流转。如果有 Bug，状态退回。
- **必须改负责人**：事情做完了，必须把 `@角色名` 换成下一个环节的人。**严禁做完不交棒。**

## 4. 各角色产出与文档权限

### 4.1 @product_mgr
- **输入来源**：观察 `DEMAND_ENTRANCE.md` 中 `🟡待拆解` 的需求。
- **产出文件**：更新 `docs/01-PRODUCT/PRD.md`。
- **交棒动作**：状态改为 `🟢待设计`，负责人改为 `@arch_perf_dev`。

### 4.2 @arch_perf_dev
- **输入来源**：观察 `DEMAND_ENTRANCE.md` 中 `🟢待设计` 的需求，并严格阅读上游产出的 `PRD.md`。
- **产出文件**：更新 `docs/02-ARCHITECTURE/ARCHITECTURE.md` 与 `API_SPEC.md`。
- **交棒动作**：状态改为 `🟢待开发`，负责人改为 `@feature_dev`。

### 4.3 @feature_dev
- **输入来源**：观察 `DEMAND_ENTRANCE.md` 中 `🟢待开发` 或 `🔴bug修复` 的需求，并严格阅读上游产出的架构与 API 文档。
- **产出文件**：更新具体的业务代码（`src/` 或 `backend/`）。
- **交棒动作**：本地编译通过后，状态改为 `🟢待测试`，负责人改为 `@test_writer`。

### 4.4 @test_writer
- **输入来源**：观察 `DEMAND_ENTRANCE.md` 中 `🟢待测试` 的需求。
- **产出文件**：更新测试代码，并按需更新 `docs/04-TESTING/TEST_STRATEGY.md`。
- **交棒动作**：
  - 测试通过：状态改为 `🟩已验收`，负责人清空（或转 `@documentor`）。
  - 发现 Bug：状态改为 `🔴bug修复`，负责人退回 `@feature_dev`，并在 `DEBUG_NOTES.md` 写明复现步骤。

### 4.5 @documentor
- **输入来源**：观察 `DEMAND_ENTRANCE.md` 中 `🟩已验收` 的需求。
- **产出文件**：提炼经验至 `docs/05-DEBUG/DEBUG_NOTES.md`，更新 `CHANGELOG.md`。

## 5. 新对话默认 Prompt 规范
由于规则已极度收敛，新对话不需要冗长的上下文铺垫，直接使用以下标准句式：

> **“请检查 `docs/00-ENTRANCE/DEMAND_ENTRANCE.md` 的进度表。如果你是当前需求的负责人，请读取你负责的核心依赖文档，继续执行任务！做完记得更新表里的状态，并交棒给下一个人。”**

## 6. 最终原则
- **文档即代码，表格即引擎。**
- 不在这个表里的需求不准做，不是当前负责人的角色不准抢跑。
- 保证每个角色“只看自己该看的，只改自己该改的”。