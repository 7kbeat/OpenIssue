import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import type { Tier } from '../core/types.js';
import { applyManualTier } from '../domain/manual.js';
import { mutateIssue, publicIssue } from '../storage/issue.js';
import { activeWorkspace } from './context.js';

const TIERS: Tier[] = ['high', 'medium', 'low'];

export function registerTierCommand(program: Command): void {
  program
    .command('tier <id> <tier>')
    .description('手动设定档位，或使用 auto 恢复自动')
    .option('--json', '输出 JSON')
    .action(async (id: string, tierValue: string, options: { json?: boolean }, command: Command) => {
      const value = tierValue.trim().toLowerCase();
      if (value !== 'auto' && !TIERS.includes(value as Tier)) {
        throw new OpenIssueError(
          '档位必须是 high、medium、low 或 auto',
          'INVALID_TIER',
        );
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
          applyManualTier(current, value === 'auto' ? 'auto' : (value as Tier));
        },
      );
      if (options.json) {
        console.log(JSON.stringify(publicIssue(issue), null, 2));
        return;
      }
      console.log(
        value === 'auto'
          ? `已恢复自动判断：${issue.id}`
          : `已手动设定 ${issue.id}：${value}`,
      );
    });
}
