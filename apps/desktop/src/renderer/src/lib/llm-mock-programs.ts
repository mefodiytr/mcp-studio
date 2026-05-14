import type { MockProgram } from '@mcp-studio/llm-provider';
import { matchUserText } from '@mcp-studio/llm-provider';

/**
 * The canned mock LLM programs the M5 e2e specs exercise. Registered with
 * the `MockLlmProvider` when `MCPSTUDIO_LLM_PROVIDER=mock` is set (in main's
 * `llm:config` IPC handler). Production builds without the env var ignore
 * these — the LlmProviderFactory picks the Anthropic adapter instead.
 *
 * Four programs:
 *   - **greeting**       — smoke test (single text turn).
 *   - **rooftop**        — the handover §A rooftop-diagnosis multi-turn
 *                          walk: findEquipment → inspectComponent →
 *                          getActiveAlarms → readHistory → final summary
 *                          with a chart code fence. Exercised by the
 *                          chat-rooftop e2e + the diagnostic-flow palette
 *                          launcher in the chat empty state.
 *   - **write-propose**  — single tool_use(setSlot) that the M5 C75 safety
 *                          boundary intercepts; the chat surfaces "queued
 *                          for operator approval" and the Changes view
 *                          shows the op badged "AI".
 *   - **cancel**         — slow text stream paced by __delay sentinels so
 *                          the chat-cancel e2e has time to fire Stop
 *                          mid-emission. Aborts cleanly.
 */
export const MOCK_PROGRAMS: MockProgram[] = [
  {
    id: 'greeting',
    match: matchUserText('hello'),
    turns: [
      {
        events: [
          {
            type: 'message-start',
            messageId: 'mock_greeting',
            model: 'mock',
            usage: { inputTokens: 5, outputTokens: 0 },
          },
          { type: 'text-delta', index: 0, text: 'Hi! ' },
          { type: 'text-delta', index: 0, text: 'How can I help you investigate this station?' },
          {
            type: 'text-stop',
            index: 0,
            text: 'Hi! How can I help you investigate this station?',
          },
          {
            type: 'message-stop',
            stopReason: 'end_turn',
            usage: { inputTokens: 5, outputTokens: 12 },
          },
        ],
      },
    ],
  },

  {
    id: 'rooftop',
    // Matches the rooftop-diagnostic flow's first user message ("Investigate
    // the rooftop unit described by: …") + the operator typing variations.
    match: matchUserText('rooftop'),
    turns: [
      // Turn 1: text rationale + findEquipment.
      {
        events: [
          {
            type: 'message-start',
            messageId: 'mock_rooftop_1',
            model: 'mock',
            usage: { inputTokens: 50, outputTokens: 0 },
          },
          {
            type: 'text-stop',
            index: 0,
            text: "I'll start by finding the rooftop unit in the knowledge layer.",
          },
          {
            type: 'tool-use-start',
            index: 1,
            toolUseId: 'toolu_mock_find',
            name: 'findEquipment',
          },
          {
            type: 'tool-use-complete',
            index: 1,
            toolUseId: 'toolu_mock_find',
            name: 'findEquipment',
            input: { query: 'rooftop' },
          },
          {
            type: 'message-stop',
            stopReason: 'tool_use',
            usage: { inputTokens: 50, outputTokens: 20 },
          },
        ],
      },
      // Turn 2: inspectComponent.
      {
        events: [
          {
            type: 'message-start',
            messageId: 'mock_rooftop_2',
            model: 'mock',
            usage: { inputTokens: 90, outputTokens: 0 },
          },
          {
            type: 'tool-use-start',
            index: 0,
            toolUseId: 'toolu_mock_inspect',
            name: 'inspectComponent',
          },
          {
            type: 'tool-use-complete',
            index: 0,
            toolUseId: 'toolu_mock_inspect',
            name: 'inspectComponent',
            input: { ord: 'station:|slot:/Drivers/AHU1' },
          },
          {
            type: 'message-stop',
            stopReason: 'tool_use',
            usage: { inputTokens: 90, outputTokens: 15 },
          },
        ],
      },
      // Turn 3: getActiveAlarms (read-only — the M3 niagara annotations
      // mark it readOnlyHint:true so the safety boundary lets it through).
      {
        events: [
          {
            type: 'message-start',
            messageId: 'mock_rooftop_3',
            model: 'mock',
            usage: { inputTokens: 130, outputTokens: 0 },
          },
          { type: 'text-stop', index: 0, text: 'Now checking active alarms on this unit.' },
          {
            type: 'tool-use-start',
            index: 1,
            toolUseId: 'toolu_mock_alarms',
            name: 'getActiveAlarms',
          },
          {
            type: 'tool-use-complete',
            index: 1,
            toolUseId: 'toolu_mock_alarms',
            name: 'getActiveAlarms',
            input: { sourceOrdPrefix: 'station:|slot:/Drivers/AHU1' },
          },
          {
            type: 'message-stop',
            stopReason: 'tool_use',
            usage: { inputTokens: 130, outputTokens: 18 },
          },
        ],
      },
      // Turn 4: final summary + a real chart fence — readHistory not needed
      // because the mock won't actually have time-series data; we synthesise
      // a small series in the LLM-emitted chart payload for the e2e to assert.
      {
        events: [
          {
            type: 'message-start',
            messageId: 'mock_rooftop_4',
            model: 'mock',
            usage: { inputTokens: 200, outputTokens: 0 },
          },
          {
            type: 'text-stop',
            index: 0,
            text:
              'Summary: the unit is operating within normal range. ' +
              'Supply-air temperature has held steady over the last few minutes:\n\n' +
              '```chart\n' +
              JSON.stringify({
                type: 'timeseries',
                title: 'Supply-air temperature (recent)',
                series: [
                  {
                    name: 'SAT',
                    points: [
                      { t: '2026-05-14T14:00:00Z', v: 21.0 },
                      { t: '2026-05-14T14:05:00Z', v: 21.2 },
                      { t: '2026-05-14T14:10:00Z', v: 21.3 },
                      { t: '2026-05-14T14:15:00Z', v: 21.4 },
                      { t: '2026-05-14T14:20:00Z', v: 21.4 },
                    ],
                  },
                ],
              }) +
              '\n```\n\nNo active alarms; nothing requires operator intervention.',
          },
          {
            type: 'message-stop',
            stopReason: 'end_turn',
            usage: { inputTokens: 200, outputTokens: 80 },
          },
        ],
      },
    ],
  },

  {
    id: 'write-propose',
    match: matchUserText('setpoint'),
    turns: [
      // Single tool_use(setSlot) — the M5 C75 safety boundary intercepts
      // because setSlot's effective annotations after the Niagara override
      // are destructiveHint=false, readOnlyHint=false (write). The boundary
      // returns pendingEnqueued; the chat surfaces "queued" + the Changes
      // view badges the op "AI".
      {
        events: [
          {
            type: 'message-start',
            messageId: 'mock_write_1',
            model: 'mock',
            usage: { inputTokens: 50, outputTokens: 0 },
          },
          {
            type: 'text-stop',
            index: 0,
            text:
              "I'll propose raising the supply-air setpoint on AHU-1 by 2 °C. " +
              'The current value is 21.0 °C — proposing 23.0 °C.',
          },
          {
            type: 'tool-use-start',
            index: 1,
            toolUseId: 'toolu_mock_write',
            name: 'setSlot',
          },
          {
            type: 'tool-use-complete',
            index: 1,
            toolUseId: 'toolu_mock_write',
            name: 'setSlot',
            input: {
              ord: 'station:|slot:/Drivers/AHU1/SAT',
              slotName: 'value',
              value: 23.0,
            },
          },
          {
            type: 'message-stop',
            stopReason: 'tool_use',
            usage: { inputTokens: 50, outputTokens: 40 },
          },
        ],
      },
      // After dispatchTool returns "queued for operator approval — …", the
      // ReAct loop continues with the tool_result block as a user turn.
      // The LLM's next assistant turn acknowledges + ends.
      {
        events: [
          {
            type: 'message-start',
            messageId: 'mock_write_2',
            model: 'mock',
            usage: { inputTokens: 120, outputTokens: 0 },
          },
          {
            type: 'text-stop',
            index: 0,
            text:
              "I've proposed the setpoint change for operator approval. " +
              'The Changes view now shows it badged AI; you decide whether to apply or reject.',
          },
          {
            type: 'message-stop',
            stopReason: 'end_turn',
            usage: { inputTokens: 120, outputTokens: 25 },
          },
        ],
      },
    ],
  },

  {
    id: 'cancel',
    match: matchUserText('story'),
    turns: [
      {
        events: [
          {
            type: 'message-start',
            messageId: 'mock_cancel',
            model: 'mock',
            usage: { inputTokens: 8, outputTokens: 0 },
          },
          // Slow stream — emit a delta + sleep, repeat. The chat-cancel e2e
          // fires Stop after the first delta lands.
          { type: 'text-delta', index: 0, text: 'Once ' },
          { type: '__delay', ms: 200 },
          { type: 'text-delta', index: 0, text: 'upon ' },
          { type: '__delay', ms: 200 },
          { type: 'text-delta', index: 0, text: 'a ' },
          { type: '__delay', ms: 200 },
          { type: 'text-delta', index: 0, text: 'time ' },
          { type: '__delay', ms: 200 },
          { type: 'text-delta', index: 0, text: 'there ' },
          { type: '__delay', ms: 200 },
          { type: 'text-delta', index: 0, text: 'was…' },
          {
            type: 'text-stop',
            index: 0,
            text: 'Once upon a time there was…',
          },
          {
            type: 'message-stop',
            stopReason: 'end_turn',
            usage: { inputTokens: 8, outputTokens: 15 },
          },
        ],
      },
    ],
  },
];
