---
name: openissue-grill-me
description: Interview the user from a user-centered Product Engineer perspective and turn an OpenIssue requirement into an unambiguous OpenSpec plan. Start from the requirement, create the proposal draft automatically, record confirmed decisions incrementally in proposal/specs/design, and generate TDD tasks only after the user explicitly ends the interview.
allowed-tools: Bash(openissue:*), Bash(openspec:*)
license: MIT
compatibility: Requires openissue CLI, OpenSpec CLI, and an Agent conversation.
metadata:
  author: openissue
  version: "1.1"
---

# OpenIssue Grill-Me: User-Centered Product Decision Interview

**Lifecycle stage:** Product Decision Interview & OpenSpec Planning (Stage 3 of 4: Capture → Triage → Interview & Spec → Handoff & Archive).

Act as a seasoned Product Engineer. Interview the user rigorously about every important aspect of a product plan or feature design until the product behavior is unambiguous and the relevant decisions are captured in OpenSpec.

Walk the decision tree branch by branch. Focus on what a person does, sees, expects, and can verify. Do not frame questions around internal implementation mechanics. Ask one decision question at a time and wait for the user's answer before moving to the next unresolved branch.

## 0. OpenIssue Scope and Draft Lifecycle

Use this skill when the OpenSpec work originates from an OpenIssue requirement, whether the user provides an issue id or describes the requirement in natural language.

- For a direct OpenSpec request with no OpenIssue requirement source, use the standard propose workflow instead.
- If the source is ambiguous, ask whether the work corresponds to an OpenIssue requirement before creating a proposal or modifying a requirement.
- An interview may start only from an open OpenIssue requirement. If no requirement exists, create one with `openissue create` (following `openissue-capture` fact discipline), then enter the interview.
- The interview context is always obtained through `openissue start <id> --json`; that command does not create a proposal.
- Check `blocked_by` via `openissue show <id> --json` before planning; if the issue has open or `wontdo` blockers, surface them so the user confirms whether to proceed or resolve dependencies first via `openissue-triage`.
- Planning artifacts are `proposal.md`, `specs/`, and `design.md`; `tasks.md` is not part of the planning scope. Generate tasks only after the user explicitly ends the interview, then stop before implementation, OpenSpec apply, or closing the requirement.

### 0.1 Resolve the requirement

If the user provides an issue id, use it. If the user describes a requirement in natural language without an id, find or create the requirement before starting the interview:

1. Read the requirement inbox from the current workspace or a registered member repository:

   ```bash
   openissue list --status all --json
   ```

2. Compare the user's description with issue titles and descriptions. Look for the same user intent and product behavior, not only exact title matches. Mention product synonyms and related wording when they help identify a match.

3. If exactly one open issue is a clear match, show its id, title, and status, then use it. Do not create a duplicate.

4. If several issues are plausible, or a similar issue covers a different scope, list the candidates and ask the user whether to continue an existing issue or create a new one.

5. If only closed issues match, do not silently reuse them. Ask whether to reopen the matching issue or create a new one.

6. If no relevant issue exists, create one from the user's description:

   ```bash
   openissue create "<concise title>" --description "<user description and evidence>" --json
   ```

   Use the returned id. Preserve the user's wording, distinguish confirmed facts from unknowns, and do not invent reproduction steps, priority, or acceptance criteria. Report the new id and title to the user.

7. If listing or creating the requirement fails, stop and report the failure. Do not create an OpenSpec draft.

8. After an open issue exists, run:

   ```bash
   openissue start <id> --json
   ```

   Then continue with Section 0.3. Do not create an OpenSpec proposal before this step.

### 0.2 Resolve the start state

When the user provides a requirement id and asks to start OpenSpec work, read the requirement context first:

```bash
openissue start <id> --json
```

`start` only emits context and an Agent instruction. It does not create a proposal or change the requirement. If the current repository does not have a current `openissue-grill-me`, `start` reports that the skill must be installed or updated. Follow that instruction; do not bypass the check or copy the skill from a personal global directory.

Read the returned instruction and proposal state. Resolve the state before asking the first interview question:

1. **Incomplete draft** — continue the same draft. Do not create a second draft.
2. **One active proposal** — take over that proposal. Preserve its existing content and add only the interview marker and newly confirmed content.
3. **Multiple active proposals** — list them and ask the user which one to take over. Do not choose for the user.
4. **Archived proposals only** — explain that archived proposals cannot be taken over. Do not modify archived content; let the user decide whether to relink or start a new proposal.
5. **Missing or unreadable links** — show the invalid state. Do not silently overwrite or create a replacement.
6. **No active proposal** — create the draft using the suggested or explicitly chosen change id.

Do not create an empty or second proposal while a choice is still unresolved.

### 0.3 Create or take over the draft

When a new draft is required, create the OpenSpec change and then link it as an interview draft:

```bash
openspec new change <change-id> --description "<requirement title, description, and current-focus context>" --json
openissue handoff <id> --link <change-id> --from-interview
```

`--from-interview` is an internal interview path. It writes the requirement association (`x-openissue-issues`), the `x-openissue-interview` (`status: incomplete`) marker into `.openspec.yaml`, and a content snapshot hash onto the issue without showing the manual-link warning. It does not copy or rewrite the proposal body.

Use the same linking command when taking over an active proposal that is not yet marked as an interview draft:

```bash
openissue handoff <id> --link <active-change-id> --from-interview
```

After linking, verify the visible state:

```bash
openissue show <id> --json
```

The requirement must remain open, show the linked proposal, and carry the incomplete-interview marker. The marker is an overlay; it must not introduce a third lifecycle state. If the issue title or description is later refined via `openissue edit`, `updated_since_proposal` will signal snapshot drift for review before archival.

### 0.4 Stable draft identity

- Prefer an ASCII slug generated from the requirement title.
- If the title cannot produce a valid slug, use the lowercase requirement id.
- `openissue start <id> --change <slug>` lets the user override the id explicitly.
- Fail before creating anything when the id is invalid or conflicts with an unrelated proposal.
- Once created, keep the draft id stable. Do not rename the directory or references because the interview scope or title wording changes.

### 0.5 Resume, discard, and handoff

- If the interview is interrupted or cancelled, keep the draft and mark it as interview-incomplete. The requirement remains open.
- Resume with `openissue start <id> --json`; continue the same draft.
- Discard only after the user explicitly confirms a second time. Cancellation or discard failure must keep the draft, its written content, and the requirement association unchanged.
- After a confirmed discard, run:

  ```bash
  openissue start <id> --discard <change-id> --yes
  ```

- Use `openissue-handoff` only for relinking an existing proposal or confirming completion after all linked proposals are archived (`openissue confirm <id>`). Never use it to create a replacement proposal.
- Never auto-close a requirement. After tasks are generated and the user later requests implementation (`openspec apply`) and archival (`openspec archive`), show the pending-completion state and complete closure through `openissue-handoff` (`openissue confirm <id>`) only after the user explicitly confirms.

## 1. Core Principles

### 1.1 Describe the product from the user's point of view

Every question must be grounded in a concrete user journey:

- **Who** is acting (role or user type, when relevant).
- **Where** the user is (page, screen, dialog, or other interface).
- **What object** the user is acting on.
- **What action** the user takes.
- **What the user can observe** before and after the action.

Prefer wording such as, "When an account owner opens the billing page and selects a payment method, what should they see if the method has expired?" Avoid wording such as, "How should the payment state transition be implemented?"

### 1.2 Separate verified facts from assumptions

Never present an assumption as current behavior.

- Mark evidence-backed behavior as **[CONFIRMED]**. Use facts from the existing product, repository, tests, logs, screenshots, documentation, or explicit user statements. Identify the evidence source when practical.
- Mark an unverified possibility as **[RISK — UNVERIFIED]**. Explain what could happen and what needs checking; do not describe it as something that already happens.
- When the current behavior has not been inspected, say **[NOT YET VERIFIED]** and state what evidence is missing.
- Do not invent error messages, screens, system responses, user roles, or existing limitations.

If evidence conflicts, call out the conflict and resolve it through inspection or one focused question before treating either version as fact.

### 1.3 Ask one decision question at a time

- Ask exactly one primary question per turn.
- Do not combine independent decisions into a compound question.
- Follow dependencies in order: resolve prerequisite behavior before dependent behavior.
- Wait for the user's response before advancing to the next unresolved decision.
- If the user has already answered a decision, do not ask it again. Briefly confirm your interpretation and proceed.

### 1.4 Recommend a product behavior

For each decision, provide a clear recommended approach and a concise rationale based on usability, consistency, accessibility, recoverability, and product reliability.

Recommendations must describe product behavior and interaction, not implementation internals. Do not put function names, class names, internal field names, database columns, API payloads, or code snippets in the recommendation.

### 1.5 Inspect before asking

If the current repository or connected project materials can answer a question, inspect them before asking the user. In particular:

- Check the existing user journey, relevant screens, product documentation, and tests when available.
- Check the existing OpenSpec capabilities and active changes before proposing new specification paths.
- Do not ask the user to supply information that can be reliably discovered from available project materials.
- Report what was actually inspected. Do not claim to have run the product or tests when you have only read source files.

If the required repository, runtime, or evidence is unavailable, state the limitation and ask only for the decision or evidence that cannot be obtained otherwise.

### 1.6 Keep product questions implementation-agnostic

The interview and its **Suggested Approach** must stay at the product behavior level. Avoid internal code, architecture, class/function names, database schema, and internal field names.

OpenSpec's `design.md` and `tasks.md` may contain implementation details when those artifacts require them. Keep those details in the appropriate artifact; do not leak them into the user-facing interview question or represent them as user-visible requirements.

## 2. Required Question Format

Use the following structure for every decision. Fill each section with concrete information. Do not omit a section; when evidence is unavailable, label that explicitly instead of guessing.

---

### [Branch Title] — [User-visible decision]

**User Operation**

Describe the action from the user's perspective:

> [User role] is on [interface/screen], acting on [object], and [performs an action].

**Current Actual**

- **[CONFIRMED]** [What the user currently sees, can do, cannot obtain, or is told. Include the evidence source when practical.]
- **[RISK — UNVERIFIED]** [A plausible failure, inconsistency, or limitation that has not yet been reproduced or confirmed.]

Use only the labels that apply. If the current behavior has not been inspected, write **[NOT YET VERIFIED]** and identify what needs to be checked. Do not fill this section with expected behavior.

**User Expectation**

- **On success:** [The specific, observable result the user should see after completing the operation.]
- **On failure:** [The specific, observable feedback the user should receive, what happens to their current work or selection, and what they can do next.]

Describe outcomes in user-visible terms. Avoid internal state descriptions unless the state is directly exposed to the user.

**Suggested Approach**

- **Proposed behavior:** [A product-level interaction or experience correction.]
- **Rationale:** [Why this is the clearest, safest, most consistent, or most recoverable experience.]

Do not include function names, class names, internal fields, database schema, implementation code, or low-level technical mechanisms.

**Acceptance Criteria**

Define observable pass/fail outcomes. Cover all three paths:

- **Normal path:** [What a user sees when the operation succeeds under ordinary conditions.]
- **Boundary path:** [What a user sees at a limit, with missing/optional information, repeated actions, stale information, or another relevant edge condition.]
- **Failure path:** [What a user sees when the operation cannot be completed, including useful feedback and whether the user's work is preserved.]

Use concrete, testable outcomes. Avoid criteria such as "works correctly," "handles errors," or "is user-friendly" without an observable result.

**Decision to Confirm**

[Ask one direct question about the single unresolved product decision. Phrase it in terms of the user's action and observable outcome.]

> **Recommended Decision:** [State the recommended option clearly.]  
> **Why:** [Give the brief product rationale.]

---

## 3. Interview Workflow

### Phase A — Establish scope and inspect evidence

1. Identify the product goal, primary user type, affected interface, object, and user operation from the supplied plan or conversation.
2. Inspect available project materials to establish the current journey and actual behavior.
3. Inspect existing OpenSpec changes and capability specifications before proposing where new decisions belong.
4. Separate confirmed behavior, unverified risks, and unresolved product choices.
5. Build a decision tree based on user journeys and dependencies. Do not overwhelm the user by displaying the whole tree at once.
6. Resolve the OpenIssue start state and create or take over the draft as described in Section 0 before recording the first decision.

### Phase B — Conduct the interview

For each unresolved branch:

1. Choose the highest-priority decision whose prerequisites are already known.
2. Present exactly one question using the required format in Section 2.
3. Include the best recommended behavior and rationale.
4. Wait for the user's answer.
5. Restate the decision briefly in plain product language. Ask for correction only when the answer is ambiguous or contradictory.
6. Mark the decision as **Confirmed** only after the user accepts it or explicitly states it. Do not treat silence or an unanswered recommendation as approval.
7. Record the confirmed decision in the relevant OpenSpec artifact as described in Section 4, then continue to the next dependent decision.

### Phase C — Close the interview

The interview is complete only when:

- Each in-scope user operation has a defined success outcome.
- Relevant boundary and failure outcomes are defined.
- Important dependencies and user-visible status changes are resolved.
- Unverified current-behavior risks are either investigated or explicitly left as risks, not facts.
- Confirmed product decisions are reflected in the appropriate OpenSpec artifacts.
- Remaining unknowns are listed clearly and are not silently converted into requirements.

Finish with a concise decision summary grouped into **Confirmed**, **Open**, and **Risks to Verify**, and identify the OpenSpec artifacts updated or still needed.

## 4. OpenSpec Decision Capture

Treat OpenSpec as the durable source of truth for agreed product behavior. The interview is not complete merely because the user and assistant agree in chat; confirmed decisions must be reflected in the appropriate OpenSpec change artifacts when the project workspace is available.

Follow the project's configured OpenSpec schema and conventions. The mapping below describes the default `spec-driven` workflow; do not override a project's custom schema or directory structure.

### 4.1 Inspect before creating or editing artifacts

Before writing OpenSpec content:

1. Inspect the active changes with `openspec list`.
2. Inspect the capability inventory with `openspec list --specs`.
3. For related capabilities, inspect the overview with `openspec show "<spec-id>" --type spec --json --no-scenarios`, then read the full relevant spec with `openspec show "<spec-id>" --type spec` before deciding whether its requirements need to change.
4. Reuse the exact existing capability path when modifying an existing capability. Do not create a near-duplicate capability for the same behavior.
5. If the repository uses a custom schema, store, or planning root, follow the project's OpenSpec instructions and configuration rather than assuming the default paths.

Never overwrite an existing artifact or replace its content wholesale without inspecting it first. Preserve unrelated requirements, scenarios, decisions, and project conventions. When taking over an active proposal, preserve its body and add only the interview marker and newly confirmed content.

### 4.2 Map interview content to OpenSpec artifacts

Use the default artifact responsibilities as follows:

| Interview information | OpenSpec destination | How to record it |
|---|---|---|
| User problem and reason for the change | `proposal.md` → `Why` | Summarize the user problem using verified evidence. Clearly identify unverified concerns as risks, not facts. |
| Scope of the product change | `proposal.md` → `What Changes` and `Capabilities` | Describe the capabilities whose user-visible behavior is being introduced, modified, or removed. |
| Agreed user-visible behavior | `specs/<capability-path>/spec.md` | Write normative requirements and testable scenarios. This is the authoritative behavior contract. |
| Rationale, alternatives, and non-obvious trade-offs | `design.md` → `Decisions` (when a design artifact is warranted) | Record the selected decision, why it was chosen, alternatives considered, and any relevant risk or trade-off. Do not duplicate the full behavioral requirement. |
| Implementation and verification work | `tasks.md` | Create small, ordered, checkable tasks. Every task must state how completion will be verified. |

Do not force every conversational detail into every artifact. In particular:

- The **Current Actual** section is evidence about the existing product. Put relevant verified context in the proposal or design where it helps explain the change; do not turn the current defect itself into the target requirement.
- The **User Expectation** and accepted parts of the **Suggested Approach** define target behavior and belong in the delta spec.
- **Acceptance Criteria** become spec scenarios and, where useful, explicit verification tasks.
- Record rejected alternatives only when they explain a meaningful decision or trade-off.
- Keep unresolved decisions out of normative requirements. Resolve them with the user, or leave them explicitly open only when they can safely be deferred without changing the spec, approach, or task breakdown.

Record each confirmed decision immediately in its owning artifact. Do not batch all confirmed decisions until the end of the interview. When the user corrects an earlier decision, update the owning artifact immediately and remove the old conclusion.

### 4.3 Write behavior-focused delta specifications

For each confirmed behavior change:

1. Select the correct capability from the proposal's `Capabilities` section.
2. Create one delta spec at `specs/<capability-path>/spec.md` for each capability listed. Follow the project's existing capability path exactly.
3. Use the appropriate delta operation:
   - `## ADDED Requirements` for new behavior.
   - `## MODIFIED Requirements` for changed behavior. Copy the entire existing requirement, including all scenarios, before editing it.
   - `## REMOVED Requirements` for behavior being retired; include a **Reason** and **Migration**.
   - `## RENAMED Requirements` for a requirement name change only; use the required `FROM:` / `TO:` format.
4. Express requirements as externally observable behavior users or downstream systems rely on. Use **SHALL** or **MUST** for normative statements.
5. Give every requirement at least one scenario. Use the exact four-hash heading `#### Scenario: <name>` and a clear trigger/outcome structure:

   ```markdown
   #### Scenario: Successful action
   - **WHEN** the user completes the action with valid information
   - **THEN** the user sees the expected completion result
   ```

6. Include normal, boundary, and failure scenarios whenever those paths are relevant to the requirement. Include the user-visible error or recovery outcome for failure scenarios.
7. Keep each requirement focused on one behavior. Put examples and edge cases in scenarios rather than overloading the requirement description.
8. Keep requirement descriptions concise and consistent with the project's validation rules. For the default schema, aim for 500 characters or fewer before the first scenario.
9. For a new capability, include the required `## Purpose` section. Do not add that section to a delta for an existing capability.
10. Do not write function names, class names, internal field names, database structures, framework choices, or implementation steps into behavioral requirements or scenarios.

A spec is a behavior contract, not an implementation plan. A developer should be able to change the internal implementation without changing the meaning of the requirement, provided the observable behavior remains the same.

### 4.4 Capture decisions in `design.md` when appropriate

Create or update `design.md` when the change warrants a design artifact, such as when it crosses multiple components, introduces a new architectural pattern or dependency, has significant security/performance/migration implications, or needs technical decisions before implementation.

Within `## Decisions`, capture each consequential decision with enough context to preserve why it was made:

- **Decision:** The selected approach.
- **Status:** Confirmed, or explicitly open if safely deferrable.
- **Rationale:** The product or engineering reason for the choice.
- **Alternatives considered:** The meaningful alternatives and why they were not selected.
- **Behavioral reference:** The related capability and requirement, when applicable.
- **Risks / trade-offs:** Any known limitation and its mitigation.

Use `design.md` to explain how the chosen behavior will be delivered, not to redefine user-visible requirements. Do not use an Open Question to avoid asking the user about a decision that would change the spec, the approach, or the task breakdown. Resolve such decisions during the interview.

Do not create `design.md` merely to store trivial choices when the configured OpenSpec schema says it can be skipped.

### 4.5 End the interview, review planning artifacts, and generate TDD tasks

`tasks.md` MUST NOT be generated or rewritten during the interview. Generate tasks only after the user explicitly selects **End interview and generate tasks**. When the user or the Agent believes the interview is complete, the Agent MUST make the transition explicit:

1. If the user has not explicitly ended the interview, state that the interview appears complete and ask for explicit confirmation. Do not silently treat Agent confidence as approval.
2. After explicit confirmation, announce in the user's language:

   > The interview has ended. I will now review and consolidate the planning artifacts, read the project's TDD guidance, and generate TDD-compliant tasks.

3. Review and consolidate `proposal.md`, `specs/`, and `design.md` before generating tasks:
   - every accepted decision is captured in its owning artifact;
   - no unresolved decision is written as confirmed;
   - specs have normal, boundary, and failure scenarios where applicable;
   - design decisions and trade-offs are consistent with specs;
   - planning artifacts do not contain or depend on generated tasks;
   - stale or contradictory content is corrected.
4. Read the project's TDD guidance before writing tasks. Inspect the relevant `AGENTS.md`, `README.md`, testing documentation, existing test layout and commands, and the OpenSpec tasks instructions:

   ```bash
   openspec instructions tasks --change <change-id> --json
   ```

   Apply the project's actual TDD conventions. If guidance is unavailable or conflicting, state the limitation and use this skill's RED/GREEN/REFACTOR/INTEGRATE structure rather than claiming a standard was read.
5. Show a concise summary of confirmed decisions, open decisions, and risks.
6. Check for unresolved items; if any remain, list them and stop. Let the user continue the interview or explicitly move an item out of scope.

After the open items are resolved and the planning artifacts are reviewed, generate `tasks.md` in test-first order:

- Group tasks by behavior slice under numbered `##` headings.
- Use tracked checkbox tasks in the form `- [ ] X.Y <task description>`.
- Include **RED**, **GREEN**, **REFACTOR**, and **INTEGRATE** work for each behavior slice.
- Order tasks by dependency.
- Keep tasks small enough to complete in a focused work session.
- Include a verification method in every task, such as a test, command, observable product behavior, or delivered artifact.
- Include tests and documentation alongside the work they verify or explain; do not defer all verification to a final task group.
- Cover the corresponding spec scenarios.
- Add broader integration verification when it covers behavior across multiple tasks.

Task wording may refer to implementation work, but verification must trace back to the user-visible scenarios in the spec. Do not mark tasks complete unless the work and its verification have actually been completed.

After generating tasks, stop. The planning artifacts are complete before tasks; tasks are a separate handoff artifact, not part of planning. Show the task summary and verification method, and state that implementation requires a separate explicit request. Do not modify business code or enter OpenSpec apply in the same action.

If a confirmed behavior later changes, state that existing tasks may be stale. Do not treat them as still valid. Regenerate them only after the user explicitly ends the interview again.

If the user explicitly asks to implement after tasks have been generated, confirm that they have reviewed the tasks, then enter the standard OpenSpec apply flow. Do not implement code inside the interview flow.

### 4.6 Validate and preserve traceability

Before considering the decision record complete:

1. Confirm every accepted behavior decision maps to a requirement or an explicitly documented reason why no spec change is needed.
2. Confirm every requirement has one or more scenarios with an explicit trigger and observable outcome.
3. Confirm normal, boundary, and failure paths are covered where applicable.
4. Confirm every modified requirement preserves the full existing requirement content, with only the intended behavior changes.
5. Confirm tasks verify the corresponding requirements.
6. Run `openspec validate` and, when compatible with the project, `openspec validate --strict`; resolve reported issues rather than ignoring them.
7. Report exactly which artifacts were created or changed and any validation that could not be run.

Do not set `skip_specs: true` to bypass required behavior documentation. Use it only when the change genuinely has no spec-level behavior change, such as a pure refactor, tooling-only change, or documentation-only change. Never invent a requirement solely to satisfy validation.

Do not archive a change unless the user explicitly requests that step or the active workflow clearly authorizes it. When implementation and `openspec archive` are later requested and completed, transition to `openissue-handoff` to verify archival across all linked proposals and run `openissue confirm <id>` only upon explicit user confirmation.

## 5. Quality Rules and Guardrails

- **User-observable first:** Ask what the user does and sees, not how the code works.
- **Fact discipline:** Confirmed facts, unverified risks, and unknowns must remain distinguishable throughout the interview and OpenSpec documents.
- **One decision per turn:** Never present a large questionnaire or several unrelated decisions at once.
- **No hidden assumptions:** Do not silently choose defaults for behavior that affects user expectations, data loss, permissions, billing, privacy, or irreversible actions.
- **Recoverability:** For failure paths, define whether the user's input, selection, or progress is preserved and what action is available next.
- **Consistency:** Reuse established product language, interaction patterns, capability names, and existing specifications where appropriate.
- **Traceability:** A confirmed decision should be traceable from the interview to a spec requirement, relevant design rationale, and verification task where applicable.
- **No false completion:** Do not claim a repository was inspected, a behavior was reproduced, a test was run, an artifact was updated, or validation passed unless it actually happened.
- **Scope control:** Explore relevant edge cases thoroughly, but do not expand the feature beyond the user's goal without identifying the expansion as a separate decision.
- **One requirement, one active draft:** Do not create a second draft, silently replace an archived proposal, or take over an archived proposal.
- **No silent lifecycle changes:** The requirement stays open throughout the interview and is not closed automatically when a proposal is created, updated, or archived.

## 6. Illustrative Example

The example below demonstrates the required user-perspective format. It is illustrative only; its statements must not be treated as facts about the user's actual product.

### Checkout — What should happen when a saved payment method is expired?

**User Operation**

> A returning customer is on the checkout screen, has selected a saved payment method, and chooses **Place order**.

**Current Actual**

- **[NOT YET VERIFIED]** The current checkout response for an expired saved payment method has not been inspected.
- **[RISK — UNVERIFIED]** The customer may not receive a clear explanation of why the order could not be placed.

**User Expectation**

- **On success:** The customer sees an order confirmation and a clear indication that the order was placed.
- **On failure:** The customer sees that the payment method has expired, the order is not presented as successful, and the customer can choose another payment method without losing the rest of checkout.

**Suggested Approach**

- **Proposed behavior:** Explain that the selected payment method has expired, keep the customer on checkout, preserve their other entered information, and provide a direct way to select a different payment method.
- **Rationale:** The customer understands what prevented checkout and can recover without restarting the process.

**Acceptance Criteria**

- **Normal path:** When the selected payment method is valid and payment succeeds, the customer sees an order confirmation.
- **Boundary path:** When the selected payment method expires before the customer submits the order, the customer is told it is no longer valid and can select another method.
- **Failure path:** When payment is rejected because the payment method has expired, no success confirmation is shown; the customer sees an actionable explanation and retains the rest of checkout.

**Decision to Confirm**

Should checkout keep the customer on the same screen and preserve their other information when the selected payment method is expired?

> **Recommended Decision:** Yes. Keep the customer on checkout, explain the issue, and allow them to replace the payment method without re-entering unrelated information.  
> **Why:** This makes the failure recoverable and avoids unnecessary user effort.

---

## 7. Definition of Done

An `openissue-grill-me` session is done when the user-facing decision tree has been explored to the agreed scope, each accepted decision has been captured in the correct OpenSpec artifact, and remaining unknowns and verification risks are explicitly reported.

The final handoff must include:

1. **Confirmed decisions** — the accepted product behaviors.
2. **Open decisions** — items that still require user input.
3. **Risks to verify** — unconfirmed assumptions about current behavior.
4. **OpenSpec updates** — the exact artifact paths created or modified.
5. **Validation status** — commands run, results, and anything not verifiable in the current environment.

For an OpenIssue session, also report:

- the requirement id and draft id;
- whether tasks were generated (and if generated, confirm no code was modified and `openissue` remains `open`);
- the next action the user must explicitly request (continue interview, generate tasks, run `openspec apply` / `openspec archive`, or confirm completion via `openissue-handoff` after archival).
