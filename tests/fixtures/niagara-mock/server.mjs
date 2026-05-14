#!/usr/bin/env node
/**
 * In-process Niagara MCP mock — a tiny stateful in-memory station that speaks
 * the subset of niagaramcp's tool surface the Studio plugin uses. Seeded from
 * the recorded envelopes (so the M2 read-flow spec —
 * `tests/e2e/niagara-plugin.spec.ts` — passes against this mock unmodified);
 * reads + writes go through the same model so a `setSlot` shows up in the
 * next `getSlots`, a `createComponent` shows up in the next `listChildren`,
 * and `removeComponent` deletes the subtree.
 *
 * Speaks newline-delimited JSON-RPC over stdio (no SDK dep). Fault injection:
 * any arg or ord that contains `__fail` makes the mutation return an
 * `isError: true` result.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

const TOOLS_LIST = load('tools-list.json').response.result; // { tools: [...] }
const BQL_RESULT = load('bqlQuery-controlPoint.json').response.result;
const INSPECT_DRIVERS = load('inspectComponent-drivers.json').response.result;
const SLOTS_USERSERVICE = load('getSlots-userservice.json').response.result;

const ROOT_ORD = 'station:|slot:/';
const SLOT_PREFIX = 'station:|slot:';

// ── In-memory model ──────────────────────────────────────────────────────────

/** ord → { ord, name, displayName, type, isPoint, parentOrd } */
const nodes = new Map();
/** parentOrd → [childOrd, …] (insertion-ordered) */
const childrenByParent = new Map();
/** ord → Map<slotName, { name, type, value, facets? }> */
const slotsByOrd = new Map();
/** sinkOrd → Map<linkName, { sourceOrd, sourceSlot, sinkSlot, converterType? }> */
const linksBySink = new Map();

const leafOf = (ord) => {
  const p = ord.startsWith(SLOT_PREFIX) ? ord.slice(SLOT_PREFIX.length) : ord;
  const trimmed = p.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed.slice(trimmed.lastIndexOf('/') + 1);
};
const parentOf = (ord) => {
  const p = (ord.startsWith(SLOT_PREFIX) ? ord.slice(SLOT_PREFIX.length) : ord).replace(/\/+$/, '');
  if (p === '' || p === '/') return null;
  const cut = p.lastIndexOf('/');
  return `${SLOT_PREFIX}${cut <= 0 ? '/' : p.slice(0, cut)}`;
};

function addNode(node) {
  nodes.set(node.ord, node);
  const parent = node.parentOrd ?? parentOf(node.ord);
  if (parent) {
    const list = childrenByParent.get(parent) ?? [];
    if (!list.includes(node.ord)) list.push(node.ord);
    childrenByParent.set(parent, list);
  }
}

// Seed the model from the depth-2 listChildren recording (children stripped
// for storage; we walk children[] to record the descendants).
{
  const root = load('listChildren-root-depth2.json').response.result.structuredContent;
  nodes.set(ROOT_ORD, { ord: ROOT_ORD, name: '/', displayName: '/', type: 'baja:Station', isPoint: false, parentOrd: null });
  const visit = (parent, raw) => {
    const node = {
      ord: raw.ord,
      name: raw.name ?? leafOf(raw.ord),
      displayName: raw.displayName ?? raw.name ?? leafOf(raw.ord),
      type: raw.type ?? 'baja:Component',
      isPoint: raw.isPoint === true,
      parentOrd: parent,
    };
    addNode(node);
    if (Array.isArray(raw.children)) {
      for (const child of raw.children) visit(raw.ord, child);
    }
  };
  for (const child of root.children ?? []) visit(ROOT_ORD, child);
}

// Seed UserService's slots from the recording.
{
  const sc = SLOTS_USERSERVICE.structuredContent;
  if (sc?.ord && Array.isArray(sc.slots)) {
    const map = new Map();
    for (const slot of sc.slots) {
      if (slot?.name) {
        map.set(slot.name, {
          name: slot.name,
          type: slot.type ?? '',
          value: slot.value ?? '',
          ...(slot.facets ? { facets: slot.facets } : {}),
        });
      }
    }
    slotsByOrd.set(sc.ord, map);
  }
}

// ── Result helpers ───────────────────────────────────────────────────────────

const ok = (obj) => ({
  isError: false,
  structuredContent: obj,
  content: [{ type: 'text', text: JSON.stringify(obj) }],
});
const toolError = (message) => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});

const shouldFail = (args) => {
  if (!args) return false;
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.includes('__fail')) return true;
  }
  return false;
};

// ── Tool handlers ────────────────────────────────────────────────────────────

function listChildren(args) {
  const ord = args?.ord || ROOT_ORD;
  if (!nodes.has(ord)) return ok({ ord, children: [] });
  const kids = (childrenByParent.get(ord) ?? []).map((cord) => {
    const n = nodes.get(cord);
    return { ord: n.ord, name: n.name, displayName: n.displayName, type: n.type, isPoint: n.isPoint };
  });
  return ok({ ord, children: kids });
}

function inspectComponent(args) {
  const ord = args?.ord || ROOT_ORD;
  // For ord exactly matching the Drivers recording, return the recorded shape verbatim
  // (the M2 spec asserts the exact recorded text/structure).
  if (ord === 'station:|slot:/Drivers') return INSPECT_DRIVERS;
  const n = nodes.get(ord);
  if (!n) return toolError(`unknown ord: ${ord}`);
  return ok({
    ord: n.ord,
    parentOrd: n.parentOrd ?? 'slot:/',
    displayName: n.displayName,
    name: n.name,
    childCount: (childrenByParent.get(ord) ?? []).length,
    type: n.type,
  });
}

function getSlots(args) {
  const ord = args?.ord || ROOT_ORD;
  // The UserService recording is the canonical shape the M2 spec doesn't assert
  // against but the niagara wrappers tolerate; rebuild from the live slot map
  // so post-setSlot reads reflect mutations.
  const slots = slotsByOrd.get(ord);
  if (!slots) return ok({ ord, slots: [], slotCount: 0 });
  const arr = [...slots.values()];
  return ok({ ord, slots: arr, slotCount: arr.length });
}

function setSlot(args) {
  if (shouldFail(args)) return toolError('fault-injected: __fail in args');
  const ord = String(args?.ord ?? '');
  const slotName = String(args?.slotName ?? '');
  if (!ord || !slotName) return toolError('ord and slotName are required');
  if (!nodes.has(ord)) return toolError(`unknown ord: ${ord}`);
  const map = slotsByOrd.get(ord) ?? new Map();
  const existing = map.get(slotName);
  const value = args?.value;
  map.set(slotName, {
    name: slotName,
    type: existing?.type ?? typeofToBajaType(value),
    value: String(value),
    ...(existing?.facets ? { facets: existing.facets } : {}),
  });
  slotsByOrd.set(ord, map);
  return ok({ ord, slotName, value: String(value) });
}

function clearSlot(args) {
  if (shouldFail(args)) return toolError('fault-injected: __fail in args');
  const ord = String(args?.ord ?? '');
  const slotName = String(args?.slotName ?? '');
  const map = slotsByOrd.get(ord);
  if (map) map.delete(slotName);
  return ok({ ord, slotName, cleared: true });
}

function typeofToBajaType(value) {
  if (typeof value === 'boolean') return 'baja:Boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'baja:Integer' : 'baja:Double';
  return 'baja:String';
}

// ── readPoint + readHistory (M4) — canned deterministic sine over wall clock
// so the live monitor's sparkline ticks across polls + the History view's
// chart renders a stable, recognisable shape. The base offset per ord makes
// adjacent watches distinguishable.

function ordHash(ord) {
  let h = 0;
  for (let i = 0; i < ord.length; i++) h = (h * 31 + ord.charCodeAt(i)) >>> 0;
  return h;
}

function sineAt(ord, tMs) {
  const offset = (ordHash(ord) % 40) - 5; // ~-5..35
  const slow = Math.sin(tMs / 3_600_000) * 8; // ~hour-scale wave
  const fast = Math.sin(tMs / 300_000) * 2; // ~5-min wave
  return Number((offset + slow + fast).toFixed(2));
}

function readPoint(args) {
  const ord = String(args?.ord ?? '');
  if (!ord) return toolError('ord is required');
  const node = nodes.get(ord);
  const v = sineAt(ord, Date.now());
  return ok({
    ord,
    displayName: node?.displayName ?? leafOf(ord),
    type: node?.type ?? 'control:NumericPoint',
    value: v,
    out: `${v} {ok} @ def`,
    status: 'ok',
    facets: { units: '°C', precision: 2 },
  });
}

function parseTime(value, fallback) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return Number(value);
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : fallback;
  }
  return fallback;
}

function readHistory(args) {
  const ord = String(args?.ord ?? '');
  if (!ord) return toolError('ord is required');
  const now = Date.now();
  const from = parseTime(args?.from, now - 3_600_000);
  const to = parseTime(args?.to, now);
  if (!(to > from)) return ok({ ord, records: [], truncated: false });
  const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(10_000, Number(args.limit))) : 1000;
  const span = to - from;
  // ~1 sample/minute up to the limit.
  const n = Math.max(2, Math.min(limit, Math.floor(span / 60_000) + 1));
  const step = span / (n - 1);
  const records = [];
  for (let i = 0; i < n; i++) {
    const t = Math.round(from + i * step);
    records.push({ t: new Date(t).toISOString(), v: sineAt(ord, t) });
  }
  // Aggregation: client-side per niagaramcp's contract — the mock just echoes
  // the requested mode so the wrapper can pass it through; "none" is the same
  // dataset, the others scale the value by a tiny tag so the renderer can
  // visually distinguish the aggregation toggled.
  const agg = String(args?.aggregation ?? 'none');
  return ok({ ord, records, aggregation: agg, truncated: false, rowCount: records.length });
}

function createComponent(args) {
  if (shouldFail(args)) return toolError('fault-injected: __fail in args');
  const parentOrd = String(args?.parentOrd ?? '');
  const type = String(args?.type ?? 'baja:Component');
  const name = String(args?.name ?? '');
  const strategy = args?.nameStrategy === 'suffix' ? 'suffix' : 'fail';
  if (!parentOrd || !name) return toolError('parentOrd and name are required');
  if (!nodes.has(parentOrd)) return toolError(`unknown parentOrd: ${parentOrd}`);
  let finalName = name;
  const siblings = childrenByParent.get(parentOrd) ?? [];
  const exists = (n) => siblings.some((c) => leafOf(c) === n);
  if (exists(finalName)) {
    if (strategy === 'fail') return { isError: true, code: -32602, content: [{ type: 'text', text: `name collision: ${name}` }] };
    let i = 2;
    while (exists(`${finalName}_${i}`)) i++;
    finalName = `${finalName}_${i}`;
  }
  const ord = parentOrd === ROOT_ORD ? `${SLOT_PREFIX}/${finalName}` : `${parentOrd}/${finalName}`;
  addNode({ ord, name: finalName, displayName: finalName, type, isPoint: false, parentOrd });
  return ok({ ord, name: finalName, type, parentOrd });
}

function removeComponent(args) {
  if (shouldFail(args)) return toolError('fault-injected: __fail in args');
  const ord = String(args?.ord ?? '');
  const dryRun = args?.dryRun !== false; // default true
  const force = args?.force === true;
  if (!nodes.has(ord)) return toolError(`unknown ord: ${ord}`);
  // Collect inbound links (links whose sourceOrd is this ord or a descendant).
  const descendants = collectSubtree(ord);
  const inboundLinks = [];
  for (const [sink, names] of linksBySink) {
    for (const [linkName, link] of names) {
      if (descendants.has(link.sourceOrd)) inboundLinks.push(`${sink}.${linkName}`);
    }
  }
  if (dryRun) {
    return ok({
      ord,
      wouldRemove: force || inboundLinks.length === 0,
      refused: !force && inboundLinks.length > 0,
      inboundLinks,
      message:
        inboundLinks.length > 0 && !force
          ? `${inboundLinks.length} inbound link${inboundLinks.length === 1 ? '' : 's'} block this removal; pass force=true to remove anyway.`
          : 'Would remove.',
    });
  }
  if (inboundLinks.length > 0 && !force) {
    return toolError(`refused: ${inboundLinks.length} inbound links`);
  }
  // Actually remove: drop nodes, child relationships, slot maps, link maps.
  for (const o of descendants) {
    nodes.delete(o);
    childrenByParent.delete(o);
    slotsByOrd.delete(o);
    linksBySink.delete(o);
  }
  const parent = parentOf(ord);
  if (parent) {
    const list = childrenByParent.get(parent) ?? [];
    childrenByParent.set(parent, list.filter((c) => c !== ord));
  }
  return ok({ ord, removed: true, removedCount: descendants.size });
}

function collectSubtree(rootOrd) {
  const out = new Set([rootOrd]);
  const stack = [rootOrd];
  while (stack.length > 0) {
    const o = stack.pop();
    for (const child of childrenByParent.get(o) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        stack.push(child);
      }
    }
  }
  return out;
}

function addExtension(args) {
  if (shouldFail(args)) return toolError('fault-injected: __fail in args');
  // Same as createComponent in shape, but `type` arg is `extensionType`.
  return createComponent({
    parentOrd: args?.parentOrd,
    type: args?.extensionType,
    name: args?.name,
    nameStrategy: args?.nameStrategy,
  });
}

function linkSlots(args) {
  if (shouldFail(args)) return toolError('fault-injected: __fail in args');
  const sourceOrd = String(args?.sourceOrd ?? '');
  const sinkOrd = String(args?.sinkOrd ?? '');
  const sinkSlot = String(args?.sinkSlot ?? '');
  if (!sourceOrd || !sinkOrd || !sinkSlot) return toolError('sourceOrd, sinkOrd, sinkSlot are required');
  const linkName = sinkSlot; // niagaramcp typically names the link after the sink slot
  const sinkMap = linksBySink.get(sinkOrd) ?? new Map();
  sinkMap.set(linkName, {
    sourceOrd,
    sourceSlot: String(args?.sourceSlot ?? 'out'),
    sinkSlot,
    ...(args?.converterType ? { converterType: String(args.converterType) } : {}),
  });
  linksBySink.set(sinkOrd, sinkMap);
  return ok({ sinkOrd, linkName, sourceOrd });
}

function unlinkSlots(args) {
  if (shouldFail(args)) return toolError('fault-injected: __fail in args');
  const sinkOrd = String(args?.sinkOrd ?? '');
  const linkName = String(args?.linkName ?? '');
  const map = linksBySink.get(sinkOrd);
  if (map) map.delete(linkName);
  return ok({ sinkOrd, linkName, removed: true });
}

function commitStation() {
  return ok({ committed: true, savedAt: new Date().toISOString() });
}

function setupTestUser(args) {
  if (shouldFail(args)) return toolError('fault-injected: __fail in args');
  return ok({ username: String(args?.username ?? ''), bound: true });
}

// ── M6 knowledge-layer handlers (added in M6 C85 for the plan-based niagara
// flows; the rooftop + knowledge-summary diagnostic flows depend on these). ──

const KNOWLEDGE_SUMMARY = {
  spaceCount: 2,
  equipmentTypeCount: 3,
  equipmentCount: 4,
  standalonePointCount: 1,
  equipmentTypes: [
    { name: 'AHU', equipmentCount: 2 },
    { name: 'RTU', equipmentCount: 1 },
    { name: 'VAV', equipmentCount: 1 },
  ],
  equipment: [
    { name: 'AHU-1', type: 'AHU', ord: 'station:|slot:/Drivers/NiagaraNetwork/AHU1' },
    { name: 'AHU-2', type: 'AHU', ord: 'station:|slot:/Drivers/NiagaraNetwork/AHU2' },
    { name: 'RTU-5', type: 'RTU', ord: 'station:|slot:/Drivers/NiagaraNetwork/RTU5' },
    { name: 'VAV-12', type: 'VAV', ord: 'station:|slot:/Drivers/NiagaraNetwork/VAV12' },
  ],
};

function findEquipment(args) {
  const query = String(args?.query ?? '').toLowerCase();
  // Pick the first equipment whose name OR type matches the query (case-
  // insensitive substring). Falls back to the first AHU so plans that
  // expect a result get something deterministic.
  const found =
    KNOWLEDGE_SUMMARY.equipment.find(
      (e) =>
        (e.name && e.name.toLowerCase().includes(query)) ||
        (e.type && e.type.toLowerCase().includes(query)),
    ) ?? KNOWLEDGE_SUMMARY.equipment[0];
  return ok({
    ord: found.ord,
    displayName: found.name,
    type: found.type,
    points: { supply_air_temp: `${found.ord}/SAT` },
  });
}

function getActiveAlarms() {
  // Empty alarms list — the rooftop plan's readHistory step skips when
  // alarms.length > 0 fails. (Future test scenarios can flip this.)
  return ok([]);
}

function getKnowledgeSummary() {
  return ok(KNOWLEDGE_SUMMARY);
}

function validateKnowledge() {
  return ok({ issues: [] });
}

function callTool(params) {
  switch (params?.name) {
    case 'listChildren':
      return listChildren(params.arguments);
    case 'inspectComponent':
      return inspectComponent(params.arguments);
    case 'getSlots':
      return getSlots(params.arguments);
    case 'bqlQuery':
      return BQL_RESULT;
    case 'setSlot':
      return setSlot(params.arguments);
    case 'clearSlot':
      return clearSlot(params.arguments);
    case 'createComponent':
      return createComponent(params.arguments);
    case 'removeComponent':
      return removeComponent(params.arguments);
    case 'addExtension':
      return addExtension(params.arguments);
    case 'linkSlots':
      return linkSlots(params.arguments);
    case 'unlinkSlots':
      return unlinkSlots(params.arguments);
    case 'commitStation':
      return commitStation();
    case 'setupTestUser':
      return setupTestUser(params.arguments);
    case 'readPoint':
      return readPoint(params.arguments);
    case 'readHistory':
      return readHistory(params.arguments);
    case 'findEquipment':
      return findEquipment(params.arguments);
    case 'getActiveAlarms':
      return getActiveAlarms(params.arguments);
    case 'getKnowledgeSummary':
      return getKnowledgeSummary(params.arguments);
    case 'validateKnowledge':
      return validateKnowledge(params.arguments);
    default:
      return { isError: false, content: [{ type: 'text', text: `(niagara-mock has no handler for ${params?.name})` }] };
  }
}

// ── JSON-RPC plumbing ────────────────────────────────────────────────────────

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notification — nothing to answer
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {}, resources: {}, prompts: {} },
        serverInfo: { name: 'niagaramcp', version: '0.4.1-mock' },
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, TOOLS_LIST);
    case 'resources/list':
      return reply(id, { resources: [] });
    case 'resources/templates/list':
      return reply(id, { resourceTemplates: [] });
    case 'prompts/list':
      return reply(id, { prompts: [] });
    case 'tools/call':
      return reply(id, callTool(params));
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
