import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import writeFileAtomic from 'write-file-atomic';

export async function writeTextAtomic(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFileAtomic(file, content, 'utf8');
}
