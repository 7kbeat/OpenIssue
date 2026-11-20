import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import { mutateIssue, publicIssue } from '../storage/issue.js';
import { activeWorkspace } from './context.js';

interface EditOptions {
  title?: string;
  description?: string;
  json?: boolean;
}

export function registerEditCommand(program: Command): void {
  program
    .command('edit <id>')
    .description('补充或修改需求的标题与描述')
    .option('--title <text>', '新标题')
    .option('--description <text>', '新描述；传空字符串可清空')
    .option('--json', '输出 JSON')
    .action(async (id: string, options: EditOptions, command: Command) => {
      if (options.title === undefined && options.description === undefined) {
        throw new OpenIssueError('至少提供 --title 或 --description', 'NOTHING_TO_EDIT');
      }
      if (options.title !== undefined && !options.title.trim()) {
        throw new OpenIssueError('标题必填', 'TITLE_REQUIRED');
      }
      const global = command.optsWithGlobals() as { product?: string; anchor?: string };
      const workspace = await activeWorkspace(process.cwd(), {
        ...(global.product ? { productId: global.product } : {}),
        ...(global.anchor ? { anchorPath: global.anchor } : {}),
      });
      const issue = await mutateIssue(
        workspace.productDir,
        workspace.product.id,
        id,
        (current) => {
          if (options.title !== undefined) current.title = options.title.trim();
          if (options.description !== undefined) current.description = options.description.trim();
        },
      );
      if (options.json) {
        console.log(JSON.stringify(publicIssue(issue), null, 2));
      } else {
        console.log(`已更新 ${issue.id}：${issue.title}`);
      }
    });
}
