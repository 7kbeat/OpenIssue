---
name: openissue-triage
description: 审阅 OpenIssue 收件箱，按项目事实、依赖与手动覆盖调整档位、顺序、依赖和状态。用于优先级评审与关闭决策。
allowed-tools: Bash(openissue:*)
license: MIT
compatibility: Requires openissue CLI.
metadata:
  author: openissue
  version: "1.0"
---

# OpenIssue Triage

审阅打开的需求，解释当前优先级，并在有证据时做最小调整。不要按创建时间猜测重要性，也不要自动关闭需求。

## Read First

```bash
openissue priority --json
openissue show <id> --json
```

`priority --json` 的分组包含 `high`、`medium`、`low`、`unassessed`；同时检查：

- `reason` 与 `basis`：结论是否有项目事实支撑；
- `stale`：输入变化后是否待刷新；
- `manual`、`dependency_floor`、`blocked`、`invalid_dependency`；
- `conflicts`：无法解析的记录必须单独指出，不能被静默忽略。

## Allowed Adjustments

只有用户明确要求或证据充分时才执行：

```bash
# 设置/清空当前重点
openissue focus "<本轮重点>"
openissue focus --clear

# 手动档位；auto 恢复自动判断
openissue tier <id> high|medium|low
openissue tier <id> auto

# 单一阻塞关系；前置已完成会解除，前置不做会使下游待评估
openissue depend <blocker-id> <blocked-id>
openissue undepend <blocker-id> <blocked-id>

# 关闭必须给出原因；“不做”必须说明理由
openissue close <id> --reason completed
openissue close <id> --reason wontdo --note "<原因>"
openissue reopen <id>
```

## Rules

- 默认只审阅打开需求；关闭需求只有在用户要求时才纳入。
- 优先级顺序固定为：排除关闭项 → 识别失效依赖 → 依赖下限 → 手动覆盖 → 助手判断。不要绕过这个顺序。
- 依赖下限只能抬高下游档位，不能降低；手动设置不会取消前置带来的下限。
- “待评估”是正常状态，不要为了填满三档而编造依据。
- 关闭关联活跃提案的需求不会关闭或改写提案；要向用户说明这一点。
- 不提供永久删除；需要“暂缓”时保持打开。
- 助手判断可选：先用 `openissue prioritize --emit` 生成请求，得到响应后用 `openissue prioritize --apply <file>` 写回；不要伪造 `tier`、`reason`、`basis` 或输入哈希。
- 需要人工快速审阅时运行 `openissue board`，不要远程暴露看板。

## Output

按高/中/低/未评估列出需求 id、标题、理由与阻塞/待刷新标记；单独列出冲突。说明本次做了哪些手动调整、哪些仍待评估，以及为什么没有自动关闭任何需求。
