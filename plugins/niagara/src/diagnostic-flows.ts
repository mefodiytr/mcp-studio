import type { DiagnosticFlow } from '@mcp-studio/plugin-api';

/**
 * Niagara's M5 diagnostic flows — canned multi-step walks the operator can
 * launch from the chat empty state or the command palette.
 *
 * M5 ships flows as **templated user prompts** (D7): the launcher dialog
 * collects the `params`, substitutes them into `prompt`, sends the result as
 * the first user message; the ReAct loop walks from there. M6 lifts these
 * to stored plan templates (plan-and-execute), narrowing the LLM's role
 * to "fill in the parameters + summarise the results".
 *
 * Two flows at M5:
 *   1. Rooftop diagnosis — the handover §A scenario.
 *   2. Knowledge layer summary — low-stakes read-only validation walk.
 *
 * Anchored to the niagaramcp tool surface as it exists in M4
 * (tests/fixtures/niagara-mock/tools-list.json). When niagaramcp ships the
 * forward-looking tools per handover §7 (getTrendAnalysis,
 * getFuzzyAssessment, getDiagnosticContext), update the prompts to prefer
 * them with a "if available, use … else fall back to …" instruction.
 */
export const NIAGARA_DIAGNOSTIC_FLOWS: DiagnosticFlow[] = [
  {
    id: 'rooftop-diagnosis',
    title: 'Rooftop diagnosis',
    description:
      'Walk a rooftop / AHU unit end-to-end: locate it via the knowledge layer, inspect, check alarms, pull a 24h trend, read fuzzy assessment, summarise with citations.',
    params: [
      {
        name: 'equipment_query',
        label: 'Equipment to investigate',
        placeholder: 'e.g. "rooftop 5 north building" or "AHU-2"',
      },
    ],
    prompt: `Investigate the rooftop unit described by: \${equipment_query}

Walk these steps, narrating what you learn after each:

1. **Find it** via \`findEquipment\` (knowledge layer). If multiple candidates, ask which one before proceeding.
2. **Inspect the root component** at the resolved ord via \`inspectComponent\` — note its type and child count.
3. **Check active alarms** for its ord subtree via \`getActiveAlarms\` (pass the unit's ord as \`sourceOrdPrefix\` or equivalent).
4. **If there are temperature concerns** (active alarms involving temperature, or the user asked about it): pull the last 24h of supply-air-temperature via \`readHistory\` with aggregation \`avg\`. Use the equipment's \`supply_air_temp\` role mapping (or the closest temperature point) to find the right ord.
5. **Read the fuzzy assessment outputs** from the equipment's points (the kitFuzzy-typed points show up via \`getSlots\`/\`readPoint\` like any other slot). Surface any signals that look out-of-range.
6. **Summarise findings** with citations to specific data pulled — value + ord + timestamp. If you found a temperature trend worth showing, embed it as a chart code fence (the host base prompt has the exact syntax). If there's nothing wrong, say so plainly.

Branch on what you actually find — don't run a step that doesn't apply. If a tool errors or returns an unexpected shape, surface that immediately rather than proceeding on assumptions.`,
  },
  {
    id: 'knowledge-summary',
    title: 'Knowledge layer summary',
    description:
      'Get an overview of the station\'s knowledge layer + flag integrity issues. Calls getKnowledgeSummary and validateKnowledge; surfaces orphan refs and missing roles.',
    prompt: `Give me an overview of this station's knowledge layer.

Steps:

1. Call \`getKnowledgeSummary\` to get the high-level breakdown (counts of spaces / equipment_types / equipment / standalone_points; a sketch of the type hierarchy).
2. Call \`validateKnowledge\` to surface integrity issues — orphan references, missing role mappings, equipment with no points.
3. Summarise:
   - What kinds of equipment exist on this station and how many of each.
   - Which spaces are populated.
   - Any integrity issues from step 2 that the operator should know about (orphan refs, missing roles), in priority order (orphans first, missing-roles second, advisory items last).

If \`validateKnowledge\` reports no issues, say so. If \`getKnowledgeSummary\` shows an empty model, suggest that the knowledge layer hasn't been built yet (the niagaramcp side has bulk import tools the operator can run).`,
  },
];
