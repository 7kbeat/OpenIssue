---
name: openissue-triage
description: Review the OpenIssue inbox, explain priority evaluations, run assistant-assisted prioritization (--emit/--apply), manage dependencies and focus, and handle explicit close/reopen decisions.
allowed-tools: Bash(openissue:*)
license: MIT
compatibility: Requires openissue CLI.
metadata:
  author: openissue
  version: "1.1"
---

# OpenIssue Triage

**Lifecycle stage:** Triage, Prioritization & Dependency Maintenance (Stage 2 of 4: Capture → Triage → Interview & Spec → Handoff & Archive).

Use this skill to review open issues, explain why each item sits in its current tier, maintain product focus and explicit blocking dependencies, run assistant-assisted prioritization, and apply explicit lifecycle transitions (`close` / `reopen`). Never guess importance from creation time and never auto-close issues.

## Read First

Inspect the current evaluation and product facts before making any recommendation or change:

```bash
openissue priority --json
openissue show <id> --json
```

In `priority --json`, review `focus`, `facts` (`specs`, `proposals`, `openspec_initialized`), `groups` (`high`, `medium`, `low`, `unassessed`), and `conflicts`:

- `reason` and `basis`: Check whether the priority conclusion is backed by real project facts.
- `stale`: True when `focus`, facts, issue content, or dependencies changed since the last judgment.
- `manual`, `dependency_floor`, `blocked`, `invalid_dependency`: Distinguish manual overrides, dependency-lifted floors, open blockers, and broken/`wontdo` blockers.
- `conflicts`: Any unparseable or duplicate issue file MUST be reported explicitly; never ignore or auto-repair conflicts.

## Priority Evaluation Rules

OpenIssue evaluates priority in a fixed deterministic order. Never bypass or invert this order:

1. **Exclude closed issues** from active priority groups.
2. **Detect invalid dependencies:** A missing blocker or a blocker closed as `wontdo` forces the downstream issue into `unassessed` (while retaining its saved `manual_tier` until the invalid dependency is removed or replaced).
3. **Apply dependency floor propagation:** An open blocker is lifted to at least the highest effective tier among open, tiered downstream issues it blocks. Floors only lift blockers; they never lower them, and manual overrides do not suppress a dependency floor.
4. **Apply manual override:** `manual_tier` takes precedence over cached assistant judgment.
5. **Apply cached assistant judgment:** When valid and non-stale, use cached `tier`; otherwise leave the issue as `unassessed`.

`unassessed` is an expected, healthy state—never invent reasons just to populate `high`, `medium`, or `low`.

## Allowed Adjustments

Execute mutations only when requested by the user or backed by verified project evidence:

```bash
# Set or clear the current product focus (one concise sentence)
openissue focus "<current product focus>"
openissue focus --clear

# Set manual tier override, or restore rule/assistant evaluation with auto
openissue tier <id> high|medium|low
openissue tier <id> auto

# Declare or remove an explicit blocking edge (blocker blocks blocked; cycles are rejected)
openissue depend <blocker-id> <blocked-id>
openissue undepend <blocker-id> <blocked-id>

# Close or reopen an issue (wontdo requires --note; no permanent delete exists)
openissue close <id> --reason wontdo --note "<reason>"
openissue close <id> --reason completed
openissue reopen <id>
```

### Lifecycle Safeguards for Closing

- **"Deferred" means stay `open`:** There is no permanent delete and no deferred status. Keep deferred items `open` (optionally in `low` or `unassessed`).
- **Linked proposals:** Closing an issue does NOT cancel, modify, or archive linked OpenSpec proposals; always inform the user if `proposals` is non-empty.
- **Completed via OpenSpec archive:** If an issue has linked OpenSpec proposals that are ready to complete after archival, route through `openissue-handoff` (`openissue confirm <id>`) rather than bypassing archive confirmation with `openissue close --reason completed`.

## Assistant-Assisted Prioritization (`--emit` / `--apply`)

When semantic re-evaluation of `unassessed` or `stale` issues is needed:

1. Generate the canonical request payload (includes open issues, `focus`, `facts`, and per-issue `input_hash`):
   ```bash
   openissue prioritize --emit > priority-request.json
   ```
2. Evaluate only open issues against `focus`, `facts`, and `blocked_by`, returning valid JSON:
   ```json
   {
     "version": 1,
     "results": [
       {
         "id": "OI-YYYYMMDD-XXXX",
         "tier": "high",
         "reason": "Directly advances current focus and unblocks downstream work",
         "basis": ["focus", "dependency:OI-YYYYMMDD-YYYY"],
         "order": 0,
         "input_hash": "<exact input_hash copied from priority-request.json>"
       }
     ]
   }
   ```
   Allowed `basis` entries are strictly validated against the emitted request: `focus` (only when `focus` is non-empty), `spec:<spec-id>`, `proposal:<proposal-id>`, or `dependency:<blocker-id>`. Never fabricate `basis` entries or `input_hash`.
3. Apply the validated response (per-issue errors are isolated; stale `input_hash` entries are rejected and require re-emitting):
   ```bash
   openissue prioritize --apply priority-response.json
   ```

For visual human review, suggest running `openissue board` locally (`127.0.0.1` only). When an issue is mature and ready to enter OpenSpec planning, hand off to `openissue-grill-me` via `openissue start <id>`.

## Output

Summarize issues grouped by `high`, `medium`, `low`, and `unassessed` (showing `id`, `title`, `reason`, and `manual`/`stale`/`dependency_floor`/`blocked`/`invalid_dependency` flags), list any `conflicts` separately, state exact adjustments made (or why none were made), and confirm no issues were auto-closed.
