import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { toPosix } from '../core/paths.js';
import type { ProjectFacts, ProposalFact, SpecFact } from '../core/types.js';

export async function readProjectFacts(anchorRoot: string): Promise<ProjectFacts> {
  const openspecDir = path.join(anchorRoot, 'openspec');
  const initialized = await exists(path.join(openspecDir, 'config.yaml'));
  const specs = initialized ? await readSpecs(anchorRoot) : [];
  const proposals = initialized ? await readProposals(anchorRoot) : [];
  return { specs, proposals, openspec_initialized: initialized };
}

async function readSpecs(anchorRoot: string): Promise<SpecFact[]> {
  const root = path.join(anchorRoot, 'openspec', 'specs');
  const files = await findFiles(root, (name) => name.endsWith('.md'));
  return Promise.all(
    files.map(async (file) => {
      const raw = await readFile(file, 'utf8').catch(() => '');
      const relative = path.relative(path.join(anchorRoot, 'openspec', 'specs'), file);
      const id = relative.replace(/\\/g, '/').replace(/\/?spec\.md$/, '').replace(/\.md$/, '');
      return {
        id: id || path.basename(file, '.md'),
        title: firstHeading(raw) ?? id,
        path: toPosix(path.relative(anchorRoot, file)),
      };
    }),
  );
}

async function readProposals(anchorRoot: string): Promise<ProposalFact[]> {
  const changesRoot = path.join(anchorRoot, 'openspec', 'changes');
  const result: ProposalFact[] = [];
  const active = await listDirs(changesRoot);
  for (const name of active) {
    if (name === 'archive') continue;
    result.push(await readProposal(path.join(changesRoot, name), name, false, anchorRoot));
  }
  const archiveRoot = path.join(changesRoot, 'archive');
  for (const name of await listDirs(archiveRoot)) {
    const id = name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    result.push(await readProposal(path.join(archiveRoot, name), id, true, anchorRoot));
  }
  return result;
}

async function readProposal(
  dir: string,
  id: string,
  archived: boolean,
  anchorRoot: string,
): Promise<ProposalFact> {
  const proposal = await readFile(path.join(dir, 'proposal.md'), 'utf8').catch(() => '');
  const tasks = await readFile(path.join(dir, 'tasks.md'), 'utf8').catch(() => '');
  return {
    id,
    title: firstHeading(proposal) ?? id,
    path: toPosix(path.relative(anchorRoot, dir)),
    archived,
    tasks_total: countTasks(tasks),
    tasks_done: countDoneTasks(tasks),
  };
}

function firstHeading(raw: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(raw);
  return match?.[1]?.trim();
}

function countTasks(raw: string): number {
  return (raw.match(/^- \[[ xX]\]/gm) ?? []).length;
}

function countDoneTasks(raw: string): number {
  return (raw.match(/^- \[[xX]\]/gm) ?? []).length;
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function findFiles(
  dir: string,
  predicate: (name: string) => boolean,
): Promise<string[]> {
  const result: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await findFiles(full, predicate)));
    else if (entry.isFile() && predicate(entry.name)) result.push(full);
  }
  return result.sort();
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}
