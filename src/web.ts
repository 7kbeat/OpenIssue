import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startBoard } from './board/server.js';
import type { Issue } from './core/types.js';
import { issueFilePath, writeIssue } from './storage/issue.js';
import { initProduct, productExists, readProduct, updateFocus } from './storage/product.js';
import { resolveWorkspace } from './storage/workspace.js';

async function ensureBoardContext() {
  const resolved = await resolveWorkspace(process.cwd());
  if (resolved.kind === 'anchor' || resolved.kind === 'member') {
    return {
      anchorRoot: resolved.anchorRoot,
      productDir: path.join(resolved.anchorRoot, 'openissue'),
      product: resolved.product,
      ...(resolved.kind === 'member' ? { memberRoot: resolved.memberRoot } : {}),
    };
  }

  const demoRoot = path.join(os.tmpdir(), 'openissue-board-workspace');
  const productDir = path.join(demoRoot, 'openissue');
  if (!(await productExists(demoRoot))) {
    await initProduct(demoRoot, 'openissue', 'OpenIssue');
    await updateFocus(demoRoot, '完善需求收件箱与 OpenSpec 决策访谈工作流');

    const changeDir = path.join(demoRoot, 'openspec', 'changes', 'interview-draft');
    await mkdir(changeDir, { recursive: true });
    await writeFile(
      path.join(changeDir, '.openspec.yaml'),
      [
        'schema: spec-driven',
        'created: 2026-01-01',
        'x-openissue-interview:',
        '  status: incomplete',
        '  issue: OI-20260101-HIGH',
        '  started_at: 2026-01-02T00:00:00.000Z',
        '  updated_at: 2026-01-02T00:00:00.000Z',
        '',
      ].join('\n'),
      'utf8',
    );
    await writeFile(path.join(changeDir, 'proposal.md'), '# 需求优先级与访谈草稿\n', 'utf8');

    const now = '2026-01-02T00:00:00.000Z';
    const seedIssues: Issue[] = [
      {
        id: 'OI-20260101-HIGH',
        title: '接入第三方账单与权限校验',
        description: '需要先确认鉴权方式，并补充 OpenSpec 决策记录。',
        status: 'open',
        product: 'openissue',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: now,
        author: 'OpenIssue',
        source: 'cli',
        blocked_by: [],
        proposals: [
          {
            id: 'interview-draft',
            path: 'openspec/changes/interview-draft',
            created_at: '2026-01-01T00:00:00.000Z',
            snapshot_hash: 'demo-hash',
          },
        ],
        priority: {
          manual_tier: 'high',
          manual_at: now,
        },
        filePath: issueFilePath(productDir, 'OI-20260101-HIGH'),
        rawFrontmatter: {},
      },
      {
        id: 'OI-20260101-BASE',
        title: '统一仓库指针解析与错误提示',
        description: '确保多仓库工作区下路径解析和冲突提示保持一致。',
        status: 'open',
        product: 'openissue',
        created_at: '2026-01-01T01:00:00.000Z',
        updated_at: now,
        author: 'OpenIssue',
        source: 'cli',
        blocked_by: [],
        proposals: [],
        priority: {
          tier: 'medium',
          reason: '支撑下游需求顺利推进',
          basis: ['dependency'],
          judged_at: now,
          source: 'rule',
        },
        filePath: issueFilePath(productDir, 'OI-20260101-BASE'),
        rawFrontmatter: {},
      },
      {
        id: 'OI-20260101-BLCK',
        title: '支持多产品成员仓库快速切换',
        description: '在成员仓库归属多个产品时提供交互式筛选。',
        status: 'open',
        product: 'openissue',
        created_at: '2026-01-01T02:00:00.000Z',
        updated_at: now,
        author: 'OpenIssue',
        source: 'cli',
        blocked_by: ['OI-20260101-BASE'],
        proposals: [],
        priority: {
          manual_tier: 'medium',
          manual_at: now,
        },
        filePath: issueFilePath(productDir, 'OI-20260101-BLCK'),
        rawFrontmatter: {},
      },
      {
        id: 'OI-20260101-LOWW',
        title: '为 CLI 输出补充摘要统计信息',
        description: '在 list 命令末尾展示各状态计数。',
        status: 'open',
        product: 'openissue',
        created_at: '2026-01-01T03:00:00.000Z',
        updated_at: now,
        author: 'OpenIssue',
        source: 'cli',
        blocked_by: [],
        proposals: [],
        priority: {
          manual_tier: 'low',
          manual_at: now,
        },
        filePath: issueFilePath(productDir, 'OI-20260101-LOWW'),
        rawFrontmatter: {},
      },
      {
        id: 'OI-20260101-NONE',
        title: '探索看板快捷键与键盘导航',
        description: '待通过 prioritize 助手评估或手动设定档位。',
        status: 'open',
        product: 'openissue',
        created_at: '2026-01-01T04:00:00.000Z',
        updated_at: now,
        author: 'OpenIssue',
        source: 'cli',
        blocked_by: [],
        proposals: [],
        priority: {},
        filePath: issueFilePath(productDir, 'OI-20260101-NONE'),
        rawFrontmatter: {},
      },
      {
        id: 'OI-20260101-DONE',
        title: '建立 Git 原生需求 Markdown 存储规范',
        description: '使用 YAML frontmatter + Markdown 正文与原子写入。',
        status: 'closed',
        product: 'openissue',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        author: 'OpenIssue',
        source: 'cli',
        close: {
          reason: 'completed',
          closed_at: '2026-01-02T00:00:00.000Z',
        },
        blocked_by: [],
        proposals: [],
        priority: {},
        filePath: issueFilePath(productDir, 'OI-20260101-DONE'),
        rawFrontmatter: {},
      },
    ];

    for (const issue of seedIssues) {
      await writeIssue(productDir, issue);
    }
  }

  return {
    anchorRoot: demoRoot,
    productDir,
    product: await readProduct(demoRoot),
  };
}

const rawPort = Number(process.env.PORT ?? 3000);
const port = Number.isInteger(rawPort) && rawPort > 0 && rawPort <= 65535 ? rawPort : 3000;
const context = await ensureBoardContext();
const board = await startBoard({
  context,
  port,
  host: '0.0.0.0',
});

console.log(`OpenIssue board listening on http://0.0.0.0:${port}/`);

const stop = () => {
  void board.close().finally(() => process.exit(0));
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
