let game = null;
let wasm = null;

function formatTraversalStats(label, rawStats) {
  const s = Array.from(rawStats, Number);
  const [
    parCalls,
    parItems,
    parChanceCalls,
    parChanceItems,
    parActionCalls,
    parActionItems,
    seqCalls,
    seqItems,
    seqChanceCalls,
    seqChanceItems,
    seqActionCalls,
    seqActionItems,
    maxParWidth,
    maxSeqWidth,
  ] = s;
  const totalCalls = parCalls + seqCalls;
  const totalItems = parItems + seqItems;
  const parCallPct = totalCalls > 0 ? (parCalls / totalCalls) * 100 : 0;
  const parItemPct = totalItems > 0 ? (parItems / totalItems) * 100 : 0;

  return `${label}: par=${parCalls}/${totalCalls} calls (${parCallPct.toFixed(1)}%), par_items=${parItems}/${totalItems} (${parItemPct.toFixed(1)}%), chance par/seq=${parChanceCalls}/${seqChanceCalls} calls (${parChanceItems}/${seqChanceItems} items), action par/seq=${parActionCalls}/${seqActionCalls} calls (${parActionItems}/${seqActionItems} items), max_width par/seq=${maxParWidth}/${maxSeqWidth}`;
}

self.onmessage = async function (e) {
  const msg = e.data;

  if (msg.type === "init") {
    try {
      wasm = await import("/solver_wasm.js");
      await wasm.default("/solver_wasm_bg.wasm");

      self.postMessage({ type: "log", message: `crossOriginIsolated: ${self.crossOriginIsolated}` });
      self.postMessage({ type: "log", message: `Memory buffer type: ${wasm.default.__wbindgen_wasm_module ? 'has module' : 'no module'}` });

      const mem = wasm.__wbg_get_wasm?.()?.memory;
      if (mem) {
        self.postMessage({ type: "log", message: `Memory is SharedArrayBuffer: ${mem.buffer instanceof SharedArrayBuffer}` });
      }

      const numThreads = navigator.hardwareConcurrency || 4;
      self.postMessage({ type: "log", message: `Initializing ${numThreads} threads...` });
      const t0 = performance.now();
      await wasm.initThreadPool(numThreads);
      self.postMessage({ type: "log", message: `Thread pool ready (${numThreads} threads) in ${(performance.now() - t0).toFixed(0)}ms` });

      const diag = wasm.testRayon();
      self.postMessage({ type: "log", message: `Rayon diag: global_threads=${diag[0]}, sum=${diag[1]}` });

      game = new wasm.GameManager();
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

      self.postMessage({
        type: "log",
        message: `Memory estimate: ${(memoryUsage / 1024 / 1024).toFixed(0)} MB`,
      });
      self.postMessage({
        type: "init_done",
        memoryUsageMB: memoryUsage / (1024 * 1024),
      });

      game.allocate_memory(false);
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

    try {
      for (let i = 0; i < maxIterations; i++) {
        game.reset_traversal_stats();
        const t0 = performance.now();
        game.solve_step(i);
        const stepMs = performance.now() - t0;
        const stepStats = game.traversal_stats();

        if (i % 10 === 0) {
          game.reset_traversal_stats();
          const t1 = performance.now();
          const exploitability = game.exploitability();
          const explMs = performance.now() - t1;
          const explStats = game.traversal_stats();
          self.postMessage({
            type: "progress",
            iteration: i,
            exploitability,
          });
          self.postMessage({
            type: "log",
            message: `  timing: solve_step=${stepMs.toFixed(0)}ms, exploitability=${explMs.toFixed(0)}ms`,
          });
          self.postMessage({
            type: "log",
            message: `  traversal: ${formatTraversalStats("solve_step", stepStats)}`,
          });
          self.postMessage({
            type: "log",
            message: `  traversal: ${formatTraversalStats("exploitability", explStats)}`,
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
    } catch (err) {
      self.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
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
