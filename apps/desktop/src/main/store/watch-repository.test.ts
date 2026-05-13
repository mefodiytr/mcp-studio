import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Watch } from '../../shared/domain/watches';

import { WatchRepository } from './watch-repository';
import { createWorkspaceStore } from './workspace-store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcpstudio-watches-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const makeRepo = (): WatchRepository => new WatchRepository(createWorkspaceStore(dir));

const w = (over: Partial<Watch> = {}): Watch => ({
  ord: 'station:|slot:/Logic/Sensor1',
  intervalMs: 5000,
  ...over,
});

describe('WatchRepository', () => {
  it('starts empty', () => {
    expect(makeRepo().list('p1')).toEqual([]);
  });

  it('set + list round-trips the per-profile list', () => {
    const repo = makeRepo();
    repo.set('p1', [w({ ord: 'a' }), w({ ord: 'b', intervalMs: 1000 })]);
    expect(repo.list('p1')).toEqual([w({ ord: 'a' }), w({ ord: 'b', intervalMs: 1000 })]);
  });

  it('list returns a copy — mutating it does not mutate the stored list', () => {
    const repo = makeRepo();
    repo.set('p1', [w({ ord: 'a' })]);
    const snapshot = repo.list('p1');
    snapshot.push(w({ ord: 'leaked' }));
    expect(repo.list('p1')).toHaveLength(1);
  });

  it('isolates profiles (set on p1 doesn\'t touch p2)', () => {
    const repo = makeRepo();
    repo.set('p1', [w({ ord: 'a' })]);
    repo.set('p2', [w({ ord: 'b' }), w({ ord: 'c' })]);
    expect(repo.list('p1').map((x) => x.ord)).toEqual(['a']);
    expect(repo.list('p2').map((x) => x.ord)).toEqual(['b', 'c']);
  });

  it('persists across re-open (the JsonStore writes through to disk)', () => {
    {
      const repo = makeRepo();
      repo.set('p1', [w({ ord: 'a', threshold: { low: 0, high: 100 } })]);
    }
    const repo = makeRepo();
    expect(repo.list('p1')).toEqual([w({ ord: 'a', threshold: { low: 0, high: 100 } })]);
  });

  it('set with an empty array drops the profile key (no clutter for profiles never watched)', () => {
    const repo = makeRepo();
    repo.set('p1', [w()]);
    repo.set('p1', []);
    expect(repo.list('p1')).toEqual([]);
  });

  it('clear drops every watch for a profile', () => {
    const repo = makeRepo();
    repo.set('p1', [w({ ord: 'a' })]);
    repo.set('p2', [w({ ord: 'b' })]);
    repo.clear('p1');
    expect(repo.list('p1')).toEqual([]);
    expect(repo.list('p2')).toHaveLength(1);
  });

  it('schema migration v2 → v3 seeds an empty watches map (idempotent)', () => {
    // Write a v2 file by hand and re-open via createWorkspaceStore.
    const repoOld = createWorkspaceStore(dir);
    repoOld.data.profiles = [];
    repoOld.data.toolHistory = [];
    // simulate older-version on-disk by manually rewriting:
    repoOld.data.schemaVersion = 2;
    repoOld.data.watches = undefined as unknown as Record<string, Watch[]>;
    repoOld.save();

    const repo = new WatchRepository(createWorkspaceStore(dir));
    expect(repo.list('any-profile')).toEqual([]);
  });
});
