import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import { suggestChangeId } from '../core/id.js';
import type { Issue } from '../core/types.js';
import {
  confirmDone,
  createProposal,
  linkProposal,
  readHandoffState,
} from '../services/handoff.js';
import { findIssue, publicIssue } from '../storage/issue.js';
import { activeWorkspace } from './context.js';
import type { ActiveWorkspace } from './context.js';

interface HandoffOptions {
  change?: string;
  link?: string;
  yes?: boolean;
  json?: boolean;
}

export function registerHandoffCommands(program: Command): void {
  program
    .command('handoff <id>')
    .description('从需求创建 OpenSpec 提案，或关联已有提案')
    .option('--change <id>', '指定新提案标识')
    .option('--link <id>', '关联已有提案')
    .option('--yes', '使用回退标识时不再询问')
    .option('--json', '输出 JSON')
    .action(async (id: string, options: HandoffOptions, command: Command) => {
      if (options.change && options.link) {
        throw new OpenIssueError('--change 与 --link 不能同时使用', 'INVALID_HANDOFF_OPTIONS');
      }
      const workspace = await workspaceFor(command);
      const issue = await findIssue(workspace.productDir, workspace.product.id, id);

      if (options.link) {
        await link(workspace, issue, options.link, options.json === true);
        return;
      }

      let changeId = options.change?.trim() || suggestChangeId(issue.title, issue.id);
      const fallback = !options.change && changeId === issue.id.toLowerCase();
      if (fallback) {
        console.error(
          `标题无法直接生成 ASCII 变更标识，将使用 ${changeId}；可用 --change 覆盖。`,
        );
        if (!options.yes && process.stdin.isTTY) {
          await confirmFallback(changeId);
        }
      }
      const updated = await createProposal({
        anchorRoot: workspace.anchorRoot,
        productDir: workspace.productDir,
        productId: workspace.product.id,
        issue,
        changeId,
        focus: workspace.product.focus,
      });
      const state = await readHandoffState(workspace.anchorRoot, updated);
      if (options.json) {
        console.log(
          JSON.stringify({ issue: publicIssue(updated), handoff: state }, null, 2),
        );
      } else {
        console.log(`已创建提案 ${changeId} 并关联需求 ${updated.id}`);
        console.log('需求仍保持打开；提案内容由 OpenSpec 流程继续完善。');
      }
    });

  program
    .command('confirm <id>')
    .description('全部关联提案归档后，确认需求已完成')
    .option('--json', '输出 JSON')
    .action(async (id: string, options: { json?: boolean }, command: Command) => {
      const workspace = await workspaceFor(command);
      const issue = await findIssue(workspace.productDir, workspace.product.id, id);
      const updated = await confirmDone(
        workspace.productDir,
        workspace.product.id,
        workspace.anchorRoot,
        issue,
      );
      if (options.json) {
        console.log(JSON.stringify(publicIssue(updated), null, 2));
      } else {
        console.log(`已确认完成 ${updated.id}`);
      }
    });
}

async function link(
  workspace: ActiveWorkspace,
  issue: Issue,
  changeId: string,
  json: boolean,
): Promise<void> {
  const updated = await linkProposal({
    anchorRoot: workspace.anchorRoot,
    productDir: workspace.productDir,
    productId: workspace.product.id,
    issue,
    changeId,
  });
  const state = await readHandoffState(workspace.anchorRoot, updated);
  if (json) {
    console.log(JSON.stringify({ issue: publicIssue(updated), handoff: state }, null, 2));
  } else {
    console.log(`已关联提案 ${changeId} 到需求 ${updated.id}`);
    console.log('需求保持打开；提案内容未被复制或改写。');
  }
}

async function confirmFallback(changeId: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`使用变更标识 ${changeId} 继续？[Y/n] `);
    if (/^n/i.test(answer.trim())) {
      throw new OpenIssueError('已取消创建提案', 'HANDOFF_CANCELLED');
    }
  } finally {
    rl.close();
  }
}

async function workspaceFor(command: Command): Promise<ActiveWorkspace> {
  const global = command.optsWithGlobals() as { product?: string; anchor?: string };
  return activeWorkspace(process.cwd(), {
    ...(global.product ? { productId: global.product } : {}),
    ...(global.anchor ? { anchorPath: global.anchor } : {}),
  });
}
