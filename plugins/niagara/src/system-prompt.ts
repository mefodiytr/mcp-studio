import type { PluginContext } from '@mcp-studio/plugin-api';

/**
 * The Niagara plugin's system-prompt fragment. Appended to the host base
 * system prompt when a Niagara connection is active.
 *
 * **M5** — static text (the {@link NIAGARA_BASE_PROMPT} block below) covering
 * the niagaramcp essentials the LLM needs to operate without false starts.
 *
 * **M6 C85** — the plugin's exported `systemPrompt(ctx)` is async; it appends
 * a **live knowledge-layer inventory** (queried at chat-runner-launch time
 * via `ctx.callTool('getKnowledgeSummary')`) as an extra section so the LLM
 * starts turn 1 already knowing what equipment exists. On call failure /
 * timeout (the host enforces a 10-second cap via {@link
 * assemblePluginContributions} — see `plugin-prompts.ts`), the inventory
 * section is dropped + a chat-header warning chip fires; the assistant keeps
 * the M5 base prompt and operates without enrichment.
 *
 * Equipped with: ORD format with concrete examples; the knowledge layer
 * (spaces / equipment_types / equipment / standalone_points + the
 * role-mapping pattern); kitFuzzy outputs as standard slot values; the
 * `bqlQuery` syntax wart (full ORD prefix + `|bql:` + separate `limit`
 * arg); Russian-locale booleans (`поистине` / `ложь`); the write-tool
 * pending-queue safety contract.
 */
export const NIAGARA_BASE_PROMPT = `# Niagara station context

You are operating against a Niagara N4 / BCControl MCS station via the niagaramcp MCP server. The station exposes its component tree, point values, history, alarms, and a structured knowledge layer.

## ORD format (Object Resource Descriptor)

Every component, slot, and history record has an **ORD** — a literal string path. Examples:
- \`station:|slot:/Drivers/NiagaraNetwork/AHU1\` — a station component at the slot path Drivers → NiagaraNetwork → AHU1.
- \`station:|slot:/Services/UserService\` — the station's UserService component.
- \`station:|slot:/Drivers/AHU1/SAT\` — the supply-air-temperature point under AHU1.

Use these as the \`ord\` argument to read tools (inspectComponent, getSlots, readPoint, readHistory, etc.). When uncertain about an ord, find it via the knowledge layer first.

## Knowledge layer

niagaramcp ships a structured semantic model on top of the raw component tree:

- **spaces** — physical/logical groupings (a building, a floor, a zone).
- **equipment_types** — schemas (e.g. "AHU", "RTU", "VAV").
- **equipment** — instances of types, anchored at a root ord.
- **standalone_points** — points not anchored to any equipment.

Equipment carries a **points** mapping: \`{ role: ord }\`. The same role name across equipment of the same type points to the corresponding ord on each instance. Example: every AHU has a \`supply_air_temp\` role that maps to its specific SAT-point ord.

Query the knowledge layer with **findEquipment** (by name/description/space), **findInSpace** (list equipment in a space), **findPoints** (find a point by role across equipment). Use **getKnowledgeSummary** for an overview and **validateKnowledge** to surface orphan references / missing roles.

## kitFuzzy outputs

The kitFuzzy module exposes fuzzy-logic controller outputs (membership functions, fuzzifiers, rule engines, defuzzifiers) **as standard slot values**. No special tool is needed: read them via getSlots or readPoint exactly like any other point. The point's parent component will be a kitFuzzy:* type; the value is the controller's current output.

## BQL queries — niagaramcp's input format

The \`bqlQuery\` tool has an awkward but stable shape:

- The \`query\` arg MUST be a **full ORD with a BQL section**: \`station:|slot:/PATH|bql:select <columns> from <baja-type>\`.
- The query string is NOT plain SQL. Example: \`station:|slot:/Drivers|bql:select displayName, type from baja:Component\`.
- **\`LIMIT N\` in the query string FAILS with a misleading parser error.** Pass \`limit\` as a separate argument (\`{ query: "...", limit: 100 }\`).
- Reference: docs/m1-followups.md.

## Boolean localization

Russian-locale stations return \`"поистине"\` (true) and \`"ложь"\` (false) instead of the canonical literals when getSlots / readPoint stringifies a Boolean. Treat them as the booleans they are. (English-locale stations return \`"true"\` / \`"false"\`.)

## Write tools — operator approval, not direct execution

Write tools (setSlot, clearSlot, createComponent, removeComponent, addExtension, linkSlots, unlinkSlots, commitStation, and the walkthrough-write / knowledge-import family) **do not execute** when you call them. They route through the operator's pending-changes queue for approval; only the operator can apply or reject each one. Propose writes freely; the operator decides. Don't claim a write happened until the operator has confirmed it.

niagaramcp ships some write tools with incorrect \`readOnlyHint:true\` annotations; MCP Studio's plugin overrides correct these transparently. You don't need to know which tools are mis-annotated — the safety boundary applies based on the corrected annotations.

## Common starting moves

- "What equipment is here?" → \`getKnowledgeSummary\`, \`findEquipment\`, or browse \`station:|slot:/Drivers\` via \`inspectComponent\`.
- "What's wrong with X?" → \`findEquipment\` to resolve X → \`getActiveAlarms\` on its ord subtree → \`readPoint\` / \`readHistory\` on the relevant role points.
- "Compare today's trend with yesterday's" → two \`readHistory\` calls over the two windows, then a chart code fence in your reply.`;

/**
 * **M6 C85** — the canonical async exported entry. Calls
 * `ctx.callTool('getKnowledgeSummary', {})` at chat-runner-launch time +
 * appends the formatted inventory to the base prompt. On any failure
 * (transport, missing tool, malformed response, isError, timeout enforced
 * by the host), returns the base prompt unchanged + logs a one-line
 * console warning; the host's `onSystemPromptTimeout` callback surfaces
 * the chat-header warning chip independently (timeout case only).
 *
 * Token budget: the inventory section is capped at ~1000 tokens (see
 * `formatKnowledgeInventory`); equipment lists are truncated with
 * `… and N more` past 20 items so a real station with hundreds of
 * components doesn't push the prompt past the cap.
 */
export async function niagaraSystemPrompt(ctx: PluginContext): Promise<string> {
  let summary: KnowledgeSummary | null = null;
  try {
    const result = await ctx.callTool('getKnowledgeSummary', {});
    summary = parseKnowledgeSummary(result);
  } catch (err) {
    // The host's `assemblePluginContributions` re-fires the
    // onSystemPromptTimeout callback on a `PluginSystemPromptTimeoutError`
    // re-throw; anything else here is swallowed (the operator gets the M5
    // prompt + no warning chip — they only see chip when the LLM is mid-
    // request waiting for our enrichment). Log so the dev console catches
    // a misshapen real-station response.
    console.warn('[niagara] getKnowledgeSummary failed; falling back to base prompt', err);
    throw err;
  }
  if (!summary) return NIAGARA_BASE_PROMPT;
  const inventory = formatKnowledgeInventory(summary);
  if (!inventory) return NIAGARA_BASE_PROMPT;
  return `${NIAGARA_BASE_PROMPT}\n\n## Connected station inventory\n\n${inventory}`;
}

interface KnowledgeSummary {
  spaceCount?: number;
  equipmentTypeCount?: number;
  equipmentCount?: number;
  standalonePointCount?: number;
  /** Compact equipment list — [{name, type}] from the server. The exact field
   *  name varies across niagaramcp versions; the parser accepts either
   *  `equipment` or `equipmentList` or `instances`. */
  equipment?: Array<{ name?: string; type?: string; ord?: string }>;
  /** Compact equipment-types list for the "what categories exist" overview. */
  equipmentTypes?: Array<{ name?: string; equipmentCount?: number }>;
  /** Free-text "extra notes" the server may include (validation warnings, the
   *  knowledge model's last-edit timestamp, etc.). Truncated at 200 chars
   *  before joining. */
  notes?: string;
}

/** Permissively parse the various shapes niagaramcp's `getKnowledgeSummary`
 *  might return (M4 history-wrapper convention: be lenient about field
 *  names). Returns `null` for an unparseable shape so the caller falls back
 *  to the base prompt without crashing.
 *
 *  Accepted shapes:
 *    - Bare object with the counts + lists.
 *    - `{ content: [{type:'text', text: '<json>'}] }` — the standard
 *      CallToolResult shape; parse the text as JSON.
 *    - `{ structuredContent: {...} }` — the MCP modern structured-output
 *      shape.
 *    - `{ result: {...} }` — older niagaramcp pre-content-blocks shape. */
export function parseKnowledgeSummary(raw: unknown): KnowledgeSummary | null {
  if (raw === null || raw === undefined) return null;
  // CallToolResult with a text content block carrying JSON.
  if (typeof raw === 'object' && raw !== null && 'content' in raw) {
    const content = (raw as { content?: unknown }).content;
    if (Array.isArray(content)) {
      const textBlock = content.find(
        (b): b is { type: string; text: string } =>
          !!b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string',
      );
      if (textBlock) {
        try {
          return normaliseSummary(JSON.parse(textBlock.text));
        } catch {
          // Fall through to other shapes
        }
      }
    }
  }
  if (typeof raw === 'object' && raw !== null && 'structuredContent' in raw) {
    const s = (raw as { structuredContent?: unknown }).structuredContent;
    return normaliseSummary(s);
  }
  if (typeof raw === 'object' && raw !== null && 'result' in raw) {
    return normaliseSummary((raw as { result?: unknown }).result);
  }
  return normaliseSummary(raw);
}

function normaliseSummary(v: unknown): KnowledgeSummary | null {
  if (v === null || v === undefined || typeof v !== 'object') return null;
  const obj = v as Record<string, unknown>;
  const equipment = pickEquipmentList(obj);
  const equipmentTypes = pickEquipmentTypeList(obj);
  return {
    spaceCount: pickNumber(obj, 'spaceCount', 'spaces_count', 'spaces'),
    equipmentTypeCount: pickNumber(obj, 'equipmentTypeCount', 'equipment_types_count', 'equipmentTypes'),
    equipmentCount: pickNumber(obj, 'equipmentCount', 'equipment_count'),
    standalonePointCount: pickNumber(
      obj,
      'standalonePointCount',
      'standalone_points_count',
      'standalonePoints',
    ),
    ...(equipment ? { equipment } : {}),
    ...(equipmentTypes ? { equipmentTypes } : {}),
    ...(typeof obj.notes === 'string' ? { notes: obj.notes.slice(0, 200) } : {}),
  };
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    // Some shapes carry the list as the count's source (no explicit count
    // field; len of the list).
    if (Array.isArray(v)) return v.length;
  }
  return undefined;
}

function pickEquipmentList(obj: Record<string, unknown>): KnowledgeSummary['equipment'] {
  const candidates = ['equipment', 'equipmentList', 'instances'];
  for (const k of candidates) {
    const v = obj[k];
    if (Array.isArray(v)) {
      return v
        .map((e) => {
          if (typeof e !== 'object' || e === null) return null;
          const o = e as Record<string, unknown>;
          const name = typeof o.name === 'string' ? o.name : undefined;
          const type = typeof o.type === 'string' ? o.type : undefined;
          const ord = typeof o.ord === 'string' ? o.ord : undefined;
          if (!name && !type && !ord) return null;
          return { ...(name ? { name } : {}), ...(type ? { type } : {}), ...(ord ? { ord } : {}) };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    }
  }
  return undefined;
}

function pickEquipmentTypeList(obj: Record<string, unknown>): KnowledgeSummary['equipmentTypes'] {
  const candidates = ['equipmentTypes', 'equipment_types'];
  for (const k of candidates) {
    const v = obj[k];
    if (Array.isArray(v)) {
      return v
        .map((e) => {
          if (typeof e !== 'object' || e === null) return null;
          const o = e as Record<string, unknown>;
          const name = typeof o.name === 'string' ? o.name : undefined;
          const count = pickNumber(o, 'equipmentCount', 'equipment_count', 'count');
          if (!name) return null;
          return { name, ...(count !== undefined ? { equipmentCount: count } : {}) };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);
    }
  }
  return undefined;
}

/** Format the parsed summary into the system-prompt inventory section.
 *  Returns an empty string when there's nothing useful to include (so the
 *  caller can drop the section entirely rather than render an empty
 *  "Connected station inventory" header). Caps equipment lists at 20 items
 *  with `… and N more` to honour the ~1k-token budget on realistic
 *  knowledge models. */
const MAX_EQUIPMENT_LIST = 20;
const MAX_EQUIPMENT_TYPE_LIST = 10;

export function formatKnowledgeInventory(summary: KnowledgeSummary): string {
  const lines: string[] = [];

  const counts: string[] = [];
  if (typeof summary.spaceCount === 'number') counts.push(`${summary.spaceCount} space(s)`);
  if (typeof summary.equipmentTypeCount === 'number')
    counts.push(`${summary.equipmentTypeCount} equipment type(s)`);
  if (typeof summary.equipmentCount === 'number') counts.push(`${summary.equipmentCount} equipment`);
  if (typeof summary.standalonePointCount === 'number')
    counts.push(`${summary.standalonePointCount} standalone point(s)`);
  if (counts.length > 0) lines.push(`Counts: ${counts.join(' · ')}.`);

  if (summary.equipmentTypes && summary.equipmentTypes.length > 0) {
    const head = summary.equipmentTypes.slice(0, MAX_EQUIPMENT_TYPE_LIST);
    const remaining = summary.equipmentTypes.length - head.length;
    const labels = head.map((t) =>
      typeof t.equipmentCount === 'number' ? `${t.name} (${t.equipmentCount})` : t.name,
    );
    lines.push(
      `Equipment types: ${labels.join(', ')}${remaining > 0 ? ` … and ${remaining} more` : ''}.`,
    );
  }

  if (summary.equipment && summary.equipment.length > 0) {
    const head = summary.equipment.slice(0, MAX_EQUIPMENT_LIST);
    const remaining = summary.equipment.length - head.length;
    const labels = head.map((e) => {
      const parts: string[] = [];
      if (e.name) parts.push(e.name);
      if (e.type) parts.push(`(${e.type})`);
      return parts.join(' ') || e.ord || '?';
    });
    lines.push(`Equipment: ${labels.join(', ')}${remaining > 0 ? ` … and ${remaining} more` : ''}.`);
  }

  if (summary.notes) lines.push(`Notes: ${summary.notes}`);

  return lines.join('\n');
}

/**
 * **M5 back-compat alias.** Existing M5 test files import `NIAGARA_SYSTEM_PROMPT`
 * to assert per-checklist-item content. M6 keeps the name pointing at the
 * static base text; the new {@link niagaraSystemPrompt} is the canonical
 * async entry plugins consume.
 */
export const NIAGARA_SYSTEM_PROMPT = NIAGARA_BASE_PROMPT;
