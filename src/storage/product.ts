import { access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { OpenIssueError } from '../core/errors.js';
import { isRecord } from '../core/guards.js';
import type { ProductManifest, ProductMember } from '../core/types.js';
import { writeTextAtomic } from './atomic.js';
import YAML from 'yaml';

export function productDirectory(anchorRoot: string): string {
  return path.join(anchorRoot, 'openissue');
}

export function productFilePath(anchorRoot: string): string {
  return path.join(productDirectory(anchorRoot), 'product.yaml');
}

export async function productExists(anchorRoot: string): Promise<boolean> {
  try {
    await access(productFilePath(anchorRoot));
    return true;
  } catch {
    return false;
  }
}

export async function readProduct(anchorRoot: string): Promise<ProductManifest> {
  let raw: string;
  try {
    raw = await readFile(productFilePath(anchorRoot), 'utf8');
  } catch (error) {
    throw new OpenIssueError(
      '当前目录不是 OpenIssue 锚点仓库：缺少 openissue/product.yaml',
      'NOT_ANCHOR',
    );
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new OpenIssueError(
      `产品清单解析失败：${error instanceof Error ? error.message : String(error)}`,
      'INVALID_PRODUCT',
    );
  }
  if (!isRecord(parsed) || typeof parsed.id !== 'string' || !parsed.id.trim()) {
    throw new OpenIssueError('产品清单缺少 id', 'INVALID_PRODUCT');
  }
  const members = Array.isArray(parsed.members)
    ? parsed.members.filter(isRecord).map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        ...(typeof item.name === 'string' ? { name: item.name } : {}),
        ...(typeof item.path === 'string' ? { path: item.path } : {}),
      })).filter((item) => item.id)
    : [];
  return {
    id: parsed.id,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : parsed.id,
    focus: typeof parsed.focus === 'string' ? parsed.focus : '',
    focus_updated_at:
      typeof parsed.focus_updated_at === 'string' ? parsed.focus_updated_at : null,
    members,
    raw: parsed,
  };
}

export async function writeProduct(
  anchorRoot: string,
  product: ProductManifest,
): Promise<void> {
  const raw: Record<string, unknown> = { ...product.raw };
  raw.id = product.id;
  raw.name = product.name;
  raw.focus = product.focus;
  raw.focus_updated_at = product.focus_updated_at;
  raw.members = product.members;
  await writeTextAtomic(
    productFilePath(anchorRoot),
    YAML.stringify(raw, { lineWidth: 0 }),
  );
}

export async function initProduct(
  anchorRoot: string,
  id: string,
  name: string,
): Promise<ProductManifest> {
  if (await productExists(anchorRoot)) {
    throw new OpenIssueError('当前目录已经是 OpenIssue 锚点仓库', 'ALREADY_INITIALIZED');
  }
  await mkdir(path.join(productDirectory(anchorRoot), 'issues'), { recursive: true });
  const product: ProductManifest = {
    id,
    name,
    focus: '',
    focus_updated_at: null,
    members: [],
    raw: {},
  };
  await writeProduct(anchorRoot, product);
  return product;
}

export async function addMember(
  anchorRoot: string,
  member: ProductMember,
): Promise<ProductManifest> {
  const product = await readProduct(anchorRoot);
  const existing = product.members.find((item) => item.id === member.id);
  if (existing) {
    if (member.name !== undefined) existing.name = member.name;
    if (member.path !== undefined) existing.path = member.path;
  } else {
    product.members.push(member);
  }
  await writeProduct(anchorRoot, product);
  return product;
}

export async function updateFocus(
  anchorRoot: string,
  focus: string,
): Promise<ProductManifest> {
  const product = await readProduct(anchorRoot);
  product.focus = focus.trim();
  product.focus_updated_at = new Date().toISOString();
  await writeProduct(anchorRoot, product);
  return product;
}

export function parseMemberPointerText(raw: string): { products: Array<{ id: string; anchor?: string }>; raw: Record<string, unknown> } {
  const parsed = YAML.parse(raw);
  if (!isRecord(parsed)) throw new OpenIssueError('openissue-project.yaml 格式无效', 'INVALID_MEMBER');
  const rawProducts = Array.isArray(parsed.products) ? parsed.products : [];
  const products = rawProducts.filter(isRecord).map((item) => ({
    id: typeof item.id === 'string' ? item.id : '',
    ...(typeof item.anchor === 'string' ? { anchor: item.anchor } : {}),
  })).filter((item) => item.id);
  if (products.length === 0 && typeof parsed.product_id === 'string') {
    products.push({
      id: parsed.product_id,
      ...(typeof parsed.anchor === 'string' ? { anchor: parsed.anchor } : {}),
    });
  }
  if (products.length === 0) {
    throw new OpenIssueError('openissue-project.yaml 未登记任何产品', 'INVALID_MEMBER');
  }
  return { products, raw: parsed };
}
