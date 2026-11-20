import path from 'node:path';
import type { Command } from 'commander';
import { OpenIssueError } from '../core/errors.js';
import { slugifyTitle } from '../core/id.js';
import { readProduct, initProduct, productExists } from '../storage/product.js';
import { registerAnchor } from '../storage/registry.js';
import { findGitRoot, registerRepository } from '../storage/workspace.js';
import { resolveSkillTools } from '../skills/catalog.js';
import { installSkills, summarizeInstall } from '../skills/install.js';

export function registerWorkspaceCommands(program: Command): void {
  program
    .command('init')
    .description('把当前目录初始化为产品锚点仓库')
    .option('--id <id>', '产品标识，默认取目录名')
    .option('--name <name>', '产品名称')
    .option('--skills [tools]', '安装配套 skills；缺省 agents，none 跳过')
    .action(async (options: { id?: string; name?: string; skills?: string | boolean }) => {
      const root = path.resolve(process.cwd());
      const selectedSkills =
        options.skills === undefined
          ? undefined
          : resolveSkillTools(options.skills === true ? 'agents' : options.skills);
      if (await productExists(root)) {
        throw new OpenIssueError('当前目录已经是 OpenIssue 锚点仓库', 'ALREADY_INITIALIZED');
      }
      const fallback = slugifyTitle(path.basename(root)) || 'openissue-product';
      const id = (options.id ?? fallback).trim();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        throw new OpenIssueError(
          '产品标识只能包含小写字母、数字与连字符，且不能以连字符开头',
          'INVALID_PRODUCT_ID',
        );
      }
      const product = await initProduct(root, id, options.name?.trim() || id);
      await registerAnchor(product.id, root, product.name);
      console.log(`已初始化产品 ${product.id}（${product.name}）`);
      console.log(`需求目录：${path.join(root, 'openissue', 'issues')}`);
      if (selectedSkills === undefined) {
        console.log('提示：运行 openissue skills install 安装配套 Agent skills。');
      } else if (selectedSkills.length === 0) {
        console.log('已跳过配套 skills。');
      } else {
        const results = await installSkills(root, selectedSkills);
        console.log(summarizeInstall(results));
      }
    });

  program
    .command('register')
    .description('把当前仓库登记到产品锚点')
    .option('--name <name>', '成员仓库名称')
    .action(
      async (options: { name?: string }, command: Command) => {
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
      },
    );
}
