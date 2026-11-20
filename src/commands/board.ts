import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { errorMessage, OpenIssueError } from '../core/errors.js';
import { startBoard } from '../board/server.js';
import { activeWorkspace } from './context.js';

export function registerBoardCommand(program: Command): void {
  program
    .command('board')
    .description('启动本地看板，仅绑定 127.0.0.1')
    .option('--port <port>', '端口，默认 4310', '4310')
    .option('--no-open', '不自动打开浏览器')
    .action(async (options: { port?: string; open?: boolean }, command: Command) => {
      const port = Number(options.port ?? 4310);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new OpenIssueError('端口必须是 0 到 65535 之间的整数', 'INVALID_PORT');
      }
      const global = command.optsWithGlobals() as { product?: string; anchor?: string };
      const workspace = await activeWorkspace(process.cwd(), {
        ...(global.product ? { productId: global.product } : {}),
        ...(global.anchor ? { anchorPath: global.anchor } : {}),
      });
      let board;
      try {
        board = await startBoard({
          context: {
            anchorRoot: workspace.anchorRoot,
            productDir: workspace.productDir,
            product: workspace.product,
          },
          port,
        });
      } catch (error) {
        throw new OpenIssueError(
          `看板启动失败：${errorMessage(error)}`,
          'BOARD_START_FAILED',
        );
      }
      console.log(`看板已启动：${board.url}`);
      console.log('仅绑定 127.0.0.1；按 Ctrl+C 停止。');
      if (options.open !== false) openBrowser(board.url);
      const stop = () => {
        void board.close().finally(() => process.exit(0));
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
}

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // The URL is printed regardless of whether the browser can be opened.
  }
}
