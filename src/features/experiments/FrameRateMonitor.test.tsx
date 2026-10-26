import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrameRateMonitor } from "./FrameRateMonitor";
import { FRAME_RATE_MONITOR_EXPERIMENT_ID } from "./experimentDefinitions";
import {
  EXPERIMENT_PREFERENCES_STORAGE_KEY,
  setExperimentEnabled,
} from "./experimentPreferences";

let callbacks: Map<number, FrameRequestCallback>;
let nextId = 0;
let hidden = false;

function frame(time: number) {
  const entry = callbacks.entries().next().value;
  if (!entry) throw new Error("No frame was scheduled");
  callbacks.delete(entry[0]);
  act(() => entry[1](time));
}

function enable() {
  act(() => {
    expect(setExperimentEnabled(FRAME_RATE_MONITOR_EXPERIMENT_ID, true)).toBe(
      true,
    );
  });
}

beforeEach(() => {
  localStorage.removeItem(EXPERIMENT_PREFERENCES_STORAGE_KEY);
  callbacks = new Map();
  nextId = 0;
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
    (callback) => {
      callbacks.set(++nextId, callback);
      return nextId;
    },
  );
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });
});
afterEach(() => {
  localStorage.removeItem(EXPERIMENT_PREFERENCES_STORAGE_KEY);
  vi.restoreAllMocks();
});

describe("temporary frame-rate monitor", () => {
  it("stays off without an explicit opt-in, including dev auto-enable", () => {
    localStorage.setItem(
      EXPERIMENT_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 2, autoEnable: true, experiments: {} }),
    );
    render(<FrameRateMonitor />);
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(callbacks.size).toBe(0);
  });

  it("reports frame rate and timings without intercepting interaction or announcements", () => {
    render(<FrameRateMonitor />);
    enable();
    expect(screen.getByText("Measuring FPS…")).toBeInTheDocument();
    frame(0);
    for (let index = 1; index <= 30; index++) frame((index * 1000) / 60);
    expect(screen.getByText("60 FPS")).toBeInTheDocument();
    expect(screen.getByText("16.7 ms · max 16.7 ms")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toHaveClass(
      "pointer-events-none",
    );
    expect(screen.getByRole("complementary")).toHaveAttribute(
      "aria-live",
      "off",
    );
    expect(callbacks.size).toBe(1);
  });

  it("keeps a slow frame visible instead of hiding it in the average", () => {
    render(<FrameRateMonitor />);
    enable();
    frame(0);
    for (let index = 1; index <= 24; index++) frame((index * 1000) / 60);
    frame(500);
    expect(screen.getByText("50 FPS")).toBeInTheDocument();
    expect(screen.getByText("20.0 ms · max 100.0 ms")).toBeInTheDocument();
  });

  it("stops sampling when disabled", () => {
    render(<FrameRateMonitor />);
    enable();
    act(() => {
      setExperimentEnabled(FRAME_RATE_MONITOR_EXPERIMENT_ID, false);
    });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(callbacks.size).toBe(0);
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(callbacks.size).toBe(0);
  });

  it("excludes hidden time and cancels the frame loop on unmount", () => {
    const { unmount } = render(<FrameRateMonitor />);
    enable();
    frame(0);
    act(() => {
      hidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(callbacks.size).toBe(0);
    act(() => {
      hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    frame(60_000);
    for (let index = 1; index <= 30; index++)
      frame(60_000 + (index * 1000) / 60);
    expect(screen.getByText("60 FPS")).toBeInTheDocument();
    expect(screen.getByText("16.7 ms · max 16.7 ms")).toBeInTheDocument();
    unmount();
    expect(callbacks.size).toBe(0);
  });
});
