/**
 * The M3 write ops — a tagged union of the structured edits the Niagara plugin
 * lets the operator queue. Pure constructors / formatters; nothing here calls
 * the server. The Changes view renders {@link describe} per op for the diff,
 * and the pending-store's `applyAll` invokes {@link toToolCall} per op via
 * `ctx.callTool(..., {write:true})`. Reversibility is flagged statically — see
 * `docs/milestone-3.md` §D2 for the table and the rationale.
 */
export type WriteOp =
  | { type: 'setSlot'; ord: string; slotName: string; oldValue: unknown; newValue: unknown }
  | { type: 'clearSlot'; ord: string; slotName: string; oldValue: unknown }
  | {
      type: 'createComponent';
      parentOrd: string;
      componentType: string;
      name: string;
      nameStrategy?: 'fail' | 'suffix';
    }
  | { type: 'removeComponent'; ord: string; force?: boolean }
  | {
      type: 'addExtension';
      parentOrd: string;
      extensionType: string;
      name: string;
      nameStrategy?: 'fail' | 'suffix';
    }
  | {
      type: 'linkSlots';
      sourceOrd: string;
      sourceSlot: string;
      sinkOrd: string;
      sinkSlot: string;
      converterType?: string;
    }
  | { type: 'unlinkSlots'; sinkOrd: string; linkName: string };

/** Whether the op has a clean local inverse: SetSlot/ClearSlot reverse via the
 *  recorded `oldValue`, CreateComponent via RemoveComponent on the new ord,
 *  LinkSlots via UnlinkSlots on the recorded link name. RemoveComponent,
 *  UnlinkSlots and AddExtension lose the data needed to reconstruct — flagged
 *  irreversible *before* Apply so the operator knows. */
export function isReversible(op: WriteOp): boolean {
  switch (op.type) {
    case 'setSlot':
    case 'clearSlot':
    case 'createComponent':
    case 'linkSlots':
      return true;
    case 'removeComponent':
    case 'unlinkSlots':
    case 'addExtension':
      return false;
  }
}

/** A short user-facing label for the diff view. English only for M3 — if i18n
 *  in the Niagara plugin becomes a goal, return a structured value instead. */
export function describe(op: WriteOp): string {
  switch (op.type) {
    case 'setSlot':
      return `Set ${op.slotName} on ${op.ord} to ${formatValue(op.newValue)}`;
    case 'clearSlot':
      return `Reset ${op.slotName} on ${op.ord} to its default`;
    case 'createComponent':
      return `Create ${op.componentType} "${op.name}" under ${op.parentOrd}`;
    case 'removeComponent':
      return `Remove ${op.ord}${op.force ? ' (force)' : ''}`;
    case 'addExtension':
      return `Add extension ${op.extensionType} "${op.name}" to ${op.parentOrd}`;
    case 'linkSlots':
      return `Link ${op.sourceOrd}.${op.sourceSlot} → ${op.sinkOrd}.${op.sinkSlot}${op.converterType ? ` via ${op.converterType}` : ''}`;
    case 'unlinkSlots':
      return `Unlink ${op.linkName} on ${op.sinkOrd}`;
  }
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v === null || v === undefined) return String(v);
  return String(v);
}

/** A BSimple Property-slot kind that `setSlot` accepts and that the property
 *  sheet can render an editable cell for. `null` = not BSimple (read-only in
 *  M3 — Actions, complex BStruct slots, links and extensions are out of scope;
 *  see `docs/milestone-3.md` §D5). */
export type BSimpleKind = 'string' | 'boolean' | 'integer' | 'number' | null;

const BSIMPLE_KIND: Record<string, Exclude<BSimpleKind, null>> = {
  'baja:String': 'string',
  'baja:Boolean': 'boolean',
  'baja:Integer': 'integer',
  'baja:Long': 'integer',
  'baja:Double': 'number',
  'baja:Float': 'number',
};

export function bsimpleKind(slotType: string): BSimpleKind {
  return BSIMPLE_KIND[slotType] ?? null;
}

/** Parse the display string a niagaramcp `getSlots` returns into the JS value
 *  setSlot expects — best-effort, returns the original string for `string`
 *  kinds, parses integers / numbers, and handles boolean (`true`/`false` plus
 *  the Russian-localized `поистине`/`ложь` niagaramcp currently ships in lieu
 *  of canonical booleans). Returns `undefined` when parsing fails. */
export function parseBSimpleValue(kind: Exclude<BSimpleKind, null>, raw: string): unknown {
  const v = raw.trim();
  switch (kind) {
    case 'string':
      return raw;
    case 'integer': {
      if (!/^-?\d+$/.test(v)) return undefined;
      return Number.parseInt(v, 10);
    }
    case 'number': {
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'boolean': {
      const lo = v.toLowerCase();
      if (lo === 'true' || lo === 'поистине' || lo === '1') return true;
      if (lo === 'false' || lo === 'ложь' || lo === '0') return false;
      return undefined;
    }
  }
}

/** **M5 C75** — inverse of {@link toToolCall}. Given a Niagara tool name +
 *  args (the shape the M5 safety boundary forwards when intercepting an
 *  AI-attributed write call), return the matching `WriteOp` if the call is
 *  one this plugin understands, otherwise `null`. The chat view's pending-
 *  enqueue path uses this to materialize the AI's intent into the same
 *  `WriteOp` tagged union the Property Sheet + tree menu emit, so the
 *  Changes view + apply loop render / apply AI-proposed ops identically to
 *  human-proposed ones.
 *
 *  Out-of-scope tools (`commitStation`, `dryRunRemove`, the entire
 *  knowledge / walkthrough-write family) return null. The chat view surfaces
 *  "no plugin can render this op" in that case. */
export function fromToolCall(
  name: string,
  args: Record<string, unknown>,
): WriteOp | null {
  switch (name) {
    case 'setSlot': {
      const ord = stringArg(args.ord);
      const slotName = stringArg(args.slotName);
      if (!ord || !slotName) return null;
      return {
        type: 'setSlot',
        ord,
        slotName,
        // oldValue is unknown to the LLM; the Changes view renders without
        // a "was X" hint for AI-proposed ops. (m5-followup: optionally
        // fetch via getSlots before enqueueing for the parity render.)
        oldValue: undefined,
        newValue: args.value,
      };
    }
    case 'clearSlot': {
      const ord = stringArg(args.ord);
      const slotName = stringArg(args.slotName);
      if (!ord || !slotName) return null;
      return { type: 'clearSlot', ord, slotName, oldValue: undefined };
    }
    case 'createComponent': {
      const parentOrd = stringArg(args.parentOrd);
      const componentType = stringArg(args.type);
      const componentName = stringArg(args.name);
      if (!parentOrd || !componentType || !componentName) return null;
      const nameStrategy = stringArg(args.nameStrategy);
      const op: WriteOp = {
        type: 'createComponent',
        parentOrd,
        componentType,
        name: componentName,
        ...(nameStrategy === 'fail' || nameStrategy === 'suffix' ? { nameStrategy } : {}),
      };
      return op;
    }
    case 'removeComponent': {
      const ord = stringArg(args.ord);
      if (!ord) return null;
      return {
        type: 'removeComponent',
        ord,
        ...(args.force === true ? { force: true } : {}),
      };
    }
    case 'addExtension': {
      const parentOrd = stringArg(args.parentOrd);
      const extensionType = stringArg(args.extensionType);
      const extensionName = stringArg(args.name);
      if (!parentOrd || !extensionType || !extensionName) return null;
      const nameStrategy = stringArg(args.nameStrategy);
      return {
        type: 'addExtension',
        parentOrd,
        extensionType,
        name: extensionName,
        ...(nameStrategy === 'fail' || nameStrategy === 'suffix' ? { nameStrategy } : {}),
      };
    }
    case 'linkSlots': {
      const sourceOrd = stringArg(args.sourceOrd);
      const sourceSlot = stringArg(args.sourceSlot);
      const sinkOrd = stringArg(args.sinkOrd);
      const sinkSlot = stringArg(args.sinkSlot);
      if (!sourceOrd || !sourceSlot || !sinkOrd || !sinkSlot) return null;
      const converterType = stringArg(args.converterType);
      return {
        type: 'linkSlots',
        sourceOrd,
        sourceSlot,
        sinkOrd,
        sinkSlot,
        ...(converterType ? { converterType } : {}),
      };
    }
    case 'unlinkSlots': {
      const sinkOrd = stringArg(args.sinkOrd);
      const linkName = stringArg(args.linkName);
      if (!sinkOrd || !linkName) return null;
      return { type: 'unlinkSlots', sinkOrd, linkName };
    }
    default:
      return null;
  }
}

function stringArg(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** The `{name, arguments}` pair to pass to `ctx.callTool` — exactly the shape
 *  niagaramcp's `tools/list` advertises for each tool. */
export function toToolCall(op: WriteOp): { name: string; arguments: Record<string, unknown> } {
  switch (op.type) {
    case 'setSlot':
      return { name: 'setSlot', arguments: { ord: op.ord, slotName: op.slotName, value: op.newValue } };
    case 'clearSlot':
      return { name: 'clearSlot', arguments: { ord: op.ord, slotName: op.slotName } };
    case 'createComponent':
      return {
        name: 'createComponent',
        arguments: {
          parentOrd: op.parentOrd,
          type: op.componentType,
          name: op.name,
          ...(op.nameStrategy ? { nameStrategy: op.nameStrategy } : {}),
        },
      };
    case 'removeComponent':
      return {
        name: 'removeComponent',
        arguments: { ord: op.ord, ...(op.force ? { force: true } : {}) },
      };
    case 'addExtension':
      return {
        name: 'addExtension',
        arguments: {
          parentOrd: op.parentOrd,
          extensionType: op.extensionType,
          name: op.name,
          ...(op.nameStrategy ? { nameStrategy: op.nameStrategy } : {}),
        },
      };
    case 'linkSlots':
      return {
        name: 'linkSlots',
        arguments: {
          sourceOrd: op.sourceOrd,
          sourceSlot: op.sourceSlot,
          sinkOrd: op.sinkOrd,
          sinkSlot: op.sinkSlot,
          ...(op.converterType ? { converterType: op.converterType } : {}),
        },
      };
    case 'unlinkSlots':
      return { name: 'unlinkSlots', arguments: { sinkOrd: op.sinkOrd, linkName: op.linkName } };
  }
}
