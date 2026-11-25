export type PriorityTier = '高' | '中' | '低';
export type EffectiveTier = PriorityTier | '待评估';
export type IssueStatus = 'open' | 'closed';
export type CloseReason = 'completed' | 'wont_do';
export type IssueSource = 'cli' | 'board';

export interface IssuePriorityMeta {
  tier?: EffectiveTier;
  manual_tier?: PriorityTier;
  order?: number;
  reason?: string;
  basis?: string[];
  evidence?: string[];
  judged_at?: string;
  input_hash?: string;
  source?: string;
  manual_at?: string;
}

export interface IssueProposalLink {
  id: string;
  path: string;
  created_at?: string;
  snapshot_hash?: string;
}

export interface IssueCloseInfo {
  reason: CloseReason;
  note?: string;
  closed_at: string;
}

export interface IssueRecord {
  id: string;
  title: string;
  description: string;
  product_id: string;
  status: IssueStatus;
  close?: IssueCloseInfo;
  close_reason?: CloseReason;
  close_note?: string;
  closed_at?: string;
  created_at: string;
  updated_at: string;
  author: string;
  source: IssueSource | string;
  blocked_by: string[];
  proposals: IssueProposalLink[];
  priority: IssuePriorityMeta;
  rawFrontmatter: Record<string, unknown>;
  filePath: string;
  rawMarkdown: string;
}

export interface ConflictRecord {
  id: string;
  fileName: string;
  filePath: string;
  relativePath: string;
  error: string;
  rawContent: string;
}

export interface ProductMemberRepo {
  id: string;
  name?: string;
  path?: string;
}

export interface ProductFocus {
  text: string;
  updated_at: string;
}

export interface ProductConfig {
  id: string;
  name: string;
  anchor_repo: string;
  anchor_path: string;
  focus?: ProductFocus;
  members: ProductMemberRepo[];
  raw: Record<string, unknown>;
}

export interface OpenSpecTaskProgress {
  done: number;
  total: number;
}

export interface OpenSpecChange {
  id: string;
  title: string;
  description: string;
  status: 'active' | 'archived';
  archived_at?: string;
  path: string;
  tasks: OpenSpecTaskProgress;
  x_openissue_issues: string[];
  rawOpenspecYaml?: string;
}

export interface OpenSpecSpec {
  id: string;
  name: string;
  summary: string;
  path: string;
}

export type WorkspaceResolutionMode = 'anchor' | 'member';

export interface WorkspaceState {
  mode: WorkspaceResolutionMode;
  currentRepoName: string;
  currentRepoPath: string;
  anchorRoot: string;
  productDir: string;
  memberRoot?: string;
  selectedProductId: string;
  candidateProducts: Array<{ id: string; name: string; anchor_repo: string }>;
  openspecInitialized: boolean;
  assistantAvailable: boolean;
  skillAvailable: boolean;
}

export interface DependencyNodeInfo {
  id: string;
  title: string;
  status: IssueStatus | 'unknown';
  close_reason?: CloseReason;
  effectiveTier?: EffectiveTier;
}

export type RulePrecedenceStage =
  | 'closed_excluded'
  | 'dependency_abandoned'
  | 'dependency_unknown'
  | 'dependency_floor'
  | 'manual_override'
  | 'assistant_judgment'
  | 'pending_evaluation';

export type ProposalLinkState = 'active' | 'archived' | 'missing';

export interface ProposalLinkStatus {
  id: string;
  path: string;
  created_at?: string;
  snapshot_hash?: string;
  state: ProposalLinkState;
  tasks?: OpenSpecTaskProgress;
  archived_at?: string;
  hasSnapshotDiff: boolean;
  interviewIncomplete?: boolean;
  interviewCompleted?: boolean;
  interviewUnknown?: boolean;
}

export interface StartProposal {
  id: string;
  path: string;
  state: ProposalLinkState;
  interview_status: 'none' | 'incomplete' | 'unknown';
}

export interface StartContext {
  issue: Record<string, unknown>;
  focus: string;
  suggested_change_id: string;
  active_proposals: StartProposal[];
  archived_proposals: StartProposal[];
  missing_proposals: StartProposal[];
  selection_required: boolean;
  resume_change_id?: string;
  interview: {
    status: 'none' | 'incomplete' | 'completed' | 'unknown';
    change_ids: string[];
  };
  skill_available: boolean;
  instruction: string;
}

export interface EvaluatedIssue {
  issue: IssueRecord;
  effectiveTier: EffectiveTier | null;
  reason: string;
  basis: string[];
  precedenceStage: RulePrecedenceStage;
  isManual: boolean;
  manualOverriddenByRule: boolean;
  isStale: boolean;
  currentInputHash: string;
  judgedAt?: string;
  sortRank: number;
  dependencyDepth: number;
  upstreamDeps: DependencyNodeInfo[];
  downstreamDeps: DependencyNodeInfo[];
  hasAbandonedUpstream: boolean;
  hasUnknownUpstream: boolean;
  isBlocked: boolean;
  blockedReason?: string;
  invalidDependency: boolean;
  invalidReason?: string;
  dependencyFloor: boolean;
  proposalStatuses: ProposalLinkStatus[];
  readyToConfirmComplete: boolean;
  hasBrokenProposalLink: boolean;
  hasSnapshotDiff: boolean;
  startContext?: StartContext;
}

export interface ProjectFacts {
  specs: OpenSpecSpec[];
  activeChanges: OpenSpecChange[];
  archivedChanges: OpenSpecChange[];
  openspecInitialized: boolean;
}

export type StatusFilterOption = 'open' | 'include_closed' | 'closed_only';
export type TierFilterOption = 'all' | EffectiveTier;
export type ProposalFilterOption = 'all' | 'linked' | 'unlinked';
export type BlockedFilterOption = 'all' | 'blocked' | 'unblocked';

export interface SearchFilterState {
  query: string;
  status: StatusFilterOption;
  tier: TierFilterOption;
  proposal: ProposalFilterOption;
  blocked: BlockedFilterOption;
}

export interface BoardFile {
  path: string;
  content: string;
  kind: 'yaml' | 'markdown';
}

export interface BoardSnapshot {
  workspace: WorkspaceState;
  product: ProductConfig;
  facts: ProjectFacts;
  issues: IssueRecord[];
  evaluated: EvaluatedIssue[];
  conflicts: ConflictRecord[];
  assistantAvailable: boolean;
  files: BoardFile[];
  generatedAt: string;
}

export interface AssistantRequestIssue {
  id: string;
  title: string;
  description: string;
  blocked_by: string[];
  proposals: Array<{
    id: string;
    state: 'active' | 'archived' | 'missing';
    tasks_total: number;
    tasks_done: number;
  }>;
  manual_tier: PriorityTier | null;
  effective_tier: string;
  current_reason: string;
  cached: {
    tier: PriorityTier;
    reason: string;
    judged_at: string | null;
    input_hash: string | null;
  } | null;
  needs_judgment: boolean;
  input_hash: string;
}

export interface AssistantRequest {
  version: 1;
  generated_at: string;
  product: { id: string; name: string };
  focus: string;
  focus_updated_at: string | null;
  facts: {
    specs: Array<{ id: string; title: string; path: string }>;
    proposals: Array<{
      id: string;
      title: string;
      path: string;
      archived: boolean;
      tasks_total: number;
      tasks_done: number;
    }>;
    openspec_initialized: boolean;
  };
  issues: AssistantRequestIssue[];
  request_hash: string;
}

export interface PrioritizeApplyResult {
  applied: string[];
  errors: string[];
}

export interface PrioritizeApplyResponse {
  result: PrioritizeApplyResult;
  snapshot: BoardSnapshot;
}
