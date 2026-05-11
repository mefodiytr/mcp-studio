import { randomUUID } from 'node:crypto';

import { profileInputSchema, profileSchema, type Profile, type ProfileInput } from '../../shared/domain/profile';

import type { JsonStore } from './json-store';
import type { WorkspaceData } from './workspace-store';

export class ProfileNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`Profile not found: ${id}`);
    this.name = 'ProfileNotFoundError';
  }
}

/** CRUD over connection profiles, persisted through the workspace store. */
export class ProfileRepository {
  constructor(private readonly store: JsonStore<WorkspaceData>) {}

  list(): Profile[] {
    return [...this.store.data.profiles];
  }

  get(id: string): Profile {
    const profile = this.store.data.profiles.find((p) => p.id === id);
    if (!profile) throw new ProfileNotFoundError(id);
    return profile;
  }

  create(input: ProfileInput): Profile {
    const validated = profileInputSchema.parse(input);
    const now = new Date().toISOString();
    const profile = profileSchema.parse({ ...validated, id: randomUUID(), createdAt: now, updatedAt: now });
    this.store.data.profiles.push(profile);
    this.store.save();
    return profile;
  }

  /** Replace the editable fields of a profile; id and createdAt are preserved. */
  update(id: string, input: ProfileInput): Profile {
    const index = this.store.data.profiles.findIndex((p) => p.id === id);
    if (index === -1) throw new ProfileNotFoundError(id);
    const existing = this.store.data.profiles[index]!;
    const validated = profileInputSchema.parse(input);
    const updated = profileSchema.parse({
      ...validated,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    this.store.data.profiles[index] = updated;
    this.store.save();
    return updated;
  }

  delete(id: string): void {
    const before = this.store.data.profiles.length;
    this.store.data.profiles = this.store.data.profiles.filter((p) => p.id !== id);
    if (this.store.data.profiles.length === before) throw new ProfileNotFoundError(id);
    this.store.save();
  }
}
