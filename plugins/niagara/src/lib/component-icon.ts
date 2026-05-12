import {
  AlarmClock,
  Box,
  CalendarClock,
  Folder,
  FolderOpen,
  Gauge,
  LineChart,
  Network,
  Server,
  Settings2,
  TextCursorInput,
  ToggleLeft,
  Variable,
} from 'lucide-react';
import type { ComponentType } from 'react';

/** A component as far as icon selection is concerned. */
export interface IconHints {
  /** Niagara type spec (`module:TypeName`, e.g. `control:NumericPoint`). May be `''`. */
  type: string;
  /** A control point (a leaf). */
  isPoint: boolean;
  /** For container-ish nodes in the tree: is it currently expanded? */
  expanded?: boolean;
}

type Icon = ComponentType<{ className?: string }>;

const matches = (type: string, ...needles: string[]): boolean => {
  const t = type.toLowerCase();
  return needles.some((n) => t.includes(n.toLowerCase()));
};

/**
 * Pick a lucide icon for a Niagara component from its type spec. Heuristic and
 * substring-based — Niagara has thousands of types; we cover the families a
 * station browser meets most (points by value kind, services, schedules, alarm
 * classes, histories, drivers/networks/devices) and fall back to a folder
 * (open/closed in the tree) or a generic box.
 */
export function componentIcon({ type, isPoint, expanded }: IconHints): Icon {
  if (isPoint) {
    // Value-kind icons for control points (and writable points).
    if (matches(type, 'Numeric', 'AnalogInput', 'AnalogOutput', 'AnalogValue')) return Gauge;
    if (matches(type, 'Boolean', 'BinaryInput', 'BinaryOutput', 'BinaryValue')) return ToggleLeft;
    if (matches(type, 'Enum', 'MultiState')) return Variable;
    if (matches(type, 'String')) return TextCursorInput;
    return Gauge; // unknown point kind
  }
  // Container / service families.
  if (matches(type, 'schedule:')) return CalendarClock;
  if (matches(type, 'alarm:', 'AlarmClass', 'AlarmService')) return AlarmClock;
  if (matches(type, 'history:', 'HistoryExt', 'HistoryService', 'HistoryConfig')) return LineChart;
  if (matches(type, 'Network', 'DriverContainer')) return Network;
  if (matches(type, ':Device', 'DeviceFolder')) return Server;
  if (matches(type, 'Service', 'ServiceContainer')) return Settings2;
  if (type === '' || matches(type, 'Folder', 'Container', 'Component')) return expanded ? FolderOpen : Folder;
  return Box; // unknown non-point component
}
