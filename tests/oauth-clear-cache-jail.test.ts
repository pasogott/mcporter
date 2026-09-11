import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerDefinition } from '../src/config.js';
import { expandHome } from '../src/env.js';
import { clearOAuthCaches } from '../src/oauth-persistence.js';

const mkDef = (name: string, tokenCacheDir?: string): ServerDefinition => ({
  name,
  description: `${name} server`,
  command: { kind: 'http', url: new URL('https://example.com/mcp') },
  auth: 'oauth',
  tokenCacheDir,
});

describe('clearOAuthCaches tokenCacheDir containment', () => {
  const originalEnv = { ...process.env };
  const tempRoots: string[] = [];
  let homedirSpy!: ReturnType<typeof vi.spyOn>;
  let hasSpy = false;

  afterEach(async () => {
    if (hasSpy) {
      homedirSpy.mockRestore();
      hasSpy = false;
    }
    process.env = { ...originalEnv };
    await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function isolateHome(): Promise<string> {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-oauth-jail-'));
    tempRoots.push(tmp);
    const home = path.join(tmp, 'home');
    await fs.mkdir(home, { recursive: true });
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(home);
    hasSpy = true;
    // The vault honors XDG_* dirs (src/paths.ts), which the os.homedir() spy does
    // not cover — without this, tests read and write the developer's real vault.
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_STATE_HOME;
    delete process.env.XDG_CACHE_HOME;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    return home;
  }

  it('keeps a canary in tokenCacheDir after clearing known credential files', async () => {
    const home = await isolateHome();
    const cacheDir = path.join(home, 'token-cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const canaryPath = path.join(cacheDir, 'IMPORTANT.txt');
    const tokensPath = path.join(cacheDir, 'tokens.json');
    await fs.writeFile(canaryPath, 'do-not-delete');
    await fs.writeFile(tokensPath, JSON.stringify({ access_token: 'cached', token_type: 'Bearer' }));

    await clearOAuthCaches(mkDef('jail-cache', cacheDir), undefined, 'all');

    await expect(fs.readFile(canaryPath, 'utf8')).resolves.toBe('do-not-delete');
    await expect(fs.stat(cacheDir).then((stat) => stat.isDirectory())).resolves.toBe(true);
    await expect(fs.access(tokensPath)).rejects.toThrow();
  });

  it('does not wipe a fake home when tokenCacheDir is the homedir', async () => {
    const home = await isolateHome();
    const canaryPath = path.join(home, 'IMPORTANT.txt');
    const notesPath = path.join(home, 'Documents', 'notes.txt');
    await fs.mkdir(path.dirname(notesPath), { recursive: true });
    await fs.writeFile(canaryPath, 'keep-home');
    await fs.writeFile(notesPath, 'notes');
    await fs.writeFile(
      path.join(home, 'tokens.json'),
      JSON.stringify({ access_token: 'cached', token_type: 'Bearer' })
    );

    await clearOAuthCaches(mkDef('jail-home', home), undefined, 'all');

    await expect(fs.readFile(canaryPath, 'utf8')).resolves.toBe('keep-home');
    await expect(fs.readFile(notesPath, 'utf8')).resolves.toBe('notes');
    await expect(fs.stat(home).then((stat) => stat.isDirectory())).resolves.toBe(true);
    await expect(fs.access(path.join(home, 'tokens.json'))).rejects.toThrow();
  });

  it('does not wipe a fake home when tokenCacheDir is ~', async () => {
    const home = await isolateHome();
    const canaryPath = path.join(home, 'IMPORTANT.txt');
    await fs.writeFile(canaryPath, 'keep-tilde');
    await fs.writeFile(
      path.join(home, 'tokens.json'),
      JSON.stringify({ access_token: 'cached', token_type: 'Bearer' })
    );

    // Config import / normalizePath only expands ~; callers then pass the home path.
    const tokenCacheDir = expandHome('~', home);
    expect(tokenCacheDir).toBe(home);

    await clearOAuthCaches(mkDef('jail-tilde', tokenCacheDir), undefined, 'all');

    await expect(fs.readFile(canaryPath, 'utf8')).resolves.toBe('keep-tilde');
    await expect(fs.stat(home).then((stat) => stat.isDirectory())).resolves.toBe(true);
    await expect(fs.access(path.join(home, 'tokens.json'))).rejects.toThrow();
  });
});
