import type { Command } from 'commander';
import { applyClose, applyReopen, parseCloseReason } from '../domain/lifecycle.js';
import { mutateIssue, publicIssue } from '../storage/issue.js';
import { activeWorkspace } from './context.js';
import { closeLabel } from './list.js';

interface CloseOptions {
  reason?: string;
  note?: string;
  json?: boolean;
}

export function registerLifecycleCommands(program: Command): void {
  program
    .command('close <id>')
    .description('关闭需求；必须选择已完成或不做')
    .option('--reason <reason>', 'completed（已完成）或 wontdo（不做）')
    .option('--note <text>', '关闭说明；不做时必填')
    .option('--json', '输出 JSON')
    .action(async (id: string, options: CloseOptions, command: Command) => {
      const reason = parseCloseReason(options.reason);
      const note = options.note?.trim() ?? '';
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
          applyClose(current, reason, note);
        },
      );
      const notice =
        issue.proposals.length > 0 ? '关联提案不会因此取消或改变。' : undefined;
      if (options.json) {
        console.log(
          JSON.stringify(
            { ...publicIssue(issue), ...(notice ? { proposal_notice: notice } : {}) },
            null,
            2,
          ),
        );
      } else {
        console.log(`已关闭 ${issue.id}（${closeLabel(reason)}）`);
        if (notice) console.log(notice);
      }
    });

  program
    .command('reopen <id>')
    .description('重新打开一条已关闭需求，保留原关闭原因')
    .option('--json', '输出 JSON')
    .action(async (id: string, options: { json?: boolean }, command: Command) => {
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
          applyReopen(current);
        },
      );
      if (options.json) {
        console.log(JSON.stringify(publicIssue(issue), null, 2));
      } else {
        console.log(`已重新打开 ${issue.id}`);
      }
    });
}
