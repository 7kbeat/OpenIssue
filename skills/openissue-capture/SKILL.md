---
name: openissue-capture
description: Capture or refine an early idea, bug, or improvement into the OpenIssue anchor inbox before it is ready for implementation or an OpenSpec plan. Records facts only; never implements code or creates proposals.
allowed-tools: Bash(openissue:*)
license: MIT
compatibility: Requires openissue CLI.
metadata:
  author: openissue
  version: "1.1"
---

# OpenIssue Capture

**Lifecycle stage:** Inbox Capture & Refinement (Stage 1 of 4: Capture → Triage → Interview & Spec → Handoff & Archive).

Use this skill when the user shares an idea, defect, or improvement that is worth tracking in the product's single-source-of-truth inbox (`openissue/issues/`) but is not yet ready for immediate implementation or a full OpenSpec proposal.

## Rules

- **Title is the only required field:** Write a concise, self-contained title. Do not stuff a paragraph into the title.
- **Fact discipline:** Record only facts confirmed by the user or directly observed in the repository. Separate **Observed Behavior**, **Evidence**, **Expected Outcome**, and **Open Questions**. Never fabricate reproduction steps, priority tiers, or acceptance criteria.
- **Deduplicate before creating:** Always inspect existing issues first. When an open issue covers the same user intent, prefer refining or supplementing it (`openissue edit`) rather than creating a duplicate.
- **Single source of truth:** Issues live only in the product anchor repository (`openissue/issues/OI-YYYYMMDD-XXXX.md`). Member repositories hold pointers only and never store local copies.
- **Strict scope boundary:** **Do NOT implement code, modify business files, set priority tiers, create OpenSpec changes, or close issues in this workflow.** If the user wants to prioritize next, hand off to `openissue-triage`; if the requirement is already mature for specification, hand off to `openissue-grill-me` via `openissue start <id>`.

## Steps

1. **Locate the product and load existing issues:**
   Run from the anchor repository or a registered member repository:
   ```bash
   openissue list --status all --json
   ```
   - If the repository belongs to multiple products, ask the user which `--product <id>` to target.
   - If the repository is unregistered, report the error and ask the user for the anchor path (`--anchor <path>`) or to initialize/register first. Do not initialize an arbitrary product on your own.
   - If `conflicts` in the JSON output is non-empty, report those malformed files to the user alongside your result; never silently ignore them.

2. **Check for duplicates or related history:**
   Compare the user's request against both `title` and `description` across open and closed issues (including synonyms and overlapping user journeys):
   - **Clear open match:** Show the existing `id` and `title` and ask whether to supplement its description with `openissue edit <id> --description "<updated description>" --json` (preserving confirmed existing details) or create a separate issue.
   - **Closed match only:** Do not silently create a duplicate or silently reopen it. Show the closed issue (`id`, `title`, `close.reason`, `close.note`) and ask whether to reopen it (`openissue reopen <id>`) or capture a new issue.
   - **No match:** Proceed to Step 3.

3. **Structure the description cleanly:**
   Use only sections supported by confirmed facts; omit empty sections rather than inventing details:
   ```markdown
   ## Observed Behavior

   ## Evidence

   ## Expected Outcome

   ## Open Questions
   ```

4. **Create or update the issue:**
   - For a new issue:
     ```bash
     openissue create "<concise title>" --description "<structured description>" --json
     ```
   - To refine an existing open issue:
     ```bash
     openissue edit <id> --description "<merged description>" --json
     ```
   For multi-line or quote-heavy descriptions, pass text safely (e.g., command substitution from a temp file or heredoc) so quotes and newlines are preserved intact.

5. **Verify persistence:**
   Confirm `id`, `path`, and `status` from the JSON response, or verify with:
   ```bash
   openissue show <id> --json
   ```

6. **Report and hand off:**
   Present the issue `id`, `title`, storage `path`, and current state (`open`, `unassessed`). Note the next lifecycle options without executing them unasked:
   - `openissue priority` / `openissue-triage` to assess priority and dependencies;
   - `openissue start <id>` / `openissue-grill-me` when ready to begin a product decision interview and OpenSpec draft.

## Output Format

```text
Captured OI-YYYYMMDD-XXXX: <title>
Path: openissue/issues/OI-YYYYMMDD-XXXX.md
Status: open (unassessed)
Next: Run `openissue priority` (or `openissue-triage`) to triage, or `openissue start OI-YYYYMMDD-XXXX` when ready for an OpenSpec interview.
```
