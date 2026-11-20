---
name: openissue-handoff
description: 重新关联已有 OpenSpec 提案，或在关联提案归档后由用户确认需求完成。创建新提案请使用 openissue-grill-me。不伪造规范产物。
allowed-tools: Bash(openissue:*)
license: MIT
compatibility: Requires openissue CLI and OpenSpec CLI.
metadata:
  author: openissue
  version: "1.0"
---

# OpenIssue Handoff

`openissue-handoff` 只保留两个例外路径：

1. 把需求重新关联到已有 OpenSpec 提案；
2. 全部关联提案归档后，由用户确认需求完成。

创建新提案不是本 skill 的职责。需要新提案时，先运行 `openissue start <id>` 进入产品决策访谈，由 `openissue-grill-me` 自动创建草稿并增量规划。

## 重新关联已有提案

先读取需求：

```bash
openissue show <id> --json
```

用户明确选择已有活跃提案后：

```bash
openissue handoff <id> --link <existing-change-id>
```

- 该路径会跳过产品决策访谈；命令会明确提示这一点。
- 先让用户确认跳过访谈，再执行关联。
- 只建立关联，不复制或改写提案正文、规范或任务。
- 需求保持打开；不要因此关闭需求。

## 归档后确认完成

当全部关联提案归档后：

```bash
openissue show <id> --json
openissue confirm <id>
```

- 只有用户明确确认需求已完成，才运行 `confirm`。
- 部分归档、已关闭需求或关联失效时不会出现完成提示。
- 不要用 `openissue close --reason completed` 代替 `confirm`；`confirm` 保留归档回流语义。
- 若用户决定不做，使用：
  ```bash
  openissue close <id> --reason wontdo --note "<原因>"
  ```

## Boundaries

- 不创建新提案；创建新提案应使用 `openissue start <id>` 与 `openissue-grill-me`。
- 不伪造 OpenSpec 的 proposal、spec、design、tasks 或归档状态。
- 不自动关闭需求，不修改已有提案内容。
- 关联失效时先报告，不要猜测提案被删除或改名。

## Output

报告需求 id、提案 id、关联或确认结果，以及需求当前状态。
