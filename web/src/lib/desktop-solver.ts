import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SolveResults } from "@/lib/poker";

export interface SolverConfig {
  oopRange: string;
  ipRange: string;
  board: number[];
  startingPot: number;
  effectiveStack: number;
  rakeRate: number;
  rakeCap: number;
  oopFlopBet: string;
  oopFlopRaise: string;
  ipFlopBet: string;
  ipFlopRaise: string;
  oopTurnBet: string;
  oopTurnRaise: string;
  ipTurnBet: string;
  ipTurnRaise: string;
  oopRiverBet: string;
  oopRiverRaise: string;
  ipRiverBet: string;
  ipRiverRaise: string;
  addAllinThreshold: number;
  forceAllinThreshold: number;
  mergingThreshold: number;
  storageMode: StorageMode;
}

export type StorageMode = "auto" | "preferMemory" | "preferSpeed";

export interface InitResult {
  enableCompression: boolean;
  memoryUsageCompressedMb: number;
  memoryUsageMb: number;
  memoryUsageUncompressedMb: number;
}

export interface ProgressPoint {
  exploitability?: number | null;
  iteration: number;
  phase: "iterationComplete" | "exploitability";
}

export interface SolveDone {
  cancelled: boolean;
  exploitability: number;
}

export type SolverPhase =
  | { type: "idle" }
  | { type: "solving"; iteration: number; maxIterations: number; exploitability: number | null }
  | { type: "extracting" }
  | { type: "uploading" }
  | { type: "done"; exploitability: number; spotId: string | null }
  | { type: "error"; phase: string; message: string };

export interface SolverStatus {
  phase: SolverPhase;
  initialized: boolean;
}

export interface SolverStartConfig {
  maxIterations: number;
  targetExploitability: number;
  exploitabilityInterval: number;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  spotMetadata?: Record<string, unknown>;
}

export interface SolveConfig {
  board: string[];
  oopRange: string;
  ipRange: string;
  oopPosition: string;
  ipPosition: string;
  gameType: string;
  potType: string;
  startingPot: number;
  effectiveStack: number;
  treeConfig: Record<string, unknown>;
  maxIterations: number;
  targetExploitability: number;
}

export interface LocalSolveMetadata {
  fileName: string;
  metadata: unknown;
}

export interface GameInfo {
  board: number[];
  effectiveStack: number;
  isOopCombos: number;
  isIpCombos: number;
  isSolved: boolean;
  numIpCombos: number;
  numOopCombos: number;
  rootEqIp: number;
  rootEqOop: number;
  rootEvIp: number;
  rootEvOop: number;
  startingPot: number;
}


interface SolverEventHandlers {
  onError?: (message: string) => void;
  onLog?: (message: string) => void;
  onMemoryAllocated?: () => void;
  onProgress?: (progress: ProgressPoint) => void;
  onExtracting?: () => void;
  onUploading?: () => void;
  onDone?: (result: { exploitability: number; spotId: string | null }) => void;
  onSolverError?: (error: { phase: string; message: string }) => void;
}

interface SolverLogPayload {
  message?: string;
}

export class DesktopSolverClient {
  private unlisteners: UnlistenFn[] = [];

  async listen(handlers: SolverEventHandlers) {
    await this.dispose();

    this.unlisteners = await Promise.all([
      listen<SolverLogPayload>("solver_log", (event) => {
        handlers.onLog?.(event.payload.message ?? "");
      }),
      listen<ProgressPoint>("solver_progress", (event) => {
        handlers.onProgress?.(event.payload);
      }),
      listen("solver_memory_allocated", () => {
        handlers.onMemoryAllocated?.();
      }),
      listen<SolverLogPayload>("solver_error", (event) => {
        handlers.onError?.(event.payload.message ?? "Unknown solver error");
      }),
      listen("solver_extracting", () => {
        handlers.onExtracting?.();
      }),
      listen("solver_uploading", () => {
        handlers.onUploading?.();
      }),
      listen<{ exploitability: number; spotId: string | null }>("solver_done", (event) => {
        handlers.onDone?.(event.payload);
      }),
      listen<{ phase: string; message: string }>("solver_error", (event) => {
        if (event.payload.phase) {
          handlers.onSolverError?.(event.payload);
        }
      }),
    ]);
  }

  async init(config: SolverConfig): Promise<InitResult> {
    return invoke<InitResult>("solver_init", { config });
  }

  async solve(
    maxIterations: number,
    targetExploitability: number,
    exploitabilityInterval: number
  ): Promise<SolveDone> {
    return invoke<SolveDone>("solver_solve", {
      exploitabilityInterval,
      maxIterations,
      targetExploitability,
    });
  }

  async cancel() {
    await invoke("solver_cancel");
  }

  async getResults(history: number[]): Promise<SolveResults> {
    return invoke<SolveResults>("solver_get_results", { history });
  }

  async lockCurrentNode(history: number[], strategy: number[]) {
    await invoke("solver_lock_current_node", { history, strategy });
  }

  async unlockCurrentNode(history: number[]) {
    await invoke("solver_unlock_current_node", { history });
  }

  async saveLocalMetadata(fileName: string, metadata: unknown): Promise<LocalSolveMetadata> {
    return invoke<LocalSolveMetadata>("solver_save_local_metadata", { fileName, metadata });
  }

  async listLocalMetadata(): Promise<LocalSolveMetadata[]> {
    return invoke<LocalSolveMetadata[]>("solver_list_local_metadata");
  }

  async gameInfo(): Promise<GameInfo | null> {
    return invoke<GameInfo | null>("solver_game_info");
  }

  async extractTree(): Promise<SolveResults[]> {
    return invoke<SolveResults[]>("solver_extract_tree");
  }

  async start(config: SolverStartConfig): Promise<{ started: boolean }> {
    return invoke<{ started: boolean }>("solver_start", { config });
  }

  async setConfig(config: SolveConfig): Promise<void> {
    await invoke("solver_set_config", { config });
  }

  async getConfig(): Promise<SolveConfig | null> {
    return invoke<SolveConfig | null>("solver_get_config");
  }

  async status(): Promise<SolverStatus> {
    return invoke<SolverStatus>("solver_status");
  }

  async dispose() {
    this.unlisteners.forEach((unlisten) => unlisten());
    this.unlisteners = [];
  }
}
