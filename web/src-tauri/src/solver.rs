use postflop_solver::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::cloud;

const MB: f64 = 1024.0 * 1024.0;
const AUTO_UNCOMPRESSED_LIMIT_MB: f64 = 8192.0;
const FORCE_UNCOMPRESSED_LIMIT_MB: f64 = 12288.0;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum SolverPhase {
    Idle,
    Solving {
        iteration: u32,
        max_iterations: u32,
        exploitability: Option<f32>,
    },
    Extracting,
    Uploading,
    Done {
        exploitability: f32,
        spot_id: Option<String>,
    },
    Error {
        phase: String,
        message: String,
    },
}

impl Default for SolverPhase {
    fn default() -> Self {
        SolverPhase::Idle
    }
}

// ---------------------------------------------------------------------------
// Core state
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct SolverState {
    game: Mutex<Option<PostFlopGame>>,
    cancel_requested: AtomicBool,
    phase: Mutex<SolverPhase>,
    config: Mutex<Option<SolveConfig>>,
    root_values: Mutex<Option<RootValues>>,
}

// ---------------------------------------------------------------------------
// Persistent frontend config
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolveConfig {
    pub board: Vec<String>,
    pub oop_range: String,
    pub ip_range: String,
    pub oop_position: String,
    pub ip_position: String,
    pub game_type: String,
    pub pot_type: String,
    pub starting_pot: i32,
    pub effective_stack: i32,
    pub tree_config: serde_json::Value,
    pub max_iterations: u32,
    pub target_exploitability: f32,
}

// ---------------------------------------------------------------------------
// Cached root values
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RootValues {
    ev_oop: f32,
    eq_oop: f32,
    ev_ip: f32,
    eq_ip: f32,
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverStatus {
    pub phase: SolverPhase,
    pub initialized: bool,
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

#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    started: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverStartConfig {
    pub max_iterations: u32,
    pub target_exploitability: f32,
    pub exploitability_interval: u32,
    // Cloud upload config (optional)
    pub supabase_url: Option<String>,
    pub supabase_anon_key: Option<String>,
    // Spot metadata for cloud save
    pub spot_metadata: Option<serde_json::Value>,
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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

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

#[tauri::command]
pub async fn solver_start(
    app: AppHandle,
    config: SolverStartConfig,
) -> Result<StartResult, String> {
    // Atomically check phase and set to Solving to prevent TOCTOU race
    {
        let state = app.state::<SolverState>();
        let mut phase = state.phase.lock().map_err(|e| e.to_string())?;
        if matches!(
            *phase,
            SolverPhase::Solving { .. } | SolverPhase::Extracting | SolverPhase::Uploading
        ) {
            return Err("Solver is already running".to_string());
        }
        // Set phase immediately while holding the lock to prevent double-start
        *phase = SolverPhase::Solving {
            iteration: 0,
            max_iterations: config.max_iterations,
            exploitability: None,
        };
    }

    // Spawn background thread -- returns immediately
    let app_clone = app.clone();
    std::thread::spawn(move || {
        solver_pipeline(app_clone, config);
    });

    Ok(StartResult { started: true })
}

#[tauri::command]
pub fn solver_status(state: State<'_, SolverState>) -> SolverStatus {
    let initialized = state
        .game
        .try_lock()
        .map(|g| g.is_some())
        .unwrap_or(true); // assume initialized if lock is held
    let phase = state
        .phase
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    SolverStatus { phase, initialized }
}

#[tauri::command]
pub fn solver_cancel(state: State<'_, SolverState>) -> CancelResult {
    state.cancel_requested.store(true, Ordering::SeqCst);
    CancelResult { cancelled: true }
}

#[tauri::command]
pub fn solver_set_config(
    state: State<'_, SolverState>,
    config: SolveConfig,
) -> Result<(), String> {
    *state.config.lock().map_err(|e| e.to_string())? = Some(config);
    Ok(())
}

#[tauri::command]
pub fn solver_get_config(
    state: State<'_, SolverState>,
) -> Result<Option<SolveConfig>, String> {
    Ok(state.config.lock().map_err(|e| e.to_string())?.clone())
}

#[tauri::command]
pub fn solver_get_results(
    state: State<'_, SolverState>,
    history: Vec<usize>,
) -> Result<SolveResults, String> {
    // Try to read cached root values first
    let cached_rv = state
        .root_values
        .lock()
        .ok()
        .and_then(|g| g.clone());

    try_with_game(state.inner(), |game| {
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

        let (actions, num_actions) = if !is_terminal && !is_chance {
            let available = game.available_actions();
            let n = available.len();
            let a = available
                .iter()
                .map(|action| format!("{action:?}"))
                .collect::<Vec<_>>()
                .join(",");
            (a, n)
        } else {
            (String::new(), 0)
        };

        let private_cards = if !is_terminal && !is_chance {
            private_cards(game, player_index)
        } else {
            Vec::new()
        };
        let current_board = game.current_board();
        let possible_cards = possible_cards(game);
        let total_bet_amount = game.total_bet_amount().to_vec();

        // Use cached root values if available, otherwise compute
        let (root_ev_oop, root_eq_oop, root_ev_ip, root_eq_ip) =
            if let Some(rv) = cached_rv.as_ref() {
                (rv.ev_oop, rv.eq_oop, rv.ev_ip, rv.eq_ip)
            } else {
                game.back_to_root();
                let (ev_oop, eq_oop) = root_values(game, 0);
                let (ev_ip, eq_ip) = root_values(game, 1);
                (ev_oop, eq_oop, ev_ip, eq_ip)
            };

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
        // Try cached values first
        let cached = state.root_values.lock().ok().and_then(|g| g.clone());
        if let Some(rv) = cached {
            (rv.ev_oop, rv.eq_oop, rv.ev_ip, rv.eq_ip)
        } else {
            game.back_to_root();
            let (ev_oop, eq_oop) = root_values(game, 0);
            let (ev_ip, eq_ip) = root_values(game, 1);
            (ev_oop, eq_oop, ev_ip, eq_ip)
        }
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

// ---------------------------------------------------------------------------
// Pipeline (runs on a background thread)
// ---------------------------------------------------------------------------

fn solver_pipeline(app: AppHandle, config: SolverStartConfig) {
    let state = app.state::<SolverState>();

    // Phase: Solving
    match solver_solve_blocking(
        &app,
        state.inner(),
        config.max_iterations,
        config.target_exploitability,
        config.exploitability_interval,
    ) {
        Ok(done) => {
            if done.cancelled {
                set_phase(&state, SolverPhase::Idle);
                return;
            }

            // Cache root values
            cache_root_values(state.inner());

            // Only extract + upload if cloud config is provided
            if let (Some(url), Some(key)) = (
                config.supabase_url.as_ref(),
                config.supabase_anon_key.as_ref(),
            ) {
                // Phase: Extracting
                set_phase(&state, SolverPhase::Extracting);
                app.emit("solver_extracting", serde_json::json!({})).ok();

                match solver_extract_tree_blocking_internal(&app, state.inner()) {
                    Ok(nodes_json) => {
                        // Phase: Uploading
                        set_phase(&state, SolverPhase::Uploading);
                        app.emit("solver_uploading", serde_json::json!({})).ok();

                        // Upload tree + upsert spot
                        match cloud::upload_pipeline(
                            url,
                            key,
                            &nodes_json,
                            config.spot_metadata.as_ref(),
                        ) {
                            Ok(spot_id) => {
                                let phase = SolverPhase::Done {
                                    exploitability: done.exploitability,
                                    spot_id: Some(spot_id),
                                };
                                set_phase(&state, phase.clone());
                                app.emit("solver_done", phase).ok();
                            }
                            Err(e) => {
                                // Upload failed but solve succeeded -- still set Done
                                let phase = SolverPhase::Done {
                                    exploitability: done.exploitability,
                                    spot_id: None,
                                };
                                set_phase(&state, phase.clone());
                                emit_log(&app, format!("Cloud upload failed: {e}"));
                                app.emit("solver_done", phase).ok();
                            }
                        }
                    }
                    Err(e) => {
                        let phase = SolverPhase::Error {
                            phase: "extracting".into(),
                            message: e.clone(),
                        };
                        set_phase(&state, phase);
                        app.emit(
                            "solver_error",
                            serde_json::json!({ "phase": "extracting", "message": e }),
                        )
                        .ok();
                    }
                }
            } else {
                let phase = SolverPhase::Done {
                    exploitability: done.exploitability,
                    spot_id: None,
                };
                set_phase(&state, phase.clone());
                app.emit("solver_done", phase).ok();
            }
        }
        Err(e) => {
            let phase = SolverPhase::Error {
                phase: "solving".into(),
                message: e.clone(),
            };
            set_phase(&state, phase);
            app.emit(
                "solver_error",
                serde_json::json!({ "phase": "solving", "message": e }),
            )
            .ok();
        }
    }
}

/// Extracts tree and returns the JSON string for cloud upload.
fn solver_extract_tree_blocking_internal(
    app: &AppHandle,
    state: &SolverState,
) -> Result<String, String> {
    let nodes = solver_extract_tree_blocking(app.clone(), state)?;
    serde_json::to_string(&nodes).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Blocking helpers
// ---------------------------------------------------------------------------

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

    // Clear cached root values since we have a new game
    *state.root_values.lock().map_err(|e| e.to_string())? = None;

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

fn solver_solve_blocking(
    app: &AppHandle,
    state: &SolverState,
    max_iterations: u32,
    target_exploitability: f32,
    exploitability_interval: u32,
) -> Result<SolveDone, String> {
    let started = Instant::now();
    state.cancel_requested.store(false, Ordering::SeqCst);

    // Set initial phase
    set_phase(
        state,
        SolverPhase::Solving {
            iteration: 0,
            max_iterations,
            exploitability: None,
        },
    );

    emit_log(
        app,
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
                app,
                format!("solver_solve: cancellation observed at iteration {iteration}"),
            );
            break;
        }

        solve_step(game, iteration);
        let completed_iteration = iteration + 1;

        // Throttle: emit progress every 10 iterations or on final iteration
        if completed_iteration % 10 == 0 || completed_iteration == max_iterations {
            *state.phase.lock().unwrap() = SolverPhase::Solving {
                iteration: completed_iteration,
                max_iterations,
                exploitability: None,
            };
            app.emit(
                "solver_progress",
                ProgressEvent {
                    iteration: completed_iteration,
                    exploitability: None,
                    phase: "iterationComplete".to_string(),
                },
            )
            .ok();
        }

        if completed_iteration % exploitability_interval == 0
            || completed_iteration == max_iterations
        {
            last_exploitability = compute_exploitability(game);

            *state.phase.lock().unwrap() = SolverPhase::Solving {
                iteration: completed_iteration,
                max_iterations,
                exploitability: Some(last_exploitability),
            };

            app.emit(
                "solver_progress",
                ProgressEvent {
                    iteration: completed_iteration,
                    exploitability: Some(last_exploitability),
                    phase: "exploitability".to_string(),
                },
            )
            .ok();

            if last_exploitability <= target_exploitability {
                break;
            }
        }
    }

    if !cancelled {
        emit_log(app, "solver_solve: finalizing strategy".to_string());
        finalize(game);
        emit_log(
            app,
            "solver_solve: computing final exploitability".to_string(),
        );
        last_exploitability = compute_exploitability(game);
    }

    emit_log(
        app,
        format!(
            "solver_solve: complete in {:.1}s{}",
            started.elapsed().as_secs_f32(),
            if cancelled { " (cancelled)" } else { "" }
        ),
    );

    let done = SolveDone {
        exploitability: last_exploitability,
        cancelled,
    };
    Ok(done)
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

    // Use cached root values if available, otherwise compute
    let cached = state.root_values.lock().ok().and_then(|g| g.clone());
    let (root_ev_oop, root_eq_oop, root_ev_ip, root_eq_ip) = if let Some(rv) = cached {
        (rv.ev_oop, rv.eq_oop, rv.ev_ip, rv.eq_ip)
    } else {
        game.back_to_root();
        let (ev_oop, eq_oop) = root_values(game, 0);
        let (ev_ip, eq_ip) = root_values(game, 1);
        (ev_oop, eq_oop, ev_ip, eq_ip)
    };

    let mut nodes: Vec<SolveResults> = Vec::new();
    let mut stack: Vec<Vec<usize>> = vec![vec![]]; // histories to visit
    let mut current_history: Vec<usize> = vec![];

    emit_log(&app, "extract_tree: starting DFS".to_string());

    while let Some(history) = stack.pop() {
        // Optimize game position: check if this is a direct child of current position
        if history.len() == current_history.len() + 1
            && !current_history.is_empty()
            && history[..current_history.len()] == current_history[..]
        {
            // Direct child -- advance one step
            game.play(history[history.len() - 1]);
        } else {
            // Must replay from root
            apply_history(game, &history);
        }
        current_history = history.clone();

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

        // Player decision node -- extract results
        let player = current_player(game);
        let player_index = if player == "ip" { 1 } else { 0 };
        let strategy = game.strategy().to_vec();

        let available = game.available_actions();
        let num_actions = available.len();
        let actions = available
            .iter()
            .map(|action| format!("{action:?}"))
            .collect::<Vec<_>>()
            .join(",");

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

        // Push child histories in reverse so first child is processed first (DFS order)
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn set_phase(state: &SolverState, phase: SolverPhase) {
    *state.phase.lock().unwrap_or_else(|e| e.into_inner()) = phase;
}

fn cache_root_values(state: &SolverState) {
    if let Ok(mut guard) = state.game.lock() {
        if let Some(game) = guard.as_mut() {
            game.back_to_root();
            let (ev_oop, eq_oop) = root_values(game, 0);
            let (ev_ip, eq_ip) = root_values(game, 1);
            *state.root_values.lock().unwrap() = Some(RootValues {
                ev_oop,
                eq_oop,
                ev_ip,
                eq_ip,
            });
        }
    }
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

fn try_with_game<T>(
    state: &SolverState,
    f: impl FnOnce(&mut PostFlopGame) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state
        .game
        .try_lock()
        .map_err(|_| "Solver is busy".to_string())?;
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
