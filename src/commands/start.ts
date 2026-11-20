import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import {
  buildStartContext,
  discardInterview,
  findArchivedChange,
  readHandoffState,
} from '../services/handoff.js';
import { findIssue, publicIssue } from '../storage/issue.js';
import { hasCurrentSkill } from '../skills/install.js';
import { activeWorkspace } from './context.js';
import type { ActiveWorkspace } from './context.js';

interface StartOptions {
  change?: string;
  discard?: string;
  yes?: boolean;
  json?: boolean;
}

export function registerStartCommand(program: Command): void {
  program
    .command('start <id>')
    .description('从需求开始产品决策访谈，输出可交给 Agent 的上下文')
    .option('--change <id>', '指定建议的草稿标识')
    .option('--discard <change-id>', '丢弃未完成的访谈草稿')
    .option('--yes', '确认丢弃，不再询问')
    .option('--json', '输出 JSON')
    .action(async (id: string, options: StartOptions, command: Command) => {
      if (options.change && options.discard) {
        throw new OpenIssueError('--change 与 --discard 不能同时使用', 'INVALID_START_OPTIONS');
      }
      const workspace = await workspaceFor(command);
      const issue = await findIssue(workspace.productDir, workspace.product.id, id);
      if (issue.status !== 'open') {
        throw new OpenIssueError('需求已关闭，不能再开始或丢弃访谈', 'ISSUE_CLOSED');
      }
      if (options.discard) {
        await discard(workspace, options, id);
        return;
      }

      const handoff = await readHandoffState(workspace.anchorRoot, issue);
      const skillAvailable =
        (await hasCurrentSkill(process.cwd(), 'openissue-grill-me')) ||
        (await hasCurrentSkill(workspace.anchorRoot, 'openissue-grill-me'));
      if (!skillAvailable) {
        throw new OpenIssueError(
          '当前仓库未安装可用的 openissue-grill-me。请先运行 openissue skills install --tool agents 安装或更新。',
          'INTERVIEW_SKILL_MISSING',
        );
      }
      const context = buildStartContext({
        issue,
        focus: workspace.product.focus,
        handoff,
        ...(options.change ? { changeId: options.change } : {}),
        skillAvailable,
      });
      const hasActive = context.active_proposals.length > 0;
      const suggestedIsLinked = handoff.proposals.some(
        (proposal) => proposal.id === context.suggested_change_id,
      );
      if (options.change || (!hasActive && !suggestedIsLinked)) {
        const changeDir = path.join(
          workspace.anchorRoot,
          'openspec',
          'changes',
          context.suggested_change_id,
        );
        if (
          existsSync(changeDir) ||
          (await findArchivedChange(workspace.anchorRoot, context.suggested_change_id))
        ) {
          throw new OpenIssueError(
            `提案 ${context.suggested_change_id} 已存在，请用 --change 指定新的草稿标识`,
            'CHANGE_NAME_CONFLICT',
          );
        }
      }
      if (options.json) {
        console.log(JSON.stringify(context, null, 2));
        return;
      }
      console.log(`${issue.id} ${issue.title}`);
      console.log('状态：打开');
      if (workspace.product.focus.trim()) {
        console.log(`当前重点：${workspace.product.focus.trim()}`);
      }
      if (context.active_proposals.length > 0) {
        console.log(
          `活跃提案：${context.active_proposals.map((proposal) => proposal.id).join('、')}`,
        );
      }
      if (context.archived_proposals.length > 0) {
        console.log(
          `归档提案：${context.archived_proposals.map((proposal) => proposal.id).join('、')}（不能接管）`,
        );
      }
      if (context.missing_proposals.length > 0) {
        console.log(
          `关联失效：${context.missing_proposals.map((proposal) => proposal.id).join('、')}`,
        );
      }
      if (context.interview.status === 'incomplete') {
        console.log(`访谈未完成：${context.interview.change_ids.join('、')}`);
      }
      console.log('\n把下面内容交给 Agent：\n');
      console.log(context.instruction);
    });
}

async function discard(
  workspace: ActiveWorkspace,
  options: StartOptions,
  id: string,
): Promise<void> {
  const changeId = options.discard?.trim();
  if (!changeId) {
    throw new OpenIssueError('必须提供要丢弃的草稿标识', 'CHANGE_ID_REQUIRED');
  }
  if (!options.yes) {
    if (!process.stdin.isTTY) {
      throw new OpenIssueError(
        '丢弃访谈草稿需要二次确认，请确认后加 --yes。',
        'DISCARD_CONFIRMATION_REQUIRED',
      );
    }
    await confirmDiscard(id, changeId);
  }
  const issue = await findIssue(workspace.productDir, workspace.product.id, id);
  const updated = await discardInterview({
    anchorRoot: workspace.anchorRoot,
    productDir: workspace.productDir,
    productId: workspace.product.id,
    issue,
    changeId,
  });
  if (options.json) {
    console.log(
      JSON.stringify(
        { discarded_change_id: changeId, issue: publicIssue(updated) },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`已丢弃访谈草稿 ${changeId}；需求 ${updated.id} 仍为打开状态。`);
}

async function confirmDiscard(issueId: string, changeId: string): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(
      `确认丢弃需求 ${issueId} 的未完成访谈草稿 ${changeId}？此操作会删除草稿目录。[y/N] `,
    );
    if (!/^y/i.test(answer.trim())) {
      throw new OpenIssueError('已取消丢弃，草稿与关联保持不变', 'DISCARD_CANCELLED');
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
