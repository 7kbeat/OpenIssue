import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenIssueError } from '../core/errors.js';
import { isRecord } from '../core/guards.js';
import { toPosix } from '../core/paths.js';
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
export const WORKSPACE_FILE = '.openissue-workspace.yaml';

export interface MemberEntry {
  id: string;
  anchor?: string;
}

export interface WorkspacePointer {
  version: number;
  product: string;
  anchor: string;
  root: string;
  path: string;
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

export function workspacePointerPath(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), WORKSPACE_FILE);
}

export async function findWorkspacePointerRoot(start: string): Promise<string | null> {
  return findNearbyFile(start, WORKSPACE_FILE);
}

export async function readWorkspacePointer(
  workspaceRoot: string,
): Promise<WorkspacePointer | null> {
  const root = path.resolve(workspaceRoot);
  const file = workspacePointerPath(root);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new OpenIssueError(
      `workspace 指针无法读取：${file}（${error instanceof Error ? error.message : String(error)}）`,
      'WORKSPACE_POINTER_INVALID',
    );
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new OpenIssueError(
      `workspace 指针格式无效：${file}（${error instanceof Error ? error.message : String(error)}）`,
      'WORKSPACE_POINTER_INVALID',
    );
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.product !== 'string' ||
    !parsed.product.trim() ||
    typeof parsed.anchor !== 'string' ||
    !parsed.anchor.trim()
  ) {
    throw new OpenIssueError(
      `workspace 指针缺少 product 或 anchor：${file}`,
      'WORKSPACE_POINTER_INVALID',
    );
  }
  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    product: parsed.product.trim(),
    anchor: parsed.anchor.trim(),
    root,
    path: file,
  };
}

export function resolvePointerAnchor(pointer: WorkspacePointer): string {
  return path.isAbsolute(pointer.anchor)
    ? path.resolve(pointer.anchor)
    : path.resolve(pointer.root, pointer.anchor);
}

export async function validateWorkspacePointer(pointer: WorkspacePointer): Promise<{
  anchorRoot: string;
  product: ProductManifest;
}> {
  const anchorRoot = resolvePointerAnchor(pointer);
  if (!(await productExists(anchorRoot))) {
    throw new OpenIssueError(
      `workspace 指针指向的锚点失效：${anchorRoot}。请运行 openissue init --rescan 或 openissue init --anchor <path> 修复。`,
      'WORKSPACE_POINTER_INVALID',
    );
  }
  const product = await readProduct(anchorRoot);
  if (product.id !== pointer.product) {
    throw new OpenIssueError(
      `workspace 指针的产品 ${pointer.product} 与锚点产品 ${product.id} 不一致。请运行 openissue init --rescan 修复。`,
      'WORKSPACE_POINTER_INVALID',
    );
  }
  return { anchorRoot, product };
}

export async function writeWorkspacePointer(
  workspaceRoot: string,
  product: string,
  anchorRoot: string,
): Promise<WorkspacePointer> {
  const root = path.resolve(workspaceRoot);
  const relative = path.relative(root, path.resolve(anchorRoot)) || '.';
  const anchor = toPosix(relative);
  const file = workspacePointerPath(root);
  await writeTextAtomic(
    file,
    YAML.stringify({ version: 1, product, anchor }, { lineWidth: 0 }),
  );
  return {
    version: 1,
    product,
    anchor,
    root,
    path: file,
  };
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
    const pointerRoot = await findWorkspacePointerRoot(start);
    if (pointerRoot) {
      const pointer = await readWorkspacePointer(pointerRoot);
      if (!pointer) {
        throw new OpenIssueError(
          `workspace 指针无法读取：${pointerRoot}`,
          'WORKSPACE_POINTER_INVALID',
        );
      }
      const resolved = await validateWorkspacePointer(pointer);
      return {
        kind: 'anchor',
        root: pointerRoot,
        anchorRoot: resolved.anchorRoot,
        product: resolved.product,
      };
    }
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
