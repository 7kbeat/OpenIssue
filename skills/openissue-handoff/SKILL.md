---
name: openissue-handoff
description: Re-link an OpenIssue requirement to an existing OpenSpec proposal or confirm completion after all linked proposals are archived. Never creates new proposals or fabricates OpenSpec artifacts.
allowed-tools: Bash(openissue:*)
license: MIT
compatibility: Requires openissue CLI and OpenSpec CLI.
metadata:
  author: openissue
  version: "1.3"
---

# OpenIssue Handoff

**Lifecycle stage:** Proposal Re-linking, Archive Verification & Completion Confirmation (Stage 4 of 4: Capture → Triage → Interview & Spec → Handoff & Archive).

`openissue-handoff` handles only two post-planning / exception lifecycle paths:

1. **Re-link** an issue to an already-existing active OpenSpec proposal (`openissue handoff <id> --link <existing-change-id>`).
2. **Verify archival and confirm completion** after all linked OpenSpec proposals have been archived (`openissue confirm <id>`).

Creating a new OpenSpec proposal is NOT this skill's responsibility. When an issue needs a new proposal, start a product decision interview with `openissue start <id>` and `openissue-grill-me`.

## Read First

Always inspect the issue and its live handoff state before acting:

```bash
openissue show <id> --json
```

Inspect the `handoff` object in the JSON output:

- `proposals[]`: Current state of each linked change (`active`, `archived`, or `missing`) plus `updated_since_proposal`.
- `archived_pending`: `true` only when the issue is `open`, has at least one linked proposal, and **every** linked proposal is `archived`.
- `link_invalid`: `true` when any linked proposal is `missing` from both active changes and the archive.
- `updated_since_proposal`: `true` when the issue title or description changed after the proposal link snapshot was recorded.
- `interview_incomplete` / `interview_completed` / `interview_unknown`: Indicates whether an active proposal still has an unfinished interview, has an explicitly completed interview marker, or has an unreadable `x-openissue-interview` marker.
- `interview_change_ids` / `interview_completed_change_ids`: Active proposals with incomplete or completed interview markers, respectively.

## 1. Re-link an Existing Active Proposal

Use this path only when the user explicitly chooses an existing active OpenSpec change instead of starting a new interview draft:

1. Warn the user that manual linking skips the product decision interview (`openissue-grill-me`) and ask for explicit confirmation before linking.
2. Execute:
   ```bash
   openissue handoff <id> --link <existing-change-id> --yes --json
   ```
   (Omit `--yes` in an interactive TTY if you want the CLI prompt itself to confirm.)
3. If `link_invalid` was present due to a missing link, explain the broken link first; never guess whether the proposal was renamed or deleted.
4. Keep the issue `open`. Linking adds the association (`x-openissue-issues` and `proposals[]`) without copying or rewriting proposal, spec, design, or task contents.

## 2. Verify Archival & Confirm Completion

After `openissue-apply` completes the implementation and `openspec archive` archives the proposal:

1. Re-read the issue state:
   ```bash
   openissue show <id> --json
   ```
2. Check readiness gates before confirming:
   - **All linked proposals archived (`archived_pending: true`):** Present the archived proposal IDs and ask the user to confirm completion.
   - **Partial archival (some `active`, some `archived`):** Report the remaining active proposals. The issue MUST stay `open`; do NOT run `confirm`.
   - **Broken link (`link_invalid: true`):** Report the missing proposal IDs. Do NOT run `confirm` or guess what happened; let the user re-link or decide how to close.
   - **Issue edited after snapshot (`updated_since_proposal: true`):** Point out that the issue title or description changed after the proposal was linked so the user can verify nothing was missed before confirming completion.
3. Only after the user explicitly confirms the requirement is complete, run:
   ```bash
   openissue confirm <id> --json
   ```
   Never substitute `openissue close <id> --reason completed` for `openissue confirm <id>` when completing an archived OpenSpec handoff—`confirm` enforces the all-archived invariant and preserves archive-completion semantics.
4. If the user instead decides not to ship or pursue the requirement, close with an explicit reason note and inform the user that linked OpenSpec proposals are not automatically cancelled or modified:
   ```bash
   openissue close <id> --reason wontdo --note "<reason>"
   ```

## Boundaries

- **Do NOT create new proposals:** Direct proposal creation via `handoff --change` is disabled; always use `openissue start <id>` and `openissue-grill-me` for new proposals.
- **Do NOT implement code:** Implementation belongs to `openissue-apply`; this skill only re-links proposals and confirms archived completion.
- **Do NOT forge OpenSpec artifacts or state:** Never fabricate `proposal.md`, `specs/`, `design.md`, `tasks.md`, `.openspec.yaml` metadata, or archive status.
- **Do NOT mark interviews completed here:** Interview completion belongs to `openissue-grill-me` and `openissue start <id> --complete <change-id>`. This skill only re-links proposals and confirms archived completion.
- **Do NOT auto-close issues** or mutate existing proposal contents during handoff.

## Output

Report the issue `id`, linked proposal IDs and states (`active` / `archived` / `missing`), any snapshot-drift or link warnings, the action taken (`linked`, `confirmed completed`, `closed wontdo`, or `held open`), and the final issue `status`.
