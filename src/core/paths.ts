import path from 'node:path';

export function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

export function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function findUp(start: string, names: string[]): string | null {
  let current = path.resolve(start);
  for (;;) {
    for (const name of names) {
      if (path.basename(current) === name) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function expandHome(input: string): string {
  if (input === '~') return process.env.HOME ?? process.env.USERPROFILE ?? input;
  if (input.startsWith('~/') || input.startsWith('~\\')) {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (home) return path.join(home, input.slice(2));
  }
  return input;
}
