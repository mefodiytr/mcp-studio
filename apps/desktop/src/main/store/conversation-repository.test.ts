import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Conversation, Message } from '../../shared/domain/conversations';
import { MAX_MESSAGES_PER_CONVERSATION } from '../../shared/domain/conversations';

import { ConversationRepository } from './conversation-repository';
import { createWorkspaceStore } from './workspace-store';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-studio-conv-'));
});

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

function mkMessage(role: 'user' | 'assistant', text: string, ts: number): Message {
  return {
    id: `m_${ts}`,
    role,
    content: [{ type: 'text', text }],
    ts,
  };
}

function mkConversation(id: string, ts: number, messages: Message[] = []): Conversation {
  return {
    id,
    title: `conv ${id}`,
    createdAt: ts,
    updatedAt: ts,
    messages,
  };
}

describe('ConversationRepository', () => {
  it('lists empty for an unknown profile', () => {
    const store = createWorkspaceStore(dir);
    const repo = new ConversationRepository(store);
    expect(repo.list('p1')).toEqual([]);
  });

  it('save + get round-trips one conversation', () => {
    const store = createWorkspaceStore(dir);
    const repo = new ConversationRepository(store);
    const c = mkConversation('c1', 1000);
    repo.save('p1', c);
    expect(repo.get('p1', 'c1')).toEqual(c);
  });

  it('lists newest-first by updatedAt', () => {
    const store = createWorkspaceStore(dir);
    const repo = new ConversationRepository(store);
    repo.save('p1', { ...mkConversation('a', 1000), updatedAt: 1000 });
    repo.save('p1', { ...mkConversation('b', 2000), updatedAt: 2000 });
    repo.save('p1', { ...mkConversation('c', 1500), updatedAt: 1500 });
    expect(repo.list('p1').map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('save replaces an existing conversation with the same id', () => {
    const store = createWorkspaceStore(dir);
    const repo = new ConversationRepository(store);
    repo.save('p1', mkConversation('c1', 1000));
    const updated: Conversation = {
      ...mkConversation('c1', 1000),
      title: 'updated',
      updatedAt: 2000,
    };
    repo.save('p1', updated);
    expect(repo.list('p1')).toHaveLength(1);
    expect(repo.get('p1', 'c1')?.title).toBe('updated');
  });

  it('delete drops the conversation; clear drops all for a profile', () => {
    const store = createWorkspaceStore(dir);
    const repo = new ConversationRepository(store);
    repo.save('p1', mkConversation('a', 1000));
    repo.save('p1', mkConversation('b', 2000));
    repo.delete('p1', 'a');
    expect(repo.list('p1').map((c) => c.id)).toEqual(['b']);
    repo.clear('p1');
    expect(repo.list('p1')).toEqual([]);
  });

  it('append adds a message and bumps updatedAt', () => {
    const store = createWorkspaceStore(dir);
    const repo = new ConversationRepository(store);
    repo.save('p1', mkConversation('c1', 1000));
    const result = repo.append('p1', 'c1', mkMessage('user', 'hi', 2000));
    expect(result?.messages).toHaveLength(1);
    expect(result?.updatedAt).toBe(2000);
  });

  it('append returns null for an unknown conversation', () => {
    const store = createWorkspaceStore(dir);
    const repo = new ConversationRepository(store);
    expect(repo.append('p1', 'nope', mkMessage('user', 'x', 1000))).toBeNull();
  });

  it('append head-trims to MAX_MESSAGES_PER_CONVERSATION', () => {
    const store = createWorkspaceStore(dir);
    const repo = new ConversationRepository(store);
    const initial = Array.from({ length: MAX_MESSAGES_PER_CONVERSATION }, (_, i) =>
      mkMessage('user', `m${i}`, 1000 + i),
    );
    repo.save('p1', mkConversation('c1', 1000, initial));
    const updated = repo.append(
      'p1',
      'c1',
      mkMessage('user', 'newest', 1000 + MAX_MESSAGES_PER_CONVERSATION),
    );
    expect(updated?.messages).toHaveLength(MAX_MESSAGES_PER_CONVERSATION);
    expect(updated?.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'newest' }]);
    // Oldest was trimmed.
    expect(updated?.messages.at(0)?.content).toEqual([{ type: 'text', text: 'm1' }]);
  });

  it('survives a workspace-store reopen (persistence)', () => {
    const store1 = createWorkspaceStore(dir);
    new ConversationRepository(store1).save('p1', mkConversation('c1', 1000));
    const store2 = createWorkspaceStore(dir);
    const repo2 = new ConversationRepository(store2);
    expect(repo2.get('p1', 'c1')).toMatchObject({ id: 'c1', title: 'conv c1' });
  });

  it("persists 'summary' marker messages — Zod round-trip + reopen (promt19 edge case #5)", () => {
    // Verify the M6 C86 collapsible-summary marker survives the
    // workspace's JsonStore round-trip (write → read → validate). The
    // marker enum was widened in C83b to include 'summary'; this test
    // pins that the additive schema change works end-to-end.
    const summaryMessage: Message = {
      id: 'm_summary_1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Earlier: investigated AHU-1; no alarms.' }],
      marker: 'summary',
      usage: { inputTokens: 1200, outputTokens: 180 },
      ts: 1500,
    };
    const store1 = createWorkspaceStore(dir);
    const repo1 = new ConversationRepository(store1);
    repo1.save('p1', mkConversation('c1', 1500, [summaryMessage]));

    const store2 = createWorkspaceStore(dir);
    const repo2 = new ConversationRepository(store2);
    const reloaded = repo2.get('p1', 'c1');
    expect(reloaded?.messages).toHaveLength(1);
    expect(reloaded?.messages[0]).toMatchObject({
      marker: 'summary',
      content: [{ type: 'text', text: 'Earlier: investigated AHU-1; no alarms.' }],
      usage: { inputTokens: 1200, outputTokens: 180 },
    });
  });

  it('migrates an older v3 workspace file to v4 idempotently (re-run is a no-op)', () => {
    // Simulate an existing v3 file by writing a workspace with the v3 shape.
    // The migrator should add `conversations` + `llm` without losing v3 fields.
    const v3File = join(dir, 'workspace.json');
    writeFileSync(
      v3File,
      JSON.stringify({
        schemaVersion: 3,
        profiles: [{ id: 'p1', label: 'X' }],
        toolHistory: [],
        watches: { p1: [] },
      }),
      'utf8',
    );
    const store = createWorkspaceStore(dir);
    expect(store.data.schemaVersion).toBe(4);
    expect(store.data.conversations).toEqual({});
    expect(store.data.llm).toEqual({ provider: 'anthropic' });
    expect(store.data.profiles).toHaveLength(1);
    expect(store.data.watches.p1).toEqual([]);

    // Re-running the migrator (by re-opening the store) is a no-op.
    const store2 = createWorkspaceStore(dir);
    expect(store2.data.schemaVersion).toBe(4);
    expect(store2.data.conversations).toEqual({});
    expect(store2.data.profiles).toHaveLength(1);
  });
});
