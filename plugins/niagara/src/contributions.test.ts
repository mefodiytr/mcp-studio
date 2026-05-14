import { describe, expect, it } from 'vitest';

import { NIAGARA_DIAGNOSTIC_FLOWS } from './diagnostic-flows';
import { NIAGARA_STARTER_QUESTIONS } from './starter-questions';
import { NIAGARA_SYSTEM_PROMPT } from './system-prompt';
import { niagaraPlugin } from './index';

describe('Niagara plugin — M5 system prompt', () => {
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

  it('is registered on the plugin object via systemPrompt() and returns the canonical text', () => {
    expect(niagaraPlugin.systemPrompt).toBeDefined();
    const ctx = makeMinimalCtx();
    expect(niagaraPlugin.systemPrompt?.(ctx)).toBe(NIAGARA_SYSTEM_PROMPT);
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

describe('Niagara plugin — M5 diagnostic flows', () => {
  it('ships at least the rooftop-diagnosis flow + the knowledge-summary flow', () => {
    const ids = NIAGARA_DIAGNOSTIC_FLOWS.map((f) => f.id);
    expect(ids).toContain('rooftop-diagnosis');
    expect(ids).toContain('knowledge-summary');
  });

  it('rooftop flow walks findEquipment → inspectComponent → getActiveAlarms → readHistory → fuzzy', () => {
    const rooftop = NIAGARA_DIAGNOSTIC_FLOWS.find((f) => f.id === 'rooftop-diagnosis');
    expect(rooftop).toBeDefined();
    expect(rooftop!.params).toEqual([
      {
        name: 'equipment_query',
        label: 'Equipment to investigate',
        placeholder: expect.any(String) as string,
      },
    ]);
    expect(rooftop!.prompt).toContain('${equipment_query}');
    expect(rooftop!.prompt).toContain('findEquipment');
    expect(rooftop!.prompt).toContain('inspectComponent');
    expect(rooftop!.prompt).toContain('getActiveAlarms');
    expect(rooftop!.prompt).toContain('readHistory');
    expect(rooftop!.prompt).toMatch(/fuzzy|kitFuzzy/i);
  });

  it('knowledge-summary flow calls getKnowledgeSummary + validateKnowledge', () => {
    const flow = NIAGARA_DIAGNOSTIC_FLOWS.find((f) => f.id === 'knowledge-summary');
    expect(flow).toBeDefined();
    expect(flow!.prompt).toContain('getKnowledgeSummary');
    expect(flow!.prompt).toContain('validateKnowledge');
    // No params — the flow runs straight through.
    expect(flow!.params).toBeUndefined();
  });

  it('is registered on the plugin object', () => {
    expect(niagaraPlugin.diagnosticFlows).toBeDefined();
    expect(niagaraPlugin.diagnosticFlows?.(makeMinimalCtx())).toBe(NIAGARA_DIAGNOSTIC_FLOWS);
  });
});

function makeMinimalCtx() {
  return {
    connection: {
      connectionId: 'c',
      profileId: 'p',
      serverInfo: { name: 'niagaramcp', version: '0.1.0' },
      status: 'connected',
    },
    callTool: async () => ({}),
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
