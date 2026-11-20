export class OpenIssueError extends Error {
  readonly code: string;
  readonly exitCode: number;

  constructor(message: string, code = 'OPENISSUE_ERROR', exitCode = 1) {
    super(message);
    this.name = 'OpenIssueError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
