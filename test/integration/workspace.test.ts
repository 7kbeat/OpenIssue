import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import {
  createAnchor,
  createMember,
  createTempDir,
  issueFixture,
  runCli,
  runGit,
  writeTestRegistry,
  type TempDir,
} from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

async function seed(anchor: TempDir, id = 'OI-20260101-AAAA', productId = 'demo'): Promise<void> {
  await writeFile(
    path.join(anchor.root, 'openissue', 'issues', `${id}.md`),
    issueFixture(
      {
        id,
        title: '锚点中的需求',
        status: 'open',
        product: productId,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        author: '测试作者',
        source: 'cli',
      },
      '描述',
    ),
    'utf8',
  );
}

describe('product workspace', () => {
  it('creates and reads in the anchor without copying into member repos', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    const member = await createMember([{ id: 'demo', anchor: anchor.root }]);
    cleanup.push(anchor, member);
    const home = path.join(anchor.root, '.home');
    await writeTestRegistry(home, { demo: { anchor_path: anchor.root } });
    await seed(anchor);

    const listed = runCli(['list', '--json'], {
      cwd: member.root,
      env: { OPENISSUE_HOME: home, OPENISSUE_AUTHOR: '测试作者' },
    });
    expect(listed.status, listed.stderr).toBe(0);
    const parsed = JSON.parse(listed.stdout) as { issues: Array<{ id: string }> };
    expect(parsed.issues.map((item) => item.id)).toEqual(['OI-20260101-AAAA']);

    const created = runCli(['create', '从成员捕获'], {
      cwd: member.root,
      env: { OPENISSUE_HOME: home, OPENISSUE_AUTHOR: '测试作者' },
    });
    expect(created.status, created.stderr).toBe(0);
    expect(await readdir(path.join(anchor.root, 'openissue', 'issues'))).toHaveLength(2);
    await expect(access(path.join(member.root, 'openissue'))).rejects.toThrow();
  });

  it('registers a repository into an anchor product', async () => {
    const anchor = await createAnchor({ id: 'demo', name: 'Demo' });
    const repo = await createTempDir('openissue-member-');
    cleanup.push(anchor, repo);
    await mkdir(path.join(repo.root, '.git'));
    const home = path.join(anchor.root, '.home');

    const result = runCli(
      ['register', '--product', 'demo', '--anchor', anchor.root],
      { cwd: repo.root, env: { OPENISSUE_HOME: home } },
    );
    expect(result.status, result.stderr).toBe(0);
    const pointer = YAML.parse(
      await readFile(path.join(repo.root, 'openissue-project.yaml'), 'utf8'),
    ) as { products: Array<{ id: string }> };
    expect(pointer.products[0]!.id).toBe('demo');
    const product = YAML.parse(
      await readFile(path.join(anchor.root, 'openissue', 'product.yaml'), 'utf8'),
    ) as { members: Array<{ id: string }> };
    expect(product.members.some((item) => item.id === path.basename(repo.root))).toBe(true);
  });

  it('shows an unregistered state and creates no local storage', async () => {
    const repo = await createTempDir('openissue-unregistered-');
    cleanup.push(repo);
    runGit(repo.root, ['init']);
    const result = runCli(['list', '--json'], {
      cwd: repo.root,
      env: { OPENISSUE_HOME: path.join(repo.root, '.home') },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('尚未归属');
    await expect(access(path.join(repo.root, 'openissue'))).rejects.toThrow();
  });

  it('requires explicit product selection when a repo belongs to multiple products', async () => {
    const alpha = await createAnchor({ id: 'alpha', name: 'Alpha' });
    const beta = await createAnchor({ id: 'beta', name: 'Beta' });
    const member = await createMember([
      { id: 'alpha', anchor: alpha.root },
      { id: 'beta', anchor: beta.root },
    ]);
    cleanup.push(alpha, beta, member);
    const home = path.join(alpha.root, '.home');
    await writeTestRegistry(home, {
      alpha: { anchor_path: alpha.root },
      beta: { anchor_path: beta.root },
    });
    await seed(alpha, 'OI-20260101-ALPH', 'alpha');
    await seed(beta, 'OI-20260101-BETA', 'beta');

    const ambiguous = runCli(['list', '--json'], {
      cwd: member.root,
      env: { OPENISSUE_HOME: home },
    });
    expect(ambiguous.status).not.toBe(0);
    expect(ambiguous.stderr).toContain('多个产品');
    expect(ambiguous.stderr).toContain('alpha');
    expect(ambiguous.stderr).toContain('beta');

    const selected = runCli(['list', '--json', '--product', 'alpha'], {
      cwd: member.root,
      env: { OPENISSUE_HOME: home },
    });
    expect(selected.status, selected.stderr).toBe(0);
    expect(selected.stdout).toContain('OI-20260101-ALPH');
    expect(selected.stdout).not.toContain('OI-20260101-BETA');
  });

  it('resolves from a nested directory with POSIX-style anchor separators', async () => {
    const anchor = await createAnchor({ id: 'demo' });
    const member = await createMember([
      { id: 'demo', anchor: anchor.root.replace(/\\/g, '/') },
    ]);
    cleanup.push(anchor, member);
    await seed(anchor);
    const nested = path.join(member.root, 'src', 'nested');
    await mkdir(nested, { recursive: true });
    const home = path.join(anchor.root, '.home');

    const listed = runCli(['list', '--json'], {
      cwd: nested,
      env: { OPENISSUE_HOME: home },
    });
    expect(listed.status, listed.stderr).toBe(0);
    expect(listed.stdout).toContain('OI-20260101-AAAA');
  });
});
