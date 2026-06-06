use postflop_solver::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};

const MB: f64 = 1024.0 * 1024.0;
const AUTO_UNCOMPRESSED_LIMIT_MB: f64 = 8192.0;
const FORCE_UNCOMPRESSED_LIMIT_MB: f64 = 12288.0;

#[derive(Default)]
pub struct SolverState {
    game: Mutex<Option<PostFlopGame>>,
    cancel_requested: AtomicBool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverConfig {
    oop_range: String,
    ip_range: String,
    board: Vec<u8>,
    starting_pot: i32,
    effective_stack: i32,
    rake_rate: f64,
    rake_cap: f64,
    oop_flop_bet: String,
    oop_flop_raise: String,
    ip_flop_bet: String,
    ip_flop_raise: String,
    oop_turn_bet: String,
    oop_turn_raise: String,
    ip_turn_bet: String,
    ip_turn_raise: String,
    oop_river_bet: String,
    oop_river_raise: String,
    ip_river_bet: String,
    ip_river_raise: String,
    add_allin_threshold: f64,
    force_allin_threshold: f64,
    merging_threshold: f64,
    storage_mode: StorageMode,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum StorageMode {
    Auto,
    PreferMemory,
    PreferSpeed,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitResult {
    memory_usage_mb: f64,
    memory_usage_uncompressed_mb: f64,
    memory_usage_compressed_mb: f64,
    enable_compression: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    iteration: u32,
    exploitability: Option<f32>,
    phase: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolveDone {
    exploitability: f32,
    cancelled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelResult {
    cancelled: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSolveMetadata {
    file_name: String,
    metadata: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolveResults {
    actions: String,
    current_board: Vec<u8>,
    history: Vec<usize>,
    is_chance: bool,
    is_terminal: bool,
    num_actions: usize,
    player: String,
    possible_cards: Vec<u8>,
    private_cards: Vec<u16>,
    root_eq_ip: f32,
    root_eq_oop: f32,
    root_ev_ip: f32,
    root_ev_oop: f32,
    strategy: Vec<f32>,
    total_bet_amount: Vec<i32>,
}

#[derive(Debug, Serialize, Clone)]
struct LogEvent {
    message: String,
}

#[tauri::command]
pub async fn solver_init(app: AppHandle, config: SolverConfig) -> Result<InitResult, String> {
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let emit_app = app_for_task.clone();
        let state = app_for_task.state::<SolverState>();
        solver_init_blocking(emit_app, state.inner(), config)
    })
    .await
    .map_err(|err| err.to_string())?
}

fn solver_init_blocking(
    app: AppHandle,
    state: &SolverState,
    config: SolverConfig,
) -> Result<InitResult, String> {
    let started = Instant::now();
    state.cancel_requested.store(false, Ordering::SeqCst);
    let storage_mode = config.storage_mode;

    emit_log(&app, "solver_init: received config from UI".to_string());
    let mut game = build_game(&app, config)?;
    emit_log(
        &app,
        format!(
            "solver_init: game tree built in {:.1}s",
            started.elapsed().as_secs_f32()
        ),
    );

    let (memory_usage, memory_usage_compressed) = game.memory_usage();
    let memory_usage_mb = memory_usage as f64 / MB;
    let enable_compression = match storage_mode {
        StorageMode::Auto => memory_usage_mb > AUTO_UNCOMPRESSED_LIMIT_MB,
        StorageMode::PreferMemory => true,
        StorageMode::PreferSpeed => {
            if memory_usage_mb > FORCE_UNCOMPRESSED_LIMIT_MB {
                emit_log(
                    &app,
                    format!(
                        "Prefer speed requested, but uncompressed storage is {:.0} MB. Using compressed storage because it exceeds the {:.0} MB safety cap.",
                        memory_usage_mb, FORCE_UNCOMPRESSED_LIMIT_MB
                    ),
                );
                true
            } else {
                false
            }
        }
    };
    let selected_memory_usage = if enable_compression {
        memory_usage_compressed
    } else {
        memory_usage
    };

    emit_log(
        &app,
        format!(
            "Memory estimate: {:.0} MB uncompressed, {:.0} MB compressed",
            memory_usage_mb,
            memory_usage_compressed as f64 / MB
        ),
    );
    if enable_compression {
        emit_log(
            &app,
            format!("Using compressed storage. Mode: {:?}.", storage_mode),
        );
    } else {
        emit_log(
            &app,
            format!("Using uncompressed storage. Mode: {:?}.", storage_mode),
        );
    }

    emit_log(&app, "solver_init: allocating solver memory".to_string());
    let allocation_started = Instant::now();
    game.allocate_memory(enable_compression);
    emit_log(
        &app,
        format!(
            "solver_init: memory allocated in {:.1}s",
            allocation_started.elapsed().as_secs_f32()
        ),
    );
    app.emit("solver_memory_allocated", ())
        .map_err(|err| err.to_string())?;

    let result = InitResult {
        memory_usage_mb: selected_memory_usage as f64 / MB,
        memory_usage_uncompressed_mb: memory_usage as f64 / MB,
        memory_usage_compressed_mb: memory_usage_compressed as f64 / MB,
        enable_compression,
    };

    *state
        .game
        .lock()
        .map_err(|_| "Solver lock poisoned".to_string())? = Some(game);
    emit_log(
        &app,
        format!(
            "solver_init: complete in {:.1}s",
            started.elapsed().as_secs_f32()
        ),
    );
    Ok(result)
}

#[tauri::command]
pub async fn solver_solve(
    app: AppHandle,
    max_iterations: u32,
    target_exploitability: f32,
    exploitability_interval: u32,
) -> Result<SolveDone, String> {
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let emit_app = app_for_task.clone();
        let state = app_for_task.state::<SolverState>();
        solver_solve_blocking(
            emit_app,
            state.inner(),
            max_iterations,
            target_exploitability,
            exploitability_interval,
        )
    })
    .await
    .map_err(|err| err.to_string())?
}

fn solver_solve_blocking(
    app: AppHandle,
    state: &SolverState,
    max_iterations: u32,
    target_exploitability: f32,
    exploitability_interval: u32,
) -> Result<SolveDone, String> {
    let started = Instant::now();
    state.cancel_requested.store(false, Ordering::SeqCst);
    emit_log(
        &app,
        format!(
            "solver_solve: starting {max_iterations} iterations, target exploitability {:.4}, exploitability interval {}",
            target_exploitability,
            exploitability_interval.max(1)
        ),
    );
    let mut guard = state
        .game
        .lock()
        .map_err(|_| "Solver lock poisoned".to_string())?;
    let game = guard
        .as_mut()
        .ok_or_else(|| "Game not initialized".to_string())?;

    let mut last_exploitability = f32::INFINITY;
    let mut cancelled = false;
    let exploitability_interval = exploitability_interval.max(1);

    for iteration in 0..max_iterations {
        if state.cancel_requested.load(Ordering::SeqCst) {
            cancelled = true;
            emit_log(
                &app,
                format!("solver_solve: cancellation observed at iteration {iteration}"),
            );
            break;
        }

        solve_step(game, iteration);
        let completed_iteration = iteration + 1;
        app.emit(
            "solver_progress",
            ProgressEvent {
                iteration: completed_iteration,
                exploitability: None,
                phase: "iterationComplete".to_string(),
            },
        )
        .map_err(|err| err.to_string())?;

        if completed_iteration % exploitability_interval == 0
            || completed_iteration == max_iterations
        {
            emit_log(
                &app,
                format!(
                    "solver_solve: computing exploitability at iteration {completed_iteration}"
                ),
            );
            last_exploitability = compute_exploitability(game);
            app.emit(
                "solver_progress",
                ProgressEvent {
                    iteration: completed_iteration,
                    exploitability: Some(last_exploitability),
                    phase: "exploitability".to_string(),
                },
            )
            .map_err(|err| err.to_string())?;

            if last_exploitability <= target_exploitability {
                break;
            }
        }
    }

    if !cancelled {
        emit_log(&app, "solver_solve: finalizing strategy".to_string());
        finalize(game);
        emit_log(
            &app,
            "solver_solve: computing final exploitability".to_string(),
        );
        last_exploitability = compute_exploitability(game);
    }

    emit_log(
        &app,
        format!(
            "solver_solve: complete in {:.1}s{}",
            started.elapsed().as_secs_f32(),
            if cancelled { " (cancelled)" } else { "" }
        ),
    );

    Ok(SolveDone {
        exploitability: last_exploitability,
        cancelled,
    })
}

#[tauri::command]
pub fn solver_cancel(state: State<'_, SolverState>) -> CancelResult {
    state.cancel_requested.store(true, Ordering::SeqCst);
    CancelResult { cancelled: true }
}

#[tauri::command]
pub fn solver_get_results(
    state: State<'_, SolverState>,
    history: Vec<usize>,
) -> Result<SolveResults, String> {
    with_game(state.inner(), |game| {
        apply_history(game, &history);

        let player = current_player(game);
        let player_index = if player == "ip" { 1 } else { 0 };
        let is_terminal = game.is_terminal_node();
        let is_chance = game.is_chance_node();
        let strategy = if !is_terminal && !is_chance {
            game.strategy().to_vec()
        } else {
            Vec::new()
        };
        let actions = if !is_terminal && !is_chance {
            game.available_actions()
                .iter()
                .map(|action| format!("{action:?}"))
                .collect::<Vec<_>>()
                .join(",")
        } else {
            String::new()
        };
        let num_actions = if !is_terminal && !is_chance {
            game.available_actions().len()
        } else {
            0
        };
        let private_cards = if !is_terminal && !is_chance {
            private_cards(game, player_index)
        } else {
            Vec::new()
        };
        let current_board = game.current_board();
        let possible_cards = possible_cards(game);
        let total_bet_amount = game.total_bet_amount().to_vec();

        game.back_to_root();
        let (root_ev_oop, root_eq_oop) = root_values(game, 0);
        let (root_ev_ip, root_eq_ip) = root_values(game, 1);

        Ok(SolveResults {
            actions,
            current_board,
            history,
            is_chance,
            is_terminal,
            num_actions,
            player,
            possible_cards,
            private_cards,
            root_eq_ip,
            root_eq_oop,
            root_ev_ip,
            root_ev_oop,
            strategy,
            total_bet_amount,
        })
    })
}

#[tauri::command]
pub fn solver_lock_current_node(
    state: State<'_, SolverState>,
    history: Vec<usize>,
    strategy: Vec<f32>,
) -> Result<(), String> {
    with_game(state.inner(), |game| {
        apply_history(game, &history);
        game.lock_current_strategy(&strategy);
        game.back_to_root();
        Ok(())
    })
}

#[tauri::command]
pub fn solver_unlock_current_node(
    state: State<'_, SolverState>,
    history: Vec<usize>,
) -> Result<(), String> {
    with_game(state.inner(), |game| {
        apply_history(game, &history);
        game.unlock_current_strategy();
        game.back_to_root();
        Ok(())
    })
}

#[tauri::command]
pub fn solver_save_local_metadata(
    app: AppHandle,
    file_name: String,
    metadata: Value,
) -> Result<LocalSolveMetadata, String> {
    let sanitized = sanitize_file_name(&file_name)?;
    let dir = local_metadata_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;

    let item = LocalSolveMetadata {
        file_name: sanitized,
        metadata,
    };
    let path = dir.join(&item.file_name);
    let bytes = serde_json::to_vec_pretty(&item).map_err(|err| err.to_string())?;
    fs::write(path, bytes).map_err(|err| err.to_string())?;
    Ok(item)
}

#[tauri::command]
pub fn solver_list_local_metadata(app: AppHandle) -> Result<Vec<LocalSolveMetadata>, String> {
    let dir = local_metadata_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut items = Vec::new();
    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        if entry.file_type().map_err(|err| err.to_string())?.is_file() {
            let bytes = fs::read(entry.path()).map_err(|err| err.to_string())?;
            let item = serde_json::from_slice::<LocalSolveMetadata>(&bytes)
                .map_err(|err| err.to_string())?;
            items.push(item);
        }
    }

    items.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    Ok(items)
}

fn build_game(app: &AppHandle, config: SolverConfig) -> Result<PostFlopGame, String> {
    if config.board.len() < 3 {
        return Err("Board must include at least three flop cards.".to_string());
    }

    emit_log(app, "build_game: parsing ranges".to_string());
    let oop: Range = config.oop_range.parse()?;
    let ip: Range = config.ip_range.parse()?;
    let mut flop = [0u8; 3];
    flop.copy_from_slice(&config.board[..3]);
    let turn = config.board.get(3).copied().unwrap_or(NOT_DEALT);
    let river = config.board.get(4).copied().unwrap_or(NOT_DEALT);

    let card_config = CardConfig {
        range: [oop, ip],
        flop,
        turn,
        river,
    };

    let initial_state = match config.board.len() {
        3 => BoardState::Flop,
        4 => BoardState::Turn,
        _ => BoardState::River,
    };

    emit_log(app, "build_game: parsing bet and raise sizes".to_string());
    let flop_bet_sizes = [
        BetSizeOptions::try_from((config.oop_flop_bet.as_str(), config.oop_flop_raise.as_str()))?,
        BetSizeOptions::try_from((config.ip_flop_bet.as_str(), config.ip_flop_raise.as_str()))?,
    ];
    let turn_bet_sizes = [
        BetSizeOptions::try_from((config.oop_turn_bet.as_str(), config.oop_turn_raise.as_str()))?,
        BetSizeOptions::try_from((config.ip_turn_bet.as_str(), config.ip_turn_raise.as_str()))?,
    ];
    let river_bet_sizes = [
        BetSizeOptions::try_from((
            config.oop_river_bet.as_str(),
            config.oop_river_raise.as_str(),
        ))?,
        BetSizeOptions::try_from((config.ip_river_bet.as_str(), config.ip_river_raise.as_str()))?,
    ];

    let tree_config = TreeConfig {
        initial_state,
        starting_pot: config.starting_pot,
        effective_stack: config.effective_stack,
        rake_rate: config.rake_rate,
        rake_cap: config.rake_cap,
        flop_bet_sizes,
        turn_bet_sizes,
        river_bet_sizes,
        turn_donk_sizes: None,
        river_donk_sizes: None,
        add_allin_threshold: config.add_allin_threshold,
        force_allin_threshold: config.force_allin_threshold,
        merging_threshold: config.merging_threshold,
    };

    emit_log(app, "build_game: constructing action tree".to_string());
    let action_tree = ActionTree::new(tree_config)?;
    emit_log(app, "build_game: constructing postflop game".to_string());
    PostFlopGame::with_config(card_config, action_tree)
}

fn with_game<T>(
    state: &SolverState,
    f: impl FnOnce(&mut PostFlopGame) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .game
        .lock()
        .map_err(|_| "Solver lock poisoned".to_string())?;
    let game = guard
        .as_mut()
        .ok_or_else(|| "Game not initialized".to_string())?;
    f(game)
}

fn apply_history(game: &mut PostFlopGame, history: &[usize]) {
    game.back_to_root();
    for &action in history {
        game.play(action);
    }
}

fn current_player(game: &PostFlopGame) -> String {
    if game.is_chance_node() {
        "chance".to_string()
    } else if game.current_player() == 0 {
        "oop".to_string()
    } else {
        "ip".to_string()
    }
}

fn private_cards(game: &PostFlopGame, player: usize) -> Vec<u16> {
    game.private_cards(player)
        .iter()
        .flat_map(|(c1, c2)| [*c1 as u16, *c2 as u16])
        .collect()
}

fn possible_cards(game: &PostFlopGame) -> Vec<u8> {
    let mask = game.possible_cards();
    (0u8..52)
        .filter(|&card| mask & (1u64 << card) != 0)
        .collect()
}

fn root_values(game: &mut PostFlopGame, player: usize) -> (f32, f32) {
    game.cache_normalized_weights();
    let ev = game.expected_values(player);
    let eq = game.equity(player);
    let weights = game.normalized_weights(player);
    (compute_average(&ev, weights), compute_average(&eq, weights))
}

fn emit_log(app: &AppHandle, message: String) {
    let _ = app.emit("solver_log", LogEvent { message });
}

fn local_metadata_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("solve-metadata"))
}

/// Information about the currently loaded game (if any).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    board: Vec<u8>,
    starting_pot: i32,
    effective_stack: i32,
    is_solved: bool,
    num_oop_combos: usize,
    num_ip_combos: usize,
    root_ev_oop: f32,
    root_ev_ip: f32,
    root_eq_oop: f32,
    root_eq_ip: f32,
}

#[tauri::command]
pub fn solver_game_info(state: State<'_, SolverState>) -> Result<Option<GameInfo>, String> {
    let mut guard = state
        .game
        .lock()
        .map_err(|_| "Solver lock poisoned".to_string())?;
    let game = match guard.as_mut() {
        Some(g) => g,
        None => return Ok(None),
    };

    let card_config = game.card_config();
    let tree_config = game.tree_config();
    let mut board: Vec<u8> = card_config.flop.to_vec();
    if card_config.turn != NOT_DEALT {
        board.push(card_config.turn);
    }
    if card_config.river != NOT_DEALT {
        board.push(card_config.river);
    }
    let starting_pot = tree_config.starting_pot;
    let effective_stack = tree_config.effective_stack;
    let is_solved = game.is_solved();
    let num_oop_combos = game.private_cards(0).len();
    let num_ip_combos = game.private_cards(1).len();

    let (root_ev_oop, root_eq_oop, root_ev_ip, root_eq_ip) = if is_solved {
        game.back_to_root();
        let (ev_oop, eq_oop) = root_values(game, 0);
        let (ev_ip, eq_ip) = root_values(game, 1);
        (ev_oop, eq_oop, ev_ip, eq_ip)
    } else {
        (0.0, 0.0, 0.0, 0.0)
    };

    Ok(Some(GameInfo {
        board,
        starting_pot,
        effective_stack,
        is_solved,
        num_oop_combos,
        num_ip_combos,
        root_ev_oop,
        root_ev_ip,
        root_eq_oop,
        root_eq_ip,
    }))
}

/// Extract the full solved tree as a flat list of nodes for the simulator.
/// Each node contains the history path, the SolveResults, and the node type.
#[tauri::command]
pub async fn solver_extract_tree(app: AppHandle) -> Result<Vec<SolveResults>, String> {
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let emit_app = app_for_task.clone();
        let state = app_for_task.state::<SolverState>();
        solver_extract_tree_blocking(emit_app, state.inner())
    })
    .await
    .map_err(|err| err.to_string())?
}

fn solver_extract_tree_blocking(
    app: AppHandle,
    state: &SolverState,
) -> Result<Vec<SolveResults>, String> {
    let started = Instant::now();
    let mut guard = state
        .game
        .lock()
        .map_err(|_| "Solver lock poisoned".to_string())?;
    let game = guard
        .as_mut()
        .ok_or_else(|| "Game not initialized".to_string())?;

    if !game.is_solved() {
        return Err("Game is not solved yet".to_string());
    }

    // Compute root values once
    game.back_to_root();
    let (root_ev_oop, root_eq_oop) = root_values(game, 0);
    let (root_ev_ip, root_eq_ip) = root_values(game, 1);

    let mut nodes: Vec<SolveResults> = Vec::new();
    let mut stack: Vec<Vec<usize>> = vec![vec![]]; // histories to visit

    emit_log(&app, "extract_tree: starting DFS".to_string());

    while let Some(history) = stack.pop() {
        apply_history(game, &history);

        let is_terminal = game.is_terminal_node();
        let is_chance = game.is_chance_node();

        if is_chance {
            // Enumerate possible cards and push child histories
            let mask = game.possible_cards();
            for card in 0u8..52 {
                if mask & (1u64 << card) != 0 {
                    let mut child_history = history.clone();
                    child_history.push(card as usize);
                    stack.push(child_history);
                }
            }
            continue;
        }

        if is_terminal {
            continue;
        }

        // Player decision node — extract results
        let player = current_player(game);
        let player_index = if player == "ip" { 1 } else { 0 };
        let strategy = game.strategy().to_vec();
        let actions = game
            .available_actions()
            .iter()
            .map(|action| format!("{action:?}"))
            .collect::<Vec<_>>()
            .join(",");
        let num_actions = game.available_actions().len();
        let pc = private_cards(game, player_index);
        let current_board = game.current_board();
        let pc_possible = possible_cards(game);
        let total_bet = game.total_bet_amount().to_vec();

        nodes.push(SolveResults {
            actions,
            current_board,
            history: history.clone(),
            is_chance: false,
            is_terminal: false,
            num_actions,
            player,
            possible_cards: pc_possible,
            private_cards: pc,
            root_eq_ip,
            root_eq_oop,
            root_ev_ip,
            root_ev_oop,
            strategy,
            total_bet_amount: total_bet,
        });

        // Push child histories for each action
        for action_idx in (0..num_actions).rev() {
            let mut child_history = history.clone();
            child_history.push(action_idx);
            stack.push(child_history);
        }
    }

    game.back_to_root();

    emit_log(
        &app,
        format!(
            "extract_tree: extracted {} nodes in {:.1}s",
            nodes.len(),
            started.elapsed().as_secs_f32()
        ),
    );

    Ok(nodes)
}

fn sanitize_file_name(file_name: &str) -> Result<String, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        return Err("Metadata file name cannot be empty.".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed == "." || trimmed == ".." {
        return Err("Metadata file name must not contain path separators.".to_string());
    }
    if !trimmed.ends_with(".json") {
        return Ok(format!("{trimmed}.json"));
    }
    Ok(trimmed.to_string())
}
