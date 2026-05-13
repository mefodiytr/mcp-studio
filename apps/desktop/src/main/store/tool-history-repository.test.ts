import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ToolHistoryRepository } from './tool-history-repository';
import { createWorkspaceStore } from './workspace-store';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcpstudio-history-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): ToolHistoryRepository {
  return new ToolHistoryRepository(createWorkspaceStore(dir));
}

const baseEntry = {
  connectionId: 'c1',
  profileId: 'p1',
  serverName: 'niagaramcp',
  toolName: 'setSlot',
  args: { ord: 'station:|slot:/x', slotName: 'enabled', value: true },
  status: 'ok' as const,
  result: null,
  error: null,
  ts: '2026-05-13T00:00:00.000Z',
  durationMs: 12,
};

describe('ToolHistoryRepository', () => {
  it('persists the optional write flag and round-trips it', () => {
    const repo = makeRepo();
    const stored = repo.add({ ...baseEntry, write: true });
    expect(stored.write).toBe(true);
    expect(repo.list()[0]?.write).toBe(true);
  });

  it('leaves the write flag absent when the caller does not pass it (back-compat with pre-audit entries)', () => {
    const repo = makeRepo();
    const stored = repo.add(baseEntry);
    expect(stored.write).toBeUndefined();
    expect('write' in (repo.list()[0] ?? {})).toBe(false);
  });

  it('lists most-recent-first', () => {
    const repo = makeRepo();
    repo.add({ ...baseEntry, toolName: 'first' });
    repo.add({ ...baseEntry, toolName: 'second', write: true });
    const list = repo.list();
    expect(list[0]?.toolName).toBe('second');
    expect(list[1]?.toolName).toBe('first');
  });
});
