import YAML from 'yaml';
import { OpenIssueError } from '../core/errors.js';

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseMarkdown(raw: string): ParsedMarkdown {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!match) {
    throw new OpenIssueError('记录缺少 YAML frontmatter，无法解析', 'PARSE_ERROR');
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(match[1] ?? '');
  } catch (error) {
    throw new OpenIssueError(
      `YAML frontmatter 解析失败：${error instanceof Error ? error.message : String(error)}`,
      'PARSE_ERROR',
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OpenIssueError('YAML frontmatter 必须是对象', 'PARSE_ERROR');
  }
  let body = match[2] ?? '';
  if (body.startsWith('\n')) body = body.slice(1);
  return { frontmatter: parsed as Record<string, unknown>, body };
}

export function serializeMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const yaml = YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd();
  const content = body.replace(/\r\n/g, '\n').replace(/\n+$/g, '');
  return content ? `---\n${yaml}\n---\n\n${content}\n` : `---\n${yaml}\n---\n`;
}
