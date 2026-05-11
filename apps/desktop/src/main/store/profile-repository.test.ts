import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProfileNotFoundError, ProfileRepository } from './profile-repository';
import { createWorkspaceStore } from './workspace-store';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcpstudio-profiles-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): ProfileRepository {
  return new ProfileRepository(createWorkspaceStore(dir));
}

describe('ProfileRepository', () => {
  it('creates, lists, gets, updates and deletes profiles', () => {
    const repo = makeRepo();
    expect(repo.list()).toEqual([]);

    const created = repo.create({
      transport: 'http',
      url: 'https://example.test/mcp',
      name: 'Example',
      auth: { method: 'bearer' },
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBe(created.updatedAt);
    expect(repo.list()).toHaveLength(1);
    expect(repo.get(created.id).name).toBe('Example');

    const updated = repo.update(created.id, {
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      name: 'Example (stdio)',
      auth: { method: 'none' },
    });
    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.transport).toBe('stdio');
    if (updated.transport === 'stdio') expect(updated.args).toEqual(['server.js']);

    repo.delete(created.id);
    expect(repo.list()).toEqual([]);
    expect(() => repo.get(created.id)).toThrow(ProfileNotFoundError);
    expect(() =>
      repo.update(created.id, { transport: 'http', url: 'https://x.test', name: 'x', auth: { method: 'none' } }),
    ).toThrow(ProfileNotFoundError);
    expect(() => repo.delete(created.id)).toThrow(ProfileNotFoundError);
  });

  it('persists profiles across store instances (survives restart)', () => {
    const first = makeRepo();
    const a = first.create({ transport: 'http', url: 'https://a.test/mcp', name: 'A', auth: { method: 'none' } });
    first.create({ transport: 'http', url: 'https://b.test/mcp', name: 'B', auth: { method: 'bearer' } });

    const second = makeRepo(); // fresh store reading the same file on disk
    expect(
      second
        .list()
        .map((p) => p.name)
        .sort(),
    ).toEqual(['A', 'B']);
    expect(second.get(a.id).name).toBe('A');
  });

  it('rejects invalid input', () => {
    const repo = makeRepo();
    expect(() =>
      repo.create({ transport: 'http', url: 'not-a-url', name: 'X', auth: { method: 'none' } }),
    ).toThrow();
    expect(() =>
      repo.create({ transport: 'http', url: 'https://x.test', name: '', auth: { method: 'none' } }),
    ).toThrow();
    expect(() =>
      repo.create({ transport: 'http', url: 'https://x.test', name: 'X', auth: { method: 'header', headerName: '' } }),
    ).toThrow();
  });
});
