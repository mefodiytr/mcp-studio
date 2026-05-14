import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, RotateCcw, Send, StopCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { runReAct, type LlmMessage, type LlmTool, type RunnerEvent } from '@mcp-studio/llm-provider';
import { enqueueAiWrite } from '@mcp-studio/niagara';

import type { Conversation, ContentBlock, Message } from '../../../../shared/domain/conversations';

import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { useConnections } from '@renderer/lib/connections';
import { createProvider, pickActiveProviderMode } from '@renderer/lib/llm-provider-factory';
import { buildPluginContext } from '@renderer/lib/plugin-context';
import { callTool, useTools } from '@renderer/lib/tools';
import {
  assemblePluginContributions,
  HOST_BASE_SYSTEM_PROMPT,
  substituteFlowPrompt,
  type TaggedDiagnosticFlow,
} from '@renderer/lib/plugin-prompts';
import { cn } from '@renderer/lib/utils';
import { pickPlugin } from '@renderer/plugins/registry';
import {
  selectConversations,
  useConversationsStore,
} from '@renderer/stores/conversations';
import { useDiagnosticFlowLauncher } from '@renderer/stores/diagnostic-flow-launcher';

import { ConversationList } from './ConversationList';
import { MessageView, type InlineToolResult } from './MessageView';
import { UsageBadge } from './UsageBadge';

function bridge(): NonNullable<typeof window.studio> {
  if (!window.studio) throw new Error('IPC bridge unavailable');
  return window.studio;
}

/**
 * The M5 chat foundation. Per-connection scope (the active connection picks
 * the profileId that owns the conversation list); within a connection, the
 * user can hold N conversations switchable on the left side.
 *
 * What this commit (C71) does:
 *   - Renders the conversation list + the active conversation's messages.
 *   - Accepts a user message + runs the ReAct loop against the
 *     mock-or-anthropic provider chosen by `MCPSTUDIO_LLM_PROVIDER`.
 *   - Streams text deltas + tool-call envelopes into the in-progress
 *     assistant message; persists the final message via `conversations:append`.
 *   - Read-only tools today (no write tools wired into the LLM's available
 *     function set — the C75 safety boundary lands before write-tool wiring).
 *   - Stop button cancels via AbortController.
 *   - Empty-state with the API-key prompt for first-run.
 */
export function ChatView() {
  const { t } = useTranslation();
  const connections = useConnections();
  const connected = connections.filter((c) => c.status === 'connected');
  const active = connected[0];
  const profileId = active?.profileId ?? null;

  const conversations = useConversationsStore(selectConversations(profileId ?? undefined));
  const ensureLoaded = useConversationsStore((s) => s.ensureLoaded);
  const upsert = useConversationsStore((s) => s.upsert);
  const remove = useConversationsStore((s) => s.remove);
  const appendMessage = useConversationsStore((s) => s.appendMessage);
  const patchInflight = useConversationsStore((s) => s.patchInflight);

  // C75: the active connection's tool catalog, mapped to the LlmTool shape
  // the ReAct loop hands the provider. The safety boundary at main intercepts
  // AI-attributed write calls — every tool surfaces to the LLM regardless of
  // its annotation, and main decides at dispatch time whether to execute or
  // route to the pending-changes queue.
  const toolsQuery = useTools(active?.connectionId);
  const llmTools = useMemo<LlmTool[]>(() => {
    const list = toolsQuery.data ?? [];
    return list.map((t) => ({
      name: t.name,
      description: t.description ?? t.title ?? '',
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
    }));
  }, [toolsQuery.data]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  // Assembled plugin contributions for the active connection (system prompt,
  // starter questions, diagnostic flows). Stable for the connection — no
  // re-assembly on every keystroke. C73 ships the pipeline; C74 lands the
  // Niagara plugin's contributions.
  const contributions = useMemo(() => {
    if (!active) {
      return {
        systemPrompt: HOST_BASE_SYSTEM_PROMPT,
        starterQuestions: [] as string[],
        diagnosticFlows: [] as TaggedDiagnosticFlow[],
      };
    }
    const plugin = pickPlugin(active.serverInfo);
    if (!plugin) {
      return {
        systemPrompt: HOST_BASE_SYSTEM_PROMPT,
        starterQuestions: [] as string[],
        diagnosticFlows: [] as TaggedDiagnosticFlow[],
      };
    }
    const ctx = buildPluginContext(active);
    return assemblePluginContributions([plugin], ctx);
  }, [active]);

  // API-key gate
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [providerMode, setProviderMode] = useState<'mock' | 'anthropic' | null>(null);

  // Diagnostic-flow launcher (filled by clicking a flow chip from the empty
  // state or a palette command).
  const [flowLauncher, setFlowLauncher] = useState<{
    flow: TaggedDiagnosticFlow;
    paramValues: Record<string, string>;
  } | null>(null);

  // Streaming state
  const [streamingText, setStreamingText] = useState('');
  const [streamingToolCalls, setStreamingToolCalls] = useState<
    { id: string; name: string; input?: Record<string, unknown> }[]
  >([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [userInput, setUserInput] = useState('');

  // Hydrate
  useEffect(() => {
    if (profileId) void ensureLoaded(profileId);
  }, [profileId, ensureLoaded]);
  useEffect(() => {
    void pickActiveProviderMode().then(setProviderMode);
  }, []);
  useEffect(() => {
    const refresh = async () => {
      const { hasKey } = await bridge().invoke('llm:hasKey', { provider: 'anthropic' });
      setHasKey(hasKey);
    };
    void refresh();
  }, []);

  // Pick the first conversation by default (or create one on first send).
  useEffect(() => {
    if (activeId === null && conversations.length > 0) {
      const first = conversations[0];
      if (first) setActiveId(first.id);
    }
  }, [activeId, conversations]);

  const handleNew = useCallback(() => {
    setActiveId(null);
    setUserInput('');
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (!profileId) return;
      await remove(profileId, id);
      if (activeId === id) setActiveId(null);
    },
    [profileId, remove, activeId],
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleSend = useCallback(async (override?: string) => {
    const text = (override ?? userInput).trim();
    if (!text || !profileId || running) return;
    if (providerMode === 'anthropic' && hasKey === false) return;
    setRunning(true);
    if (!override) setUserInput('');

    let conversationId = activeId;
    // New conversation? Create it now.
    if (!conversationId) {
      const now = Date.now();
      const fresh: Conversation = {
        id: `conv_${now}_${Math.random().toString(36).slice(2, 8)}`,
        title: text.slice(0, 40),
        createdAt: now,
        updatedAt: now,
        messages: [],
      };
      await upsert(profileId, fresh);
      conversationId = fresh.id;
      setActiveId(fresh.id);
    }

    // Persist the user message.
    const userMessage: Message = {
      id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'user',
      content: [{ type: 'text', text }],
      ts: Date.now(),
    };
    await appendMessage(profileId, conversationId, userMessage);

    // Build the provider + run the ReAct loop. C75 wires the tool catalog +
    // dispatches through the caller-attributed `connections:call` IPC — main
    // intercepts AI-attributed effective-write calls at the safety boundary
    // and returns `pendingEnqueued` instead of dispatching to the SDK; the
    // chat view routes those into the active plugin's pending-changes queue.
    const controller = new AbortController();
    abortRef.current = controller;
    setStreamingText('');
    setStreamingToolCalls([]);

    const connectionIdForDispatch = active?.connectionId;

    try {
      const mode = providerMode ?? 'anthropic';
      const provider = await createProvider(mode);
      const history: LlmMessage[] = mapHistoryForProvider(activeConversation?.messages ?? []).concat({
        role: 'user',
        content: [{ type: 'text', text }],
      });
      const gen = runReAct({
        provider,
        system: contributions.systemPrompt,
        history,
        tools: llmTools,
        dispatchTool: async (name, args) => {
          if (!connectionIdForDispatch) {
            return 'error: no active connection';
          }
          const outcome = await callTool(connectionIdForDispatch, name, args, {
            caller: { type: 'ai', conversationId: conversationId },
          });
          if (outcome.pendingEnqueued) {
            // The M5 C75 safety boundary intercepted an AI-attributed write.
            // Route the op into the active plugin's pending queue + tell the
            // LLM we've queued it for operator approval.
            const result = enqueueAiWrite(
              connectionIdForDispatch,
              { name: outcome.pendingEnqueued.toolName, args: outcome.pendingEnqueued.args },
              { type: 'ai', conversationId },
            );
            if (result === 'enqueued') {
              return `queued for operator approval — the Changes view now shows this proposed write with an "AI" badge. The operator will review and apply or reject it; do not assume the change has happened. Continue with read-only steps if appropriate; otherwise summarise what you proposed and wait.`;
            }
            if (result === 'unrenderable') {
              return `error: this server's write tools are not yet supported by an MCP Studio plugin pending-queue. Do not propose this kind of write — describe what you would do in prose instead.`;
            }
            return 'error: no active connection to enqueue the write to';
          }
          if (outcome.error) {
            return `error: ${outcome.error.message}`;
          }
          // Normal read-tool result. Stringify the content for the LLM —
          // the runner concatenates whatever we return into the tool_result
          // block. We pass through the full result JSON; the LLM is good at
          // parsing nested structures.
          return outcome.result ?? '';
        },
        signal: controller.signal,
      });

      const assistantContent: ContentBlock[] = [];
      let textBuf = '';
      // C78 — capture the last `message-stop` usage so the persisted
      // assistant message carries the token count + the UsageBadge totals
      // it across the conversation.
      let lastTurnUsage: { inputTokens: number; outputTokens: number } | undefined;
      let result = await gen.next();
      while (!result.done) {
        const ev = result.value as RunnerEvent;
        if (ev.type === 'text-delta') {
          textBuf += ev.text;
          setStreamingText(textBuf);
        } else if (ev.type === 'text-stop') {
          assistantContent.push({ type: 'text', text: ev.text });
          textBuf = '';
          setStreamingText('');
        } else if (ev.type === 'tool-use-start') {
          setStreamingToolCalls((s) => [...s, { id: ev.toolUseId, name: ev.name }]);
        } else if (ev.type === 'tool-use-complete') {
          assistantContent.push({
            type: 'tool_use',
            id: ev.toolUseId,
            name: ev.name,
            input: ev.input,
          });
        } else if (ev.type === 'message-stop') {
          lastTurnUsage = ev.usage;
        } else if (ev.type === 'aborted') {
          await appendMessage(profileId, conversationId, {
            id: `m_${Date.now()}`,
            role: 'assistant',
            content: assistantContent,
            marker: 'aborted',
            ts: Date.now(),
            ...(lastTurnUsage ? { usage: lastTurnUsage } : {}),
          });
          break;
        } else if (ev.type === 'max-turns-reached') {
          await appendMessage(profileId, conversationId, {
            id: `m_${Date.now()}`,
            role: 'assistant',
            content: assistantContent,
            marker: 'max-turns-reached',
            ts: Date.now(),
            ...(lastTurnUsage ? { usage: lastTurnUsage } : {}),
          });
          break;
        } else if (ev.type === 'turn-stop') {
          // Persist this turn's assistant message; clear local buffers. The
          // cumulative `message-stop` usage carried on this turn lands on the
          // persisted message (C78 — feeds the UsageBadge).
          if (assistantContent.length > 0) {
            await appendMessage(profileId, conversationId, {
              id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              role: 'assistant',
              content: [...assistantContent],
              ts: Date.now(),
              ...(lastTurnUsage ? { usage: lastTurnUsage } : {}),
            });
            assistantContent.length = 0;
            lastTurnUsage = undefined;
          }
        }
        result = await gen.next();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await appendMessage(profileId, conversationId, {
        id: `m_${Date.now()}`,
        role: 'assistant',
        content: [{ type: 'text', text: `Error: ${msg}` }],
        marker: 'error',
        ts: Date.now(),
      });
    } finally {
      abortRef.current = null;
      setRunning(false);
      setStreamingText('');
      setStreamingToolCalls([]);
      // Avoid lint on patchInflight (held for future incremental updates):
      void patchInflight;
    }
  }, [
    userInput,
    profileId,
    running,
    providerMode,
    hasKey,
    activeId,
    activeConversation,
    contributions.systemPrompt,
    llmTools,
    active?.connectionId,
    upsert,
    appendMessage,
    patchInflight,
  ]);

  // Run a diagnostic flow (or a starter chip): substitute params, fire send.
  const handleRunFlow = useCallback(
    async (flow: TaggedDiagnosticFlow, params: Record<string, string> = {}) => {
      const prompt = substituteFlowPrompt(flow.prompt, params);
      setFlowLauncher(null);
      await handleSend(prompt);
    },
    [handleSend],
  );

  // C79 — Regenerate: truncate the conversation back to before the last user
  // message that had a text body, then re-send that text. The runner persists
  // the user message + the new assistant turn fresh; the regenerated chain
  // replaces the old one in the conversation log.
  const handleRegenerate = useCallback(async () => {
    if (!activeConversation || !profileId || running) return;
    const messages = activeConversation.messages;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m && m.role === 'user' && m.content.some((b) => b.type === 'text')) {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;
    const lastUserMsg = messages[lastUserIdx];
    if (!lastUserMsg) return;
    const lastUserText = lastUserMsg.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!lastUserText.trim()) return;
    await upsert(profileId, {
      ...activeConversation,
      messages: messages.slice(0, lastUserIdx),
      updatedAt: Date.now(),
    });
    await handleSend(lastUserText);
  }, [activeConversation, profileId, running, upsert, handleSend]);

  const handleLaunchFlow = useCallback((flow: TaggedDiagnosticFlow) => {
    if (!flow.params || flow.params.length === 0) {
      void handleRunFlow(flow, {});
      return;
    }
    const initial: Record<string, string> = {};
    for (const p of flow.params) initial[p.name] = '';
    setFlowLauncher({ flow, paramValues: initial });
  }, [handleRunFlow]);

  // C79 — keyboard shortcuts. Mounted at the chat-view component level so
  // they're only active while the chat rail is open (unmount on view-switch
  // removes them). Standard chat-app patterns:
  //   Ctrl+Enter   send (from any focus inside the chat)
  //   Esc          stop generation
  //   Ctrl+Shift+N start a new conversation
  //   Ctrl+/       focus the chat input from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'Enter') {
        e.preventDefault();
        void handleSend(undefined);
        return;
      }
      if (e.key === 'Escape' && running) {
        e.preventDefault();
        abortRef.current?.abort();
        return;
      }
      if (ctrl && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
        e.preventDefault();
        setActiveId(null);
        setUserInput('');
        // Focus input next tick — after the empty-state re-render mounts it.
        setTimeout(() => inputRef.current?.focus(), 0);
        return;
      }
      if (ctrl && e.key === '/') {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSend, running]);

  // Consume palette-enqueued flow launches (the cross-cut between
  // useAppCommands' "Run diagnostic flow: …" command + the chat view's
  // launcher dialog).
  const pendingFlow = useDiagnosticFlowLauncher((s) => s.pending);
  const consumePendingFlow = useDiagnosticFlowLauncher((s) => s.consume);
  useEffect(() => {
    if (!pendingFlow) return;
    const flow = consumePendingFlow();
    if (flow) handleLaunchFlow(flow);
  }, [pendingFlow, consumePendingFlow, handleLaunchFlow]);

  if (!profileId) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-md text-sm text-muted-foreground">
          <Bot className="mx-auto mb-4 size-12 text-muted-foreground/40" />
          <p>{t('chat.noConnection')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={handleNew}
        onDelete={handleDelete}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-start justify-between gap-3 border-b p-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-medium">{activeConversation?.title ?? t('chat.newConversation')}</h1>
            <p className="text-xs text-muted-foreground">
              {t('chat.scope', { server: active?.serverInfo?.name ?? active?.profileId ?? '' })}
              {providerMode === 'mock' && (
                <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                  {t('chat.mockBadge')}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeConversation && activeConversation.messages.some((m) => m.role === 'assistant') && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void handleRegenerate()}
                disabled={running}
                title={t('chat.regenerate')}
                aria-label={t('chat.regenerate')}
              >
                <RotateCcw className="size-3.5" />
                <span className="ml-1 text-xs">{t('chat.regenerate')}</span>
              </Button>
            )}
            {activeConversation && <UsageBadge conversation={activeConversation} />}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {!activeConversation || activeConversation.messages.length === 0 ? (
            <EmptyState
              providerMode={providerMode}
              hasKey={hasKey}
              onKeySaved={() => setHasKey(true)}
              starterQuestions={contributions.starterQuestions}
              diagnosticFlows={contributions.diagnosticFlows}
              onPickStarter={(text) => void handleSend(text)}
              onLaunchFlow={handleLaunchFlow}
            />
          ) : (
            activeConversation.messages.map((m, i) => {
              const next = activeConversation.messages[i + 1];
              const toolResults: InlineToolResult[] | undefined =
                next && next.role === 'user'
                  ? next.content.flatMap((b) =>
                      b.type === 'tool_result'
                        ? [{ tool_use_id: b.tool_use_id, content: b.content, isError: b.isError }]
                        : [],
                    )
                  : undefined;
              return <MessageView key={m.id} message={m} toolResults={toolResults} />;
            })
          )}
          {/* In-flight streaming view (between turn-start and turn-stop) */}
          {(streamingText || streamingToolCalls.length > 0) && (
            <div className="my-3 space-y-2 text-sm">
              {streamingText && (
                <div className="whitespace-pre-wrap">
                  {streamingText}
                  <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-foreground/60" aria-hidden />
                </div>
              )}
              {streamingToolCalls.map((tc) => (
                <div
                  key={tc.id}
                  className="my-1 rounded-md border bg-card p-2 font-mono text-xs text-muted-foreground"
                >
                  Calling <span className="font-semibold">{tc.name}</span>…
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="border-t p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend(undefined);
            }}
            className="flex items-center gap-2"
          >
            <Input
              ref={inputRef}
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder={t('chat.inputPlaceholder')}
              disabled={running}
              className="flex-1"
              autoFocus
            />
            {running ? (
              <Button type="button" variant="destructive" onClick={handleStop}>
                <StopCircle className="size-4" />
                <span className="ml-1">{t('chat.stop')}</span>
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!userInput.trim() || (providerMode === 'anthropic' && hasKey === false)}
              >
                <Send className="size-4" />
                <span className="ml-1">{t('chat.send')}</span>
              </Button>
            )}
          </form>
        </footer>
      </div>
      <FlowLauncherDialog
        launcher={flowLauncher}
        onClose={() => setFlowLauncher(null)}
        onSubmit={(flow, values) => void handleRunFlow(flow, values)}
        onChange={(values) =>
          setFlowLauncher((prev) => (prev ? { ...prev, paramValues: values } : prev))
        }
      />
    </div>
  );
}

function FlowLauncherDialog({
  launcher,
  onClose,
  onSubmit,
  onChange,
}: {
  launcher: { flow: TaggedDiagnosticFlow; paramValues: Record<string, string> } | null;
  onClose: () => void;
  onSubmit: (flow: TaggedDiagnosticFlow, values: Record<string, string>) => void;
  onChange: (values: Record<string, string>) => void;
}) {
  const { t } = useTranslation();
  if (!launcher) return null;
  const { flow, paramValues } = launcher;
  const params = flow.params ?? [];
  const canSubmit = params.every((p) => (paramValues[p.name] ?? '').trim().length > 0);
  return (
    <Dialog open={!!launcher} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{flow.title}</DialogTitle>
          <DialogDescription>{flow.description}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onSubmit(flow, paramValues);
          }}
        >
          {params.map((p) => (
            <div key={p.name}>
              <label
                htmlFor={`flow-${flow.id}-${p.name}`}
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {p.label}
              </label>
              <Input
                id={`flow-${flow.id}-${p.name}`}
                value={paramValues[p.name] ?? ''}
                onChange={(e) => onChange({ ...paramValues, [p.name]: e.target.value })}
                placeholder={p.placeholder}
                autoFocus
              />
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('chat.flowCancel')}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {t('chat.flowRun')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  providerMode,
  hasKey,
  onKeySaved,
  starterQuestions,
  diagnosticFlows,
  onPickStarter,
  onLaunchFlow,
}: {
  providerMode: 'mock' | 'anthropic' | null;
  hasKey: boolean | null;
  onKeySaved: () => void;
  starterQuestions: string[];
  diagnosticFlows: TaggedDiagnosticFlow[];
  onPickStarter: (text: string) => void;
  onLaunchFlow: (flow: TaggedDiagnosticFlow) => void;
}) {
  const { t } = useTranslation();
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const needsKey = providerMode === 'anthropic' && hasKey === false;

  return (
    <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
      <Bot className="mx-auto size-12 text-muted-foreground/40" />
      <h2 className="text-base font-medium">{t('chat.welcomeTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('chat.welcomeBody')}</p>
      {needsKey && (
        <div className="mx-auto max-w-sm rounded-md border bg-muted/30 p-3 text-left">
          <label htmlFor="anthropic-key" className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('chat.apiKeyLabel')}
          </label>
          <div className="flex gap-2">
            <Input
              id="anthropic-key"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
            />
            <Button
              type="button"
              disabled={!keyInput.trim() || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await bridge().invoke('llm:setKey', { provider: 'anthropic', key: keyInput.trim() });
                  setKeyInput('');
                  onKeySaved();
                } finally {
                  setSaving(false);
                }
              }}
            >
              {t('chat.apiKeySave')}
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{t('chat.apiKeyHelp')}</p>
        </div>
      )}
      {!needsKey && diagnosticFlows.length > 0 && (
        <div className="space-y-2 text-left">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('chat.diagnosticFlowsHeading')}
          </h3>
          <div className="flex flex-wrap justify-start gap-2">
            {diagnosticFlows.map((flow) => (
              <Button
                key={flow.id}
                variant="outline"
                size="sm"
                onClick={() => onLaunchFlow(flow)}
                title={flow.description}
              >
                {flow.title}
              </Button>
            ))}
          </div>
        </div>
      )}
      {!needsKey && starterQuestions.length > 0 && (
        <div className="space-y-2 text-left">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t('chat.starterQuestionsHeading')}
          </h3>
          <div className="flex flex-wrap justify-start gap-2">
            {starterQuestions.map((q, i) => (
              <Button
                key={i}
                variant="ghost"
                size="sm"
                className="h-auto whitespace-normal border border-border bg-muted/30 px-3 py-2 text-left text-sm font-normal"
                onClick={() => onPickStarter(q)}
              >
                {q}
              </Button>
            ))}
          </div>
        </div>
      )}
      {!needsKey && (
        <p className={cn('text-xs', providerMode === 'mock' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
          {providerMode === 'mock' ? t('chat.mockHint') : t('chat.startHint')}
        </p>
      )}
    </div>
  );
}

/** Re-shape the persisted Message[] into the LlmMessage[] the runner expects. */
function mapHistoryForProvider(messages: Message[]): LlmMessage[] {
  return messages
    .filter((m) => m.marker !== 'aborted' && m.marker !== 'error' && m.marker !== 'max-turns-reached')
    .map((m) => ({
      role: m.role,
      content: m.content.map((b) => {
        if (b.type === 'text') return { type: 'text' as const, text: b.text };
        if (b.type === 'tool_use')
          return { type: 'tool_use' as const, id: b.id, name: b.name, input: b.input };
        return {
          type: 'tool_result' as const,
          tool_use_id: b.tool_use_id,
          content: typeof b.content === 'string' ? b.content : JSON.stringify(b.content),
          ...(b.isError ? { isError: true as const } : {}),
        };
      }),
    }));
}
