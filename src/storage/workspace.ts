import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenIssueError } from '../core/errors.js';
import type { ProductManifest } from '../core/types.js';
import { writeTextAtomic } from './atomic.js';
import {
  addMember,
  parseMemberPointerText,
  productExists,
  readProduct,
} from './product.js';
import { lookupAnchor, readRegistry, registerAnchor } from './registry.js';
import YAML from 'yaml';

export const MEMBER_FILE = 'openissue-project.yaml';

export interface MemberEntry {
  id: string;
  anchor?: string;
}

export interface ResolvedChoice {
  id: string;
  name?: string;
  anchor_path: string;
  product: ProductManifest;
}

export type WorkspaceContext =
  | { kind: 'anchor'; root: string; anchorRoot: string; product: ProductManifest }
  | {
      kind: 'member';
      root: string;
      memberRoot: string;
      anchorRoot: string;
      product: ProductManifest;
    }
  | { kind: 'unregistered'; root: string }
  | { kind: 'ambiguous'; root: string; memberRoot: string; choices: ResolvedChoice[] }
  | { kind: 'missing'; root: string; memberRoot: string; products: MemberEntry[] };

export async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function findNearbyFile(start: string, name: string): Promise<string | null> {
  let current = path.resolve(start);
  for (;;) {
    const candidate = path.join(current, name);
    if (await exists(candidate)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function findGitRoot(start: string): Promise<string | null> {
  return findNearbyFile(start, '.git');
}

export async function findAnchorRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  for (;;) {
    if (await productExists(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export async function readMemberPointer(memberRoot: string): Promise<{
  products: MemberEntry[];
  raw: Record<string, unknown>;
}> {
  const file = path.join(memberRoot, MEMBER_FILE);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    throw new OpenIssueError(
      `当前仓库未登记到任何产品：缺少 ${MEMBER_FILE}`,
      'NOT_REGISTERED',
    );
  }
  try {
    return parseMemberPointerText(raw);
  } catch (error) {
    if (error instanceof OpenIssueError) throw error;
    throw new OpenIssueError(
      `成员指针解析失败：${error instanceof Error ? error.message : String(error)}`,
      'INVALID_MEMBER',
    );
  }
}

export async function writeMemberPointer(
  memberRoot: string,
  products: MemberEntry[],
): Promise<void> {
  let raw: Record<string, unknown> = {};
  const file = path.join(memberRoot, MEMBER_FILE);
  try {
    const existing = parseMemberPointerText(await readFile(file, 'utf8'));
    raw = existing.raw;
  } catch {
    raw = {};
  }
  delete raw.product_id;
  delete raw.anchor;
  raw.products = products.map((item) => ({
    id: item.id,
    ...(item.anchor ? { anchor: item.anchor } : {}),
  }));
  await writeTextAtomic(file, YAML.stringify(raw, { lineWidth: 0 }));
}

export async function resolveWorkspace(
  start: string,
  options: { productId?: string; anchorPath?: string } = {},
): Promise<WorkspaceContext> {
  if (options.anchorPath) {
    const anchorRoot = path.resolve(start, options.anchorPath);
    if (!(await productExists(anchorRoot))) {
      throw new OpenIssueError(`指定的锚点仓库不存在：${anchorRoot}`, 'NOT_ANCHOR');
    }
    return {
      kind: 'anchor',
      root: anchorRoot,
      anchorRoot,
      product: await readProduct(anchorRoot),
    };
  }

  const anchorRoot = await findAnchorRoot(start);
  if (anchorRoot) {
    return {
      kind: 'anchor',
      root: anchorRoot,
      anchorRoot,
      product: await readProduct(anchorRoot),
    };
  }

  const memberRoot = await findNearbyFile(start, MEMBER_FILE);
  if (!memberRoot) {
    const root = (await findGitRoot(start)) ?? path.resolve(start);
    return { kind: 'unregistered', root };
  }

  const pointer = await readMemberPointer(memberRoot);
  const registry = await readRegistry();
  const requested = options.productId
    ? pointer.products.filter((item) => item.id === options.productId)
    : pointer.products;

  if (options.productId && requested.length === 0) {
    throw new OpenIssueError(
      `当前仓库未登记到产品 ${options.productId}`,
      'PRODUCT_NOT_FOUND',
    );
  }

  const choices: ResolvedChoice[] = [];
  const unresolved: MemberEntry[] = [];
  for (const entry of requested) {
    const candidates = [
      registry.products[entry.id]?.anchor_path,
      localAnchorFromPointer(entry.anchor, memberRoot),
    ].filter((item): item is string => Boolean(item));
    let resolved: ResolvedChoice | undefined;
    for (const candidate of candidates) {
      if (!(await productExists(candidate))) continue;
      const product = await readProduct(candidate);
      resolved = {
        id: entry.id,
        ...(registry.products[entry.id]?.name ? { name: registry.products[entry.id]!.name } : {}),
        anchor_path: path.resolve(candidate),
        product,
      };
      break;
    }
    if (resolved) choices.push(resolved);
    else unresolved.push(entry);
  }

  if (options.productId) {
    const selected = choices[0];
    if (!selected) {
      return { kind: 'missing', root: memberRoot, memberRoot, products: unresolved };
    }
    return {
      kind: 'member',
      root: memberRoot,
      memberRoot,
      anchorRoot: selected.anchor_path,
      product: selected.product,
    };
  }

  if (choices.length > 1) {
    return { kind: 'ambiguous', root: memberRoot, memberRoot, choices };
  }
  if (choices.length === 1) {
    const selected = choices[0]!;
    return {
      kind: 'member',
      root: memberRoot,
      memberRoot,
      anchorRoot: selected.anchor_path,
      product: selected.product,
    };
  }
  return { kind: 'missing', root: memberRoot, memberRoot, products: unresolved };
}

function localAnchorFromPointer(anchor: string | undefined, memberRoot: string): string | undefined {
  if (!anchor) return undefined;
  if (/^(https?:|git@|ssh:)/i.test(anchor)) return undefined;
  return path.isAbsolute(anchor) ? anchor : path.resolve(memberRoot, anchor);
}

export async function registerRepository(
  memberRoot: string,
  anchorRoot: string,
  productId: string,
  memberName?: string,
): Promise<ProductManifest> {
  const product = await readProduct(anchorRoot);
  if (product.id !== productId) {
    throw new OpenIssueError(
      `锚点仓库的产品标识是 ${product.id}，与请求的 ${productId} 不一致`,
      'PRODUCT_MISMATCH',
    );
  }
  const pointer = await readMemberPointer(memberRoot).catch(() => ({ products: [], raw: {} }));
  const products = pointer.products.filter((item) => item.id !== productId);
  products.push({ id: productId, anchor: anchorRoot });
  await writeMemberPointer(memberRoot, products);
  const memberId = memberName?.trim() || path.basename(memberRoot);
  await addMember(anchorRoot, { id: memberId, name: memberId });
  await registerAnchor(product.id, anchorRoot, product.name);
  return readProduct(anchorRoot);
}

export async function ensureAnchorForProduct(anchorRoot: string): Promise<ProductManifest> {
  const product = await readProduct(anchorRoot);
  await registerAnchor(product.id, anchorRoot, product.name);
  return product;
}
