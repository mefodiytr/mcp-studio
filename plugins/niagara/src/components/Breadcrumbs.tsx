import { ChevronRight } from 'lucide-react';
import { cn } from '@mcp-studio/ui';

import { ordTrail } from '../lib/ord';

/**
 * Root → `ord` breadcrumb trail; clicking a segment calls `onNavigate` with that
 * ancestor's ORD. Shared by the Explorer and Folder views.
 */
export function Breadcrumbs({ ord, onNavigate }: { ord: string; onNavigate: (ord: string) => void }) {
  const trail = ordTrail(ord);
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5 text-xs">
      {trail.map((seg, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={seg.ord} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
            <button
              type="button"
              onClick={() => onNavigate(seg.ord)}
              className={cn('rounded px-1 py-0.5 hover:bg-accent', last ? 'font-medium' : 'text-muted-foreground')}
            >
              {i === 0 ? 'Station' : seg.name}
            </button>
          </span>
        );
      })}
    </div>
  );
}
