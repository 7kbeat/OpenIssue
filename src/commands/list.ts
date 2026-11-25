import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import type { Issue } from '../core/types.js';
import { readHandoffState } from '../services/handoff.js';
import { loadIssues, publicIssue } from '../storage/issue.js';
import { activeWorkspace } from './context.js';

type StatusFilter = 'open' | 'closed' | 'all';

export interface ListOptions {
  status?: string;
  json?: boolean;
}

export function parseStatusFilter(value: string | undefined): StatusFilter {
  if (!value || value === 'open') return 'open';
  if (value === 'closed' || value === 'all') return value;
  throw new OpenIssueError('状态筛选必须是 open、closed 或 all', 'INVALID_FILTER');
}

export function filterByStatus(issues: Issue[], status: StatusFilter): Issue[] {
  if (status === 'all') return issues;
  return issues.filter((issue) => issue.status === status);
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('列出需求，默认只显示打开项')
    .option('--status <status>', 'open、closed 或 all', 'open')
    .option('--json', '输出 JSON')
    .action(async (options: ListOptions, command: Command) => {
      const global = command.optsWithGlobals() as { product?: string; anchor?: string };
      const workspace = await activeWorkspace(process.cwd(), {
        ...(global.product ? { productId: global.product } : {}),
        ...(global.anchor ? { anchorPath: global.anchor } : {}),
      });
      const status = parseStatusFilter(options.status);
      const collection = await loadIssues(workspace.productDir, workspace.product.id);
      const issues = filterByStatus(collection.issues, status);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              issues: issues.map((issue) => publicIssue(issue)),
              conflicts: collection.conflicts.map(({ filePath: _filePath, ...rest }) => rest),
            },
            null,
            2,
          ),
        );
        return;
      }
      for (const issue of issues) {
        const note =
          issue.close?.reason === 'wontdo' && issue.close.note
            ? ` — ${issue.close.note}`
            : '';
        console.log(`${issue.id} [${statusLabel(issue)}${note}] ${issue.title}`);
      }
      for (const conflict of collection.conflicts) {
        console.error(`需要处理：${conflict.relativePath}（${conflict.error}）`);
      }
    });

  program
    .command('show <id>')
    .description('查看一条需求')
    .option('--json', '输出 JSON')
    .action(async (id: string, options: { json?: boolean }, command: Command) => {
      const global = command.optsWithGlobals() as { product?: string; anchor?: string };
      const workspace = await activeWorkspace(process.cwd(), {
        ...(global.product ? { productId: global.product } : {}),
        ...(global.anchor ? { anchorPath: global.anchor } : {}),
      });
      const collection = await loadIssues(workspace.productDir, workspace.product.id);
      const issue = collection.issues.find((item) => item.id === id);
      if (!issue) throw new OpenIssueError(`找不到需求 ${id}`, 'ISSUE_NOT_FOUND');
      const handoff =
        issue.proposals.length > 0
          ? await readHandoffState(workspace.anchorRoot, issue)
          : undefined;
      if (options.json) {
        console.log(
          JSON.stringify(
            { ...publicIssue(issue), ...(handoff ? { handoff } : {}) },
            null,
            2,
          ),
        );
        return;
      }
      console.log(`${issue.id} ${issue.title}`);
      console.log(`状态：${statusLabel(issue)}`);
      console.log(`作者：${issue.author}`);
      console.log(`创建：${issue.created_at}`);
      if (issue.close) {
        console.log(`关闭原因：${closeLabel(issue.close.reason)}${issue.close.note ? ` — ${issue.close.note}` : ''}`);
      }
      if (handoff) {
        console.log(
          `提案：${handoff.proposals
            .map(
              (proposal) =>
                `${proposal.id}（${proposal.state === 'active' ? '在途' : proposal.state === 'archived' ? '已归档' : '失效'}）`,
            )
            .join('、')}`,
        );
        if (issue.status === 'open' && handoff.interview_incomplete) {
          console.log(`访谈未完成：${handoff.interview_change_ids.join('、')}`);
          console.log(`继续：openissue start ${issue.id}`);
        }
        if (issue.status === 'open' && handoff.interview_completed) {
          console.log(`访谈已完成：${handoff.interview_completed_change_ids.join('、')}`);
        }
        if (handoff.interview_unknown) {
          console.log('访谈状态未知：关联提案的访谈标记无法读取');
        }
        if (handoff.archived_pending) {
          console.log(`提案已归档，待确认完成：openissue confirm ${issue.id}`);
        }
        if (handoff.link_invalid) {
          console.log('关联失效：在活跃变更与归档区都找不到关联提案');
        }
      }
      const blocking = collection.issues.filter(
        (candidate) => candidate.status === 'open' && candidate.blocked_by.includes(issue.id),
      );
      const waiting = issue.blocked_by
        .map((blockerId) => collection.issues.find((candidate) => candidate.id === blockerId))
        .filter((candidate): candidate is Issue => Boolean(candidate) && candidate!.status === 'open');
      if (blocking.length > 0) {
        console.log(`阻塞：${blocking.map((item) => `${item.id} ${item.title}`).join('、')}`);
      }
      if (waiting.length > 0) {
        console.log(`等待：${waiting.map((item) => `${item.id} ${item.title}`).join('、')}`);
      }
      if (issue.description) console.log(`\n${issue.description}`);
    });
}

export function statusLabel(issue: Issue): string {
  if (issue.status === 'open') return '打开';
  return `关闭 · ${issue.close ? closeLabel(issue.close.reason) : '未知原因'}`;
}

export function closeLabel(reason: 'completed' | 'wontdo'): string {
  return reason === 'completed' ? '已完成' : '不做';
}
