import { chmod } from 'node:fs/promises';

try {
  await chmod(new URL('../dist/index.js', import.meta.url), 0o755);
} catch (error) {
  if (process.platform !== 'win32') {
    throw error;
  }
}
