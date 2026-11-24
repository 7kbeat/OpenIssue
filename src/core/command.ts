import { spawnSync } from 'node:child_process';

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/**
 * Run a short-lived external command.
 *
 * On Windows, `.cmd` shims such as `openspec.cmd` need a shell. Passing args
 * together with `shell: true` triggers Node's DEP0190 warning, so the whole
 * command line is passed as a single shell string instead.
 */
export function runCommand(
  command: string,
  args: string[] = [],
  options: CommandOptions = {},
): CommandResult {
  const common = {
    encoding: 'utf8' as const,
    windowsHide: true,
    ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
  };
  const result =
    process.platform === 'win32'
      ? spawnSync(
          [command, ...args]
            .map((value) =>
              value.length === 0 || /[\s"&|<>^()%!]/.test(value)
                ? `"${value.replace(/"/g, '\\"')}"`
                : value,
            )
            .join(' '),
          { ...common, shell: true },
        )
      : spawnSync(command, args, common);
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error } : {}),
  };
}
