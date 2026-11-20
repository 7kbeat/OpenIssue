import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { isRecord } from '../core/guards.js';
import type { Registry } from '../core/types.js';
import { writeTextAtomic } from './atomic.js';

export function openissueHome(): string {
  return process.env.OPENISSUE_HOME?.trim()
    ? path.resolve(process.env.OPENISSUE_HOME)
    : path.join(os.homedir(), '.openissue');
}

export function registryPath(): string {
  return path.join(openissueHome(), 'registry.yaml');
}

export async function readRegistry(): Promise<Registry> {
  try {
    const raw = await readFile(registryPath(), 'utf8');
    const parsed = YAML.parse(raw);
    if (!isRecord(parsed) || !isRecord(parsed.products)) return { products: {} };
    const products: Registry['products'] = {};
    for (const [id, value] of Object.entries(parsed.products)) {
      if (!isRecord(value) || typeof value.anchor_path !== 'string') continue;
      products[id] = {
        anchor_path: value.anchor_path,
        ...(typeof value.name === 'string' ? { name: value.name } : {}),
      };
    }
    return { products };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { products: {} };
    throw error;
  }
}

export async function writeRegistry(registry: Registry): Promise<void> {
  await writeTextAtomic(
    registryPath(),
    YAML.stringify({ products: registry.products }, { lineWidth: 0 }),
  );
}

export async function registerAnchor(
  id: string,
  anchorPath: string,
  name?: string,
): Promise<void> {
  const registry = await readRegistry();
  registry.products[id] = {
    anchor_path: path.resolve(anchorPath),
    ...(name ? { name } : {}),
  };
  await writeRegistry(registry);
}

export async function lookupAnchor(id: string): Promise<string | undefined> {
  const registry = await readRegistry();
  return registry.products[id]?.anchor_path;
}
