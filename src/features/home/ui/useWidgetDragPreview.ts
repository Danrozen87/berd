import { useCallback, useEffect, useRef } from "react";
import type { CanvasPoint } from "../lib/layoutCamera";

interface DragPreview {
  element: HTMLElement;
  offset: CanvasPoint;
  translate: string;
  willChange: string;
}

/** Own only transient translation; React keeps the committed widget bounds. */
export function useWidgetDragPreview() {
  const preview = useRef<DragPreview | null>(null);
  const frame = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const current = preview.current;
    if (current) {
      current.element.style.translate = `${current.offset.x}px ${current.offset.y}px`;
    }
  }, []);
  const clear = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    const current = preview.current;
    if (current) {
      current.element.style.translate = current.translate;
      current.element.style.willChange = current.willChange;
      preview.current = null;
    }
  }, []);
  const update = useCallback(
    (element: HTMLElement, offset: CanvasPoint) => {
      if (preview.current?.element !== element) {
        clear();
        preview.current = {
          element,
          offset,
          translate: element.style.translate,
          willChange: element.style.willChange,
        };
        element.style.willChange = "translate";
      }
      preview.current.offset = offset;
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    },
    [clear, flush],
  );
  useEffect(() => clear, [clear]);
  return { update, flush, clear };
}
