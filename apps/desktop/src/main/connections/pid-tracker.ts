import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { JsonStore } from '../store/json-store';

interface PidRecord {
  pid: number;
  profileId: string;
  startedAt: string;
}

interface PidTrackerData {
  schemaVersion: number;
  pids: PidRecord[];
}

const VERSION = 1;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // ESRCH → gone; EPERM → exists but not signalable (still alive).
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Force-kill a process and its descendants. */
export function forceKillTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

/**
 * Records the PIDs of spawned stdio servers in userData/active-pids.json so a
 * crash that bypassed graceful shutdown can be *detected* (and the orphans
 * reported) on the next launch — and so a normal quit can force-kill them. No
 * native code. Job-object-based hard-crash survival is intentionally out of M1
 * scope; see docs/milestone-1.md (revisit ~M3).
 */
export class StdioPidTracker {
  private readonly store: JsonStore<PidTrackerData>;

  constructor(userDataDir: string) {
    this.store = new JsonStore<PidTrackerData>({
      filePath: join(userDataDir, 'active-pids.json'),
      version: VERSION,
      defaults: { schemaVersion: VERSION, pids: [] },
    });
  }

  /** On startup: return (and clear) any still-alive PIDs left by a prior
   *  session. Caller decides what to do (we only log — PID reuse means we
   *  can't safely auto-kill). */
  reapOrphans(): PidRecord[] {
    const orphans = this.store.data.pids.filter((record) => isAlive(record.pid));
    if (this.store.data.pids.length > 0) {
      this.store.data.pids = [];
      this.store.save();
    }
    return orphans;
  }

  add(pid: number, profileId: string): void {
    this.store.data.pids.push({ pid, profileId, startedAt: new Date().toISOString() });
    this.store.save();
  }

  remove(pid: number): void {
    const before = this.store.data.pids.length;
    this.store.data.pids = this.store.data.pids.filter((record) => record.pid !== pid);
    if (this.store.data.pids.length !== before) this.store.save();
  }

  pids(): number[] {
    return this.store.data.pids.map((record) => record.pid);
  }
}
