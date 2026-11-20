#!/usr/bin/env node
import { Command } from 'commander';
import { pathToFileURL } from 'node:url';
import { errorMessage, OpenIssueError } from './core/errors.js';
import { VERSION } from './core/version.js';
import { registerCreateCommand } from './commands/create.js';
import { registerBoardCommand } from './commands/board.js';
import { registerDependencyCommands } from './commands/dependencies.js';
import { registerEditCommand } from './commands/edit.js';
import { registerFocusCommand } from './commands/focus.js';
import { registerHandoffCommands } from './commands/handoff.js';
import { registerListCommand } from './commands/list.js';
import { registerLifecycleCommands } from './commands/lifecycle.js';
import { registerPriorityCommand } from './commands/priority.js';
import { registerWorkspaceCommands } from './commands/register.js';
import { registerSkillsCommands } from './commands/skills.js';
import { registerTierCommand } from './commands/tier.js';

export { VERSION };

export function createProgram(): Command {
  const program = new Command();
  program
    .name('openissue')
    .description('Git 原生的需求收件箱')
    .version(VERSION, '--version', '显示版本号')
    .option('--anchor <path>', '显式指定产品锚点仓库')
    .option('--product <id>', '在多个产品归属中选择一个');
  registerCreateCommand(program);
  registerBoardCommand(program);
  registerEditCommand(program);
  registerListCommand(program);
  registerLifecycleCommands(program);
  registerDependencyCommands(program);
  registerPriorityCommand(program);
  registerFocusCommand(program);
  registerTierCommand(program);
  registerHandoffCommands(program);
  registerWorkspaceCommands(program);
  registerSkillsCommands(program);
  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  try {
    await createProgram().parseAsync(argv);
  } catch (error) {
    console.error(`错误：${errorMessage(error)}`);
    process.exitCode = error instanceof OpenIssueError ? error.exitCode : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
