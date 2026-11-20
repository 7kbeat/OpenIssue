import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import type { Issue } from '../core/types.js';
import { assertCanDepend } from '../domain/dependencies.js';
import { loadIssues, mutateIssue } from '../storage/issue.js';
import { activeWorkspace } from './context.js';

export function registerDependencyCommands(program: Command): void {
  program
    .command('depend <blocker> <blocked>')
    .description('声明一条需求阻塞另一条需求')
    .option('--json', '输出 JSON')
    .action(
      async (blocker: string, blocked: string, options: { json?: boolean }, command: Command) => {
        const workspace = await workspaceFor(command);
        const collection = await loadIssues(workspace.productDir, workspace.product.id);
        const blockerIssue = requireIssue(collection.issues, blocker);
        const blockedIssue = requireIssue(collection.issues, blocked);
        if (blockedIssue.blocked_by.includes(blocker)) {
          throw new OpenIssueError('依赖关系已经存在', 'DEPENDENCY_EXISTS');
        }
        assertCanDepend(collection.issues, blocker, blocked);
        const updated = await mutateIssue(
          workspace.productDir,
          workspace.product.id,
          blocked,
          (issue) => {
            issue.blocked_by = [...issue.blocked_by, blocker];
          },
        );
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                blocker: blockerIssue.id,
                blocked: updated.id,
                blocked_by: updated.blocked_by,
              },
              null,
              2,
            ),
          );
        } else {
          console.log(`${blockerIssue.id} 阻塞 ${updated.id}`);
        }
      },
    );

  program
    .command('undepend <blocker> <blocked>')
    .description('移除一条阻塞关系')
    .option('--json', '输出 JSON')
    .action(
      async (blocker: string, blocked: string, options: { json?: boolean }, command: Command) => {
        const workspace = await workspaceFor(command);
        const collection = await loadIssues(workspace.productDir, workspace.product.id);
        const blockedIssue = requireIssue(collection.issues, blocked);
        if (!blockedIssue.blocked_by.includes(blocker)) {
          throw new OpenIssueError('依赖关系不存在', 'DEPENDENCY_NOT_FOUND');
        }
        const updated = await mutateIssue(
          workspace.productDir,
          workspace.product.id,
          blocked,
          (issue) => {
            issue.blocked_by = issue.blocked_by.filter((id) => id !== blocker);
          },
        );
        if (options.json) {
          console.log(
            JSON.stringify(
              { blocker, blocked: updated.id, blocked_by: updated.blocked_by },
              null,
              2,
            ),
          );
        } else {
          console.log(`已移除：${blocker} 阻塞 ${updated.id}`);
        }
      },
    );
}

function requireIssue(issues: Issue[], id: string): Issue {
  const issue = issues.find((item) => item.id === id);
  if (!issue) throw new OpenIssueError(`找不到需求 ${id}`, 'ISSUE_NOT_FOUND');
  return issue;
}

async function workspaceFor(command: Command) {
  const global = command.optsWithGlobals() as { product?: string; anchor?: string };
  return activeWorkspace(process.cwd(), {
    ...(global.product ? { productId: global.product } : {}),
    ...(global.anchor ? { anchorPath: global.anchor } : {}),
  });
}
