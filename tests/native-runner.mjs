import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function nativePath() {
  if (process.platform !== 'darwin') throw new Error('Native diagnostics require macOS.');
  const architecture = { arm64: 'aarch64', x64: 'x86_64' }[process.arch];
  if (!architecture) throw new Error(`Unsupported architecture: ${process.arch}`);
  return fileURLToPath(
    new URL(`../src-tauri/binaries/iris-capture-${architecture}-apple-darwin`, import.meta.url),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = spawnSync(nativePath(), process.argv.slice(2), { stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}
