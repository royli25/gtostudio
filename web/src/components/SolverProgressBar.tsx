"use client";

import { useEffect, useState } from "react";

interface SolverProgress {
  iteration: number;
  maxIterations: number;
  exploitability?: number | null;
  phase: string; // "idle" | "solving" | "extracting" | "uploading" | "done" | "error"
}

export function SolverProgressBar() {
  const [progress, setProgress] = useState<SolverProgress | null>(null);
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    let mounted = true;
    let unlisteners: (() => void)[] = [];

    const setup = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const { listen } = await import("@tauri-apps/api/event");

        // Poll initial status
        try {
          const status = await invoke<any>("solver_status");
          if (!mounted) return;

          // Handle both old format (solving: boolean) and new format (phase object)
          if (status.phase) {
            const phase = status.phase;
            if (phase.type === "solving" || phase.type === "Solving") {
              setProgress({
                iteration: phase.iteration || 0,
                maxIterations:
                  phase.maxIterations || phase.max_iterations || 1000,
                phase: "solving",
              });
              setVisible(true);
            } else if (
              phase.type === "extracting" ||
              phase.type === "Extracting"
            ) {
              setProgress({
                iteration: 0,
                maxIterations: 1,
                phase: "extracting",
              });
              setVisible(true);
            } else if (
              phase.type === "uploading" ||
              phase.type === "Uploading"
            ) {
              setProgress({
                iteration: 0,
                maxIterations: 1,
                phase: "uploading",
              });
              setVisible(true);
            }
          } else if (status.solving) {
            // Legacy format
            setVisible(true);
            setProgress({
              iteration: 0,
              maxIterations: 1000,
              phase: "solving",
            });
          }
        } catch {
          // solver_status not available yet
        }

        // Listen for progress events
        const unlisten1 = await listen<any>("solver_progress", (event) => {
          if (!mounted) return;
          setVisible(true);
          setFadeOut(false);
          setProgress({
            iteration: event.payload.iteration,
            maxIterations:
              event.payload.maxIterations ||
              event.payload.max_iterations ||
              1000,
            exploitability: event.payload.exploitability,
            phase: "solving",
          });
        });
        unlisteners.push(unlisten1);

        const DEFAULT_PROGRESS: SolverProgress = { iteration: 0, maxIterations: 1000, phase: "solving" };

        const unlisten2 = await listen("solver_extracting", () => {
          if (!mounted) return;
          setProgress((p) => ({
            ...(p ?? DEFAULT_PROGRESS),
            phase: "extracting",
            iteration: p?.maxIterations || 1,
            maxIterations: p?.maxIterations || 1,
          }));
        });
        unlisteners.push(unlisten2);

        const unlisten3 = await listen("solver_uploading", () => {
          if (!mounted) return;
          setProgress((p) => ({ ...(p ?? DEFAULT_PROGRESS), phase: "uploading" }));
        });
        unlisteners.push(unlisten3);

        const unlisten4 = await listen("solver_done", () => {
          if (!mounted) return;
          setProgress((p) => ({
            ...(p ?? DEFAULT_PROGRESS),
            phase: "done",
            iteration: p?.maxIterations || 1,
          }));
          setFadeOut(true);
          setTimeout(() => {
            if (mounted) {
              setVisible(false);
              setFadeOut(false);
              setProgress(null);
            }
          }, 2000);
        });
        unlisteners.push(unlisten4);

        const unlisten5 = await listen("solver_error", () => {
          if (!mounted) return;
          setProgress((p) => ({ ...(p ?? DEFAULT_PROGRESS), phase: "error" }));
          // Keep error bar visible for 5 seconds
          setTimeout(() => {
            if (mounted) {
              setVisible(false);
              setProgress(null);
            }
          }, 5000);
        });
        unlisteners.push(unlisten5);
      } catch {
        // Not in Tauri environment — do nothing
      }
    };

    setup();

    return () => {
      mounted = false;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  if (!visible || !progress) return null;

  const isError = progress.phase === "error";
  const isIndeterminate =
    progress.phase === "extracting" || progress.phase === "uploading";
  const percentage = isIndeterminate
    ? 100
    : Math.min(
        (progress.iteration / Math.max(progress.maxIterations, 1)) * 100,
        100
      );

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "3px",
        zIndex: 9999,
        overflow: "hidden",
        opacity: fadeOut ? 0 : 1,
        transition: "opacity 500ms ease-out",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${percentage}%`,
          background: isError ? "#ef4444" : "#22c55e",
          transition: isIndeterminate ? "none" : "width 200ms ease-out",
          animation: isIndeterminate
            ? "solver-progress-pulse 1.5s ease-in-out infinite"
            : undefined,
        }}
      />
      <style>{`
        @keyframes solver-progress-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
