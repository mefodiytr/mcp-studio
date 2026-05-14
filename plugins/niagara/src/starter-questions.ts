/**
 * Niagara's M5 starter questions — chips shown in the chat empty state.
 *
 * Four prompts that surface common operator concerns. Static strings in v1;
 * richer prompts with ord autocomplete + space-specific names are an
 * m5-followup (the explorer-store.known cross-view cache from M4 is the
 * autocomplete substrate).
 *
 * The host caps the total at 6 (across all contributing plugins).
 */
export const NIAGARA_STARTER_QUESTIONS: string[] = [
  'What equipment is in this station? Use the knowledge layer (getKnowledgeSummary or findEquipment) to give me an overview.',
  'Are there any active alarms right now? Group them by source ord and call out anything urgent.',
  'Pick the rooftop unit (or any AHU) you find and walk me through its current state — components, key point values, and recent history.',
  'Show me the last 24 hours of supply-air-temperature for an AHU as a chart. Use findEquipment to pick one, then readHistory.',
];
