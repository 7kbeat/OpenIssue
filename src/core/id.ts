import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeIssueId(now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = randomBytes(4);
  let suffix = '';
  for (const byte of bytes) suffix += ALPHABET[byte % ALPHABET.length];
  return `OI-${day}-${suffix}`;
}

export function isValidIssueId(value: string): boolean {
  return /^OI-\d{8}-[A-Z0-9]{4}$/.test(value);
}

export function slugifyTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 60)
    .replace(/-+$/g, '');
}

export function isValidChangeId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value) && value.length <= 64;
}

export function suggestChangeId(title: string, issueId: string): string {
  const slug = slugifyTitle(title);
  if (isValidChangeId(slug)) return slug;
  return issueId.toLowerCase();
}
