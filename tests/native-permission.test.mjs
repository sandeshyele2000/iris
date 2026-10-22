import { nativePath } from './native-runner.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

function run(...args) {
  const process = spawnSync(nativePath(), args, {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.ifError(process.error);
  return { status: process.status, body: JSON.parse(process.stdout) };
}

test('diagnostics report Screen Recording permission without requesting access', () => {
  const { status, body } = run('diagnose');
  assert.equal(status, 0);
  assert.equal(body.ok, true);
  assert.equal(typeof body.result.permissionGranted, 'boolean');
  assert.equal('policy' in body.result, false);
  assert.equal('sophosInstalled' in body.result, false);
});

test('invalid commands return a structured failure and nonzero exit', () => {
  const { status, body } = run('invalid-command');
  assert.equal(status, 1);
  assert.equal(body.error.code, 'INVALID_ARGUMENT');
});

test('invalid capture input fails before permission checks and never writes a PNG', () => {
  const directory = mkdtempSync(join(tmpdir(), 'iris-capture-test-'));
  const output = join(directory, 'must-not-exist.png');
  try {
    for (const args of [
      ['capture', 'invalid', output],
      ['capture', '1', 'relative.png'],
      ['capture', '1', join(directory, 'invalid.jpg')],
    ]) {
      const { status, body } = run(...args);
      assert.equal(status, 1);
      assert.equal(body.error.code, 'INVALID_ARGUMENT');
    }
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
