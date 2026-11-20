---
name: openissue-onboard
description: 在 workspace、单仓或全新项目中初始化 OpenIssue、发现锚点与成员并安装配套 skills。用于第一次接入产品或补齐安装。
allowed-tools: Bash(openissue:*)
license: MIT
compatibility: Requires openissue CLI.
metadata:
  author: openissue
  version: "1.0"
---

# OpenIssue Onboarding

把 OpenIssue 接入一个产品、workspace 或成员仓库。只做接入与安装，不在本流程中创建需求或实现代码。

## Steps

1. **判断入口**：先确认用户当前是哪种环境：
   - 多仓 workspace：根目录下已有或即将有 spec/issue 锚点与代码仓；
   - 单 Git 仓：当前目录是仓根，没有子仓库；
   - 全新项目：空 workspace，需要同时创建代码仓与 spec 仓。
2. **接入既有 workspace**：在 workspace 根运行：
   ```bash
   openissue init
   ```
   - 系统只扫描直接子目录。已有 `openissue/product.yaml` 的仓，以及含完整 `openspec/specs` / `openspec/changes` 的规范仓，是锚点候选。
   - 只有 `openspec/config.yaml` store 指针的代码仓不是锚点。
   - 唯一候选自动复用；多个候选必须用 `--anchor <path>` 明确选择。
   - 让用户确认锚点与成员候选。store 指针匹配的成员预选，其他直接子 Git 仓可选，已归属其他产品的仓标记冲突且默认不选。
   - 确认后生成 `.openissue-workspace.yaml`、根 `.agents/skills` 与带 `OPENISSUE` 标记的根 `AGENTS.md` 索引。
3. **接入单 Git 仓**：在仓根运行：
   ```bash
   openissue init --id <product-id> --name "<产品名>"
   ```
   当前仓原地成为锚点，不创建嵌套仓库、workspace 指针或根索引。若在仓内子目录运行，先回到仓根，不要猜测。
4. **创建全新项目**：在空 workspace 运行：
   ```bash
   openissue init --new --name "<英文项目名>"
   ```
   - 项目名必须是英文；确认最终 id 与目录名 `<id>/`、`<id>-spec/` 后再继续。
   - 两个仓库分别 `git init`，不自动提交，不生成技术栈脚手架。
5. **处理 OpenSpec**：已有完整 OpenSpec 时直接复用；缺少时询问用户是否补初始化。脚本内可用 `--openspec` 或 `--no-openspec`。OpenSpec CLI 不可用或失败时保留已创建内容，并明确告诉用户尚未就绪。
6. **安装或补齐 skills**：`init` 默认安装全部随包 skills 到 workspace 根 `.agents/skills`；`--skills none` 跳过。其他工具目录不要通过 `init` 写入，改用：
   ```bash
   openissue skills install --tool agents,claude
   ```
   已安装但被修改的文件不要用 `--force` 静默覆盖，先向用户确认。
7. **验证**：
   ```bash
   openissue list --json
   openissue skills status --json
   ```
   从 workspace 根能读到锚点产品、`status` 显示 `current` 即完成。
8. **可选看板**：需要人工审阅时运行 `openissue board`，只绑定本机 `127.0.0.1`。

## Failure handling

- 任一步骤失败都不要删除已有仓库、OpenIssue 数据或 OpenSpec 数据；按命令输出的成功/失败阶段说明原因。
- 指针失效时使用 `openissue init --rescan` 或 `--anchor <path>` 明确修复，不要静默改选。
- 新项目中断后用相同 `--new --name "<名称>" --yes` 重试；有效目录、产品、成员与 skills 应幂等复用。
- 只有用户明确要求时才清理本次创建内容。

## Boundaries

- 不创建示例需求，除非用户明确要求。
- 不修改代码仓库的业务文件；只允许创建 `openissue-project.yaml`、最小 README/AGENTS 与 skills 目录。
- 不提交 Git；由用户决定提交范围与信息。
- 手动 `openissue register` 会跳过 workspace 锚点/成员发现，只在补登记或用户明确要求时使用。
- 多产品归属时，后续命令必须显式使用 `--product <id>`；不要猜测。

## Output

说明入口类型、锚点路径、产品 id、已登记成员、OpenSpec 是否就绪、已安装 skills 目录，以及下一步可运行的捕获或看板命令。
