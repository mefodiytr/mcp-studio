import { z } from 'zod';

/**
 * A single watched point in the M4 live monitor — one row of the watch list,
 * persisted in `workspace.json` under the connection's profile (so the
 * watches survive a restart and reattach when the profile reconnects).
 *
 * `connectionId` is session-only and the wrong key; `profileId` is stable.
 * The `intervalMs` is the polling cadence the monitor uses (0 = paused;
 * 1000 / 5000 / 10000 / 30000 / 60000 are the popover presets); the optional
 * `threshold` recolours the sparkline + value on a crossing.
 */
export const watchSchema = z.object({
  ord: z.string().min(1),
  intervalMs: z.number().int().nonnegative(),
  threshold: z
    .object({
      low: z.number().optional(),
      high: z.number().optional(),
    })
    .optional(),
  /** Cached at add-time so a row renders before the first poll lands; the
   *  monitor view updates it from a fresh `inspectComponent` call when stale. */
  displayName: z.string().optional(),
  /** Cached unit / facet label, if known (e.g. `"°C"` from `getSlots` facets). */
  unit: z.string().optional(),
});
export type Watch = z.infer<typeof watchSchema>;

/** Per-profile watch list — keyed by `profileId` (NOT `connectionId`). */
export const watchesByProfileSchema = z.record(z.array(watchSchema));
export type WatchesByProfile = z.infer<typeof watchesByProfileSchema>;
