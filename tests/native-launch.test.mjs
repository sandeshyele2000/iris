import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('first-launch permission requests are one-time and respect existing grants', () => {
  const directory = mkdtempSync(join(tmpdir(), 'iris-permission-test-'));
  try {
    const root = fileURLToPath(new URL('..', import.meta.url));
    const executable = join(directory, 'permission-fixture');
    const compile = spawnSync(
      'xcrun',
      [
        'swiftc',
        '-swift-version',
        '6',
        '-parse-as-library',
        '-module-cache-path',
        join(directory, 'swift-cache'),
        join(root, 'native/macos/LaunchPermission.swift'),
        join(root, 'tests/PermissionFixture.swift'),
        '-o',
        executable,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    assert.ifError(compile.error);
    assert.equal(compile.status, 0, compile.stderr);
    const run = spawnSync(executable, [], { encoding: 'utf8', timeout: 10_000 });
    assert.ifError(run.error);
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /First launch requests once/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
