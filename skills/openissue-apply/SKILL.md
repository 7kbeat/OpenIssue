---
name: openissue-apply
description: Implement an OpenIssue requirement through its linked OpenSpec change. Use after the product decision interview and TDD tasks are complete, when the user explicitly asks to implement. Gates on the issue, dependencies, and handoff state; reads OpenSpec apply instructions; executes pending tasks with test-first verification; updates task progress; and stops before archive or issue completion.
allowed-tools: Bash(openissue:*), Bash(openspec:*)
license: MIT
compatibility: Requires openissue CLI, OpenSpec CLI 1.10+, and an OpenIssue requirement with a completed interview and generated tasks.
metadata:
  author: openissue
  version: "1.0"
---

# OpenIssue Apply: Implement an Issue Through Its OpenSpec Change

**Lifecycle stage:** Implementation & Verification (between Interview & Spec and Handoff & Archive).

Use this skill when an OpenIssue requirement has a linked active OpenSpec change with generated tasks, and the user explicitly asks to implement it. This skill replaces the generic `openspec-apply-change` workflow for OpenIssue-sourced work: it adds the issue, dependency, handoff, and interview gates that the generic apply skill does not know about.

This skill does not plan. `openissue-grill-me` owns the product decision interview, proposal/specs/design, tasks, and the explicit interview-completed transition. This skill does not archive or close. `openissue-handoff` owns re-linking and completion confirmation after archival.

## 0. Scope and Source Routing

- **OpenIssue-sourced implementation:** use this skill. The work must resolve to an issue id and a linked active OpenSpec change.
- **Direct OpenSpec request with no OpenIssue source:** use the standard `openspec-apply-change` workflow. Do not create an OpenIssue issue merely to use this skill.
- **Planning, task generation, or decision changes:** use `openissue-grill-me`. Do not write proposal, specs, design, or tasks from this skill except for checking task boxes after verified completion.
- **Re-linking or archive completion:** use `openissue-handoff`. Do not run `openissue confirm` here.
- **Archive:** not part of this skill. Only archive when the user separately and explicitly asks after implementation is complete.

These boundaries keep planning, implementation, and completion as separate decisions.

## 1. Resolve the Issue and Target Change

If the user provides an issue id, use it. If the request only names a feature, first find the matching issue:

```bash
openissue list --status all --json
```

Compare the request with issue titles and descriptions, not only exact title matches. If exactly one open issue clearly matches, use it. If several issues are plausible, list them and ask the user to choose. If only closed issues match, do not silently implement them; ask whether to reopen the issue or stop. If no issue matches, explain that the work has no OpenIssue source and route it to the standard OpenSpec flow.

Read the issue and its live handoff state:

```bash
openissue show <id> --json
```

Use the returned `handoff` object to resolve the target change:

- exactly one `active` proposal: use it;
- multiple `active` proposals: list them and ask which one to implement; never choose silently;
- no `active` proposal: stop and route to `openissue-grill-me` with `openissue start <id>`;
- `missing` proposal: report the broken link and route to `openissue-handoff`; do not guess a replacement;
- only archived proposals: report that archived changes cannot be implemented as active work; let the user decide whether to re-link or plan a new change.

Announce the selection before editing:

```text
Implementing issue: <issue-id> <title>
Change: <change-id>
```

Include how to override the selected issue or change (for example, name another issue id). Do not proceed on an ambiguous target.

## 2. Preflight: Gate on Issue and Handoff State

Check every gate before reading or changing code. A failed gate is a stop, not something to work around.

| Gate | Evidence | Required action |
|---|---|---|
| Issue is open | `issue.status === "open"` | Do not implement a closed issue. Ask whether to reopen it first. |
| Dependencies allow work | `issue.blocked_by` and the blocker states | If an open or `wontdo` blocker remains, surface the blocker ids and pause. Resolve dependencies through `openissue-triage` or an explicit user decision. |
| Target proposal is active | `handoff.proposals[]` | Exactly one active linked proposal. Multiple requires a user choice; none or missing requires the planning/handoff route. |
| Interview is complete | `handoff.interview_completed` and `handoff.interview_completed_change_ids` contains the target change | If the interview is incomplete or unknown, stop. Do not implement and do not mark the interview complete from this skill. |
| Issue has not drifted | `updated_since_proposal === false` for the target proposal | If true, warn that the issue title or description changed after the proposal link. Ask whether to update the plan through `openissue-grill-me` or proceed with the existing plan. |
| Tasks are ready | OpenSpec status and apply instructions | If planning artifacts are missing or tasks are not generated, stop and route to `openissue-grill-me`. |

**Manual-link exception:** a proposal linked with `openissue handoff <id> --link <change>` has no interview marker because that path explicitly skips the interview. Report this state. Continue only when the user explicitly confirms that the planning artifacts and tasks were reviewed. Never write an interview-completed marker from this skill.

If the issue has open blockers, do not silently reorder or ignore them. State the blocking ids, the reason they block, and the next action (resolve, replace, or explicitly defer with the user's decision).

## 3. Read the OpenSpec Apply Context

If the user named an OpenSpec store or the work lives in one, discover it first and pass `--store <id>` to the commands that read or write that store:

```bash
openspec store list --json
```

Read the change status:

```bash
openspec status --change "<change-id>" --json
```

Then read the current apply instructions:

```bash
openspec instructions apply --change "<change-id>" --json
```

Parse and use these values:

- `schemaName`, `planningHome`, `changeRoot`, and `actionContext` — planning scope, edit roots, and constraints;
- `contextFiles` — every concrete artifact path to read; do not assume `tasks.md` or the default `spec-driven` schema;
- `progress` and `tasks` — total, complete, remaining, and each task with its state and checkbox location;
- `instruction` — the CLI's current execution instruction;
- `context` — required project instruction input; read and apply relevant project facts, conventions, and constraints;
- `operationGuidance` — optional additive advice; follow entries that are applicable and compatible with the controlling inputs;
- `sourcePath` and line numbers — where the task checkbox lives.

Read every file listed under `contextFiles` before implementing. Also read the project `AGENTS.md`, `README.md`, testing documentation, CI configuration, and the affected code and tests. Do not infer artifact locations or project commands from this skill when the repository provides them.

Handle the CLI state explicitly:

- **`blocked`:** planning artifacts are missing. Report the missing artifacts and the CLI's recovery instruction. Stop before editing code; route planning work to `openissue-grill-me`.
- **`all_done`:** every tracked task is complete. Do not make code changes just to produce activity. Report the completed state and the archive/handoff options.
- **Executable state:** proceed only with pending, unblocked tasks in the order the CLI and dependencies define.

`context` is a required project-context input. `operationGuidance` is optional advice. Neither is evidence that a task is complete, and neither may override the CLI state, an explicit user decision, or the planning artifacts. If they conflict with a controlling input, report the conflict instead of silently choosing one.

## 4. Announce the Implementation Plan

Before changing code, show the user a short plan:

```text
## Implementing: <issue-id> / <change-id> (schema: <schema-name>)

Progress: N/M tasks complete
Remaining: <task numbers and short descriptions>
Affected repositories: <repos or modules from the plan>
Verification: <project commands or task-defined checks>
Risks / open points: <blockers, drift, ambiguous tasks, or none>
```

Proceed when the target and gates are clear. Pause before editing if a task is ambiguous, contradicts the specs, requires a new product decision, or expands beyond the linked plan.

## 5. Execute Tasks in Order

Work through pending tasks in dependency order. For each task:

1. Show which task is being worked on.
2. Re-read the task at the current `sourcePath` and line number. If the description or checkbox no longer matches, rerun `openspec instructions apply --change "<change-id>" --json` and use the fresh location. Never edit a stale checkbox.
3. Identify the observable behavior and the verification the task requires from the specs, scenarios, design, and task text.
4. Make the smallest coherent change within the authorized scope.
5. Verify that change using the project's actual commands.
6. Mark the checkbox only after the task's full behavior and verification conditions are satisfied.
7. Rerun apply instructions and confirm the CLI reports the task as complete and the overall progress changed.

Keep changes scoped to the task. Do not perform drive-by refactors, add unrelated dependencies, or silently expand the plan. Match the repository's existing architecture, naming, error handling, and test conventions.

If a task spans multiple member repositories, edit only the repositories and files the plan requires. The issue remains in the anchor repository; do not copy the issue into member repositories.

### 5.1 TDD sequence for behavior-changing slices

For a task that changes observable behavior, use RED → GREEN → REFACTOR → INTEGRATE unless the task explicitly defines a different verification method:

1. **RED — prove the test detects the target problem.** Write the smallest decisive behavior test first. Run it before changing production behavior. Confirm it fails because the required behavior is missing or the defect still exists. Inspect the failure and confirm it reaches the intended assertion.
2. **GREEN — make the minimum implementation change.** Change production code only within the task scope. Run the target test and affected regression tests. Never obtain green by deleting assertions, weakening expectations, skipping tests, or changing the accepted behavior.
3. **REFACTOR — improve design while preserving behavior.** Refactor only while the relevant tests are green. Rerun the target and affected regression tests after every meaningful refactoring step. Do not mix new behavior into refactoring.
4. **INTEGRATE — verify the slice in context.** Run the integration, contract, or end-to-end checks the task requires. Confirm the relevant normal, boundary, and failure paths still behave as specified.

A valid RED is an expected assertion failure after the test reaches the target behavior. Syntax errors, compilation errors, import failures, missing fixtures, broken mocks, environment faults, and unrelated regressions are not valid RED evidence. Repair the test setup and rerun.

For a bug fix, the regression test must reproduce the reported or verified defect before the fix. Writing a passing test after the fix does not establish that RED occurred.

### 5.2 Tests that do not start from RED

When a task is test-only, documentation-only, a pure refactor, or explicitly uses characterization/regression verification, follow the task's defined verification instead of inventing a fake RED. State the chosen verification and run it. Do not claim strict test-first development for work that did not follow it.

### 5.3 Test design discipline

Tests are evidence for the accepted behavior contract, not a count to maximize. Apply these rules:

- **Traceability:** each important test maps to a requirement, scenario, defect, contract, or explicit risk. Do not invent acceptance criteria from the implementation.
- **Behavior over implementation:** assert observable outcomes, state changes, and side effects. Do not couple tests to private method order, internal field names, or incidental formatting unless the contract requires it.
- **Decisive oracle:** state the exact expected result before writing the assertion. If the specification does not define an outcome, pause instead of turning an assumption into a test.
- **Appropriate level:** use unit tests for focused logic, integration tests for real boundaries, and end-to-end tests for critical journeys. Do not replace every behavior with E2E or mock away the system under test.
- **Boundaries and failure paths:** cover applicable invalid inputs, permissions, empty states, retries, concurrency, partial failure, recovery, and compatibility requirements.
- **Isolation and determinism:** tests must establish their own state, clean up, avoid execution-order dependence, and avoid arbitrary sleeps or real external services.
- **Meaningful assertions:** no empty assertions, bare not-throw checks, or claims that a mock call proves a business outcome.
- **No greenwashing:** never delete, skip, weaken, or rewrite a failing test merely to make progress. A failing test is evidence to investigate.

## 6. Verify and Synchronize Task State

Run verification from fastest to broadest, using the commands the task and project actually define:

1. the added or modified test;
2. the affected test file or module;
3. the affected integration, contract, or end-to-end checks;
4. the project's typecheck, lint, build, and full test command when required by the project or task.

Record the exact command and the actual result. Do not claim a command passed unless it ran. If a test cannot run, record the blocker and the residual risk.

Update a task checkbox only when all of these are true:

- the specified behavior is fully implemented, not partially implemented or deferred;
- the task's verification command ran and passed;
- relevant regression checks still pass;
- the checkbox still matches the task description at the current location.

After changing checkboxes, always rerun:

```bash
openspec instructions apply --change "<change-id>" --json
```

Confirm that the CLI recognizes the expected completed tasks and that `progress.complete` and `progress.remaining` changed. Editing the checkbox alone is not proof that progress synchronized.

If later changes invalidate an earlier verification, rerun the checks and correct the task state truthfully. Never check off future tasks, skipped work, deferred work, or tasks that only passed against an earlier code state.

Before declaring implementation complete, run the structural validation required by the project and OpenSpec workflow:

```bash
openspec validate "<change-id>" --strict
```

Validation success is not behavioral test success, and a completed task list is not proof that every test ran. Report them as separate states.

## 7. Completion, Archive Boundary, and Pause

### 7.1 On completion

When every tracked task is complete and verified:

```text
## Implementation Complete

**Issue:** <issue-id> <title>
**Change:** <change-id>
**Schema:** <schema-name>
**Progress:** M/M tasks complete ✓

### Completed This Session
- [x] <task>
...

### Verification
- `<command>`: passed / failed / not run
...

### Files Changed
- <path>

### Remaining Risks or Unverified Items
- <risk or "none">
```

Then stop. Report that the issue remains `open` and that no archive, issue closure, or completion confirmation was performed. If the user wants to continue:

- archive requires a separate explicit request and the OpenSpec archive command;
- completion confirmation requires `openissue-handoff` after every linked proposal is archived;
- further behavior changes require `openissue-grill-me` to update the planning artifacts and regenerate affected tasks.

Never describe all tasks being checked as proof that the requirement is complete or that the proposal should be archived.

### 7.2 On pause

Pause and report when:

- the issue is closed, blocked, missing, or ambiguous;
- there is no active linked proposal, multiple active proposals, or a missing link;
- the interview is incomplete or unknown;
- the issue has drifted from the proposal and the user has not chosen whether to update the plan;
- planning artifacts or tasks are missing, or the CLI reports `blocked`;
- a task is unclear, contradicts the specs, or requires a new product decision;
- implementation reveals additional user-visible scope, a design gap, or a required spec change;
- a test or verification failure remains after an in-scope repair attempt;
- a required tool, environment, test, or repository is unavailable;
- the user interrupts.

Use this shape:

```text
## Implementation Paused

**Issue:** <issue-id>
**Change:** <change-id>
**Progress:** N/M tasks complete

### Reason
<concrete blocker or decision needed>

### Options
1. <safe option>
2. <alternative>
3. Other approach
```

Do not manufacture progress, mark partial tasks complete, or continue past a blocker by guessing. If the work requires changed behavior or acceptance criteria, route it back to `openissue-grill-me`; do not silently rewrite the plan.

## 8. Guardrails

- Use this skill instead of `openspec-apply-change` when the implementation is linked to an OpenIssue requirement.
- Do not create or modify `proposal.md`, `specs/`, `design.md`, or `tasks.md` content other than checking off verified tasks. Planning changes belong to `openissue-grill-me`.
- Do not change acceptance criteria, scenario outcomes, or task scope to fit the implementation.
- Do not archive, close, confirm, delete issue or proposal data, commit, or push unless the user explicitly asks for that separate action.
- Do not overwrite unrelated user changes or discard existing work to simplify a task.
- Do not mark tasks complete based on written code, unexecuted tests, partial behavior, or a later code state.
- Do not report a check as passed, a RED as valid, or a behavior as covered unless it was actually executed or evidenced.
- Do not use `context` or `operationGuidance` as proof of completion or as permission to bypass CLI state.
- Read all `contextFiles` and project conventions before editing; never guess artifact paths or commands.
- Keep the issue open and the archive pending until the user explicitly completes the handoff flow.

## 9. Definition of Done

An `openissue-apply` session is done only when:

- [ ] The issue and target active proposal are unambiguous.
- [ ] The issue is open and no unresolved blocker silently blocks implementation.
- [ ] The interview is completed, or the manual-link exception was explicitly accepted by the user.
- [ ] Issue drift was reviewed and resolved or explicitly accepted.
- [ ] OpenSpec status and apply instructions were read; every `contextFiles` path and project convention was inspected.
- [ ] Every pending task was implemented in order and is fully complete, or the session paused with a concrete reason.
- [ ] Behavior-changing slices have valid RED, GREEN, post-refactor, and integration evidence, or the task-defined alternative was used and stated.
- [ ] Verification commands were actually run, with results recorded.
- [ ] Task checkboxes were updated only after evidence, and `openspec instructions apply` confirmed the progress.
- [ ] No archive, issue closure, or completion confirmation was performed without a separate explicit request.
- [ ] Remaining risks, unverified items, and out-of-scope changes are reported honestly.

**Final principle:** implement the accepted contract, prove it with tests, keep task state synchronized with evidence, and leave archive and issue completion to explicit user decisions.
