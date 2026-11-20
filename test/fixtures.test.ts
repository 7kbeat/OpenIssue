import { afterEach, describe, expect, it } from 'vitest';
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  createAnchor,
  createMember,
  createOpenspecSkeleton,
  createTempDir,
  runOpenspec,
  type TempDir,
} from './helpers/fixtures.js';

const cleanup: TempDir[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

describe('repository fixtures', () => {
  it('creates and cleans an anchor with a product manifest and issue directory', async () => {
    const anchor = await createAnchor({ id: 'demo', name: 'Demo' });
    cleanup.push(anchor);
    await expect(access(path.join(anchor.root, 'openissue', 'product.yaml'))).resolves.toBeUndefined();
    await expect(access(path.join(anchor.root, 'openissue', 'issues'))).resolves.toBeUndefined();
    const manifest = await readFile(path.join(anchor.root, 'openissue', 'product.yaml'), 'utf8');
    expect(manifest).toContain('id: demo');
  });

  it('creates a member pointer and an OpenSpec-capable anchor', async () => {
    const anchor = await createAnchor({ id: 'demo', openspec: true });
    const member = await createMember([{ id: 'demo', anchor: anchor.root }]);
    cleanup.push(anchor, member);
    expect(await readFile(path.join(member.root, 'openissue-project.yaml'), 'utf8')).toContain(
      'id: demo',
    );
    const result = runOpenspec(anchor.root);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Changes:|No active changes found/);
  });

  it('can create nested paths safely from a temp fixture', async () => {
    const temp = await createTempDir();
    cleanup.push(temp);
    const nested = path.join(temp.root, 'a', 'b');
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, 'x.txt'), 'ok', 'utf8');
    expect(await readFile(path.join(nested, 'x.txt'), 'utf8')).toBe('ok');
  });
});
