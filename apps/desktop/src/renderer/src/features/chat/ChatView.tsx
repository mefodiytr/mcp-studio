import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Send, StopCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { runReAct, type LlmMessage, type LlmTool, type RunnerEvent } from '@mcp-studio/llm-provider';

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

    // Build the provider + run the ReAct loop. Tools are empty in C71 — the
    // wiring to ConnectionManager's tool catalog lands in C75 (after the
    // safety boundary is in place for AI write attribution).
    const controller = new AbortController();
    abortRef.current = controller;
    setStreamingText('');
    setStreamingToolCalls([]);

    try {
      const mode = providerMode ?? 'anthropic';
      const provider = await createProvider(mode);
      const history: LlmMessage[] = mapHistoryForProvider(activeConversation?.messages ?? []).concat({
        role: 'user',
        content: [{ type: 'text', text }],
      });
      const tools: LlmTool[] = [];
      const gen = runReAct({
        provider,
        system: contributions.systemPrompt,
        history,
        tools,
        dispatchTool: async () => {
          // No tools wired in C71 — the LLM has none to call.
          throw new Error('No tools available in C71');
        },
        signal: controller.signal,
      });

      const assistantContent: ContentBlock[] = [];
      let textBuf = '';
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
        } else if (ev.type === 'aborted') {
          await appendMessage(profileId, conversationId, {
            id: `m_${Date.now()}`,
            role: 'assistant',
            content: assistantContent,
            marker: 'aborted',
            ts: Date.now(),
          });
          break;
        } else if (ev.type === 'max-turns-reached') {
          await appendMessage(profileId, conversationId, {
            id: `m_${Date.now()}`,
            role: 'assistant',
            content: assistantContent,
            marker: 'max-turns-reached',
            ts: Date.now(),
          });
          break;
        } else if (ev.type === 'turn-stop') {
          // Persist this turn's assistant message; clear local buffers.
          if (assistantContent.length > 0) {
            await appendMessage(profileId, conversationId, {
              id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              role: 'assistant',
              content: [...assistantContent],
              ts: Date.now(),
            });
            assistantContent.length = 0;
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

  const handleLaunchFlow = useCallback((flow: TaggedDiagnosticFlow) => {
    if (!flow.params || flow.params.length === 0) {
      void handleRunFlow(flow, {});
      return;
    }
    const initial: Record<string, string> = {};
    for (const p of flow.params) initial[p.name] = '';
    setFlowLauncher({ flow, paramValues: initial });
  }, [handleRunFlow]);

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
        <header className="border-b p-3">
          <h1 className="text-sm font-medium">{activeConversation?.title ?? t('chat.newConversation')}</h1>
          <p className="text-xs text-muted-foreground">
            {t('chat.scope', { server: active?.serverInfo?.name ?? active?.profileId ?? '' })}
            {providerMode === 'mock' && (
              <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
                {t('chat.mockBadge')}
              </span>
            )}
          </p>
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
