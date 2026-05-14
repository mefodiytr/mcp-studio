import type { DiagnosticFlow, PlanStep } from '@mcp-studio/plugin-api';

/**
 * Niagara's diagnostic flows — canned multi-step walks the operator can
 * launch from the chat empty state or the command palette.
 *
 * **M5** shipped flows as templated user prompts (`prompt: string`) — the
 * launcher dialog collects params, substitutes them, sends the result as
 * the first user message; the ReAct loop walked from there.
 *
 * **M6 C85** lifts both flows to structured `plan: PlanStep[]` shapes
 * (D1 — linear with `runIf?` conditional skips; two step kinds: `tool-call`
 * + `llm-step`). The `prompt` field stays as the M5 fallback: a flow with
 * BOTH `plan` AND `prompt` runs the plan; a flow with only `prompt` falls
 * back to ReAct (back-compat for any plugin that hasn't migrated). When
 * niagaramcp ships the forward-looking tools per handover §7
 * (getTrendAnalysis / getFuzzyAssessment / getDiagnosticContext), the
 * plans add feature-detect short-circuits — same shape as M3 C57's Bearer
 * bootstrap.
 *
 * Two flows at M6:
 *   1. **Rooftop diagnosis** — the handover §A walk. Five steps,
 *      conditional readHistory skip via `runIf: var-length-gt(alarms, 0)`.
 *   2. **Knowledge layer summary** — low-stakes read-only validation walk.
 *      Three steps; the validateKnowledge step always runs after the
 *      summary lands.
 */
export const NIAGARA_DIAGNOSTIC_FLOWS: DiagnosticFlow[] = [
  {
    id: 'rooftop-diagnosis',
    title: 'Rooftop diagnosis',
    description:
      'Walk a rooftop / AHU unit end-to-end: locate it via the knowledge layer, inspect, check alarms, pull a 24h trend on alarm presence, summarise with citations.',
    params: [
      {
        name: 'equipment_query',
        label: 'Equipment to investigate',
        placeholder: 'e.g. "rooftop 5 north building" or "AHU-2"',
      },
    ],
    // M5 back-compat prompt — only used if the runner can't execute `plan`
    // (e.g. a future plugin without the M6 plan-runner shim). M6's chat
    // view dispatches to runPlan when `plan` is present.
    prompt: `Investigate the rooftop unit described by: \${equipment_query}

Walk these steps: findEquipment → inspectComponent → getActiveAlarms → readHistory (if alarms) → summarise.`,
    plan: rooftopDiagnosisPlan(),
  },
  {
    id: 'knowledge-summary',
    title: 'Knowledge layer summary',
    description:
      "Get an overview of the station's knowledge layer + flag integrity issues. Calls getKnowledgeSummary and validateKnowledge; surfaces orphan refs and missing roles.",
    prompt: `Give me an overview of this station's knowledge layer (call getKnowledgeSummary + validateKnowledge, then summarise).`,
    plan: knowledgeSummaryPlan(),
  },
];

function rooftopDiagnosisPlan(): PlanStep[] {
  return [
    {
      kind: 'tool-call',
      id: 'find-equipment',
      tool: 'findEquipment',
      args: { query: '${param.equipment_query}' },
      bindResultTo: 'equipment',
      label: 'Find the equipment via the knowledge layer',
    },
    {
      kind: 'tool-call',
      id: 'inspect',
      tool: 'inspectComponent',
      args: { ord: '${equipment.ord}' },
      bindResultTo: 'inspection',
      runIf: { kind: 'var-defined', path: 'equipment.ord' },
      label: 'Inspect the root component',
    },
    {
      kind: 'tool-call',
      id: 'active-alarms',
      tool: 'getActiveAlarms',
      args: { sourceOrdPrefix: '${equipment.ord}' },
      bindResultTo: 'alarms',
      runIf: { kind: 'var-defined', path: 'equipment.ord' },
      label: 'Check active alarms on the ord subtree',
    },
    {
      kind: 'tool-call',
      id: 'sat-history',
      tool: 'readHistory',
      args: {
        ord: '${equipment.points.supply_air_temp}',
        aggregation: 'avg',
        from: '24h ago',
      },
      bindResultTo: 'sat_history',
      // Only pull a 24h trend when there's at least one active alarm —
      // this is the M6 D1 example case for `var-length-gt`.
      runIf: { kind: 'var-length-gt', path: 'alarms', value: 0 },
      label: 'Pull 24h supply-air-temp trend (only if alarms present)',
    },
    {
      kind: 'llm-step',
      id: 'summary',
      prompt: `You ran a rooftop-diagnosis flow against the equipment query: \${param.equipment_query}.

Bound results:
  - equipment: \${equipment}
  - inspection: \${inspection}
  - alarms: \${alarms}
  - sat_history (only if pulled): \${sat_history}

Summarise the findings for the operator. Cite specific data — equipment displayName + ord, alarm sourceOrds + timestamps, history sample counts + temperature ranges. If sat_history is present, embed it as a chart code fence (the host base prompt has the exact syntax). If there were no alarms, say so plainly + skip the trend chart. End with operator-readable conclusions: is this equipment OK, or does something need attention?`,
      label: 'Summarise findings with citations',
    },
  ];
}

function knowledgeSummaryPlan(): PlanStep[] {
  return [
    {
      kind: 'tool-call',
      id: 'summary',
      tool: 'getKnowledgeSummary',
      args: {},
      bindResultTo: 'summary',
      label: 'Get the knowledge-layer overview',
    },
    {
      kind: 'tool-call',
      id: 'validate',
      tool: 'validateKnowledge',
      args: {},
      bindResultTo: 'validation',
      runIf: { kind: 'always' },
      label: 'Surface integrity issues',
    },
    {
      kind: 'llm-step',
      id: 'narrate',
      prompt: `You ran a knowledge-layer summary flow.

Bound results:
  - summary: \${summary}
  - validation: \${validation}

Narrate for the operator:

1. What kinds of equipment exist + how many of each.
2. Which spaces are populated.
3. Any integrity issues — orphan references first, missing role mappings second, advisory items last.

If validation reports no issues, say so. If the model is empty, suggest the operator run the niagaramcp bulk-import tools to populate it.`,
      label: 'Narrate the knowledge layer + integrity issues',
    },
  ];
}
