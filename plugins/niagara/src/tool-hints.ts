/**
 * Schema overlays for niagaramcp's tools, merged into the generic Tools-catalog
 * form by the host when a Niagara connection is active. niagaramcp's own
 * inputSchemas are mostly fine but several carry Russian-only descriptions and
 * none give worked examples for the ORD / BQL / type-spec strings that trip
 * people up — these add English `title`/`description` and `examples`. Shallow
 * overlay: top-level keys win, `properties` are merged per-key, `required` is
 * unioned. (Tracked: niagaramcp should localize its own tool text — see
 * `docs/m1-followups.md`.)
 */
export const NIAGARA_TOOL_HINTS: Record<string, unknown> = {
  listChildren: {
    title: 'List children of a station component',
    description:
      'List the direct children of a component ORD (or the station root). depth 1 = direct children (max 5; depth > 1 nests). Returns name / ord / type / displayName / isPoint per child.',
    properties: {
      ord: {
        description: "Component ORD — e.g. 'station:|slot:/' (the station root) or 'station:|slot:/Drivers'.",
        examples: ['station:|slot:/', 'station:|slot:/Drivers'],
      },
      depth: { description: 'Traversal depth, 1–5 (default 1). depth > 1 returns nested `children`.' },
    },
  },
  inspectComponent: {
    title: 'Inspect one component',
    description: 'Identity of a single component: ord, name, displayName, type, parentOrd, childCount. For its slots use getSlots.',
    properties: { ord: { examples: ['station:|slot:/Drivers'] } },
  },
  getSlots: {
    title: 'List a component’s slots (properties)',
    properties: {
      ord: {
        description: 'Component ORD whose slots to list.',
        examples: ['station:|slot:/Services/UserService'],
      },
    },
  },
  readPoint: {
    title: 'Read a control point',
    description: 'Read a point’s current value, status, priority, and facets by ORD.',
    properties: { ord: { description: 'Point ORD.', examples: ['station:|slot:/Logic/Sensor1'] } },
  },
  writePoint: {
    title: 'Write a writable control point',
    description:
      'Write a value to a writable Numeric / Boolean / String / Enum point at priority 1–16 (default 16). Pass value = null to release that priority level.',
    properties: {
      ord: { description: 'Writable point ORD.', examples: ['station:|slot:/Logic/Setpoint'] },
      priority: { description: 'BACnet-style priority array level, 1 (highest) – 16 (default).' },
      value: { description: 'Number / boolean / string / integer (for enum ordinals), or null to release the priority level.' },
    },
  },
  findComponentsByType: {
    title: 'Find components by Niagara type',
    properties: {
      typeName: {
        description: "A Niagara type — short ('BNumericPoint') or qualified ('control:NumericPoint').",
        examples: ['control:NumericPoint', 'baja:UserService', 'BNumericWritable'],
      },
    },
  },
  bqlQuery: {
    title: 'Run a BQL query',
    description:
      'Run a BQL query against the station. The `query` must be a full ORD with a |bql: part — Studio’s BQL view builds this for you; calling it raw, prefix it yourself. Row-capping is the separate `limit` arg, NOT a SQL LIMIT clause (BQL has none). Returns TSV (line 1 = column names).',
    properties: {
      query: {
        description: "Full ORD + |bql:<SELECT…>. e.g. 'station:|slot:/Drivers|bql:select displayName, out from control:ControlPoint'.",
        examples: [
          'station:|slot:/|bql:select displayName, type from baja:Component',
          'station:|slot:/Drivers|bql:select displayName, out from control:ControlPoint',
        ],
      },
      limit: { description: 'Max rows in the response, 1–1000 (default 100). Do not put a LIMIT clause in `query`.' },
    },
  },
  readHistory: {
    title: 'Read history records',
    description:
      'Read history records for a control point or BHistoryExt between `from` and `to` (ISO datetime or epoch ms). Optional client-side aggregation (none|avg|min|max|count). limit caps rows (default 1000, max 10000); a 10 s iteration timeout also applies.',
    properties: {
      ord: { description: 'Control-point ORD or a BHistoryExt ORD.', examples: ['station:|slot:/Logic/Sensor1'] },
      from: { examples: ['2026-05-01T00:00:00Z'] },
      to: { examples: ['2026-05-12T00:00:00Z'] },
    },
  },
};
