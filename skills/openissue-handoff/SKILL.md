---
name: openissue-handoff
description: 把成熟需求交给 OpenSpec，创建或关联提案，并在归档后由用户确认完成。不伪造规范产物。
allowed-tools: Bash(openissue:*)
license: MIT
compatibility: Requires openissue CLI and OpenSpec CLI.
metadata:
  author: openissue
  version: "1.0"
---

# OpenIssue Handoff

当一条需求已经足够成熟、准备进入 OpenSpec 的规划流程时，建立需求与提案的关联。

## Preconditions

- 需求存在且为打开状态；先读：
  ```bash
  openissue show <id> --json
  ```
- 锚点仓库已初始化 OpenSpec；否则先请用户初始化，或只保留需求。
- 用户已明确要进入 OpenSpec；不要因为需求“看起来成熟”就自行交接。

## Create A Proposal

```bash
openissue handoff <id> --change <kebab-case-change-id> --yes
```

- `--change` 省略时按标题生成 ASCII 标识；中文标题可能回退到需求 id，使用 `--yes` 跳过回退确认。
- 创建只带入需求标题、描述与当前重点，不自动生成完整 spec、design 或 tasks。
- 需求保持打开；提案内容由 OpenSpec 的 propose/apply 流程继续完善。

## Link An Existing Proposal

```bash
openissue handoff <id> --link <existing-change-id>
```

不要复制或改写已有提案的内容。

## After Handoff

1. 用 OpenSpec 流程完成提案：
   ```bash
   openspec status --change <change-id> --json
   openspec instructions <artifact> --change <change-id> --json
   ```
   按 OpenSpec 返回的模板与规则创建产物；不要凭空补写需求没有的事实。
2. 提案归档后，检查所有关联提案是否都已归档：
   ```bash
   openissue show <id> --json
   ```
3. 只有用户明确确认需求已完成，才运行：
   ```bash
   openissue confirm <id>
   ```
   全部关联提案归档后该命令才会成功。
4. 不要用 `openissue close --reason completed` 代替 `confirm`；`confirm` 保留归档回流语义。若用户决定不做，使用：
   ```bash
   openissue close <id> --reason wontdo --note "<原因>"
   ```

## Boundaries

- 不伪造 OpenSpec 的 proposal、spec、design、tasks 或归档状态。
- 不自动关闭需求，不修改已有提案内容。
- 需求创建后如有修改，提案只显示“创建提案后有更新”的差异，不回写覆盖。
- 关联失效时先报告，不要猜测提案被删除或改名。

## Output

报告需求 id、提案 id、创建或关联结果、需求仍为打开状态，以及下一步应运行的 OpenSpec 命令。
