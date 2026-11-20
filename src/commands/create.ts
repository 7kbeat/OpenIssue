import { access } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { currentAuthor } from '../core/author.js';
import { OpenIssueError } from '../core/errors.js';
import { makeIssueId } from '../core/id.js';
import type { Issue } from '../core/types.js';
import { issueFilePath, publicIssue, writeIssue } from '../storage/issue.js';
import { ensureAnchorForProduct } from '../storage/workspace.js';
import { activeWorkspace } from './context.js';

export function registerCreateCommand(program: Command): void {
  program
    .command('create <title>')
    .description('创建一条需求，只要求标题')
    .option('-d, --description <text>', '可选描述')
    .option('--json', '输出 JSON')
    .action(async (title: string, options: { description?: string; json?: boolean }, command: Command) => {
      const global = command.optsWithGlobals() as { product?: string; anchor?: string };
      const workspace = await activeWorkspace(process.cwd(), {
        ...(global.product ? { productId: global.product } : {}),
        ...(global.anchor ? { anchorPath: global.anchor } : {}),
      });
      const normalized = title.trim();
      if (!normalized) {
        throw new OpenIssueError('标题必填', 'TITLE_REQUIRED');
      }
      const now = new Date().toISOString();
      const id = await allocateId(workspace.productDir);
      const issue: Issue = {
        id,
        title: normalized,
        description: options.description?.trim() ?? '',
        status: 'open',
        product: workspace.product.id,
        created_at: now,
        updated_at: now,
        author: currentAuthor(),
        source: 'cli',
        blocked_by: [],
        proposals: [],
        priority: {},
        filePath: issueFilePath(workspace.productDir, id),
        rawFrontmatter: {},
      };
      await writeIssue(workspace.productDir, issue);
      await ensureAnchorForProduct(workspace.anchorRoot);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              id,
              path: path.relative(workspace.anchorRoot, issue.filePath),
              issue: publicIssue(issue),
            },
            null,
            2,
          ),
        );
      } else {
        console.log(`已创建 ${id}：${normalized}`);
      }
    });
}

async function allocateId(productDir: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = makeIssueId();
    try {
      await access(issueFilePath(productDir, id));
    } catch {
      return id;
    }
  }
  throw new OpenIssueError('无法生成唯一的需求标识，请重试', 'ID_COLLISION');
}
