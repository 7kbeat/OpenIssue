import path from 'node:path';
import { OpenIssueError } from '../core/errors.js';
import type { ProductManifest } from '../core/types.js';
import { resolveWorkspace, type WorkspaceContext } from '../storage/workspace.js';

export interface ActiveWorkspace {
  anchorRoot: string;
  productDir: string;
  product: ProductManifest;
  memberRoot?: string;
  kind: 'anchor' | 'member';
}

export async function activeWorkspace(
  cwd: string,
  options: { productId?: string; anchorPath?: string } = {},
): Promise<ActiveWorkspace> {
  const context = await resolveWorkspace(cwd, options);
  return requireWorkspace(context);
}

export function requireWorkspace(context: WorkspaceContext): ActiveWorkspace {
  if (context.kind === 'anchor' || context.kind === 'member') {
    return {
      anchorRoot: context.anchorRoot,
      productDir: path.join(context.anchorRoot, 'openissue'),
      product: context.product,
      ...(context.kind === 'member' ? { memberRoot: context.memberRoot } : {}),
      kind: context.kind,
    };
  }
  if (context.kind === 'unregistered') {
    throw new OpenIssueError(
      '当前仓库尚未归属任何产品。请在锚点仓库运行 openissue init，或在成员仓库运行 openissue register --product <id> --anchor <path>。',
      'NOT_REGISTERED',
    );
  }
  if (context.kind === 'ambiguous') {
    const names = context.choices.map((item) => item.id).join('、');
    throw new OpenIssueError(
      `当前仓库属于多个产品，请用 --product 选择：${names}`,
      'AMBIGUOUS_PRODUCT',
    );
  }
  const names = context.products.map((item) => item.id).join('、') || '未知产品';
  throw new OpenIssueError(
    `找不到产品锚点（${names}）。请先克隆并注册锚点仓库，或运行 openissue register。`,
    'ANCHOR_NOT_FOUND',
  );
}
