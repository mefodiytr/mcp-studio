import type { ToolAnnotations } from '@mcp-studio/plugin-api';

/**
 * Annotation overrides for niagaramcp's wrongly-annotated tools, merged onto
 * the server's advertised `Tool.annotations` by the host. niagaramcp's whole
 * `walkthrough-write` family + `importKnowledge` currently ship `readOnlyHint:
 * true, destructiveHint: false` (they mutate the knowledge model) — without
 * these overrides the generic Tools catalog would run them with no badge and
 * no destructive-confirm. (Tracked on the niagaramcp side in
 * `docs/m1-followups.md`; once that ships, these become no-ops and can be
 * dropped.) Only the clear cases — never mark something destructive that
 * isn't; over-flagging is annoying-but-not-broken, mis-flagging is.
 */
export const NIAGARA_TOOL_ANNOTATION_OVERRIDES: Record<string, ToolAnnotations> = {
  // Walkthrough-write — create / update / bulk on the semantic knowledge model.
  createSpace: { readOnlyHint: false },
  updateSpace: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  createEquipmentType: { readOnlyHint: false },
  updateEquipmentType: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  createEquipment: { readOnlyHint: false },
  updateEquipment: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  bulkCreateEquipment: { readOnlyHint: false, destructiveHint: true },
  assignPointToEquipment: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  createStandalonePoint: { readOnlyHint: false },
  // Management — `importKnowledge` `replace` mode wipes the model.
  importKnowledge: { readOnlyHint: false, destructiveHint: true },
};
