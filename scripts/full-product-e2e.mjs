#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultOpenspecRunner } from '../dist/services/handoff.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'dist', 'cli.js');
const temp = await mkdtemp(path.join(tmpdir(), 'openissue-product-'));
const home = path.join(temp, '.home');
const anchor = path.join(temp, 'anchor');
const memberA = path.join(temp, 'member-a');
const memberB = path.join(temp, 'member-b');
const env = {
  ...process.env,
  OPENISSUE_HOME: home,
  OPENISSUE_AUTHOR: '端到端测试',
};

function run(args, cwd) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `命令失败：openissue ${args.join(' ')}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function runJson(args, cwd) {
  const output = run(args, cwd);
  const start = output.indexOf('{');
  return JSON.parse(start >= 0 ? output.slice(start) : output);
}

function step(message) {
  console.log(`✓ ${message}`);
}

try {
  await Promise.all([anchor, memberA, memberB].map((dir) => mkdir(dir, { recursive: true })));
  await Promise.all([memberA, memberB].map((dir) => mkdir(path.join(dir, '.git'))));

  run(['init', '--id', 'demo', '--name', 'Demo E2E'], anchor);
  step('在锚点仓库初始化产品');

  await Promise.all([
    mkdir(path.join(anchor, 'openspec', 'changes'), { recursive: true }),
    mkdir(path.join(anchor, 'openspec', 'specs'), { recursive: true }),
  ]);
  await writeFile(path.join(anchor, 'openspec', 'config.yaml'), 'schema: spec-driven\n', 'utf8');

  run(['register', '--anchor', '../anchor'], memberA);
  run(['register', '--anchor', '../anchor'], memberB);
  step('两个成员仓库登记到同一锚点');

  const login = runJson(['create', '登录', '--description', '登录能力', '--json'], memberA);
  step(`成员 A 捕获需求 ${login.id}`);

  const memberList = runJson(['list', '--json'], memberB);
  assert.equal(memberList.issues.length, 1);
  assert.equal(memberList.issues[0].id, login.id);
  step('成员 B 看到同一条需求，且没有本地副本');

  run(['focus', '先跑通收件箱'], anchor);
  const billing = runJson(
    ['create', '接入第三方账单', '--description', '账单接入需要鉴权', '--json'],
    memberA,
  );
  run(['depend', login.id, billing.id], anchor);
  run(['tier', billing.id, 'high'], anchor);
  run(['tier', login.id, 'low'], anchor);
  const priority = runJson(['priority', '--json'], anchor);
  const high = priority.groups.high;
  const loginItem = high.find((item) => item.id === login.id);
  assert.ok(loginItem, '登录应被依赖下限提升到高');
  assert.equal(loginItem.dependency_floor, true);
  step('依赖关系把前置需求提升到高，理由包含依赖下限');

  const request = runJson(['prioritize', '--emit'], anchor);
  const billingRequest = request.issues.find((item) => item.id === billing.id);
  assert.ok(billingRequest);
  const responseFile = path.join(temp, 'assistant-response.json');
  await writeFile(
    responseFile,
    JSON.stringify(
      {
        version: 1,
        results: [
          {
            id: billing.id,
            tier: 'high',
            reason: '当前重点要求先跑通账单接入',
            basis: ['focus'],
            order: 0,
            input_hash: billingRequest.input_hash,
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  const applied = runJson(['prioritize', '--apply', responseFile], anchor);
  assert.deepEqual(applied.applied, [billing.id]);
  step('助手判断请求与写回完成');

  run(['handoff', billing.id, '--change', 'billing-e2e', '--yes'], anchor);
  const changeDir = path.join(anchor, 'openspec', 'changes', 'billing-e2e');
  await writeFile(
    path.join(changeDir, 'proposal.md'),
    '# Billing E2E\n\n## Why\n\n完成账单接入。\n\n## What Changes\n\n- 新增账单能力。\n',
    'utf8',
  );
  await writeFile(path.join(changeDir, 'tasks.md'), '- [x] 完成账单接入\n', 'utf8');
  await mkdir(path.join(changeDir, 'specs', 'billing'), { recursive: true });
  await writeFile(
    path.join(changeDir, 'specs', 'billing', 'spec.md'),
    '## ADDED Requirements\n\n### Requirement: 账单\n\n系统 SHALL 支持账单接入。\n\n#### Scenario: 成功\n\n- **WHEN** 用户配置账单\n- **THEN** 系统保存配置\n',
    'utf8',
  );
  await defaultOpenspecRunner(['validate', 'billing-e2e', '--strict'], anchor);
  await defaultOpenspecRunner(['archive', 'billing-e2e', '--yes', '--json'], anchor);
  const archiveEntries = await readdir(path.join(anchor, 'openspec', 'changes', 'archive'));
  assert.ok(archiveEntries.some((name) => name.endsWith('-billing-e2e')));
  step('OpenSpec 提案通过校验并归档');

  run(['confirm', billing.id], anchor);
  const closed = runJson(['show', billing.id, '--json'], anchor);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.close.reason, 'completed');
  step('确认完成后需求关闭为已完成');

  const productYaml = await readFile(path.join(anchor, 'openissue', 'product.yaml'), 'utf8');
  assert.match(productYaml, /members:/);
  assert.match(productYaml, /member-a/);
  assert.match(productYaml, /member-b/);
  for (const member of [memberA, memberB]) {
    await assert.rejects(access(path.join(member, 'openissue')));
  }
  step('成员仓库没有需求副本');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
