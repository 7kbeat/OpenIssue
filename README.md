# OpenIssue

Git 原生的需求收件箱，面向产品工程师。它接住那些“值得做、现在做不了、也还写不出 spec”的想法；等想法成熟后，再交给 OpenSpec。

需求只保存一份：在产品锚点仓库的 `openissue/issues/` 中。成员代码仓库只保存 `openissue-project.yaml` 指针，不保存副本。GitHub Issues 不在实现范围。

## 环境

- Node.js >= 22
- pnpm >= 10
- 可选：OpenSpec CLI（`openspec` 1.10+，交接功能需要）

## 安装与开发

```bash
pnpm install
pnpm build
pnpm test
node dist/cli.js --version
```

如果要在当前 shell 中直接使用 `openissue`：

```bash
pnpm link --global
openissue --version
```

端到端验证：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
pnpm e2e:product
```

`pnpm e2e:product` 会在临时目录创建“锚点 + 两个成员仓库”的完整产品，走通捕获、优先级、依赖、OpenSpec 交接与归档确认。

## 配套 Agent skills

OpenIssue 随包提供五份 Agent workflow skills：

- `openissue-onboard`：初始化产品、登记成员仓库、安装 skills；
- `openissue-capture`：把想法或 bug 捕获为需求，只记录不实现；
- `openissue-triage`：按项目事实、依赖与手动覆盖审阅优先级；
- `openissue-grill-me`：从成熟需求开始产品决策访谈，自动创建提案草稿并增量写入 proposal/specs/design；用户明确结束访谈后才生成 TDD tasks；
- `openissue-handoff`：重新关联已有提案，并在全部关联提案归档后由用户确认完成。

查看并安装：

```bash
openissue skills list
openissue skills install                          # 默认 .agents/skills
openissue skills install --tool claude,opencode   # 指定工具
openissue skills install --tool all               # 所有受支持目录
```

支持 `agents`、`claude`、`opencode`、`cursor`、`github-copilot`、`qwen`、`gemini`、`trae`、`oh-my-pi`；`codex` 是 `agents` 的别名。只做项目内安装，不写用户主目录。

已安装的 skill 用 `.openissue-skills.json` 记录内容哈希。再次安装不会覆盖用户修改；确认要覆盖时显式使用 `--force`。检查与升级：

```bash
openissue skills status
openissue skills update
```

`status` 只读显示 `缺失`、`已安装`、`待更新`、`已修改`、`未托管`。`update` 只更新未修改的托管副本；未指定 `--tool` 时只处理已检测到的目录。`init` 也可以一步安装：

```bash
openissue init --id demo --name "Demo 产品" --skills agents
openissue init --id demo --name "Demo 产品" --skills none   # 明确跳过
```

未提供 `--skills` 时，`init` 只初始化产品并提示后续安装。skills 随 npm 包分发；`pnpm pack` 可用于检查打包内容。

## 数据布局

```text
<锚点仓库>/
  openissue/
    product.yaml            # 产品 id、名称、当前重点、成员列表
    issues/
      OI-YYYYMMDD-XXXX.md   # YAML frontmatter + Markdown 描述
  openspec/                 # 可选的规范/提案区
```

成员仓库：

```yaml
products:
  - id: demo
    anchor: ../demo-anchor
```

本机注册表默认在 `~/.openissue/registry.yaml`；可用 `OPENISSUE_HOME` 覆盖。

## 快速开始

### 1. 初始化锚点

在产品的 spec/issue 仓库根目录：

```bash
openissue init --id demo --name "Demo 产品"
```

这会创建 `openissue/product.yaml` 与 `openissue/issues/`，并把锚点登记到本机注册表。

### 2. 登记成员仓库

在每个成员代码仓库根目录：

```bash
openissue register --anchor ../demo-anchor
```

锚点的 `product.yaml` 会记录成员；成员仓库只得到 `openissue-project.yaml`。一个仓库登记到多个产品时，后续命令必须用 `--product <id>` 明确选择。

### 3. 捕获需求

```bash
openissue create "接入第三方账单"
openissue create "接入第三方账单" --description "需要先确认鉴权方式"
```

只有标题是必填的。所属产品、创建时间、作者与来源由系统自动记录；来源为命令行。

### 4. 查看与编辑

```bash
openissue list
openissue list --status closed
openissue list --status all
openissue show OI-20261120-ABCD
openissue edit OI-20261120-ABCD --title "新的标题"
openissue edit OI-20261120-ABCD --description "补充后的描述"
openissue edit OI-20261120-ABCD --description ""
```

默认只显示打开项。关闭项需要显式筛选。

### 5. 当前重点

```bash
openissue focus "先跑通需求收件箱"
openissue focus
openissue focus --clear
```

当前重点是可选的一句话；设置后助手判断可以引用它，留空时只使用项目事实。`focus` 会显示最后更新时间。

### 6. 优先级

```bash
openissue priority
openissue priority --json
```

输出按高、中、低、待评估分组，并显示每条需求的理由、依赖与手动/待刷新标记。

规则立即生效：关闭项排除、依赖失效、依赖下限、手动档位、助手判断。没有助手结果时，需要语义判断的需求显示“待评估”，不会被默认归入某一档。

手动设定与恢复：

```bash
openissue tier OI-20261120-ABCD high
openissue tier OI-20261120-ABCD medium
openissue tier OI-20261120-ABCD auto
```

手动值会保留；依赖下限或失效依赖可以覆盖有效档位，约束解除后手动值恢复。

### 7. 助手判断

```bash
openissue prioritize --emit > priority-request.json
openissue prioritize --apply priority-response.json
```

`--emit` 只输出打开需求、当前重点、规范/提案/任务进度与输入哈希；不包含关闭项，也不要求模型账号或密钥。助手返回的格式：

```json
{
  "version": 1,
  "results": [
    {
      "id": "OI-20261120-ABCD",
      "tier": "high",
      "reason": "当前重点要求先完成账单接入",
      "basis": ["focus"],
      "order": 0,
      "input_hash": "从请求中原样带回"
    }
  ]
}
```

`--apply` 会校验档位、理由、依据与 `input_hash`，按需求隔离错误。部分结果有效时，只写入有效项；其余保持原状态或“待评估”。输入已变化的结果会被拒绝，需要重新 `--emit`。

### 8. 依赖

```bash
openissue depend OI-20261120-AAAA OI-20261120-BBBB
openissue undepend OI-20261120-AAAA OI-20261120-BBBB
```

第一条阻塞第二条。只支持这一种显式关系，不自动推断；循环会被拒绝且不写入。前置为“已完成”时解除阻塞；前置为“不做”时下游进入“待评估”，直到移除或替换依赖。

### 9. 关闭与重新打开

```bash
openissue close OI-20261120-ABCD --reason completed
openissue close OI-20261120-ABCD --reason wontdo --note "方向已调整"
openissue reopen OI-20261120-ABCD
```

关闭必须选择“已完成”或“不做”；“不做”必须填写原因。重新打开会保留原关闭原因。没有永久删除入口。

关闭已关联提案的需求时，界面会说明提案不会因此取消或改变。

### 10. 交给 OpenSpec

从需求开始产品决策访谈：

```bash
openissue start OI-20261120-ABCD
openissue start OI-20261120-ABCD --json
```

`start` 只输出需求上下文与可交给 Agent 的启动指令，不创建提案、不改需求。把输出交给 Agent 后，`openissue-grill-me` 会：

1. 用 `openspec new change` 创建提案草稿；
2. 用 `openissue handoff <id> --link <change> --from-interview` 建立关联并写入 `x-openissue-issues` 与 `x-openissue-interview`；
3. 每确认一项决策就增量写入 proposal、specs 或 design；
4. 只有用户明确说“结束访谈并生成任务”后才写 tasks，生成后停止。

需求保持打开；访谈未完成会同时显示在需求与草稿上。再次运行 `start` 会继续同一草稿；丢弃草稿必须二次确认：

```bash
openissue start OI-20261120-ABCD --discard <change-id> --yes
```

`handoff --change` 不再直接创建提案，会提示改用 `start`。只有重新关联已有活跃提案时仍使用：

```bash
openissue handoff OI-20261120-ABCD --link existing-change
```

该路径会明确提示跳过了产品决策访谈。关联时只新增关联信息，不复制或改写提案内容。

当全部关联提案归档后：

```bash
openissue confirm OI-20261120-ABCD
```

只有用户确认才会关闭为“已完成”；系统不会自动关闭。部分归档、已关闭需求或关联失效时不会出现完成提示。

### 11. 本地看板

```bash
openissue board
openissue board --port 4310 --no-open
```

看板只绑定 `127.0.0.1`，与命令行读写同一份数据。可以：

- 按高/中/低/待评估查看，看到理由、依赖、提案与手动/待刷新标记；
- 调整档位、关闭或重新打开；
- 编辑当前重点；
- 按标题/描述搜索，并按状态、档位、关联提案、阻塞状态组合筛选；
- 处理关联失效、归档确认与冲突记录。

看板不提供创建需求或编辑标题/描述的入口；捕获由命令行负责。看板也没有账号、负责人、评论、通知或实时协作。

## 冲突与损坏记录

无法解析的 frontmatter（包括 Git 合并冲突）不会让看板崩溃。它会在独立的“需要处理的记录”区域显示文件名、错误与原始内容，且不受搜索/筛选隐藏。

处理方式：

1. 打开对应文件，修复 YAML 或解决 Git 冲突；
2. 保留未知 frontmatter 字段；
3. 保存后刷新看板。

OpenIssue 不会自动修复或丢弃无法解析的记录。

## 故障排查

**`当前目录不是 OpenIssue 锚点仓库`**  
在锚点根目录运行 `openissue init`，或用 `--anchor <path>` 指向锚点。

**`当前仓库尚未归属任何产品`**  
在成员仓库运行 `openissue register --anchor <锚点路径>`。

**`当前仓库属于多个产品`**  
用 `--product <id>` 选择当前产品；未选择前不会读取或写入任何产品的需求。

**`找不到产品锚点`**  
确认锚点已克隆，并已在本机注册；运行一次锚点内的 `openissue init` 或成员仓库的 `openissue register`。

**`OpenSpec 命令失败` / `锚点仓库尚未初始化 OpenSpec`**  
在锚点运行 `openspec init`，确认 `openspec --version` 可用。OpenSpec 未初始化不影响捕获、优先级与看板。

**`需求在读取后被外部修改`**  
文件已被其他进程或 Git 操作改写。刷新后重试；看板会提示保存失败，不会覆盖原记录。

**`输入已变化，请重新生成判断请求`**  
生成 `--emit` 后需求或项目事实发生了变化。重新生成请求，再让助手判断。

**`关联失效`**  
提案既不在活跃变更也不在归档区。用看板的“重新关联”或 `openissue handoff <id> --link <change>`；也可以按正常流程手动关闭需求。

**`检测到未托管或已修改的 skills 文件`**  
安装或更新发现目标文件不是 OpenIssue 上次写入的版本。先确认差异；确实要覆盖时使用 `openissue skills install --force` 或 `openissue skills update --force`。

**`尚未安装配套 skills`**  
先运行 `openissue skills install`，或用 `--tool <目标>` 指定要安装/更新的目录。`openissue start` 需要已安装 `openissue-grill-me`；缺失时会提示安装或更新。

**`handoff 不再直接创建提案`**  
使用 `openissue start <id>` 进入产品决策访谈。`handoff --change` 已被拒绝；只有重新关联已有提案才使用 `handoff --link`。

**`访谈未完成`**  
需求已关联一个访谈草稿，但尚未生成 tasks。运行 `openissue start <id>` 继续同一草稿；需要放弃时使用 `--discard <change-id> --yes`，执行前会要求二次确认。

**看板端口被占用**  
换一个端口：`openissue board --port 4311`。启动失败不会影响命令行。

**中文标题无法生成变更标识**  
OpenSpec 1.10 只接受小写字母、数字与连字符。OpenIssue 会回退到需求标识；可用 `--change <id>` 指定自定义标识。

## 设计边界

- 单用户；共享与并发由 Git 承担。
- 没有账号、负责人、评论、通知、在线状态或实时协作。
- 没有标签、里程碑、附件、自定义字段。
- 不读取、不写入、不同步 GitHub Issues。
- 一条需求一个 Markdown 文件；写入使用原子替换。
