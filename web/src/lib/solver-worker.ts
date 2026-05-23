import init, { GameManager } from "./solver_wasm";

let game: GameManager | null = null;

const MB = 1024 * 1024;
const AUTO_COMPRESSION_THRESHOLD_MB = 3072;
const MAX_WASM_MEMORY_MB = 3900;

function formatMemory(bytes: number): string {
  return `${(bytes / MB).toFixed(0)} MB`;
}

type WorkerMessage =
  | { type: "init"; config: SolverConfig }
  | { type: "lock_current_node"; history?: number[]; strategy: number[] }
  | { type: "solve"; maxIterations: number; targetExploitability: number }
  | { type: "unlock_current_node"; history?: number[] }
  | { type: "get_results"; history: number[] }
  | { type: "get_strategy"; history: number[] };

interface SolverConfig {
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
}

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const msg = e.data;

  if (msg.type === "init") {
    try {
      await init("/solver_wasm_bg.wasm");
      game = new GameManager();
      const c = msg.config;
      game.init(
        c.oopRange,
        c.ipRange,
        new Uint8Array(c.board),
        c.startingPot,
        c.effectiveStack,
        c.rakeRate,
        c.rakeCap,
        c.oopFlopBet,
        c.oopFlopRaise,
        c.ipFlopBet,
        c.ipFlopRaise,
        c.oopTurnBet,
        c.oopTurnRaise,
        c.ipTurnBet,
        c.ipTurnRaise,
        c.oopRiverBet,
        c.oopRiverRaise,
        c.ipRiverBet,
        c.ipRiverRaise,
        c.addAllinThreshold,
        c.forceAllinThreshold,
        c.mergingThreshold
      );
      const memoryUsage = Number(game.memory_usage(false)[0]);
      const memoryUsageCompressed = Number(game.memory_usage(true)[0]);
      const enableCompression = memoryUsage / MB > AUTO_COMPRESSION_THRESHOLD_MB;
      const selectedMemoryUsage = enableCompression ? memoryUsageCompressed : memoryUsage;

      self.postMessage({
        type: "log",
        message: `Memory estimate: ${formatMemory(memoryUsage)} uncompressed, ${formatMemory(memoryUsageCompressed)} compressed`,
      });
      if (enableCompression) {
        self.postMessage({
          type: "log",
          message: `Using compressed storage because the uncompressed tree is larger than ${AUTO_COMPRESSION_THRESHOLD_MB} MB.`,
        });
      }
      if (selectedMemoryUsage / MB > MAX_WASM_MEMORY_MB) {
        throw new Error(
          `Tree is too large for browser memory (${formatMemory(selectedMemoryUsage)} ${enableCompression ? "compressed" : "uncompressed"}). Disable some bet/raise sizes or use narrower ranges.`
        );
      }
      self.postMessage({
        type: "init_done",
        memoryUsageMB: selectedMemoryUsage / MB,
        memoryUsageUncompressedMB: memoryUsage / MB,
        memoryUsageCompressedMB: memoryUsageCompressed / MB,
        enableCompression,
      });

      game.allocate_memory(enableCompression);
      self.postMessage({ type: "memory_allocated" });
    } catch (err) {
      self.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (msg.type === "solve") {
    if (!game) {
      self.postMessage({ type: "error", message: "Game not initialized" });
      return;
    }
    const { maxIterations, targetExploitability } = msg;

    for (let i = 0; i < maxIterations; i++) {
      game.solve_step(i);

      if (i % 10 === 0) {
        const exploitability = game.exploitability();
        self.postMessage({
          type: "progress",
          iteration: i,
          exploitability,
        });
        if (exploitability <= targetExploitability) {
          break;
        }
      }
    }

    game.finalize();
    const exploitability = game.exploitability();
    self.postMessage({
      type: "solve_done",
      exploitability,
    });
  }

  if (msg.type === "lock_current_node") {
    if (!game) {
      self.postMessage({ type: "error", message: "Game not initialized" });
      return;
    }

    try {
      game.apply_history(new Uint32Array(msg.history ?? []));
      game.lock_current_strategy(new Float32Array(msg.strategy));
      game.back_to_root();
      self.postMessage({ type: "locked_done" });
    } catch (err) {
      self.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (msg.type === "unlock_current_node") {
    if (!game) {
      self.postMessage({ type: "error", message: "Game not initialized" });
      return;
    }

    try {
      game.apply_history(new Uint32Array(msg.history ?? []));
      game.unlock_current_node();
      game.back_to_root();
      self.postMessage({ type: "unlocked_done" });
    } catch (err) {
      self.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (msg.type === "get_results") {
    if (!game) return;
    try {
      game.apply_history(new Uint32Array(msg.history));
      const player = game.current_player();
      const playerIndex = player === "ip" ? 1 : 0;
      const isTerminal = game.is_terminal_node();
      const isChance = game.is_chance_node();
      const strategy = !isTerminal && !isChance ? Array.from(game.strategy()) : [];
      const actions = game.actions();
      const numActions = game.num_actions();
      const privateCards = !isTerminal && !isChance ? Array.from(game.private_cards(playerIndex)) : [];
      const currentBoard = Array.from(game.current_board());
      const possibleCards = Array.from(game.possible_cards());
      const totalBetAmount = Array.from(game.total_bet_amount());

      game.back_to_root();
      const rootEvOop = game.root_ev(0);
      const rootEvIp = game.root_ev(1);
      const rootEqOop = game.root_equity(0);
      const rootEqIp = game.root_equity(1);

      self.postMessage({
        type: "results",
        history: msg.history,
        strategy,
        actions,
        numActions,
        player,
        privateCards,
        currentBoard,
        isTerminal,
        isChance,
        possibleCards,
        totalBetAmount,
        rootEvOop,
        rootEvIp,
        rootEqOop,
        rootEqIp,
      });
    } catch (err) {
      self.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
