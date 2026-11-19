import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

/**
 * Drag-to-reorder list using pointer events (works with touch, no library).
 * Only the grip handle starts a drag, so normal scrolling and taps still work.
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  gap = 8,
}: {
  items: T[];
  onReorder: (items: T[]) => void;
  renderItem: (item: T, handle: ReactNode) => ReactNode;
  gap?: number;
}) {
  const refs = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<{ id: string; from: number; to: number; dy: number } | null>(null);
  const geo = useRef<{ startY: number; rects: DOMRect[]; from: number } | null>(null);

  const onDown = (e: ReactPointerEvent<HTMLElement>, index: number) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rects = items.map((it) => refs.current.get(it.id)!.getBoundingClientRect());
    geo.current = { startY: e.clientY, rects, from: index };
    setDrag({ id: items[index].id, from: index, to: index, dy: 0 });
    navigator.vibrate?.(8);
  };

  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const g = geo.current;
    if (!g || !drag) return;
    const dy = e.clientY - g.startY;
    const r = g.rects[g.from];
    const center = r.top + r.height / 2 + dy;
    let to = g.from;
    for (let i = 0; i < g.rects.length; i++) {
      if (i === g.from) continue;
      const mid = g.rects[i].top + g.rects[i].height / 2;
      if (i > g.from && center > mid) to = Math.max(to, i);
      if (i < g.from && center < mid) to = Math.min(to, i);
    }
    setDrag({ ...drag, dy, to });
  };

  const onUp = () => {
    const d = drag;
    geo.current = null;
    setDrag(null);
    if (d && d.from !== d.to) {
      const next = [...items];
      const [moved] = next.splice(d.from, 1);
      next.splice(d.to, 0, moved);
      onReorder(next);
    }
  };

  const shiftFor = (i: number) => {
    if (!drag || !geo.current) return 0;
    const h = geo.current.rects[drag.from].height + gap;
    if (i === drag.from) return drag.dy;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -h;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return h;
    return 0;
  };

  return (
    <div className="stack" style={{ gap }}>
      {items.map((item, i) => {
        const handle = (
          <span
            className="drag-handle"
            role="button"
            aria-label="Drag to reorder"
            onPointerDown={(e) => onDown(e, i)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <GripVertical size={18} />
          </span>
        );
        return (
          <div
            key={item.id}
            ref={(el) => {
              if (el) refs.current.set(item.id, el);
              else refs.current.delete(item.id);
            }}
            className={`sortable-item${drag?.id === item.id ? ' dragging' : ''}`}
            style={{ transform: `translateY(${shiftFor(i)}px)` }}
          >
            {renderItem(item, handle)}
          </div>
        );
      })}
    </div>
  );
}
