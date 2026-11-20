---
name: openissue-capture
description: 把还不能实现、也还写不出 spec 的想法或 bug 捕获为 OpenIssue 需求。只记录，不实现。
allowed-tools: Bash(openissue:*)
license: MIT
compatibility: Requires openissue CLI.
metadata:
  author: openissue
  version: "1.0"
---

# OpenIssue Capture

当用户描述一个值得记住、但现在不能做或还没成熟到 OpenSpec 的想法、缺陷、改进时，把它放进产品锚点的需求收件箱。

## Rules

- 标题是唯一必填项；标题要能独立看懂，不要把整段描述塞进标题。
- 只写用户已经确认的事实。区分“现象”“证据”“期望”“待确认”，不要补造复现步骤、优先级或验收标准。
- 先查重，再创建。相似需求优先建议补充原需求，而不是新建重复项。
- **不要在本流程中实现代码、修改仓库业务文件、创建 OpenSpec 变更或关闭需求。**
- 需求只在锚点保存一份；成员仓库不产生副本。

## Steps

1. **定位产品**：在锚点或已登记成员仓库运行：
   ```bash
   openissue list --status all --json
   ```
   如果失败，说明当前仓库未接入；按错误提示请用户提供锚点，或使用 `--anchor <path>`。不要自行初始化一个错误的产品。
2. **查重**：从 JSON 中按标题与描述比对。发现高度相似项时，向用户说明原需求 id 与差异，询问是补充还是新建。
3. **整理描述**：用下面的结构，缺失的章节可省略，但不要捏造：
   ```markdown
   ## 现象

   ## 证据

   ## 期望

   ## 待确认
   ```
4. **创建**：
   ```bash
   openissue create "<标题>" --description "<描述>" --json
   ```
   描述较长时先写入临时文件再通过 shell 传入；不要把引号或换行拼坏。
5. **确认落盘**：从 JSON 读取 `id`、`path` 与 `issue.status`，必要时运行：
   ```bash
   openissue show <id> --json
   ```
6. **收尾**：报告需求 id、标题与保存路径；说明它默认进入未评估队列。可以建议下一步做 triage，但不要自行设置优先级或创建提案。

## Output

```text
已捕获 OI-YYYYMMDD-XXXX：<标题>
路径：openissue/issues/OI-YYYYMMDD-XXXX.md
状态：打开（未评估）
下一步：需要时运行 openissue priority 或 openissue board 审阅。
```
