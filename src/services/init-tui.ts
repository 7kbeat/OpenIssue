import path from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import type { Language } from '../core/language.js';
import { saveExplicitLanguage } from '../storage/preferences.js';
import {
  buildInitPlan,
  executeInitPlan,
  type InitPlan,
  type PlanOverrides,
} from './init-plan.js';
import type { InitOptions, InitReport } from './workspace-init.js';

export type TuiStep =
  | 'environment'
  | 'product'
  | 'members'
  | 'skills'
  | 'openspec'
  | 'review'
  | 'executing'
  | 'result';

export interface TuiIO {
  input: NodeJS.ReadStream;
  output: NodeJS.WriteStream;
  onStep?: (step: TuiStep) => void;
}

export interface TuiKey {
  name?: string;
  ctrl?: boolean;
}

export interface TuiChoice<T> {
  value: T;
  label: string;
  disabled?: boolean;
}

export type ChoiceResult<T> =
  | { kind: 'value'; value: T }
  | { kind: 'back' }
  | { kind: 'cancel' };

export type TuiResult =
  | { kind: 'completed'; plan: InitPlan; report: InitReport }
  | { kind: 'cancelled'; plan: InitPlan };

export function moveIndex(
  index: number,
  delta: number,
  length: number,
  choices: Array<{ disabled?: boolean }> = [],
): number {
  if (length === 0) return 0;
  let next = index;
  for (let attempts = 0; attempts < length; attempts += 1) {
    next = (next + delta + length) % length;
    if (!choices[next]?.disabled) return next;
  }
  return index;
}

export function toggleValue<T>(selected: Set<T>, value: T, disabled = false): Set<T> {
  if (disabled) return selected;
  const next = new Set(selected);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function renderChoices<T>(params: {
  title: string;
  step: string;
  choices: TuiChoice<T>[];
  index: number;
  multi?: boolean;
  selected?: Set<T>;
  language: Language;
}): string {
  const lines = [params.title, params.step, ''];
  params.choices.forEach((choice, choiceIndex) => {
    const cursor = choiceIndex === params.index ? '>' : ' ';
    const mark =
      params.multi && params.selected ? (params.selected.has(choice.value) ? '[x]' : '[ ]') : '';
    const disabled = choice.disabled
      ? `  ${t(params.language, '（不可用）', '(unavailable)')}`
      : '';
    lines.push(`${cursor} ${mark}${mark ? ' ' : ''}${choice.label}${disabled}`);
  });
  lines.push('');
  lines.push(
    t(
      params.language,
      '↑/↓ 移动 · 空格选择 · 回车继续 · ←/Esc 返回 · q 取消',
      '↑/↓ move · space select · enter continue · ←/Esc back · q cancel',
    ),
  );
  return lines.join('\n');
}

export function renderReview(plan: InitPlan): string {
  const language = plan.language;
  const lines = [
    t(language, '执行前 Review', 'Review before initialization'),
    '',
    `${t(language, '模式', 'Mode')}: ${plan.mode} — ${plan.mode_reason}`,
    `${t(language, '语言', 'Language')}: ${language === 'zh' ? '中文' : 'English'}`,
  ];
  if (plan.product) {
    lines.push(
      `${t(language, '产品', 'Product')}: ${plan.product.id} (${plan.product.name})`,
    );
  }
  if (plan.anchor_root) {
    lines.push(`${t(language, '锚点', 'Anchor')}: ${plan.anchor_root}`);
  }
  if (plan.code_root) lines.push(`${t(language, '代码仓', 'Code repo')}: ${plan.code_root}`);
  if (plan.spec_root) lines.push(`${t(language, 'spec 仓', 'Spec repo')}: ${plan.spec_root}`);
  lines.push('', t(language, '成员', 'Members'));
  if (plan.members.length === 0) {
    lines.push(`  ${t(language, '无', 'none')}`);
  } else {
    for (const member of plan.members) {
      lines.push(
        `  ${member.selected ? '[x]' : '[ ]'} ${member.id} — ${member.status}${
          member.reason ? ` (${member.reason})` : ''
        }`,
      );
    }
  }
  lines.push('', t(language, 'Skills', 'Skills'));
  lines.push(
    `  ${
      plan.skills.install
        ? `${t(language, '安装到', 'install to')} ${plan.skills.target}`
        : t(language, '跳过', 'skip')
    }`,
  );
  if (plan.skills.conflicts.length > 0) {
    for (const conflict of plan.skills.conflicts) {
      lines.push(`  ! ${conflict.path} (${conflict.state})`);
    }
  }
  lines.push('', 'OpenSpec');
  if (plan.openspec.ready) {
    lines.push(`  ${t(language, '已就绪', 'ready')}`);
  } else if (plan.openspec.cli_available) {
    lines.push(
      `  ${
        plan.openspec.initialize
          ? t(language, '本次初始化', 'initialize now')
          : t(language, '暂不初始化', 'initialize later')
      }`,
    );
  } else {
    lines.push(`  ${t(language, 'CLI 不可用，暂不初始化', 'CLI unavailable; initialize later')}`);
  }
  lines.push('', t(language, '将写入', 'Will write'));
  if (plan.writes.length === 0) {
    lines.push(`  ${t(language, '无变更', 'no changes')}`);
  } else {
    for (const write of plan.writes) {
      lines.push(`  [${write.action}] ${write.path} — ${write.label}`);
    }
  }
  if (plan.warnings.length > 0) {
    lines.push('', t(language, '警告', 'Warnings'));
    for (const warning of plan.warnings) lines.push(`  - ${warning}`);
  }
  return lines.join('\n');
}

export function readTuiKey(input: NodeJS.ReadStream): Promise<TuiKey> {
  const { promise, resolve } = Promise.withResolvers<TuiKey>();
  const onKey = (_value: string, key: TuiKey): void => {
    input.off('keypress', onKey);
    resolve(key);
  };
  input.on('keypress', onKey);
  return promise;
}

export async function runChoice<T>(
  params: {
    title: string;
    step: string;
    choices: TuiChoice<T>[];
    language: Language;
    input: NodeJS.ReadStream;
    output: NodeJS.WriteStream;
    initialIndex?: number;
    allowBack?: boolean;
  },
): Promise<ChoiceResult<T>> {
  let index = params.initialIndex ?? 0;
  for (;;) {
    params.output.write('\x1b[2J\x1b[H');
    params.output.write(
      `${renderChoices({
        title: params.title,
        step: params.step,
        choices: params.choices,
        index,
        language: params.language,
      })}\n`,
    );
    const key = await readTuiKey(params.input);
    if (key.ctrl || key.name === 'q') return { kind: 'cancel' };
    if (key.name === 'up') {
      index = moveIndex(index, -1, params.choices.length, params.choices);
      continue;
    }
    if (key.name === 'down') {
      index = moveIndex(index, 1, params.choices.length, params.choices);
      continue;
    }
    if (key.name === 'return' || key.name === 'enter') {
      const choice = params.choices[index];
      if (choice && !choice.disabled) return { kind: 'value', value: choice.value };
      continue;
    }
    if (key.name === 'escape' || key.name === 'left') {
      if (params.allowBack) return { kind: 'back' };
      return { kind: 'cancel' };
    }
  }
}

export async function runMultiChoice<T>(
  params: {
    title: string;
    step: string;
    choices: TuiChoice<T>[];
    language: Language;
    input: NodeJS.ReadStream;
    output: NodeJS.WriteStream;
    selected?: Set<T>;
    allowBack?: boolean;
  },
): Promise<ChoiceResult<Set<T>>> {
  let index = 0;
  let selected = new Set(params.selected ?? []);
  for (;;) {
    params.output.write('\x1b[2J\x1b[H');
    params.output.write(
      `${renderChoices({
        title: params.title,
        step: params.step,
        choices: params.choices,
        index,
        multi: true,
        selected,
        language: params.language,
      })}\n`,
    );
    const key = await readTuiKey(params.input);
    if (key.ctrl || key.name === 'q') return { kind: 'cancel' };
    if (key.name === 'up') {
      index = moveIndex(index, -1, params.choices.length, params.choices);
      continue;
    }
    if (key.name === 'down') {
      index = moveIndex(index, 1, params.choices.length, params.choices);
      continue;
    }
    if (key.name === 'space') {
      const choice = params.choices[index];
      if (choice) selected = toggleValue(selected, choice.value, choice.disabled);
      continue;
    }
    if (key.name === 'return' || key.name === 'enter') {
      return { kind: 'value', value: selected };
    }
    if (key.name === 'escape' || key.name === 'left') {
      if (params.allowBack) return { kind: 'back' };
      return { kind: 'cancel' };
    }
  }
}

export async function runInitTui(
  initialOptions: InitOptions,
  io: TuiIO = { input: process.stdin, output: process.stdout },
): Promise<TuiResult> {
  const input = io.input;
  const output = io.output;
  const rawInput = input as NodeJS.ReadStream & {
    setRawMode?: (mode: boolean) => void;
  };
  const hasTty = input.isTTY === true;
  if (hasTty) {
    emitKeypressEvents(input);
    rawInput.setRawMode?.(true);
    output.write('\x1b[?1049h\x1b[?25l');
  }

  let options = initialOptions;
  let overrides: PlanOverrides = {};
  let plan = await buildInitPlan(options, overrides);
  let step = 0;

  try {
    for (;;) {
      if (step === 0) {
        io.onStep?.('environment');
        const result = await environmentStep(plan, options, overrides, io);
        if (result.kind === 'cancel') return { kind: 'cancelled', plan };
        if (result.kind === 'restart') {
          options = result.options;
          overrides = result.overrides;
          plan = result.plan;
          step = 0;
          continue;
        }
        plan = result.plan;
        options = result.options;
        overrides = result.overrides;
        step = 1;
        continue;
      }

      if (step === 1) {
        io.onStep?.('product');
        const result = await runChoice({
          title: t(options.language, '产品与锚点', 'Product and anchor'),
          step: t(options.language, '步骤 2/6', 'Step 2/6'),
          choices: [
            { value: 'next', label: t(options.language, '继续', 'Continue') },
            { value: 'back', label: t(options.language, '返回', 'Back') },
          ],
          language: options.language,
          input,
          output,
          allowBack: true,
        });
        if (result.kind === 'cancel') return { kind: 'cancelled', plan };
        if (result.kind === 'back') {
          step = 0;
          continue;
        }
        step = 2;
        continue;
      }

      if (step === 2) {
        io.onStep?.('members');
        if (plan.members.length === 0) {
          const result = await runChoice({
            title: t(options.language, '成员：无可登记成员', 'Members: no candidates'),
            step: t(options.language, '步骤 3/6', 'Step 3/6'),
            choices: [
              { value: 'next', label: t(options.language, '继续', 'Continue') },
              { value: 'back', label: t(options.language, '返回', 'Back') },
            ],
            language: options.language,
            input,
            output,
            allowBack: true,
          });
          if (result.kind === 'cancel') return { kind: 'cancelled', plan };
          if (result.kind === 'back') {
            step = 1;
            continue;
          }
          step = 3;
          continue;
        }
        const selected = new Set(
          plan.members
            .filter((member) => member.selected)
            .map((member) => member.path),
        );
        const result = await runMultiChoice({
          title: t(options.language, '选择成员仓库', 'Select member repositories'),
          step: t(options.language, '步骤 3/6', 'Step 3/6'),
          choices: plan.members.map((member) => ({
            value: member.path,
            label: `${member.id}${member.reason ? ` — ${member.reason}` : ''}`,
            disabled: member.status === 'conflict' || member.status === 'invalid',
          })),
          selected,
          language: options.language,
          input,
          output,
          allowBack: true,
        });
        if (result.kind === 'cancel') return { kind: 'cancelled', plan };
        if (result.kind === 'back') {
          step = 1;
          continue;
        }
        plan = {
          ...plan,
          members: plan.members.map((member) => ({
            ...member,
            selected: result.value.has(member.path),
          })),
        };
        step = 3;
        continue;
      }

      if (step === 3) {
        io.onStep?.('skills');
        const result = await skillsStep(plan, options, io);
        if (result.kind === 'cancel') return { kind: 'cancelled', plan };
        if (result.kind === 'back') {
          step = 2;
          continue;
        }
        plan = { ...result.plan, options: result.options };
        options = result.options;
        step = 4;
        continue;
      }

      if (step === 4) {
        io.onStep?.('openspec');
        const result = await openspecStep(plan, options, io);
        if (result.kind === 'cancel') return { kind: 'cancelled', plan };
        if (result.kind === 'back') {
          step = 3;
          continue;
        }
        plan = refreshPlan({ ...result.plan, options: result.options });
        options = result.options;
        step = 5;
        continue;
      }

      io.onStep?.('review');
      const reviewed = await reviewStep(plan, io);
      if (reviewed.kind === 'cancel') return { kind: 'cancelled', plan };
      if (reviewed.kind === 'back') {
        step = 4;
        continue;
      }

      const executed = await executeWithResult(plan, io);
      return executed;
    }
  } finally {
    if (hasTty) {
      rawInput.setRawMode?.(false);
      output.write('\x1b[?25h\x1b[?1049l');
    }
  }
}

type StepResult =
  | { kind: 'next'; plan: InitPlan; options: InitOptions; overrides: PlanOverrides }
  | { kind: 'restart'; plan: InitPlan; options: InitOptions; overrides: PlanOverrides }
  | { kind: 'cancel' };

async function environmentStep(
  plan: InitPlan,
  options: InitOptions,
  overrides: PlanOverrides,
  io: TuiIO,
): Promise<StepResult> {
  if (plan.blocked_reason) {
    const choices: TuiChoice<string>[] = [
      { value: 'retry', label: t(options.language, '重试', 'Retry') },
    ];
    if (
      plan.blocked_code === 'WORKSPACE_NOT_EMPTY' ||
      plan.blocked_code === 'PROJECT_NAME_REQUIRED' ||
      plan.blocked_code === 'INVALID_PROJECT_NAME'
    ) {
      choices.push({
        value: 'new',
        label: t(options.language, '输入项目名并新建', 'Enter a project name and create'),
      });
    }
    choices.push({ value: 'cancel', label: t(options.language, '取消', 'Cancel') });
    const result = await runChoice({
      title: plan.blocked_reason,
      step: t(options.language, '步骤 1/6', 'Step 1/6'),
      choices,
      language: options.language,
      input: io.input,
      output: io.output,
    });
    if (result.kind !== 'value' || result.value === 'cancel') return { kind: 'cancel' };
    if (result.value === 'new') {
      const name = await askText(
        t(options.language, '英文项目名', 'English project name'),
        io,
      );
      if (name === undefined) return { kind: 'cancel' };
      const nextOptions = { ...options, name, newProject: true, yes: false };
      const nextOverrides: PlanOverrides = { forceMode: 'new-project', name };
      const nextPlan = await buildInitPlan(nextOptions, nextOverrides);
      return {
        kind: 'restart',
        plan: nextPlan,
        options: nextOptions,
        overrides: nextOverrides,
      };
    }
    const nextPlan = await buildInitPlan(options, overrides);
    return {
      kind: 'restart',
      plan: nextPlan,
      options,
      overrides,
    };
  }

  const choices: TuiChoice<string>[] = [
    { value: 'continue', label: t(options.language, '继续', 'Continue') },
    {
      value: 'language',
      label: t(options.language, '切换语言', 'Switch language'),
    },
    {
      value: 'mode',
      label: t(options.language, '改选模式', 'Change mode'),
    },
    { value: 'cancel', label: t(options.language, '取消', 'Cancel') },
  ];
  const result = await runChoice({
    title: plan.mode_reason || t(options.language, '初始化环境', 'Initialization environment'),
    step: t(options.language, '步骤 1/6', 'Step 1/6'),
    choices,
    language: options.language,
    input: io.input,
    output: io.output,
  });
  if (result.kind !== 'value' || result.value === 'cancel') return { kind: 'cancel' };

  if (result.value === 'language') {
    const languageResult = await runChoice({
      title: t(options.language, '选择语言', 'Choose language'),
      step: t(options.language, '步骤 1/6', 'Step 1/6'),
      choices: [
        { value: 'zh', label: '中文' },
        { value: 'en', label: 'English' },
      ] as TuiChoice<Language>[],
      language: options.language,
      input: io.input,
      output: io.output,
      allowBack: true,
    });
    if (languageResult.kind !== 'value') return { kind: 'cancel' };
    const saved = await saveExplicitLanguage(plan.workspace_root, languageResult.value);
    if (saved.warning) {
      io.output.write(`${t(options.language, '警告', 'Warning')}: ${saved.warning}\n`);
    }
    const nextOptions = {
      ...options,
      language: languageResult.value,
      languageSource: 'flag' as const,
    };
    const nextPlan = await buildInitPlan(nextOptions, overrides);
    return {
      kind: 'restart',
      plan: nextPlan,
      options: nextOptions,
      overrides,
    };
  }

  if (result.value === 'mode') {
    const modeResult = await runChoice({
      title: t(options.language, '选择模式', 'Choose mode'),
      step: t(options.language, '步骤 1/6', 'Step 1/6'),
      choices: [
        { value: 'workspace', label: t(options.language, 'workspace', 'workspace') },
        { value: 'single-repo', label: t(options.language, '单仓', 'single repo') },
        { value: 'new-project', label: t(options.language, '新项目', 'new project') },
      ] as TuiChoice<string>[],
      language: options.language,
      input: io.input,
      output: io.output,
      allowBack: true,
    });
    if (modeResult.kind !== 'value') return { kind: 'cancel' };
    let nextOptions = options;
    let nextOverrides: PlanOverrides = { forceMode: modeResult.value as InitPlan['mode'] };
    if (modeResult.value === 'new-project') {
      const name = await askText(
        t(options.language, '英文项目名', 'English project name'),
        io,
      );
      if (name === undefined) return { kind: 'cancel' };
      nextOptions = { ...options, name, newProject: true };
      nextOverrides = { ...nextOverrides, name };
    }
    const nextPlan = await buildInitPlan(nextOptions, nextOverrides);
    return {
      kind: 'restart',
      plan: nextPlan,
      options: nextOptions,
      overrides: nextOverrides,
    };
  }

  if (plan.requires_anchor_selection) {
    const choice = await runChoice({
      title: t(options.language, '选择锚点', 'Choose anchor'),
      step: t(options.language, '步骤 1/6', 'Step 1/6'),
      choices: plan.anchors.map((anchor) => ({
        value: anchor.path,
        label: `${anchor.path} — ${anchor.reason}`,
      })),
      language: options.language,
      input: io.input,
      output: io.output,
      allowBack: true,
    });
    if (choice.kind !== 'value') return { kind: 'cancel' };
    const nextOverrides = { ...overrides, anchorPath: choice.value };
    const nextPlan = await buildInitPlan(options, nextOverrides);
    return {
      kind: 'restart',
      plan: nextPlan,
      options,
      overrides: nextOverrides,
    };
  }

  return { kind: 'next', plan, options, overrides };
}

async function skillsStep(
  plan: InitPlan,
  options: InitOptions,
  io: TuiIO,
): Promise<
  | { kind: 'next'; plan: InitPlan; options: InitOptions }
  | { kind: 'back' }
  | { kind: 'cancel' }
> {
  if (plan.skills.conflicts.length > 0) {
    const result = await runChoice({
      title: t(options.language, 'Skills 冲突', 'Skills conflict'),
      step: t(options.language, '步骤 4/6', 'Step 4/6'),
      choices: [
        {
          value: 'preserve',
          label: t(options.language, '保留现有并跳过', 'Preserve existing and skip'),
        },
        { value: 'overwrite', label: t(options.language, '覆盖并安装', 'Overwrite and install') },
        { value: 'back', label: t(options.language, '返回', 'Back') },
        { value: 'cancel', label: t(options.language, '取消', 'Cancel') },
      ],
      language: options.language,
      input: io.input,
      output: io.output,
      allowBack: true,
    });
    if (result.kind === 'cancel') return { kind: 'cancel' };
    if (result.kind === 'back' || result.value === 'back') return { kind: 'back' };
    if (result.value === 'preserve') {
      return {
        kind: 'next',
        plan: { ...plan, skills: { ...plan.skills, install: false } },
        options: { ...options, skills: [] },
      };
    }
    return {
      kind: 'next',
      plan,
      options: { ...options, force: true },
    };
  }

  const result = await runChoice({
    title: t(options.language, '安装共享 skills', 'Install shared skills'),
    step: t(options.language, '步骤 4/6', 'Step 4/6'),
    choices: [
      { value: 'install', label: t(options.language, '安装到 .agents/skills', 'Install to .agents/skills') },
      { value: 'skip', label: t(options.language, '跳过', 'Skip') },
      { value: 'back', label: t(options.language, '返回', 'Back') },
      { value: 'cancel', label: t(options.language, '取消', 'Cancel') },
    ],
    language: options.language,
    input: io.input,
    output: io.output,
    allowBack: true,
  });
  if (result.kind === 'cancel') return { kind: 'cancel' };
  if (result.kind === 'back' || result.value === 'back') return { kind: 'back' };
  if (result.value === 'skip') {
    return {
      kind: 'next',
      plan: { ...plan, skills: { ...plan.skills, install: false } },
      options: { ...options, skills: [] },
    };
  }
  return { kind: 'next', plan, options };
}

async function openspecStep(
  plan: InitPlan,
  options: InitOptions,
  io: TuiIO,
): Promise<
  | { kind: 'next'; plan: InitPlan; options: InitOptions }
  | { kind: 'back' }
  | { kind: 'cancel' }
> {
  if (plan.openspec.ready || !plan.openspec.cli_available || !plan.openspec.needs_choice) {
    const result = await runChoice({
      title: plan.openspec.ready
        ? t(options.language, 'OpenSpec 已就绪', 'OpenSpec is ready')
        : plan.openspec.reason ||
          t(options.language, 'OpenSpec 暂不初始化', 'OpenSpec will not be initialized now'),
      step: t(options.language, '步骤 5/6', 'Step 5/6'),
      choices: [
        { value: 'next', label: t(options.language, '继续', 'Continue') },
        { value: 'back', label: t(options.language, '返回', 'Back') },
        { value: 'cancel', label: t(options.language, '取消', 'Cancel') },
      ],
      language: options.language,
      input: io.input,
      output: io.output,
      allowBack: true,
    });
    if (result.kind === 'cancel') return { kind: 'cancel' };
    if (result.kind === 'back' || result.value === 'back') return { kind: 'back' };
    return { kind: 'next', plan, options };
  }

  const result = await runChoice({
    title: t(options.language, 'OpenSpec 尚未初始化', 'OpenSpec is not initialized'),
    step: t(options.language, '步骤 5/6', 'Step 5/6'),
    choices: [
      { value: 'now', label: t(options.language, '现在初始化', 'Initialize now') },
      { value: 'later', label: t(options.language, '暂不初始化', 'Initialize later') },
      { value: 'back', label: t(options.language, '返回', 'Back') },
      { value: 'cancel', label: t(options.language, '取消', 'Cancel') },
    ],
    language: options.language,
    input: io.input,
    output: io.output,
    allowBack: true,
  });
  if (result.kind === 'cancel') return { kind: 'cancel' };
  if (result.kind === 'back' || result.value === 'back') return { kind: 'back' };
  return {
    kind: 'next',
    plan: {
      ...plan,
      openspec: {
        ...plan.openspec,
        initialize: result.value === 'now',
        needs_choice: false,
      },
    },
    options,
  };
}

async function reviewStep(
  plan: InitPlan,
  io: TuiIO,
): Promise<{ kind: 'execute' } | { kind: 'back' } | { kind: 'cancel' }> {
  io.output.write('\x1b[2J\x1b[H');
  io.output.write(`${renderReview(plan)}\n\n`);
  const result = await runChoice({
    title: t(plan.language, '确认执行', 'Confirm initialization'),
    step: t(plan.language, '步骤 6/6', 'Step 6/6'),
    choices: [
      { value: 'execute', label: t(plan.language, '执行', 'Execute') },
      { value: 'back', label: t(plan.language, '返回修改', 'Back to edit') },
      { value: 'cancel', label: t(plan.language, '取消', 'Cancel') },
    ],
    language: plan.language,
    input: io.input,
    output: io.output,
    allowBack: true,
  });
  if (result.kind === 'cancel') return { kind: 'cancel' };
  if (result.kind === 'back' || result.value === 'back') return { kind: 'back' };
  return { kind: 'execute' };
}

async function executeWithResult(plan: InitPlan, io: TuiIO): Promise<TuiResult> {
  let current = plan;
  for (;;) {
    io.onStep?.('executing');
    io.output.write('\x1b[2J\x1b[H');
    io.output.write(`${t(plan.language, '正在执行初始化…', 'Initializing…')}\n`);
    const report = await executeInitPlan(current);
    io.output.write('\x1b[2J\x1b[H');
    io.output.write(`${renderReport(report, plan.language)}\n\n`);
    io.onStep?.('result');
    const choices: TuiChoice<string>[] = [];
    if (report.status !== 'success') {
      choices.push({ value: 'retry', label: t(plan.language, '重试', 'Retry') });
    }
    choices.push({ value: 'exit', label: t(plan.language, '退出', 'Exit') });
    const result = await runChoice({
      title: t(plan.language, '执行结果', 'Execution result'),
      step: t(plan.language, '步骤 7/7', 'Step 7/7'),
      choices,
      language: plan.language,
      input: io.input,
      output: io.output,
    });
    if (result.kind === 'value' && result.value === 'retry') {
      continue;
    }
    return { kind: 'completed', plan: current, report };
  }
}

function renderReport(report: InitReport, language: Language): string {
  const lines = [
    `${t(language, '状态', 'Status')}: ${report.status}`,
    `${t(language, '模式', 'Mode')}: ${report.mode}`,
  ];
  if (report.product) lines.push(`${t(language, '产品', 'Product')}: ${report.product.id}`);
  if (report.anchor_root) lines.push(`${t(language, '锚点', 'Anchor')}: ${report.anchor_root}`);
  lines.push('', t(language, '阶段', 'Phases'));
  for (const phase of report.phases) {
    const label = language === 'zh' ? phase.label : phaseLabel(phase.label);
    lines.push(`  ${phase.status === 'success' ? '✓' : phase.status === 'failed' ? '✗' : '-'} ${label}${phase.message ? ` — ${phase.message}` : ''}`);
  }
  if (report.warnings.length > 0) {
    lines.push('', t(language, '警告', 'Warnings'));
    for (const warning of report.warnings) lines.push(`  - ${warning}`);
  }
  if (report.next.length > 0) {
    lines.push('', t(language, '下一步', 'Next'));
    for (const command of report.next) lines.push(`  ${command}`);
  }
  return lines.join('\n');
}

async function askText(
  message: string,
  io: TuiIO,
): Promise<string | undefined> {
  const raw = io.input as NodeJS.ReadStream & {
    setRawMode?: (mode: boolean) => void;
  };
  if (io.input.isTTY) raw.setRawMode?.(false);
  const rl = createInterface({ input: io.input, output: io.output });
  try {
    const value = await rl.question(`${message}: `);
    return value.trim() || undefined;
  } finally {
    rl.close();
    if (io.input.isTTY) raw.setRawMode?.(true);
  }
}

function phaseLabel(label: string): string {
  const labels: Record<string, string> = {
    项目计划: 'Project plan',
    '初始化 Git 仓库': 'Initialize Git repositories',
    'OpenIssue 产品': 'OpenIssue product',
    '本机锚点注册': 'Register local anchor',
    'OpenSpec 初始化': 'Initialize OpenSpec',
    '提升 OpenSpec skills': 'Promote OpenSpec skills',
    '写入 workspace 指针': 'Write workspace pointer',
    '复用 workspace 指针': 'Reuse workspace pointer',
    '登记成员仓库': 'Register member repositories',
    '安装 OpenIssue skills': 'Install OpenIssue skills',
    'spec 仓 AGENTS': 'Spec repository AGENTS',
    'workspace AGENTS 索引': 'Workspace AGENTS index',
    '自动登记代码仓': 'Register code repository',
  };
  return labels[label] ?? label;
}

function refreshPlan(plan: InitPlan): InitPlan {
  const base = plan.writes.filter(
    (write) => write.kind !== 'skills' && write.kind !== 'openspec' && write.kind !== 'member',
  );
  if (plan.skills.install) {
    base.push({
      path: plan.skills.target,
      action: 'update',
      label: 'skills',
      kind: 'skills',
    });
  }
  const openspecRoot = plan.anchor_root ?? plan.spec_root;
  if (!plan.openspec.ready && plan.openspec.initialize && openspecRoot) {
    base.push({
      path: path.join(openspecRoot, 'openspec'),
      action: 'create',
      label: 'OpenSpec',
      kind: 'openspec',
    });
  }
  for (const member of plan.members.filter((item) => item.selected)) {
    base.push({
      path: path.join(member.path, 'openissue-project.yaml'),
      action: 'create',
      label: 'member pointer',
      kind: 'member',
    });
  }
  return { ...plan, writes: base };
}

function t(language: Language, zh: string, en: string): string {
  return language === 'zh' ? zh : en;
}
