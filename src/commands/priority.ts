import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { errorMessage, OpenIssueError } from '../core/errors.js';
import type { EvaluatedIssue, PriorityContext, PriorityEvaluation } from '../domain/priority.js';
import { evaluatePriority, tierLabel } from '../domain/priority.js';
import { buildAssistantRequest } from '../domain/assistant.js';
import { applyAssistantResults } from '../services/priority.js';
import { readProjectFacts } from '../storage/facts.js';
import { loadIssues, publicIssue } from '../storage/issue.js';
import { activeWorkspace } from './context.js';

export function registerPriorityCommand(program: Command): void {
  program
    .command('priority')
    .alias('prioritize')
    .description('展示优先级；或生成/应用助手判断请求')
    .option('--json', '输出 JSON')
    .option('--emit', '输出助手判断请求')
    .option('--apply <file>', '应用助手响应；使用 - 从标准输入读取')
    .action(async (options: { json?: boolean; emit?: boolean; apply?: string }, command: Command) => {
      if (options.emit && options.apply) {
        throw new OpenIssueError('--emit 与 --apply 不能同时使用', 'INVALID_PRIORITY_OPTIONS');
      }
      const global = command.optsWithGlobals() as { product?: string; anchor?: string };
      const workspace = await activeWorkspace(process.cwd(), {
        ...(global.product ? { productId: global.product } : {}),
        ...(global.anchor ? { anchorPath: global.anchor } : {}),
      });
      const collection = await loadIssues(workspace.productDir, workspace.product.id);
      const facts = await readProjectFacts(workspace.anchorRoot);
      const context = { focus: workspace.product.focus, facts };
      const evaluation = evaluatePriority(collection.issues, context);

      if (options.emit) {
        const request = buildAssistantRequest(workspace.product, context, evaluation);
        console.log(JSON.stringify(request, null, 2));
        return;
      }
      if (options.apply) {
        await applyResponse(options.apply, workspace.productDir, workspace.product.id, context, evaluation);
        return;
      }

      if (options.json) {
        console.log(
          JSON.stringify(
            {
              focus: workspace.product.focus,
              focus_updated_at: workspace.product.focus_updated_at,
              facts,
              groups: {
                high: evaluation.groups.high.map(itemJson),
                medium: evaluation.groups.medium.map(itemJson),
                low: evaluation.groups.low.map(itemJson),
                unassessed: evaluation.groups.unassessed.map(itemJson),
              },
              closed: evaluation.closed.map((issue) => publicIssue(issue)),
              conflicts: collection.conflicts.map(({ filePath: _filePath, ...rest }) => rest),
            },
            null,
            2,
          ),
        );
        return;
      }
      console.log(
        workspace.product.focus
          ? `当前重点：${workspace.product.focus}`
          : '当前重点：未设置（判断依据有限）',
      );
      for (const key of ['high', 'medium', 'low', 'unassessed'] as const) {
        console.log(`${tierLabel(key)}`);
        const items = evaluation.groups[key];
        if (items.length === 0) {
          console.log('  （无）');
          continue;
        }
        for (const item of items) {
          console.log(`  ${item.issue.id} ${item.issue.title}`);
          console.log(`    理由：${item.reason}${markers(item)}`);
        }
      }
      if (evaluation.groups.unassessed.length > 0) {
        console.log('语义判断尚未完成：待评估项不会被自动归入某一档。');
      }
      for (const conflict of collection.conflicts) {
        console.error(`需要处理：${conflict.relativePath}（${conflict.error}）`);
      }
    });
}

async function applyResponse(
  file: string,
  productDir: string,
  productId: string,
  context: PriorityContext,
  evaluation: PriorityEvaluation,
): Promise<void> {
  const rawText =
    file === '-'
      ? await readStdin()
      : await readFile(path.resolve(process.cwd(), file), 'utf8');
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch (error) {
    throw new OpenIssueError(
      `助手响应不是合法 JSON：${errorMessage(error)}`,
      'INVALID_ASSISTANT_RESPONSE',
    );
  }
  const { applied, errors } = await applyAssistantResults({
    raw,
    productDir,
    productId,
    context,
    evaluation,
  });
  console.log(JSON.stringify({ applied, errors }, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function itemJson(item: EvaluatedIssue): Record<string, unknown> {
  return {
    ...publicIssue(item.issue),
    effective_tier: item.tier,
    reason: item.reason,
    basis: item.basis,
    manual: item.manual,
    stale: item.stale,
    dependency_floor: item.dependency_floor,
    invalid_dependency: item.invalid_dependency,
    blocked: item.blocked,
    ...(item.blocked_reason ? { blocked_reason: item.blocked_reason } : {}),
    ...(item.input_hash ? { input_hash: item.input_hash } : {}),
    ...(item.judged_at ? { judged_at: item.judged_at } : {}),
  };
}

function markers(item: EvaluatedIssue): string {
  const values: string[] = [];
  if (item.manual) values.push('手动');
  if (item.stale) values.push('待刷新');
  if (item.dependency_floor) values.push('依赖下限');
  if (item.invalid_dependency) values.push('前置已放弃');
  if (item.blocked && !item.invalid_dependency) values.push('被阻塞');
  return values.length > 0 ? `（${values.join('、')}）` : '';
}
