import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocaleFormatting } from "@/shared/i18n";
import { FRAME_RATE_MONITOR_EXPERIMENT_ID } from "./experimentDefinitions";
import { useExperiment } from "./experimentPreferences";

type FrameSample = { fps: number; average: number; worst: number };
const SAMPLE_INTERVAL_MS = 500;

function useFrameSample() {
  const [sample, setSample] = useState<FrameSample | null>(null);
  useEffect(() => {
    let frame = 0;
    let start: number | null = null;
    let previous: number | null = null;
    let count = 0;
    let worst = 0;
    const tick = (time: number) => {
      if (previous !== null) {
        count++;
        worst = Math.max(worst, time - previous);
      } else {
        start = time;
      }
      previous = time;
      const elapsed = time - (start ?? time);
      if (elapsed >= SAMPLE_INTERVAL_MS) {
        setSample({
          fps: Math.round((count * 1000) / elapsed),
          average: elapsed / count,
          worst,
        });
        start = time;
        count = 0;
        worst = 0;
      }
      frame = requestAnimationFrame(tick);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      start = null;
      previous = null;
      count = 0;
      worst = 0;
      setSample(null);
      if (!document.hidden) frame = requestAnimationFrame(tick);
    };
    restart();
    document.addEventListener("visibilitychange", restart);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", restart);
    };
  }, []);
  return sample;
}

function FrameRateReadout() {
  const { t } = useTranslation("settings");
  const { formatNumber } = useLocaleFormatting();
  const sample = useFrameSample();
  const milliseconds = (value: number) =>
    formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <aside
      aria-label={t("experiments.frameRate.title")}
      aria-live="off"
      className="pointer-events-none fixed right-3 top-[calc(var(--spacing-app-top-bar)+0.75rem)] z-100 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs tabular-nums text-foreground shadow-mini"
    >
      <div>
        {sample
          ? t("experiments.frameRate.fps", { value: sample.fps })
          : t("experiments.frameRate.waiting")}
      </div>
      {sample && (
        <div>
          {t("experiments.frameRate.timing", {
            average: milliseconds(sample.average),
            worst: milliseconds(sample.worst),
          })}
        </div>
      )}
    </aside>
  );
}

/** Temporary diagnostics; disabling the experiment unmounts the entire sampler. */
export function FrameRateMonitor() {
  const experiment = useExperiment(FRAME_RATE_MONITOR_EXPERIMENT_ID);
  return experiment?.enabled ? <FrameRateReadout /> : null;
}
