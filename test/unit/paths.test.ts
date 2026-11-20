import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { findUp, isPathInside, toPosix } from '../../src/core/paths.js';
import { makeIssueId, slugifyTitle, suggestChangeId } from '../../src/core/id.js';

describe('path helpers', () => {
  it('normalizes Windows and POSIX separators for display', () => {
    expect(toPosix('C:\\repo\\openissue\\issues\\OI.md')).toBe(
      'C:/repo/openissue/issues/OI.md',
    );
    expect(toPosix('/repo/openissue/issues/OI.md')).toBe('/repo/openissue/issues/OI.md');
  });

  it('recognizes descendants without prefix confusion', () => {
    const root = path.resolve('/tmp', 'product');
    expect(isPathInside(path.join(root, 'issues', 'a.md'), root)).toBe(true);
    expect(isPathInside(path.resolve('/tmp', 'product-other', 'a.md'), root)).toBe(false);
    expect(isPathInside(root, root)).toBe(true);
  });

  it('finds a named ancestor from a nested directory', () => {
    const root = path.resolve('/tmp', 'product');
    expect(findUp(path.join(root, 'a', 'b'), ['product'])).toBe(root);
  });
});

describe('identifier helpers', () => {
  it('creates stable date-prefixed issue ids and ASCII change ids', () => {
    expect(makeIssueId(new Date('2026-11-20T12:00:00.000Z'))).toMatch(
      /^OI-20261120-[A-Z0-9]{4}$/,
    );
    expect(slugifyTitle('Login / Billing v2')).toBe('login-billing-v2');
    expect(suggestChangeId('登录与账单', 'OI-20261120-ABCD')).toBe('oi-20261120-abcd');
    expect(suggestChangeId('Login Flow', 'OI-20261120-ABCD')).toBe('login-flow');
  });
});
