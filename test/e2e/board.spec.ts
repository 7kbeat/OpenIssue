import { test, expect, type Page } from '@playwright/test';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startBoard, type BoardServer } from '../../src/board/server.js';
import { contentHash } from '../../src/core/hash.js';
import { readProduct } from '../../src/storage/product.js';
import { createAnchor, issueFixture, type TempDir } from '../helpers/fixtures.js';

let anchor: TempDir;
let board: BoardServer;

test.beforeEach(async () => {
  anchor = await createAnchor({ id: 'demo', openspec: true, focus: '先跑通收件箱' });
  await seedBoard(anchor);
  board = await startBoard({
    context: {
      anchorRoot: anchor.root,
      productDir: path.join(anchor.root, 'openissue'),
      product: await readProduct(anchor.root),
    },
    port: 0,
  });
});

test.afterEach(async () => {
  await board.close();
  await anchor.cleanup();
});

test('renders groups, reasons, dependencies, links, and no capture controls', async ({ page }) => {
  await page.goto(board.url);
  for (const group of ['high', 'medium', 'low', 'unassessed']) {
    await expect(page.getByTestId(`group-${group}`)).toBeVisible();
  }
  const high = card(page, 'OI-20260101-HIGH');
  await expect(high).toContainText('Alpha Billing');
  await expect(high.getByTestId('issue-tier')).toHaveText('高');
  await expect(high.getByTestId('issue-reason')).toContainText('手动设定');
  await expect(high.getByTestId('manual-badge')).toBeVisible();
  await expect(high.getByTestId('snapshot-updated')).toBeVisible();
  await expect(high.getByTestId('issue-proposals')).toContainText('linked-change');
  await expect(high.getByTestId('issue-proposals')).toContainText('1/3');
  await expect(high.getByTestId('interview-badge')).toHaveText('访谈未完成');
  await expect(high.getByTestId('issue-meta')).toContainText('作者');
  await expect(high.getByTestId('issue-status')).toHaveText('打开');

  const blocked = card(page, 'OI-20260101-BLOCK');
  await expect(blocked.getByTestId('blocked-badge')).toBeVisible();
  await expect(blocked.getByTestId('issue-waiting')).toContainText('1 项');
  await expect(card(page, 'OI-20260101-BASE').getByTestId('floor-badge')).toBeVisible();
  await expect(card(page, 'OI-20260101-ARCH').getByTestId('archived-prompt')).toBeVisible();
  await expect(card(page, 'OI-20260101-INVALID').getByTestId('invalid-link-badge')).toBeVisible();

  await page.getByRole('button', { name: '查看详情与原文' }).click();
  await expect(page.getByTestId('conflict-item')).toHaveCount(1);
  await page.getByRole('button', { name: '查看原文' }).click();
  await expect(page.getByTestId('conflict-raw')).toContainText('broken');

  await high.getByTestId('issue-title').click();
  const inspector = page.getByTestId('issue-inspector');
  await expect(inspector).toBeVisible();
  const description = inspector.getByTestId('issue-description-markdown');
  await expect(description.getByRole('heading', { name: '背景' })).toBeVisible();
  await expect(description.locator('strong')).toHaveText('统一口径');
  await expect(description.locator('code').filter({ hasText: 'webhook' })).toBeVisible();
  await expect(description.locator('table')).toContainText('amount');
  await expect(description.locator('pre code')).toContainText('const amount = 100;');
  await expect(description.locator('input[type="checkbox"]')).toBeChecked();
  await expect(description.locator('blockquote')).toContainText('灰度验证');
  await expect(inspector.getByTestId('start-entry')).toBeVisible();
  await expect(inspector.getByTestId('start-context')).toContainText(
    '继续未完成草稿 linked-change',
  );
  await expect(inspector.getByTestId('start-context')).toContainText('结束访谈并生成任务');
  await expect(inspector).toContainText('查看完整字段（frontmatter / 派生字段）');
  await expect(inspector).toContainText('查看原始 Markdown 文件');
  await expect(inspector).toContainText('linked-change');

  await expect(page.locator('input[name="title"]')).toHaveCount(0);
  await expect(page.locator('textarea[name="description"]')).toHaveCount(0);
  await expect(page.getByTestId('create-button')).toHaveCount(0);

  await page.getByLabel('关闭详情抽屉').click();
  await writeFile(
    path.join(anchor.root, 'openspec', 'changes', 'linked-change', '.openspec.yaml'),
    'schema: spec-driven\ncreated: 2026-01-01\nx-openissue-interview:\n  status: completed\n  issue: OI-20260101-HIGH\n  started_at: 2026-01-02T00:00:00.000Z\n  updated_at: 2026-01-03T00:00:00.000Z\n  completed_at: 2026-01-03T00:00:00.000Z\n',
    'utf8',
  );
  await page.reload();
  await expect(high.getByTestId('interview-completed-badge')).toHaveText('访谈已完成');
  await expect(high.getByTestId('interview-badge')).toHaveCount(0);
  await high.getByTestId('issue-title').click();
  await expect(page.getByTestId('issue-inspector')).toContainText('已完成');
  await expect(page.getByTestId('start-context')).not.toContainText('继续未完成草稿 linked-change');
});

test('adjusts tier, closes and reopens, and edits focus', async ({ page }) => {
  await page.goto(board.url);

  const low = card(page, 'OI-20260101-LOW');
  await low.getByRole('button', { name: '高', exact: true }).click();
  await expect(
    page.locator('[data-testid="group-high"] [data-issue-id="OI-20260101-LOW"]'),
  ).toBeVisible();

  const medium = card(page, 'OI-20260101-MED');
  await medium.getByTestId('issue-title').click();
  await page.getByRole('button', { name: '关闭需求', exact: true }).click();
  await page.getByRole('radio', { name: '已完成' }).check();
  await page.getByRole('button', { name: '确认关闭' }).click();
  await expect(card(page, 'OI-20260101-MED')).toHaveCount(0);
  await page.getByLabel('关闭详情抽屉').click();

  await page.locator('[data-testid="status-filter"] [data-status="closed_only"]').click();
  await expect(page.getByTestId('closed-section')).toContainText('Medium Delta');
  await page
    .locator('[data-testid="closed-section"] [data-issue-id="OI-20260101-MED"]')
    .getByTestId('issue-title')
    .click();
  await page.getByRole('button', { name: '重新打开' }).click();
  await page.getByLabel('关闭详情抽屉').click();
  await page.locator('[data-testid="status-filter"] [data-status="open"]').click();
  await expect(card(page, 'OI-20260101-MED')).toBeVisible();

  await page.getByText('编辑重点', { exact: true }).click();
  const focus = page.getByTestId('focus-input');
  await focus.fill('新的当前重点');
  await page.getByTestId('focus-save').click();
  await expect(page.getByText('新的当前重点', { exact: true })).toBeVisible();
});

test('searches and combines filters without hiding conflicts', async ({ page }) => {
  await page.goto(board.url);
  await page.getByTestId('search-input').fill('alpha');
  await expect(card(page, 'OI-20260101-HIGH')).toBeVisible();
  await expect(card(page, 'OI-20260101-MED')).toHaveCount(0);
  await expect(page.getByTestId('conflicts')).toBeVisible();
  await page.getByRole('button', { name: '查看详情与原文' }).click();
  await page.getByRole('button', { name: '查看原文' }).click();
  await expect(page.getByTestId('conflict-raw')).toContainText('broken');

  await page.getByTestId('clear-filters').click();
  await page.getByTestId('search-input').fill('账单');
  await expect(card(page, 'OI-20260101-HIGH')).toBeVisible();

  await page.getByTestId('clear-filters').click();
  await page.getByTestId('search-input').fill('Closed Gamma');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('conflicts')).toBeVisible();

  await page.locator('[data-testid="status-filter"] [data-status="include_closed"]').click();
  await expect(page.getByTestId('closed-section')).toContainText('Closed Gamma');
  await expect(page.getByTestId('closed-section')).toContainText('已完成');

  await page.getByTestId('clear-filters').click();
  await page.getByRole('button', { name: '筛选', exact: true }).click();
  await page.getByTestId('tier-filter').selectOption('高');
  await page.getByTestId('linked-filter').selectOption('linked');
  await expect(card(page, 'OI-20260101-HIGH')).toBeVisible();
  await expect(card(page, 'OI-20260101-MED')).toHaveCount(0);

  await page.getByTestId('clear-filters').click();
  await page.getByTestId('blocked-filter').selectOption('blocked');
  await expect(card(page, 'OI-20260101-BLOCK')).toBeVisible();
  await expect(card(page, 'OI-20260101-BASE')).toHaveCount(0);
  await expect(card(page, 'OI-20260101-MED')).toHaveCount(0);
});

test('renders OpenSpec facts, workspace files, and the assistant protocol', async ({ page }) => {
  await page.goto(board.url);
  await page.getByRole('button', { name: 'OpenSpec 交接', exact: true }).click();
  await expect(page.getByTestId('active-proposal')).toContainText('linked-change');
  await expect(page.getByTestId('active-proposal')).toContainText('1/3');
  await expect(page.getByTestId('active-proposal')).toContainText('OI-20260101-HIGH');
  await expect(page.getByTestId('archived-proposal')).toContainText('archived-change');
  await expect(page.getByTestId('archived-proposal')).toContainText('归档于');
  await expect(page.getByText('workspace-spec', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '仓库与文件', exact: true }).click();
  await expect(page.getByText('工作区识别与仓库边界')).toBeVisible();
  await expect(page.getByText('查看完整工作区与产品字段')).toBeVisible();
  await expect(page.getByText('openissue/issues/OI-20260101-HIGH.md')).toBeVisible();
  await page.getByText('openissue/issues/OI-20260101-HIGH.md').click();
  await expect(page.locator('pre').filter({ hasText: 'Alpha Billing' })).toBeVisible();

  await page.getByRole('button', { name: '助手语义判断', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('request_hash');
  await page.getByRole('button', { name: '载入示例结果' }).click();
  await page.getByRole('button', { name: '校验并应用结果' }).click();
  await expect(dialog).toContainText('已更新');
});

test('stays single-user and exposes author and time', async ({ page }) => {
  await page.goto(board.url);
  const body = await page.locator('body').innerText();
  expect(body).not.toContain('负责人');
  expect(body).not.toContain('评论');
  expect(body).not.toContain('通知');
  expect(body).not.toContain('在线');
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('[data-testid*="comment"]')).toHaveCount(0);
  await expect(page.locator('[data-testid*="assignee"]')).toHaveCount(0);
  await expect(page.locator('[data-testid*="notification"]')).toHaveCount(0);
  await expect(page.getByTestId('group-high')).toBeVisible();
});

function card(page: Page, id: string) {
  return page.locator(`[data-testid="issue-card"][data-issue-id="${id}"]`);
}

async function seedBoard(target: TempDir): Promise<void> {
  const issuesDir = path.join(target.root, 'openissue', 'issues');
  const specDir = path.join(target.root, 'openspec', 'specs', 'workspace-spec');
  await mkdir(specDir, { recursive: true });
  await writeFile(
    path.join(specDir, 'spec.md'),
    '# 工作区规范\n\n成员仓库只保留指针。\n',
    'utf8',
  );
  const active = path.join(target.root, 'openspec', 'changes', 'linked-change');
  await mkdir(active, { recursive: true });
  await writeFile(
    path.join(active, '.openspec.yaml'),
    'schema: spec-driven\ncreated: 2026-01-01\nx-openissue-interview:\n  status: incomplete\n  issue: OI-20260101-HIGH\n  started_at: 2026-01-02T00:00:00.000Z\n  updated_at: 2026-01-02T00:00:00.000Z\n',
    'utf8',
  );
  await writeFile(path.join(active, 'proposal.md'), '# Linked\n\n提案正文\n', 'utf8');
  await writeFile(
    path.join(active, 'tasks.md'),
    '- [x] 1. done\n- [ ] 2. todo\n- [ ] 3. todo\n',
    'utf8',
  );
  const archived = path.join(target.root, 'openspec', 'changes', 'archived-change');
  await mkdir(archived, { recursive: true });
  await writeFile(
    path.join(archived, '.openspec.yaml'),
    'schema: spec-driven\ncreated: 2026-01-01\n',
    'utf8',
  );
  await writeFile(path.join(archived, 'proposal.md'), '# Archived\n', 'utf8');
  const archiveDir = path.join(target.root, 'openspec', 'changes', 'archive');
  await mkdir(archiveDir, { recursive: true });
  await rename(archived, path.join(archiveDir, '2026-01-01-archived-change'));

  await seedIssue(issuesDir, 'OI-20260101-HIGH', {
    title: 'Alpha Billing',
    description: [
      '## 背景',
      '',
      '账单接入需要**统一口径**，并支持 `webhook` 回调。',
      '',
      '- 对账字段保持一致',
      '- [x] 已确认回调签名',
      '',
      '| 字段 | 说明 |',
      '| --- | --- |',
      '| amount | 金额 |',
      '',
      '```ts',
      'const amount = 100;',
      '```',
      '',
      '> 注意：上线前需要完成灰度验证。',
    ].join('\n'),
    manual: 'high',
    proposals: [
      {
        id: 'linked-change',
        path: 'openspec/changes/linked-change',
        created_at: '2026-01-01T00:00:00.000Z',
        snapshot_hash: 'deadbeef',
      },
    ],
  });
  await seedIssue(issuesDir, 'OI-20260101-BASE', {
    title: 'Base prerequisite',
    manual: 'low',
  });
  await seedIssue(issuesDir, 'OI-20260101-BLOCK', {
    title: 'Blocked Beta',
    manual: 'high',
    blockedBy: ['OI-20260101-BASE'],
  });
  await seedIssue(issuesDir, 'OI-20260101-MED', {
    title: 'Medium Delta',
    manual: 'medium',
  });
  await seedIssue(issuesDir, 'OI-20260101-LOW', {
    title: 'Low Epsilon',
    manual: 'low',
  });
  await seedIssue(issuesDir, 'OI-20260101-NONE', {
    title: 'Unassessed Zeta',
  });
  await seedIssue(issuesDir, 'OI-20260101-STALE', {
    title: 'Stale Theta',
    manual: 'medium',
    cache: {
      tier: 'medium',
      reason: '旧判断',
      basis: ['focus'],
      input_hash: 'old-hash',
      judged_at: '2026-01-02T00:00:00.000Z',
      source: 'assistant',
    },
  });
  await seedIssue(issuesDir, 'OI-20260101-ARCH', {
    title: 'Archived Eta',
    manual: 'medium',
    proposals: [
      {
        id: 'archived-change',
        path: 'openspec/changes/archived-change',
        created_at: '2026-01-01T00:00:00.000Z',
        snapshot_hash: contentHash('Archived Eta', ''),
      },
    ],
  });
  await seedIssue(issuesDir, 'OI-20260101-INVALID', {
    title: 'Invalid Theta',
    manual: 'low',
    proposals: [
      {
        id: 'missing-change',
        path: 'openspec/changes/missing-change',
        created_at: '2026-01-01T00:00:00.000Z',
        snapshot_hash: contentHash('Invalid Theta', ''),
      },
    ],
  });
  await seedIssue(issuesDir, 'OI-20260101-CLOSED', {
    title: 'Closed Gamma',
    status: 'closed',
    close: { reason: 'completed', closed_at: '2026-01-03T00:00:00.000Z' },
  });
  await writeFile(
    path.join(issuesDir, 'broken.md'),
    '---\ntitle: [broken\n---\nraw conflict\n',
    'utf8',
  );
}

async function seedIssue(
  dir: string,
  id: string,
  options: {
    title: string;
    description?: string;
    manual?: 'high' | 'medium' | 'low';
    blockedBy?: string[];
    status?: 'open' | 'closed';
    close?: Record<string, unknown>;
    proposals?: Array<Record<string, unknown>>;
    cache?: Record<string, unknown>;
  },
): Promise<void> {
  const priority: Record<string, unknown> = {
    ...(options.cache ?? {}),
    ...(options.manual
      ? { manual_tier: options.manual, manual_at: '2026-01-02T00:00:00.000Z' }
      : {}),
  };
  await writeFile(
    path.join(dir, `${id}.md`),
    issueFixture(
      {
        id,
        title: options.title,
        status: options.status ?? 'open',
        product: 'demo',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        author: '测试作者',
        source: 'cli',
        blocked_by: options.blockedBy ?? [],
        proposals: options.proposals ?? [],
        ...(options.close ? { close: options.close } : {}),
        priority,
      },
      options.description ?? '',
    ),
    'utf8',
  );
}
