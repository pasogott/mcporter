import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDoctorCommand } from '../src/cli/config/doctor.js';
import type { LoadConfigOptions } from '../src/config.js';
import * as configModule from '../src/config.js';

let tempDir: string;
let loadOptions: LoadConfigOptions;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcporter-doctor-'));
  loadOptions = { rootDir: tempDir };
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('config doctor', () => {
  it.each(['flag', 'environment'])('reports the selected %s config path', async (source) => {
    const configPath = path.join(tempDir, 'custom.json');
    await fs.writeFile(configPath, '{"mcpServers":{},"imports":[]}');
    if (source === 'flag') {
      loadOptions = { ...loadOptions, configPath };
      vi.stubEnv('MCPORTER_CONFIG', path.join(tempDir, 'overridden.json'));
    } else {
      vi.stubEnv('MCPORTER_CONFIG', configPath);
    }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleDoctorCommand({ loadOptions } as never, []);
    const lines = logSpy.mock.calls.flat().join('\n');
    expect(lines).toContain(`Selected config: ${configPath}`);
    expect(lines).not.toContain(`Selected config: ${configPath} (missing)`);
    expect(lines).toContain('Config looks good.');
  });

  it('reports issues for stdio cwd and missing oauth token cache', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(configModule, 'loadServerDefinitions').mockResolvedValue([
      {
        name: 'bad-stdio',
        command: { kind: 'stdio', command: 'node', args: [], cwd: 'relative/path' },
      },
      {
        name: 'oauth-missing-cache',
        command: { kind: 'http', url: new URL('https://example.com/mcp'), headers: {} },
        auth: 'oauth',
        tokenCacheDir: undefined,
      },
    ]);

    await handleDoctorCommand({ loadOptions } as never, []);

    const output = logSpy.mock.calls.flat().join('\n');
    logSpy.mockRestore();

    expect(output).toContain('has a non-absolute working directory');
  });
});
