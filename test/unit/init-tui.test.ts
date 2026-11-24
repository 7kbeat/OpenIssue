import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveSkillTools } from '../../src/skills/catalog.js';
import {
  moveIndex,
  renderChoices,
  runChoice,
  runInitTui,
  runMultiChoice,
  toggleValue,
  type TuiStep,
} from '../../src/services/init-tui.js';
import {
  runInit,
  type InitOptions,
} from '../../src/services/workspace-init.js';
import {
  createOpenspecSkeleton,
  createTempDir,
  runGit,
  type TempDir,
} from '../helpers/fixtures.js';

const cleanup: TempDir[] = [];

afterEach(async () => {
  delete process.env.OPENISSUE_HOME;
  await Promise.all(cleanup.splice(0).map((item) => item.cleanup()));
});

function streams(): { input: NodeJS.ReadStream; output: NodeJS.WriteStream; text: () => string } {
  const input = new PassThrough() as unknown as NodeJS.ReadStream;
  const output = new PassThrough() as unknown as NodeJS.WriteStream;
  let text = '';
  output.on('data', (chunk: Buffer) => {
    text += chunk.toString();
  });
  return { input, output, text: () => text };
}

async function nextImmediate(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

function stepDriver(io: { onStep?: (step: TuiStep) => void }): {
  next: () => Promise<TuiStep>;
  pending: TuiStep[];
} {
  const pending: TuiStep[] = [];
  let notify: (() => void) | undefined;
  io.onStep = (step) => {
    pending.push(step);
    notify?.();
    notify = undefined;
  };
  return {
    pending,
    next: async () => {
      while (pending.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
      return pending.shift()!;
    },
  };
}

describe('init TUI primitives', () => {
  it('wraps and skips disabled choices', () => {
    const choices = [{}, { disabled: true }, {}];
    expect(moveIndex(0, -1, choices.length, choices)).toBe(2);
    expect(moveIndex(0, 1, choices.length, choices)).toBe(2);
    expect(moveIndex(2, 1, choices.length, choices)).toBe(0);
  });

  it('toggles selected values without mutating the original', () => {
    const original = new Set(['a']);
    const next = toggleValue(original, 'b');
    expect([...original]).toEqual(['a']);
    expect([...next].sort()).toEqual(['a', 'b']);
    expect(toggleValue(next, 'a')).toEqual(new Set(['b']));
  });

  it('renders cursor, multi-select marks, and hints', () => {
    const text = renderChoices({
      title: 'Members',
      step: '1/6',
      choices: [
        { value: 'a', label: 'alpha' },
        { value: 'b', label: 'beta' },
      ],
      index: 1,
      multi: true,
      selected: new Set(['a']),
      language: 'en',
    });
    expect(text).toContain('> [ ] beta');
    expect(text).toContain('  [x] alpha');
    expect(text).toContain('space select');
  });

  it('selects a choice with arrow and enter keypresses', async () => {
    const io = streams();
    const promise = runChoice({
      title: 'Choose',
      step: '1/6',
      choices: [
        { value: 'a', label: 'alpha' },
        { value: 'b', label: 'beta' },
      ],
      language: 'en',
      input: io.input,
      output: io.output,
    });
    io.input.emit('keypress', '', { name: 'down' });
    await new Promise((resolve) => setImmediate(resolve));
    io.input.emit('keypress', '', { name: 'return' });
    await expect(promise).resolves.toEqual({ kind: 'value', value: 'b' });
    expect(io.text()).toContain('beta');
  });

  it('toggles a multi-select choice with space', async () => {
    const io = streams();
    const promise = runMultiChoice({
      title: 'Choose many',
      step: '3/6',
      choices: [
        { value: 'a', label: 'alpha' },
        { value: 'b', label: 'beta' },
      ],
      language: 'en',
      input: io.input,
      output: io.output,
    });
    io.input.emit('keypress', '', { name: 'space' });
    await new Promise((resolve) => setImmediate(resolve));
    io.input.emit('keypress', '', { name: 'down' });
    await new Promise((resolve) => setImmediate(resolve));
    io.input.emit('keypress', '', { name: 'space' });
    await new Promise((resolve) => setImmediate(resolve));
    io.input.emit('keypress', '', { name: 'return' });
    const result = await promise;
    expect(result.kind).toBe('value');
    if (result.kind === 'value') expect(result.value).toEqual(new Set(['a', 'b']));
  });

  it('returns back on escape when allowed', async () => {
    const io = streams();
    const promise = runChoice({
      title: 'Choose',
      step: '1/6',
      choices: [{ value: 'a', label: 'alpha' }],
      language: 'zh',
      input: io.input,
      output: io.output,
      allowBack: true,
    });
    io.input.emit('keypress', '', { name: 'escape' });
    await expect(promise).resolves.toEqual({ kind: 'back' });
  });

  it('runs the full wizard for a unique anchor and writes after review', async () => {
    const workspace = await createTempDir('openissue-tui-');
    const home = await createTempDir('openissue-tui-home-');
    cleanup.push(workspace, home);
    process.env.OPENISSUE_HOME = home.root;
    await mkdir(path.join(workspace.root, 'spec'), { recursive: true });
    await createOpenspecSkeleton(path.join(workspace.root, 'spec'));

    const io = streams();
    const options: InitOptions = {
      cwd: workspace.root,
      id: undefined,
      name: undefined,
      anchorPath: undefined,
      skills: [],
      newProject: undefined,
      yes: undefined,
      memberPaths: [],
      skipMembers: true,
      openspec: false,
      rescan: undefined,
      force: undefined,
      language: 'en',
      languageSource: 'flag',
      interactive: true,
    };
    const driver = stepDriver(io);
    const promise = runInitTui(options, io);
    for (let index = 0; index < 8; index += 1) {
      const step = await driver.next();
      if (step !== 'executing') {
        io.input.emit('keypress', '', { name: 'return' });
      }
    }
    const result = await promise;
    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.report.status).toBe('success');
      expect(result.report.anchor_root).toBe(path.join(workspace.root, 'spec'));
    }
  });

  it(
    'continues past the environment step after selecting one of multiple anchors',
    { timeout: 5000 },
    async () => {
      const workspace = await createTempDir('openissue-tui-anchors-');
      const home = await createTempDir('openissue-tui-home-');
      cleanup.push(workspace, home);
      process.env.OPENISSUE_HOME = home.root;
      const anchors = ['one', 'two'].map((name) => path.join(workspace.root, name));
      for (const root of anchors) {
        await mkdir(path.join(root, 'openissue', 'issues'), { recursive: true });
        await writeFile(
          path.join(root, 'openissue', 'product.yaml'),
          `id: ${path.basename(root)}\nname: ${path.basename(root)}\nfocus: ""\nfocus_updated_at: null\nmembers: []\n`,
          'utf8',
        );
        await createOpenspecSkeleton(root);
      }

      const io = streams();
      const options: InitOptions = {
        cwd: workspace.root,
        id: undefined,
        name: undefined,
        anchorPath: undefined,
        skills: [],
        newProject: undefined,
        yes: undefined,
        memberPaths: [],
        skipMembers: true,
        openspec: false,
        rescan: undefined,
        force: undefined,
        language: 'en',
        languageSource: 'flag',
        interactive: true,
      };
      const driver = stepDriver(io);
      const promise = runInitTui(options, io);
      expect(await driver.next()).toBe('environment');
      io.input.emit('keypress', '', { name: 'return' });
      await nextImmediate();
      io.input.emit('keypress', '', { name: 'return' });
      expect(await driver.next()).toBe('environment');
      io.input.emit('keypress', '', { name: 'return' });
      expect(await driver.next()).toBe('product');
      io.input.emit('keypress', '', { name: 'q' });
      const result = await promise;
      expect(result.kind).toBe('cancelled');
      expect(anchors).toContain(result.plan.anchor_root);
    },
  );

  it('enters and restores the alternate screen in TTY mode', async () => {
    const workspace = await createTempDir('openissue-tui-tty-');
    const home = await createTempDir('openissue-tui-home-');
    cleanup.push(workspace, home);
    process.env.OPENISSUE_HOME = home.root;
    await mkdir(path.join(workspace.root, 'spec'), { recursive: true });
    await createOpenspecSkeleton(path.join(workspace.root, 'spec'));

    const io = streams();
    const input = io.input as NodeJS.ReadStream & {
      isTTY: boolean;
      setRawMode: (mode: boolean) => void;
    };
    const output = io.output as NodeJS.WriteStream & { isTTY: boolean };
    const setRawMode = vi.fn();
    input.isTTY = true;
    input.setRawMode = setRawMode;
    output.isTTY = true;

    const options: InitOptions = {
      cwd: workspace.root,
      id: undefined,
      name: undefined,
      anchorPath: undefined,
      skills: [],
      newProject: undefined,
      yes: undefined,
      memberPaths: [],
      skipMembers: true,
      openspec: false,
      rescan: undefined,
      force: undefined,
      language: 'en',
      languageSource: 'flag',
      interactive: true,
    };
    const driver = stepDriver(io);
    const promise = runInitTui(options, io);
    for (let index = 0; index < 8; index += 1) {
      const step = await driver.next();
      if (step !== 'executing') {
        io.input.emit('keypress', '', { name: 'return' });
      }
    }
    await promise;
    expect(setRawMode).toHaveBeenCalledWith(true);
    expect(setRawMode).toHaveBeenCalledWith(false);
    expect(io.text()).toContain('\x1b[?1049h');
    expect(io.text()).toContain('\x1b[?1049l');
  });

  it('cancels at review without product writes', async () => {
    const workspace = await createTempDir('openissue-tui-cancel-');
    const home = await createTempDir('openissue-tui-home-');
    cleanup.push(workspace, home);
    process.env.OPENISSUE_HOME = home.root;
    await mkdir(path.join(workspace.root, 'spec'), { recursive: true });
    await createOpenspecSkeleton(path.join(workspace.root, 'spec'));

    const io = streams();
    const options: InitOptions = {
      cwd: workspace.root,
      id: undefined,
      name: undefined,
      anchorPath: undefined,
      skills: [],
      newProject: undefined,
      yes: undefined,
      memberPaths: [],
      skipMembers: true,
      openspec: false,
      rescan: undefined,
      force: undefined,
      language: 'en',
      languageSource: 'flag',
      interactive: true,
    };
    const driver = stepDriver(io);
    const promise = runInitTui(options, io);
    for (let index = 0; index < 5; index += 1) {
      const step = await driver.next();
      expect(step).not.toBe('review');
      io.input.emit('keypress', '', { name: 'return' });
    }
    expect(await driver.next()).toBe('review');
    io.input.emit('keypress', '', { name: 'q' });
    const result = await promise;
    expect(result.kind).toBe('cancelled');
    expect(existsSync(path.join(workspace.root, '.openissue-workspace.yaml'))).toBe(false);
  });

  it('preserves an unmanaged skill by default during the wizard', async () => {
    const workspace = await createTempDir('openissue-tui-conflict-');
    const home = await createTempDir('openissue-tui-home-');
    cleanup.push(workspace, home);
    process.env.OPENISSUE_HOME = home.root;
    await mkdir(path.join(workspace.root, 'spec'), { recursive: true });
    await createOpenspecSkeleton(path.join(workspace.root, 'spec'));
    const skillFile = path.join(
      workspace.root,
      '.agents',
      'skills',
      'openissue-capture',
      'SKILL.md',
    );
    await mkdir(path.dirname(skillFile), { recursive: true });
    await writeFile(skillFile, 'user modified content', 'utf8');

    const io = streams();
    const options: InitOptions = {
      cwd: workspace.root,
      id: undefined,
      name: undefined,
      anchorPath: undefined,
      skills: resolveSkillTools('agents'),
      newProject: undefined,
      yes: undefined,
      memberPaths: [],
      skipMembers: true,
      openspec: false,
      rescan: undefined,
      force: undefined,
      language: 'en',
      languageSource: 'flag',
      interactive: true,
    };
    const driver = stepDriver(io);
    const promise = runInitTui(options, io);
    for (let index = 0; index < 8; index += 1) {
      const step = await driver.next();
      if (step !== 'executing') {
        io.input.emit('keypress', '', { name: 'return' });
      }
    }
    const result = await promise;
    expect(result.kind).toBe('completed');
    expect(await readFile(skillFile, 'utf8')).toBe('user modified content');
  });

  it('runs a single-repository journey without a pointer', async () => {
    const repo = await createTempDir('openissue-tui-single-');
    const home = await createTempDir('openissue-tui-home-');
    cleanup.push(repo, home);
    process.env.OPENISSUE_HOME = home.root;
    runGit(repo.root, ['init']);
    await createOpenspecSkeleton(repo.root);

    const io = streams();
    const options: InitOptions = {
      cwd: repo.root,
      id: undefined,
      name: undefined,
      anchorPath: undefined,
      skills: [],
      newProject: undefined,
      yes: undefined,
      memberPaths: [],
      skipMembers: true,
      openspec: false,
      rescan: undefined,
      force: undefined,
      language: 'en',
      languageSource: 'flag',
      interactive: true,
    };
    const driver = stepDriver(io);
    const promise = runInitTui(options, io);
    for (let index = 0; index < 8; index += 1) {
      const step = await driver.next();
      if (step !== 'executing') {
        io.input.emit('keypress', '', { name: 'return' });
      }
    }
    const result = await promise;
    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.report.mode).toBe('single-repo');
      expect(result.report.status).toBe('success');
    }
    expect(existsSync(path.join(repo.root, '.openissue-workspace.yaml'))).toBe(false);
  });

  it('runs a new-project journey and creates both repositories', async () => {
    const workspace = await createTempDir('openissue-tui-new-');
    const home = await createTempDir('openissue-tui-home-');
    cleanup.push(workspace, home);
    process.env.OPENISSUE_HOME = home.root;

    const io = streams();
    const options: InitOptions = {
      cwd: workspace.root,
      id: undefined,
      name: 'Demo',
      anchorPath: undefined,
      skills: [],
      newProject: true,
      yes: undefined,
      memberPaths: [],
      skipMembers: true,
      openspec: false,
      rescan: undefined,
      force: undefined,
      language: 'en',
      languageSource: 'flag',
      interactive: true,
    };
    const driver = stepDriver(io);
    const promise = runInitTui(options, io);
    for (let index = 0; index < 8; index += 1) {
      const step = await driver.next();
      if (step !== 'executing') {
        io.input.emit('keypress', '', { name: 'return' });
      }
    }
    const result = await promise;
    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.report.mode).toBe('new-project');
      expect(result.report.status).toBe('success');
    }
    expect(existsSync(path.join(workspace.root, 'demo'))).toBe(true);
    expect(existsSync(path.join(workspace.root, 'demo-spec'))).toBe(true);
  });

  it('reuses an existing workspace pointer', async () => {
    const workspace = await createTempDir('openissue-tui-reuse-');
    const home = await createTempDir('openissue-tui-home-');
    cleanup.push(workspace, home);
    process.env.OPENISSUE_HOME = home.root;
    await mkdir(path.join(workspace.root, 'spec'), { recursive: true });
    await createOpenspecSkeleton(path.join(workspace.root, 'spec'));

    const base: InitOptions = {
      cwd: workspace.root,
      id: undefined,
      name: undefined,
      anchorPath: undefined,
      skills: [],
      newProject: undefined,
      yes: true,
      memberPaths: [],
      skipMembers: true,
      openspec: false,
      rescan: undefined,
      force: undefined,
      language: 'en',
      languageSource: 'flag',
      interactive: false,
    };
    await runInit({ ...base, anchorPath: 'spec' });

    const io = streams();
    const options: InitOptions = {
      ...base,
      anchorPath: undefined,
      yes: undefined,
      interactive: true,
    };
    const driver = stepDriver(io);
    const promise = runInitTui(options, io);
    for (let index = 0; index < 8; index += 1) {
      const step = await driver.next();
      if (step !== 'executing') {
        io.input.emit('keypress', '', { name: 'return' });
      }
    }
    const result = await promise;
    expect(result.kind).toBe('completed');
    if (result.kind === 'completed') {
      expect(result.report.mode).toBe('workspace-reuse');
      expect(result.report.pointer?.reused).toBe(true);
    }
  });

  it('keeps created content and offers retry then exit after failure', async () => {
    const workspace = await createTempDir('openissue-tui-failure-');
    const home = await createTempDir('openissue-tui-home-');
    cleanup.push(workspace, home);
    process.env.OPENISSUE_HOME = home.root;
    const originalPath = process.env.PATH;
    process.env.PATH = '';

    try {
      const io = streams();
      const options: InitOptions = {
        cwd: workspace.root,
        id: undefined,
        name: 'Demo',
        anchorPath: undefined,
        skills: [],
        newProject: true,
        yes: undefined,
        memberPaths: [],
        skipMembers: true,
        openspec: true,
        rescan: undefined,
        force: undefined,
        language: 'en',
        languageSource: 'flag',
        interactive: true,
      };
      const driver = stepDriver(io);
      const promise = runInitTui(options, io);
      for (let index = 0; index < 5; index += 1) {
        await driver.next();
        io.input.emit('keypress', '', { name: 'return' });
      }
      expect(await driver.next()).toBe('review');
      io.input.emit('keypress', '', { name: 'return' });
      expect(await driver.next()).toBe('executing');
      expect(await driver.next()).toBe('result');
      io.input.emit('keypress', '', { name: 'down' });
      await new Promise((resolve) => setImmediate(resolve));
      io.input.emit('keypress', '', { name: 'return' });

      const result = await promise;
      expect(result.kind).toBe('completed');
      if (result.kind === 'completed') {
        expect(result.report.status).toBe('partial');
        expect(result.report.phases.some((phase) => phase.status === 'failed')).toBe(true);
      }
      expect(existsSync(path.join(workspace.root, 'demo'))).toBe(true);
      expect(existsSync(path.join(workspace.root, 'demo-spec'))).toBe(true);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it('switches language on the first screen and persists it', async () => {
    const workspace = await createTempDir('openissue-tui-language-');
    const home = await createTempDir('openissue-tui-home-');
    cleanup.push(workspace, home);
    process.env.OPENISSUE_HOME = home.root;
    await mkdir(path.join(workspace.root, 'spec'), { recursive: true });
    await createOpenspecSkeleton(path.join(workspace.root, 'spec'));

    const io = streams();
    const options: InitOptions = {
      cwd: workspace.root,
      id: undefined,
      name: undefined,
      anchorPath: undefined,
      skills: [],
      newProject: undefined,
      yes: undefined,
      memberPaths: [],
      skipMembers: true,
      openspec: false,
      rescan: undefined,
      force: undefined,
      language: 'zh',
      languageSource: 'system',
      interactive: true,
    };
    const driver = stepDriver(io);
    const promise = runInitTui(options, io);
    expect(await driver.next()).toBe('environment');
    io.input.emit('keypress', '', { name: 'down' });
    await new Promise((resolve) => setImmediate(resolve));
    io.input.emit('keypress', '', { name: 'return' });
    await new Promise((resolve) => setImmediate(resolve));
    io.input.emit('keypress', '', { name: 'down' });
    await new Promise((resolve) => setImmediate(resolve));
    io.input.emit('keypress', '', { name: 'return' });
    expect(await driver.next()).toBe('environment');
    io.input.emit('keypress', '', { name: 'q' });
    const result = await promise;
    expect(result.kind).toBe('cancelled');
    expect(result.plan.language).toBe('en');
    const prefs = await readFile(path.join(home.root, 'preferences.yaml'), 'utf8');
    expect(prefs).toContain('last_explicit: en');
  });
});
