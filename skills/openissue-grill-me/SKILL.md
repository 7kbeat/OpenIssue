---
name: openissue-grill-me
description: 从 OpenIssue 需求进入 OpenSpec 的产品决策访谈。先访谈、自动创建提案草稿并增量写入 proposal/specs/design；只有用户明确结束访谈后才生成 TDD tasks，生成后停止。
allowed-tools: Bash(openissue:*), Bash(openspec:*)
license: MIT
compatibility: Requires openissue CLI, OpenSpec CLI, and an Agent conversation.
metadata:
  author: openissue
  version: "1.0"
---

# OpenIssue Grill-Me

把一条 OpenIssue 需求送入 OpenSpec 时，先做产品决策访谈，再写规划产物。访谈是默认起点；不要先写完整的 spec、design 或 tasks，也不要在访谈中实现代码。

## 适用边界

- 只用于来自 OpenIssue 需求的 OpenSpec 工作。
- 没有 OpenIssue 需求来源的 OpenSpec 变更继续使用标准 propose；来源不明确时先问用户，不要创建提案。
- 访谈只在 Agent 对话中进行。看板与命令行只提供起点和可复制上下文，不内嵌聊天。
- `openissue-handoff` 只负责重新关联已有提案与归档后确认完成，不再负责创建新提案。

## 入口

用户给出需求标识或标题时并要求开始 OpenSpec 时，先读取上下文：

```bash
openissue start <id> --json
```

如果当前仓库缺少 `openissue-grill-me`，`start` 会提示安装或修复。不要绕过该检查，也不要从个人全局目录手工复制。

`start` 只输出上下文，不创建提案、不改需求。读取输出后：

1. 若存在未完成草稿，继续同一草稿，不要创建第二份。
2. 若存在一个活跃提案，接管该提案并保留已有正文。
3. 若存在多个活跃提案，列出并让用户选择，不要自行选择。
4. 若只有归档提案，说明归档提案不能被接管，由用户决定重新关联或新建。
5. 若没有活跃提案，按 `suggested_change_id` 创建草稿。

## 自动创建草稿

创建新草稿时，先调用 OpenSpec 创建变更，再建立需求关联和访谈标记：

```bash
openspec new change <change-id> --description "<需求标题、描述与当前重点>" --json
openissue handoff <id> --link <change-id> --from-interview
```

- `--from-interview` 是访谈流程的内部关联路径，不显示“跳过访谈”警告。
- 它只写关联与 `x-openissue-interview` 标记，不复制或改写提案正文。
- 草稿创建后保持标识稳定；访谈范围变化时不要自动改名。
- 需求保持打开；访谈未完成不是新的生命周期状态。

接管已有活跃提案时，同样使用：

```bash
openissue handoff <id> --link <active-change-id> --from-interview
```

已有正文不得覆盖；只补写尚未确认的内容和访谈标记。

## 访谈方法

每次只问一个产品决策，按依赖顺序推进：

- 从用户操作、可见结果、边界与失败恢复出发，不问内部实现。
- 明确区分已确认事实、未验证风险与未决项；不要把假设写成当前行为。
- 每项决策给出推荐行为与理由，等待用户明确确认后再记录。
- 不把未决项写成已确认结论。

## 增量记录

每确认一项决策，立即写入其归属的规划产物，并让用户看到 diff：

| 决策内容 | 写入位置 |
| --- | --- |
| 问题、动机、范围与能力变更 | `proposal.md` 的 Why / What Changes / Capabilities |
| 可验证的用户行为、边界与失败路径 | `specs/<capability>/spec.md` |
| 取舍、替代方案、非显然约束与风险 | `design.md` 的 Decisions |

- 不要在访谈结束时才批量补写；确认一项就写一项。
- 写 spec 前先读现有能力规范与同目录变更，复用准确的能力路径。
- 修改既有需求时保留原需求与未改动场景，只改本次确认的部分。
- 需求描述保持短小，每个需求至少有一个正常路径场景；适用时补边界与失败场景。
- 用户修正已确认决策时，立即更新对应产物并消除旧结论。
- 访谈中不要生成或重写 `tasks.md`。

## 结束访谈并生成 tasks

只有用户明确执行“结束访谈并生成任务”时，才进入这一步。

1. 先展示结论摘要：已确认决策、未决项与风险。
2. 仍有未决项时列出并阻止生成；让用户继续访谈，或明确把某项移出本次范围。
3. 未决项处理完后，按测试先行顺序生成 `tasks.md`：
   - 按行为切片分组；
   - 每片包含 RED、GREEN、REFACTOR、INTEGRATE；
   - 每个任务写明验证命令或可观察结果；
   - 覆盖对应的 spec 场景。
4. 生成 tasks 后停止，展示任务摘要与验证方式，并说明实现需要用户另行发起。
5. 不要在生成 tasks 的同一次动作中修改业务代码，也不要自动进入标准 OpenSpec apply。
6. 若已确认行为后来变化，说明旧 tasks 可能过期；只有用户再次明确结束后才重写。

只有用户在 tasks 生成后明确要求实现时，才确认用户已审阅任务，并进入标准 OpenSpec apply 流程；仍不在本访谈流程内直接改代码。

## 与标准 propose 分流

- 来自 OpenIssue 需求：使用本 skill 与自动草稿。
- 直接提出的 OpenSpec 变更、没有需求来源：使用标准 propose。
- 来源不明确：先问“这项工作是否对应某条 OpenIssue 需求？”，得到答案前不创建提案、不修改需求。

不要替换、改名或覆盖 OpenSpec 标准 propose。

## 中断、恢复与丢弃

- 访谈中断或取消时保留草稿；需求保持打开，草稿显示“访谈未完成”。
- 再次从同一需求开始时，运行 `openissue start <id> --json`，继续同一草稿。
- 丢弃草稿必须先让用户明确确认；取消或失败时草稿、已写内容与关联必须保持不变。
- 确认丢弃后才能运行：
  ```bash
  openissue start <id> --discard <change-id> --yes
  ```

## 收尾与归档

- 访谈规划止于 tasks；不要自动关闭需求。
- 全部关联提案归档后，由用户确认完成；使用 `openissue-handoff` 的归档确认路径。
- 不伪造 OpenSpec 的 proposal、specs、design、tasks 或归档状态。
- 不要声称仓库已检查、测试已运行或验证已通过，除非实际执行并观察到结果。

## 输出

报告：

1. 需求 id 与草稿 id；
2. 已确认决策摘要；
3. 已更新的 proposal、specs、design 路径；
4. 未决项与风险；
5. tasks 是否已生成，以及下一步需要用户明确发起的动作。
