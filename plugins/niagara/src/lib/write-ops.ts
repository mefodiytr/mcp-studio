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
