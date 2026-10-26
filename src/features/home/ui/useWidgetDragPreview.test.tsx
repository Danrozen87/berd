import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWidgetDragPreview } from "./useWidgetDragPreview";

describe("useWidgetDragPreview", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes only the latest position on the next frame and restores owned styles", () => {
    const element = document.createElement("div");
    element.style.translate = "2px 4px";
    element.style.willChange = "opacity";
    const { result } = renderHook(() => useWidgetDragPreview());
    act(() => {
      result.current.update(element, { x: 10, y: 20 });
      result.current.update(element, { x: 30, y: 40 });
    });
    expect(element.style.translate).toBe("2px 4px");
    act(() => vi.advanceTimersToNextFrame());
    expect(element.style.translate).toBe("30px 40px");
    act(() => result.current.clear());
    expect(element.style.translate).toBe("2px 4px");
    expect(element.style.willChange).toBe("opacity");
  });

  it("flushes a pending preview once without a late frame overwriting it", () => {
    const element = document.createElement("div");
    const { result } = renderHook(() => useWidgetDragPreview());
    act(() => {
      result.current.update(element, { x: 10, y: 20 });
      result.current.flush();
    });
    expect(element.style.translate).toBe("10px 20px");
    element.style.translate = "99px 99px";
    act(() => vi.advanceTimersToNextFrame());
    expect(element.style.translate).toBe("99px 99px");
  });

  it("cancels queued work and restores styles when the canvas unmounts", () => {
    const element = document.createElement("div");
    element.style.willChange = "opacity";
    const { result, unmount } = renderHook(() => useWidgetDragPreview());
    act(() => result.current.update(element, { x: 10, y: 20 }));
    unmount();
    act(() => vi.advanceTimersToNextFrame());
    expect(element.style.translate).toBe("");
    expect(element.style.willChange).toBe("opacity");
  });

  it("restores the previous element before previewing another", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    const { result } = renderHook(() => useWidgetDragPreview());
    act(() => {
      result.current.update(first, { x: 10, y: 20 });
      vi.advanceTimersToNextFrame();
      result.current.update(second, { x: 30, y: 40 });
      vi.advanceTimersToNextFrame();
    });
    expect(first.style.translate).toBe("");
    expect(first.style.willChange).toBe("");
    expect(second.style.translate).toBe("30px 40px");
  });
});
