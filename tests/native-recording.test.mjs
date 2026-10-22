import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativePath } from './native-runner.mjs';

test('recording state and invalid arguments never request capture access', () => {
  for (const args of [
    ['record-status'],
    ['record-stop'],
    ['record-start', 'invalid', '/tmp/invalid.mp4'],
    ['record-start', '1', 'relative.mp4'],
  ]) {
    const result = spawnSync(nativePath(), args, { encoding: 'utf8', timeout: 10_000 });
    assert.ifError(result.error);
    const body = JSON.parse(result.stdout);
    if (args[0] === 'record-start') {
      assert.equal(body.error.code, 'INVALID_ARGUMENT');
    } else {
      assert.equal(body.result.active, false);
    }
  }
});

test(
  'MP4 writer preserves static-screen duration and produces decodable video',
  { timeout: 60_000 },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'iris-video-test-'));
    try {
      const root = fileURLToPath(new URL('..', import.meta.url));
      const executable = join(directory, 'recording-fixture');
      const compile = spawnSync(
        'xcrun',
        [
          'swiftc',
          '-swift-version',
          '6',
          '-parse-as-library',
          '-module-cache-path',
          join(directory, 'swift-cache'),
          ...[
            'CaptureEngine.swift',
            'ScreenRecording.swift',
            'ImageServices.swift',
            'RegionSelection.swift',
          ].map((file) => join(root, 'native/macos', file)),
          join(root, 'tests/RecordingFixture.swift'),
          '-o',
          executable,
        ],
        { encoding: 'utf8', timeout: 45_000 },
      );
      assert.ifError(compile.error);
      assert.equal(compile.status, 0, compile.stderr);
      const run = spawnSync(executable, [join(directory, 'generated.mp4')], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.ifError(run.error);
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /first and last frames decode/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
