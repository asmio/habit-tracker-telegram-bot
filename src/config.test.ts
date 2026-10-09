import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadBotConfig, loadDbConfig } from './config';

describe('loadBotConfig', () => {
  const originalToken = process.env.BOT_TOKEN;
  afterEach(() => {
    if (originalToken === undefined) delete process.env.BOT_TOKEN;
    else process.env.BOT_TOKEN = originalToken;
  });

  test('reads BOT_TOKEN from the environment', () => {
    process.env.BOT_TOKEN = 'abc123';
    expect(loadBotConfig()).toEqual({ botToken: 'abc123' });
  });

  test('throws a descriptive error when BOT_TOKEN is missing', () => {
    delete process.env.BOT_TOKEN;
    expect(() => loadBotConfig()).toThrow(/Invalid environment configuration/);
  });

  test('throws when BOT_TOKEN is present but empty', () => {
    process.env.BOT_TOKEN = '';
    expect(() => loadBotConfig()).toThrow(/Invalid environment configuration/);
  });
});

describe('loadDbConfig', () => {
  const originalPath = process.env.DB_PATH;
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), 'habit-tracker-config-test-'));
  });
  afterEach(() => {
    if (originalPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = originalPath;
    rmSync(scratchDir, { recursive: true, force: true });
  });

  test(':memory: is returned as-is', () => {
    process.env.DB_PATH = ':memory:';
    expect(loadDbConfig()).toEqual({ dbPath: ':memory:' });
  });

  test('a real path creates its parent directory, recursively, if missing', () => {
    const nested = join(scratchDir, 'a', 'b', 'habit-tracker.db');
    process.env.DB_PATH = nested;

    expect(existsSync(join(scratchDir, 'a', 'b'))).toBe(false);
    expect(loadDbConfig()).toEqual({ dbPath: nested });
    expect(existsSync(join(scratchDir, 'a', 'b'))).toBe(true);
  });

  test('defaults to ./data/habit-tracker.db when DB_PATH is unset', () => {
    delete process.env.DB_PATH;
    // The default is a relative path; chdir into the scratch dir first so its mkdirSync resolves
    // there, never anywhere near this repo's own real data/ directory.
    const originalCwd = process.cwd();
    process.chdir(scratchDir);
    try {
      expect(loadDbConfig()).toEqual({ dbPath: './data/habit-tracker.db' });
      expect(existsSync(join(scratchDir, 'data'))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
