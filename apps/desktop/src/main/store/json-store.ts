import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface Versioned {
  schemaVersion: number;
}

export interface JsonStoreOptions<T extends Versioned> {
  /** Absolute path to the JSON file backing this store. */
  filePath: string;
  /** The on-disk schema version this build expects. */
  version: number;
  /** Data used when the file is absent or unreadable. Must already be at `version`. */
  defaults: T;
  /** Called once when the loaded file's `schemaVersion` is below `version`;
   *  returns data migrated to `version` (its `schemaVersion` is overwritten). */
  migrate?: (data: unknown, fromVersion: number) => T;
}

/**
 * A tiny, dependency-free JSON-file store for the main process: load on
 * construction, hold in memory, write atomically (`*.tmp` → rename) on `save()`.
 * One file per store, under the app's userData directory.
 *
 * Chosen over electron-store to avoid the ESM/CJS-in-Electron-main friction and
 * keep full control. // TODO(M4): replace the JSON files with better-sqlite3
 * once tool-call history and the audit log need a queryable backend.
 */
export class JsonStore<T extends Versioned> {
  private current: T;

  constructor(private readonly options: JsonStoreOptions<T>) {
    const { data, migrated } = this.load();
    this.current = data;
    if (migrated) this.save();
  }

  /** The live in-memory document. Callers mutate it, then call `save()`. */
  get data(): T {
    return this.current;
  }

  save(): void {
    mkdirSync(dirname(this.options.filePath), { recursive: true });
    const tmp = `${this.options.filePath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.current, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.options.filePath);
  }

  private load(): { data: T; migrated: boolean } {
    const { filePath, version, defaults, migrate } = this.options;
    const fresh = (): { data: T; migrated: boolean } => ({
      data: { ...defaults, schemaVersion: version },
      migrated: false,
    });

    if (!existsSync(filePath)) return fresh();

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      return fresh();
    }

    const loadedVersion =
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Versioned).schemaVersion === 'number'
        ? (parsed as Versioned).schemaVersion
        : 0;

    if (loadedVersion === version) return { data: parsed as T, migrated: false };

    if (loadedVersion < version && migrate) {
      return { data: { ...migrate(parsed, loadedVersion), schemaVersion: version }, migrated: true };
    }

    // No migration path (a file from a future build, or a missing migrate fn) —
    // fall back to defaults rather than risk corrupting data.
    return fresh();
  }
}
