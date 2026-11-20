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
  await expect(high.getByTestId('issue-proposals')).toContainText('在途');

  const blocked = card(page, 'OI-20260101-BLOCK');
  await expect(blocked.getByTestId('blocked-badge')).toBeVisible();
  await expect(blocked.getByTestId('issue-waiting')).toContainText('OI-20260101-BASE');
  await expect(card(page, 'OI-20260101-BASE').getByTestId('floor-badge')).toBeVisible();

  await expect(page.getByTestId('archived-prompt')).toBeVisible();
  await expect(page.getByTestId('invalid-link-badge')).toBeVisible();
  await expect(page.getByTestId('conflict-item')).toHaveCount(1);
  await expect(page.getByTestId('conflict-raw')).toContainText('broken');

  await expect(page.locator('input[name="title"]')).toHaveCount(0);
  await expect(page.locator('textarea[name="description"]')).toHaveCount(0);
  await expect(page.getByTestId('create-button')).toHaveCount(0);
  await expect(high.getByTestId('issue-meta')).toContainText('作者');
});

test('adjusts tier, closes and reopens, and edits focus', async ({ page }) => {
  await page.goto(board.url);

  const low = card(page, 'OI-20260101-LOW');
  await low.getByTestId('tier-select').selectOption('high');
  await low.getByTestId('tier-save').click();
  await page.waitForLoadState('networkidle');
  await expect(card(page, 'OI-20260101-LOW')).toBeVisible();
  await expect(
    page.locator('[data-testid="group-high"] [data-issue-id="OI-20260101-LOW"]'),
  ).toBeVisible();

  const medium = card(page, 'OI-20260101-MED');
  await medium.getByTestId('close-reason').selectOption('completed');
  await medium.getByTestId('close-button').click();
  await page.waitForLoadState('networkidle');
  await expect(card(page, 'OI-20260101-MED')).toHaveCount(0);

  await page.getByTestId('status-filter').selectOption('closed');
  await page.getByRole('button', { name: '筛选' }).click();
  await page.waitForLoadState('networkidle');
  const closed = page.locator('[data-testid="closed-issue"][data-issue-id="OI-20260101-MED"]');
  await expect(closed).toContainText('关闭 · 已完成');
  await closed.getByTestId('reopen-button').click();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('status-filter').selectOption('open');
  await page.getByRole('button', { name: '筛选' }).click();
  await page.waitForLoadState('networkidle');
  await expect(card(page, 'OI-20260101-MED')).toBeVisible();

  await page.getByTestId('focus-input').fill('新的当前重点');
  await page.getByTestId('focus-save').click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('focus-input')).toHaveValue('新的当前重点');
});

test('searches and combines filters without hiding conflicts', async ({ page }) => {
  await page.goto(board.url);
  await page.getByTestId('search-input').fill('alpha');
  await page.getByRole('button', { name: '筛选' }).click();
  await page.waitForLoadState('networkidle');
  await expect(card(page, 'OI-20260101-HIGH')).toBeVisible();
  await expect(card(page, 'OI-20260101-MED')).toHaveCount(0);
  await expect(page.getByTestId('conflicts')).toBeVisible();
  await expect(page.getByTestId('conflict-raw')).toContainText('broken');

  await page.getByTestId('clear-filters').click();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('search-input').fill('账单');
  await page.getByRole('button', { name: '筛选' }).click();
  await page.waitForLoadState('networkidle');
  await expect(card(page, 'OI-20260101-HIGH')).toBeVisible();

  await page.getByTestId('clear-filters').click();
  await page.getByTestId('search-input').fill('Closed Gamma');
  await page.getByRole('button', { name: '筛选' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('empty-state')).toBeVisible();
  await expect(page.getByTestId('conflicts')).toBeVisible();

  await page.getByTestId('status-filter').selectOption('all');
  await page.getByRole('button', { name: '筛选' }).click();
  await page.waitForLoadState('networkidle');
  await expect(page.getByTestId('closed-section')).toContainText('Closed Gamma');
  await expect(page.getByTestId('closed-section')).toContainText('已完成');

  await page.getByTestId('clear-filters').click();
  await page.getByTestId('tier-filter').selectOption('high');
  await page.getByTestId('linked-filter').selectOption('yes');
  await page.getByRole('button', { name: '筛选' }).click();
  await page.waitForLoadState('networkidle');
  await expect(card(page, 'OI-20260101-HIGH')).toBeVisible();
  await expect(card(page, 'OI-20260101-MED')).toHaveCount(0);

  await page.getByTestId('clear-filters').click();
  await page.getByTestId('blocked-filter').selectOption('yes');
  await page.getByRole('button', { name: '筛选' }).click();
  await page.waitForLoadState('networkidle');
  await expect(card(page, 'OI-20260101-BLOCK')).toBeVisible();
  await expect(card(page, 'OI-20260101-BASE')).toHaveCount(0);
  await expect(card(page, 'OI-20260101-MED')).toHaveCount(0);
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
  const active = path.join(target.root, 'openspec', 'changes', 'linked-change');
  await mkdir(active, { recursive: true });
  await writeFile(
    path.join(active, '.openspec.yaml'),
    'schema: spec-driven\ncreated: 2026-01-01\n',
    'utf8',
  );
  await writeFile(path.join(active, 'proposal.md'), '# Linked\n', 'utf8');
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
    description: '账单接入',
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
