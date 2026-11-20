import { createInterface } from 'node:readline/promises';
import { Option, type Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import type { Issue } from '../core/types.js';
import {
  confirmDone,
  linkProposal,
  readHandoffState,
} from '../services/handoff.js';
import { findIssue, publicIssue } from '../storage/issue.js';
import { activeWorkspace } from './context.js';
import type { ActiveWorkspace } from './context.js';

interface HandoffOptions {
  change?: string;
  link?: string;
  fromInterview?: boolean;
  yes?: boolean;
  json?: boolean;
}

export function registerHandoffCommands(program: Command): void {
  program
    .command('handoff <id>')
    .description('关联已有 OpenSpec 提案；创建新提案请使用 openissue start')
    .option('--change <id>', '已停用：直接创建提案')
    .option('--link <id>', '关联已有提案')
    .addOption(
      new Option(
        '--from-interview',
        '内部：由 openissue-grill-me 在访谈草稿创建后调用',
      ).hideHelp(),
    )
    .option('--yes', '跳过确认提示')
    .option('--json', '输出 JSON')
    .action(async (id: string, options: HandoffOptions, command: Command) => {
      if (options.change && options.link) {
        throw new OpenIssueError('--change 与 --link 不能同时使用', 'INVALID_HANDOFF_OPTIONS');
      }
      if (options.change) {
        throw new OpenIssueError(
          `handoff 不再直接创建提案；请运行 openissue start ${id} 进入产品决策访谈。`,
          'HANDOFF_CREATE_DISABLED',
        );
      }
      if (!options.link) {
        throw new OpenIssueError(
          `请使用 --link <change> 关联已有提案，或运行 openissue start ${id} 开始访谈。`,
          'HANDOFF_TARGET_REQUIRED',
        );
      }
      const workspace = await workspaceFor(command);
      const issue = await findIssue(workspace.productDir, workspace.product.id, id);
      if (!options.fromInterview) {
        console.error(
          `提示：手动关联会跳过产品决策访谈。建议先运行 openissue start ${id}。`,
        );
        if (!options.yes && process.stdin.isTTY) {
          await confirmSkipInterview();
        }
      }
      await link(workspace, issue, options.link, options.fromInterview === true, options.json === true);
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
  fromInterview: boolean,
  json: boolean,
): Promise<void> {
  const updated = await linkProposal({
    anchorRoot: workspace.anchorRoot,
    productDir: workspace.productDir,
    productId: workspace.product.id,
    issue,
    changeId,
    fromInterview,
  });
  const state = await readHandoffState(workspace.anchorRoot, updated);
  if (json) {
    console.log(
      JSON.stringify(
        {
          issue: publicIssue(updated),
          handoff: state,
          skipped_interview: !fromInterview,
        },
        null,
        2,
      ),
    );
  } else if (fromInterview) {
    console.log(`已关联访谈草稿 ${changeId} 到需求 ${updated.id}`);
    console.log('访谈未完成标记已写入；请继续在 Agent 对话中推进产品决策访谈。');
  } else {
    console.log(`已关联提案 ${changeId} 到需求 ${updated.id}（已跳过产品决策访谈）`);
    console.log('需求保持打开；提案内容未被复制或改写。');
  }
}

async function confirmSkipInterview(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question('确认跳过产品决策访谈并继续关联？[y/N] ');
    if (!/^y/i.test(answer.trim())) {
      throw new OpenIssueError('已取消关联', 'HANDOFF_CANCELLED');
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
