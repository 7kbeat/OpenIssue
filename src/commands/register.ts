import path from 'node:path';
import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import { readProduct, productExists } from '../storage/product.js';
import { findGitRoot, registerRepository } from '../storage/workspace.js';

export function registerRegisterCommand(program: Command): void {
  program
    .command('register')
    .description('把当前仓库登记到产品锚点')
    .option('--name <name>', '成员仓库名称')
    .action(async (options: { name?: string }, command: Command) => {
      const global = command.optsWithGlobals() as { anchor?: string; product?: string };
      if (!global.anchor) {
        throw new OpenIssueError('必须提供 --anchor <path>', 'ANCHOR_REQUIRED');
      }
      const repoRoot = (await findGitRoot(process.cwd())) ?? path.resolve(process.cwd());
      const anchorRoot = path.resolve(process.cwd(), global.anchor);
      if (!(await productExists(anchorRoot))) {
        throw new OpenIssueError(`指定的锚点仓库不存在：${anchorRoot}`, 'NOT_ANCHOR');
      }
      const product = await readProduct(anchorRoot);
      const productId = global.product?.trim() || product.id;
      await registerRepository(repoRoot, anchorRoot, productId, options.name);
      console.log(`已把 ${repoRoot} 登记到产品 ${productId}`);
      console.log(`成员指针：${path.join(repoRoot, 'openissue-project.yaml')}`);
    });
}
