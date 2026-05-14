import { describe, expect, it, vi } from 'vitest';

import { NIAGARA_DIAGNOSTIC_FLOWS } from './diagnostic-flows';
import { NIAGARA_STARTER_QUESTIONS } from './starter-questions';
import {
  NIAGARA_BASE_PROMPT,
  NIAGARA_SYSTEM_PROMPT,
  formatKnowledgeInventory,
  niagaraSystemPrompt,
  parseKnowledgeSummary,
} from './system-prompt';
import { niagaraPlugin } from './index';

describe('Niagara plugin — base system-prompt content (M5 invariants)', () => {
  // NIAGARA_SYSTEM_PROMPT is a back-compat alias for NIAGARA_BASE_PROMPT.
  it('covers the ORD format with concrete examples', () => {
    expect(NIAGARA_SYSTEM_PROMPT).toMatch(/station:\|slot:\/[A-Z]/);
    expect(NIAGARA_SYSTEM_PROMPT).toMatch(/AHU1|UserService|Drivers/);
  });

  it('introduces the knowledge layer with the four entity kinds + role mapping', () => {
    expect(NIAGARA_SYSTEM_PROMPT.toLowerCase()).toContain('spaces');
    expect(NIAGARA_SYSTEM_PROMPT.toLowerCase()).toContain('equipment_types');
    expect(NIAGARA_SYSTEM_PROMPT.toLowerCase()).toContain('equipment');
    expect(NIAGARA_SYSTEM_PROMPT.toLowerCase()).toContain('standalone_points');
    expect(NIAGARA_SYSTEM_PROMPT).toMatch(/supply_air_temp|role/);
  });

  it('names the knowledge-layer query tools by name', () => {
    expect(NIAGARA_SYSTEM_PROMPT).toContain('findEquipment');
    expect(NIAGARA_SYSTEM_PROMPT).toContain('findInSpace');
    expect(NIAGARA_SYSTEM_PROMPT).toContain('findPoints');
  });

  it('explains the kitFuzzy reading pattern (no special tool — just getSlots/readPoint)', () => {
    expect(NIAGARA_SYSTEM_PROMPT).toContain('kitFuzzy');
    expect(NIAGARA_SYSTEM_PROMPT).toMatch(/getSlots|readPoint/);
  });

  it('states the bqlQuery syntax wart with the limit-as-separate-arg warning', () => {
    expect(NIAGARA_SYSTEM_PROMPT).toContain('bqlQuery');
    expect(NIAGARA_SYSTEM_PROMPT).toContain('|bql:');
    expect(NIAGARA_SYSTEM_PROMPT).toMatch(/LIMIT.*FAILS|limit.*separate/i);
  });

  it('warns about Russian-locale boolean stringification', () => {
    expect(NIAGARA_SYSTEM_PROMPT).toContain('поистине');
    expect(NIAGARA_SYSTEM_PROMPT).toContain('ложь');
  });

  it('describes the write-tool safety semantics + the annotation-override transparency', () => {
    expect(NIAGARA_SYSTEM_PROMPT.toLowerCase()).toMatch(/do not execute|pending-changes queue/);
    expect(NIAGARA_SYSTEM_PROMPT.toLowerCase()).toContain('readonlyhint');
  });

  it('NIAGARA_SYSTEM_PROMPT is a back-compat alias for NIAGARA_BASE_PROMPT (same string)', () => {
    expect(NIAGARA_SYSTEM_PROMPT).toBe(NIAGARA_BASE_PROMPT);
  });
});

describe('niagaraSystemPrompt (M6 C85 — async, knowledge-layer enrichment)', () => {
  it('is registered on the plugin object + returns a Promise<string>', async () => {
    expect(niagaraPlugin.systemPrompt).toBeDefined();
    // Stub callTool with a no-knowledge-summary fallback so the test isn't
    // surfaced as an unhandled rejection; the assertion only checks the
    // return-type shape.
    const ctx = makeMinimalCtx({ callTool: async () => null });
    const result = niagaraPlugin.systemPrompt!(ctx);
    expect(result).toBeInstanceOf(Promise);
    await result; // drain to avoid floating-promise warnings
  });

  it('appends the inventory section to the base prompt on a successful getKnowledgeSummary call', async () => {
    const ctx = makeMinimalCtx({
      callTool: async (name) => {
        if (name !== 'getKnowledgeSummary') return {};
        return {
          spaceCount: 2,
          equipmentTypeCount: 3,
          equipmentCount: 12,
          standalonePointCount: 5,
          equipment: [
            { name: 'AHU-1', type: 'AHU', ord: 'station:|slot:/Drivers/AHU1' },
            { name: 'AHU-2', type: 'AHU' },
          ],
          equipmentTypes: [{ name: 'AHU', equipmentCount: 5 }, { name: 'RTU', equipmentCount: 7 }],
        };
      },
    });
    const prompt = await niagaraSystemPrompt(ctx);
    expect(prompt).toContain(NIAGARA_BASE_PROMPT);
    expect(prompt).toContain('## Connected station inventory');
    expect(prompt).toContain('2 space(s)');
    expect(prompt).toContain('12 equipment');
    expect(prompt).toContain('AHU-1');
    expect(prompt).toContain('AHU (5)');
  });

  it('falls back to the base prompt (no inventory section) when getKnowledgeSummary returns null/undefined', async () => {
    const ctx = makeMinimalCtx({ callTool: async () => null });
    const prompt = await niagaraSystemPrompt(ctx);
    expect(prompt).toBe(NIAGARA_BASE_PROMPT);
    expect(prompt).not.toContain('Connected station inventory');
  });

  it('re-throws getKnowledgeSummary failures so the host can detect timeout vs other rejection', async () => {
    const ctx = makeMinimalCtx({
      callTool: async () => {
        throw new Error('upstream 500');
      },
    });
    await expect(niagaraSystemPrompt(ctx)).rejects.toThrow('upstream 500');
  });
});

describe('parseKnowledgeSummary (M6 C85 — permissive parser)', () => {
  it('parses the bare-object shape', () => {
    const out = parseKnowledgeSummary({
      spaceCount: 1,
      equipmentCount: 5,
      equipment: [{ name: 'A', type: 'AHU' }],
    });
    expect(out).toMatchObject({ spaceCount: 1, equipmentCount: 5 });
    expect(out?.equipment).toEqual([{ name: 'A', type: 'AHU' }]);
  });

  it('parses CallToolResult.content[0].text as JSON', () => {
    const out = parseKnowledgeSummary({
      content: [{ type: 'text', text: JSON.stringify({ spaceCount: 3 }) }],
    });
    expect(out?.spaceCount).toBe(3);
  });

  it('parses structuredContent shape', () => {
    const out = parseKnowledgeSummary({ structuredContent: { equipmentCount: 9 } });
    expect(out?.equipmentCount).toBe(9);
  });

  it('parses the older result-wrapped shape', () => {
    const out = parseKnowledgeSummary({ result: { spaceCount: 7 } });
    expect(out?.spaceCount).toBe(7);
  });

  it('accepts snake_case field-name variants', () => {
    const out = parseKnowledgeSummary({
      spaces_count: 4,
      equipment_types_count: 2,
      equipment_count: 10,
      standalone_points_count: 3,
    });
    expect(out).toMatchObject({
      spaceCount: 4,
      equipmentTypeCount: 2,
      equipmentCount: 10,
      standalonePointCount: 3,
    });
  });

  it('derives count from the list when only the list is present', () => {
    const out = parseKnowledgeSummary({ spaces: [{}, {}, {}] });
    expect(out?.spaceCount).toBe(3);
  });

  it('returns null for null / undefined / non-object inputs', () => {
    expect(parseKnowledgeSummary(null)).toBeNull();
    expect(parseKnowledgeSummary(undefined)).toBeNull();
    expect(parseKnowledgeSummary('string')).toBeNull();
    expect(parseKnowledgeSummary(42)).toBeNull();
  });
});

describe('formatKnowledgeInventory (M6 C85 — ~1k-token-budget formatter)', () => {
  it('emits a counts line + equipment-types line + equipment line', () => {
    const out = formatKnowledgeInventory({
      spaceCount: 1,
      equipmentTypeCount: 2,
      equipmentCount: 3,
      standalonePointCount: 0,
      equipmentTypes: [{ name: 'AHU', equipmentCount: 2 }, { name: 'RTU', equipmentCount: 1 }],
      equipment: [{ name: 'AHU-1', type: 'AHU' }, { name: 'RTU-3', type: 'RTU' }],
    });
    expect(out).toContain('Counts: 1 space(s) · 2 equipment type(s) · 3 equipment · 0 standalone point(s)');
    expect(out).toContain('Equipment types: AHU (2), RTU (1)');
    expect(out).toContain('Equipment: AHU-1 (AHU), RTU-3 (RTU)');
  });

  it('truncates equipment lists past 20 items with "… and N more"', () => {
    const equipment = Array.from({ length: 25 }, (_, i) => ({ name: `E${i}`, type: 'X' }));
    const out = formatKnowledgeInventory({ equipment });
    expect(out).toContain('E0 (X)');
    expect(out).toContain('E19 (X)');
    expect(out).not.toContain('E20 (X)');
    expect(out).toContain('… and 5 more');
  });

  it('truncates equipment-type lists past 10 items', () => {
    const equipmentTypes = Array.from({ length: 15 }, (_, i) => ({ name: `T${i}`, equipmentCount: 1 }));
    const out = formatKnowledgeInventory({ equipmentTypes });
    expect(out).toContain('T0 (1)');
    expect(out).toContain('T9 (1)');
    expect(out).toContain('… and 5 more');
  });

  it('returns empty string when there is nothing useful', () => {
    expect(formatKnowledgeInventory({})).toBe('');
  });

  it('falls back to ord when name + type are absent', () => {
    const out = formatKnowledgeInventory({
      equipment: [{ ord: 'station:|slot:/X' }],
    });
    expect(out).toContain('station:|slot:/X');
  });

  it('includes the notes line if present', () => {
    expect(formatKnowledgeInventory({ notes: 'last edited 2026-05-14' })).toContain(
      'Notes: last edited 2026-05-14',
    );
  });
});

describe('Niagara plugin — M5 starter questions', () => {
  it('ships 4 chips covering common operator concerns', () => {
    expect(NIAGARA_STARTER_QUESTIONS).toHaveLength(4);
    for (const q of NIAGARA_STARTER_QUESTIONS) expect(q.length).toBeGreaterThan(10);
  });

  it('is registered on the plugin object', () => {
    expect(niagaraPlugin.starterQuestions).toBeDefined();
    expect(niagaraPlugin.starterQuestions?.(makeMinimalCtx())).toBe(NIAGARA_STARTER_QUESTIONS);
  });

  it('mentions the canonical Niagara tools/concepts (so the chips align with the system prompt)', () => {
    const joined = NIAGARA_STARTER_QUESTIONS.join(' ').toLowerCase();
    expect(joined).toMatch(/alarms|findequipment|readhistory|knowledge|equipment/);
  });
});

describe('Niagara plugin — M6 diagnostic flows lifted to structured plans (C85)', () => {
  it('ships rooftop-diagnosis + knowledge-summary; both keep their M5 prompt for back-compat', () => {
    const ids = NIAGARA_DIAGNOSTIC_FLOWS.map((f) => f.id);
    expect(ids).toContain('rooftop-diagnosis');
    expect(ids).toContain('knowledge-summary');
    for (const flow of NIAGARA_DIAGNOSTIC_FLOWS) {
      // M6 — every flow ships BOTH prompt (M5 fallback) AND plan (M6 canonical).
      expect(typeof flow.prompt).toBe('string');
      expect(flow.plan).toBeDefined();
      expect(flow.plan!.length).toBeGreaterThan(0);
    }
  });

  it('rooftop-diagnosis plan: 5 steps (findEquipment / inspectComponent / getActiveAlarms / readHistory / llm-step) with the readHistory runIf conditional', () => {
    const rooftop = NIAGARA_DIAGNOSTIC_FLOWS.find((f) => f.id === 'rooftop-diagnosis');
    expect(rooftop?.params).toEqual([
      {
        name: 'equipment_query',
        label: 'Equipment to investigate',
        placeholder: expect.any(String) as string,
      },
    ]);
    const plan = rooftop!.plan!;
    expect(plan).toHaveLength(5);

    // Step 1: findEquipment with the equipment_query param substitution.
    expect(plan[0]).toMatchObject({
      kind: 'tool-call',
      tool: 'findEquipment',
      args: { query: '${param.equipment_query}' },
      bindResultTo: 'equipment',
    });

    // Step 2 + 3 only run when equipment.ord is defined.
    expect(plan[1]).toMatchObject({
      kind: 'tool-call',
      tool: 'inspectComponent',
      runIf: { kind: 'var-defined', path: 'equipment.ord' },
    });
    expect(plan[2]).toMatchObject({
      kind: 'tool-call',
      tool: 'getActiveAlarms',
      runIf: { kind: 'var-defined', path: 'equipment.ord' },
    });

    // Step 4: readHistory conditional on alarms.length > 0 — the D1 example case.
    expect(plan[3]).toMatchObject({
      kind: 'tool-call',
      tool: 'readHistory',
      runIf: { kind: 'var-length-gt', path: 'alarms', value: 0 },
    });

    // Step 5: terminal llm-step — no bindResultTo (final assistant message).
    expect(plan[4]).toMatchObject({ kind: 'llm-step' });
    expect((plan[4] as { bindResultTo?: string }).bindResultTo).toBeUndefined();
    expect((plan[4] as { prompt: string }).prompt).toContain('${param.equipment_query}');
    expect((plan[4] as { prompt: string }).prompt).toContain('${equipment}');
    expect((plan[4] as { prompt: string }).prompt).toContain('${alarms}');
    expect((plan[4] as { prompt: string }).prompt).toContain('${sat_history}');
  });

  it('knowledge-summary plan: 3 steps (getKnowledgeSummary / validateKnowledge / narrate)', () => {
    const flow = NIAGARA_DIAGNOSTIC_FLOWS.find((f) => f.id === 'knowledge-summary');
    const plan = flow!.plan!;
    expect(plan).toHaveLength(3);
    expect(plan[0]).toMatchObject({ kind: 'tool-call', tool: 'getKnowledgeSummary', bindResultTo: 'summary' });
    expect(plan[1]).toMatchObject({
      kind: 'tool-call',
      tool: 'validateKnowledge',
      bindResultTo: 'validation',
      runIf: { kind: 'always' },
    });
    expect(plan[2]).toMatchObject({ kind: 'llm-step' });
    expect(flow!.params).toBeUndefined();
  });

  it('is registered on the plugin object', () => {
    expect(niagaraPlugin.diagnosticFlows).toBeDefined();
    expect(niagaraPlugin.diagnosticFlows?.(makeMinimalCtx())).toBe(NIAGARA_DIAGNOSTIC_FLOWS);
  });
});

interface CtxOverrides {
  callTool?: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function makeMinimalCtx(overrides: CtxOverrides = {}) {
  const ct =
    overrides.callTool ??
    (async () => {
      throw new Error('callTool not stubbed');
    });
  // Cast to PluginContext via unknown — the test's ctx is a structural subset
  // sufficient for what niagaraSystemPrompt actually consumes.
  return {
    connection: {
      connectionId: 'c',
      profileId: 'p',
      serverInfo: { name: 'niagaramcp', version: '0.1.0' },
      status: 'connected',
    },
    callTool: vi.fn(ct),
    listTools: async () => [],
    listResources: async () => [],
    listResourceTemplates: async () => [],
    readResource: async () => ({}),
    listPrompts: async () => [],
    getPrompt: async () => ({}),
    rawRequest: async () => ({}),
    setCwd: () => undefined,
  };
}
