---
name: openissue-onboard
description: 在仓库中初始化 OpenIssue、登记成员仓库并安装配套 skills。用于第一次接入产品或补齐安装。
allowed-tools: Bash(openissue:*)
license: MIT
compatibility: Requires openissue CLI.
metadata:
  author: openissue
  version: "1.0"
---

# OpenIssue Onboarding

把 OpenIssue 接入一个产品或成员仓库。只做接入与安装，不在本流程中创建需求或实现代码。

## Steps

1. **确认锚点**：产品的需求只存在一个 spec/issue 锚点仓库。问用户哪个仓库是锚点；不要把成员代码仓库当作锚点。
2. **初始化锚点**（仅当 `openissue/product.yaml` 不存在）：
   ```bash
   openissue init --id <product-id> --name "<产品名>" --skills agents
   ```
   - `product-id` 使用小写字母、数字与连字符。
   - 已有锚点时不要重复初始化；直接进入下一步。
   - 不需要 skills 时可省略 `--skills`，之后单独安装。
3. **登记成员仓库**：在每个成员仓库根目录运行：
   ```bash
   openissue register --anchor <锚点路径> --name "<成员名>"
   ```
   成员仓库只得到 `openissue-project.yaml` 指针，不复制需求。
4. **安装或补齐 skills**：在需要助手读取 skills 的仓库根目录运行：
   ```bash
   openissue skills install --tool agents,claude
   ```
   目标目录见 `openissue skills list`；已安装但被修改的文件不要用 `--force` 静默覆盖，先向用户确认。
5. **验证**：
   ```bash
   openissue list --json
   openissue skills status --json
   ```
   `list` 能读到锚点产品、`status` 显示 `current` 即完成。
6. **可选看板**：需要人工审阅时运行 `openissue board`，只绑定本机 `127.0.0.1`。

## Boundaries

- 不创建示例需求，除非用户明确要求。
- 不修改代码仓库的业务文件；只允许创建 `openissue-product.yaml` 与 skills 目录。
- 不提交 Git；由用户决定提交范围与信息。
- 多产品归属时，后续命令必须显式使用 `--product <id>`；不要猜测。

## Output

说明锚点路径、产品 id、已登记成员、已安装 skills 目录，以及下一步可运行的捕获或看板命令。
