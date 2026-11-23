import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildInitPlan } from '../../src/services/init-plan.js';
import type { InitOptions } from '../../src/services/workspace-init.js';
import {
  createOpenspecSkeleton,
  createTempDir,
  runGit,
  type TempDir,
} from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

function options(cwd: string, overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    cwd,
    id: undefined,
    name: undefined,
    anchorPath: undefined,
    skills: [],
    newProject: undefined,
    yes: undefined,
    memberPaths: [],
    skipMembers: undefined,
    openspec: undefined,
    rescan: undefined,
    force: undefined,
    language: 'zh',
    interactive: false,
    ...overrides,
  };
}

async function anchor(root: string, id = 'demo'): Promise<void> {
  await mkdir(path.join(root, 'openissue', 'issues'), { recursive: true });
  await writeFile(
    path.join(root, 'openissue', 'product.yaml'),
    `id: ${id}\nname: ${id}\nfocus: ''\nfocus_updated_at: null\nmembers: []\n`,
    'utf8',
  );
  await createOpenspecSkeleton(root);
}

describe('init plan', () => {
  it('plans a new project without writing', async () => {
    const workspace = await createTempDir('openissue-plan-new-');
    cleanup.push(workspace);
    const plan = await buildInitPlan(
      options(workspace.root, { name: 'Demo Product', newProject: true, language: 'en' }),
    );
    expect(plan.mode).toBe('new-project');
    expect(plan.product).toEqual({ id: 'demo-product', name: 'Demo Product' });
    expect(plan.code_root).toBe(path.join(workspace.root, 'demo-product'));
    expect(plan.spec_root).toBe(path.join(workspace.root, 'demo-product-spec'));
    expect(plan.writes.some((item) => item.path.endsWith('README.md'))).toBe(true);
    expect(plan.openspec.needs_choice).toBe(true);
  });

  it('requires an anchor choice when multiple anchors exist', async () => {
    const workspace = await createTempDir('openissue-plan-multi-');
    cleanup.push(workspace);
    await anchor(path.join(workspace.root, 'one'), 'one');
    await anchor(path.join(workspace.root, 'two'), 'two');
    const plan = await buildInitPlan(options(workspace.root));
    expect(plan.requires_anchor_selection).toBe(true);
    expect(plan.anchors.map((item) => item.path).sort()).toEqual([
      path.join(workspace.root, 'one'),
      path.join(workspace.root, 'two'),
    ]);
    expect(plan.writes).toEqual([]);
  });

  it('plans a unique anchor with preselected members and writes', async () => {
    const workspace = await createTempDir('openissue-plan-one-');
    cleanup.push(workspace);
    await anchor(path.join(workspace.root, 'spec'));
    const member = path.join(workspace.root, 'code');
    await mkdir(member, { recursive: true });
    runGit(member, ['init']);

    const plan = await buildInitPlan(options(workspace.root, { language: 'en' }));
    expect(plan.mode).toBe('workspace');
    expect(plan.anchor_root).toBe(path.join(workspace.root, 'spec'));
    expect(plan.openspec.ready).toBe(true);
    expect(plan.members).toHaveLength(1);
    expect(plan.members[0]).toMatchObject({
      id: 'code',
      preselected: false,
      selected: false,
    });
    expect(plan.writes.some((item) => item.path.endsWith('openissue-project.yaml'))).toBe(false);
    expect(plan.mode_reason).toContain('Anchor found');
  });

  it('reports a blocked workspace with ordinary content', async () => {
    const workspace = await createTempDir('openissue-plan-blocked-');
    cleanup.push(workspace);
    await writeFile(path.join(workspace.root, 'notes.txt'), 'hello', 'utf8');
    const plan = await buildInitPlan(options(workspace.root));
    expect(plan.blocked_code).toBe('WORKSPACE_NOT_EMPTY');
    expect(plan.blocked_reason).toContain('普通内容');
    expect(plan.writes).toEqual([]);
  });
});
