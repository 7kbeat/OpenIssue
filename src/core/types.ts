export type Tier = 'high' | 'medium' | 'low';
export type EffectiveTier = Tier | 'unassessed';
export type IssueStatus = 'open' | 'closed';
export type CloseReason = 'completed' | 'wontdo';
export type IssueSource = 'cli' | 'board';

export interface CloseInfo {
  reason: CloseReason;
  note?: string;
  closed_at: string;
}

export interface ProposalLink {
  id: string;
  path: string;
  created_at: string;
  snapshot_hash: string;
}

export interface PriorityCache {
  tier?: Tier;
  order?: number;
  reason?: string;
  basis?: string[];
  judged_at?: string;
  input_hash?: string;
  source?: 'assistant' | 'manual' | 'rule';
  manual_tier?: Tier;
  manual_at?: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string;
  status: IssueStatus;
  product: string;
  created_at: string;
  updated_at: string;
  author: string;
  source: IssueSource;
  close?: CloseInfo;
  blocked_by: string[];
  proposals: ProposalLink[];
  priority: PriorityCache;
  filePath: string;
  rawFrontmatter: Record<string, unknown>;
}

export interface IssueConflict {
  filePath: string;
  relativePath: string;
  raw: string;
  error: string;
}

export interface IssueCollection {
  issues: Issue[];
  conflicts: IssueConflict[];
}

export interface ProductMember {
  id: string;
  name?: string;
  path?: string;
}

export interface ProductManifest {
  id: string;
  name: string;
  focus: string;
  focus_updated_at: string | null;
  members: ProductMember[];
  raw: Record<string, unknown>;
}

export interface RegistryEntry {
  anchor_path: string;
  name?: string;
}

export interface Registry {
  products: Record<string, RegistryEntry>;
}

export interface ProposalFact {
  id: string;
  title: string;
  path: string;
  archived: boolean;
  tasks_total: number;
  tasks_done: number;
}

export interface SpecFact {
  id: string;
  title: string;
  path: string;
}

export interface ProjectFacts {
  specs: SpecFact[];
  proposals: ProposalFact[];
  openspec_initialized: boolean;
}

export interface PriorityViewItem {
  issue: Issue;
  tier: EffectiveTier;
  reason: string;
  basis: string[];
  order: number;
  manual: boolean;
  stale: boolean;
  dependency_floor: boolean;
  invalid_dependency: boolean;
  invalid_reason?: string;
  blocked: boolean;
  blocked_reason?: string;
  archived_pending: boolean;
  link_invalid: boolean;
  proposals: Array<ProposalLink & { state: 'active' | 'archived' | 'missing' }>;
}

export interface PriorityView {
  product: ProductManifest;
  facts: ProjectFacts;
  groups: Record<'high' | 'medium' | 'low' | 'unassessed', PriorityViewItem[]>;
  closed: Issue[];
  conflicts: IssueConflict[];
}
