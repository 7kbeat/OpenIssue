import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import { updateFocus } from '../storage/product.js';
import { activeWorkspace } from './context.js';

export function registerFocusCommand(program: Command): void {
  program
    .command('focus [text]')
    .description('查看或设置产品当前重点')
    .option('--clear', '清空当前重点')
    .option('--json', '输出 JSON')
    .action(async (text: string | undefined, options: { clear?: boolean; json?: boolean }, command: Command) => {
      if (text !== undefined && options.clear) {
        throw new OpenIssueError('不能同时提供重点文本与 --clear', 'INVALID_FOCUS');
      }
      const global = command.optsWithGlobals() as { product?: string; anchor?: string };
      const workspace = await activeWorkspace(process.cwd(), {
        ...(global.product ? { productId: global.product } : {}),
        ...(global.anchor ? { anchorPath: global.anchor } : {}),
      });
      const changing = text !== undefined || options.clear === true;
      const product = changing
        ? await updateFocus(workspace.anchorRoot, options.clear ? '' : text ?? '')
        : workspace.product;
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              focus: product.focus,
              focus_updated_at: product.focus_updated_at,
            },
            null,
            2,
          ),
        );
        return;
      }
      if (!product.focus) {
        console.log('当前重点：未设置');
      } else {
        console.log(`当前重点：${product.focus}`);
        if (product.focus_updated_at) console.log(`更新于：${product.focus_updated_at}`);
      }
    });
}
