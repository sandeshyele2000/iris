import { nativePath } from './native-runner.mjs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
const directory = mkdtempSync(join(tmpdir(), 'iris-images-'));
const fixture = join(directory, 'fixture.png');
function run(...args) {
  const result = spawnSync(nativePath(), args, {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.ifError(result.error);
  return { status: result.status, ...JSON.parse(result.stdout) };
}
before(() => {
  const result = spawnSync(
    'xcrun',
    [
      'swift',
      '-module-cache-path',
      'native/macos/.build/cache',
      'tests/MakeFixture.swift',
      fixture,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(result.status, 0, result.stderr);
});
after(() => rmSync(directory, { recursive: true, force: true }));
test('native image metadata, PNG/JPEG exports and thumbnail generation', () => {
  const info = run('image-info', fixture);
  assert.equal(info.ok, true);
  assert.ok(info.result.width >= 640);
  assert.ok(info.result.height >= 200);
  for (const format of ['png', 'jpeg']) {
    const output = join(directory, `export.${format}`);
    assert.equal(run('convert', fixture, output, format).ok, true);
    const bytes = readFileSync(output);
    assert.ok(
      format === 'png'
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes[0] === 255 && bytes[1] === 216,
    );
    assert.deepEqual(run('image-info', output).result, info.result);
    assert.equal(
      run('convert', fixture, output, format).ok,
      false,
      'Existing output must not be overwritten',
    );
  }
  const thumb = join(directory, 'thumb.png');
  assert.equal(run('thumbnail', fixture, thumb).ok, true);
  assert.ok(run('image-info', thumb).result.width <= 320);
});
test('OCR recognizes a generated local image without capture or network access', () => {
  const result = run('ocr', fixture);
  assert.equal(result.ok, true);
  assert.match(result.result.text, /IRIS LOCAL TEST/);
});
test('bad images report structured errors', () => {
  const result = run('image-info', join(directory, 'missing.png'));
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'INVALID_IMAGE');
});
test(
  'authorized display capture produces a readable PNG',
  {
    skip:
      process.env.IRIS_TEST_CAPTURE !== '1'
        ? 'Set IRIS_TEST_CAPTURE=1 only on an authorized Mac with Screen Recording access.'
        : false,
  },
  () => {
    const sources = run('sources').result;
    assert.ok(sources.displays.length);
    const output = join(directory, 'authorized-capture.png');
    const capture = run('capture', String(sources.displays[0].id), output);
    assert.equal(capture.ok, true, JSON.stringify(capture));
    assert.ok(existsSync(output));
    const info = run('image-info', output).result;
    assert.equal(info.width, capture.result.width);
    assert.equal(info.height, capture.result.height);
  },
);
