#!/usr/bin/env node
/**
 * In-process Niagara MCP mock — replays the recorded niagaramcp envelopes that
 * live next to this file (see the `*.json` fixtures). Speaks newline-delimited
 * JSON-RPC over stdio (the MCP stdio transport), no SDK dependency. Used by the
 * Niagara plugin e2e (`tests/e2e/niagara-plugin.spec.ts`).
 *
 * Behaviour:
 *  - `initialize` → serverInfo.name = "niagaramcp" (so the in-box Niagara plugin
 *    matches) + the `tools` capability.
 *  - `tools/list` → the recorded 46-tool surface (`tools-list.json`).
 *  - `tools/call`:
 *      listChildren(ord)       → children from the depth-2 root recording
 *                                (flattened: root, Services, Drivers, …)
 *      inspectComponent(ord)   → the Drivers recording, else synthesised
 *      getSlots(ord)           → the UserService recording, else empty
 *      bqlQuery(...)           → the control-point recording (a TSV body)
 *      anything else           → a harmless text stub
 *  - resources/prompts list calls → empty.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(path.join(dir, name), 'utf8'));

const TOOLS_LIST = load('tools-list.json').response.result; // { tools: [...] }
const INSPECT_DRIVERS = load('inspectComponent-drivers.json').response.result;
const SLOTS_USERSERVICE = load('getSlots-userservice.json').response.result;
const BQL_RESULT = load('bqlQuery-controlPoint.json').response.result;

const ROOT_ORD = 'station:|slot:/';
const SLOT_PREFIX = 'station:|slot:';

// Flatten the depth-2 `listChildren` recording: ord → its children[] (each
// child stripped of its own nested `children`), plus ord → the node itself.
const childrenByOrd = new Map();
const nodeByOrd = new Map();
{
  const root = load('listChildren-root-depth2.json').response.result.structuredContent;
  const visit = (node) => {
    if (node.ord) nodeByOrd.set(node.ord, node);
    if (Array.isArray(node.children)) {
      childrenByOrd.set(node.ord, node.children);
      node.children.forEach(visit);
    }
  };
  visit(root);
}

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

const textResult = (obj) => ({
  isError: false,
  structuredContent: obj,
  content: [{ type: 'text', text: JSON.stringify(obj) }],
});

function listChildren(args) {
  const ord = args?.ord || ROOT_ORD;
  return textResult({ ord, children: childrenByOrd.get(ord) ?? [] });
}

function inspectComponent(args) {
  const ord = args?.ord || ROOT_ORD;
  if (ord === 'station:|slot:/Drivers') return INSPECT_DRIVERS;
  const node = nodeByOrd.get(ord) ?? {};
  const name = node.name || leafOf(ord);
  return textResult({
    ord,
    parentOrd: parentOf(ord) ?? 'slot:/',
    displayName: node.displayName || name,
    name,
    childCount: (childrenByOrd.get(ord) ?? []).length,
    type: node.type || 'baja:Component',
  });
}

function getSlots(args) {
  const ord = args?.ord || ROOT_ORD;
  if (ord === 'station:|slot:/Services/UserService') return SLOTS_USERSERVICE;
  return textResult({ ord, slots: [], slotCount: 0 });
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
    default:
      return { isError: false, content: [{ type: 'text', text: `(niagara-mock has no recorded result for ${params?.name})` }] };
  }
}

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // a notification — nothing to answer
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
