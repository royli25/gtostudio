# Global Solver Refactor PRD

## Summary

Move the solve lifecycle entirely into the Rust backend so it runs independently of frontend navigation. The frontend becomes a stateless view that reads solver state on mount and subscribes to events for live updates. A thin green progress bar at the very top of the window shows solve progress globally across all pages.

## Problem

Today the solve is driven by a frontend `invoke()` promise. When the user navigates away:
- The promise is dropped — nobody receives the result
- The auto-save (extract → compress → upload) chain is lost
- Coming back requires fragile "reconnect" logic with retry loops
- The user can't browse simulations or other pages while a solve runs

## Goals

- Solve runs entirely in Rust, unaffected by frontend navigation
- Auto-save (extract tree → upload to Supabase) happens in Rust after solve completes
- Frontend is a pure view — mount reads state, unmount unsubscribes, no orchestration
- Global progress bar visible on every page during a solve
- Zero "reconnect" logic

## Non-Goals

- Queuing multiple solves (one at a time is fine for now)
- Moving the Next.js frontend to a different framework
- Changing the engine's solve algorithm

## Architecture

### Rust Backend: Fire-and-Forget Solver

The `SolverState` becomes a full state machine:

```
Idle → Initializing → Solving → Extracting → Uploading → Done
                                                          ↓
                                                        Error
```

**New `SolverState` struct:**
```rust
pub struct SolverState {
    game: Mutex<Option<PostFlopGame>>,
    cancel_requested: AtomicBool,
    phase: Mutex<SolverPhase>,
    config: Mutex<Option<SolvedSpotConfig>>,  // board, ranges, positions, etc.
}

pub enum SolverPhase {
    Idle,
    Solving { iteration: u32, max_iterations: u32, exploitability: Option<f32> },
    Extracting { node_count: u32 },
    Uploading { bytes_sent: u64, bytes_total: u64 },
    Done { exploitability: f32, spot_id: String, upload_path: String },
    Error { phase: String, message: String },
}
```

**New command flow:**

1. `solver_start(config)` — fire-and-forget. Spawns a background thread that runs the full pipeline:
   - Init game → allocate memory
   - Solve (emitting `solver_progress` events)
   - Extract tree (emitting `solver_extracting` event)
   - Upload to Supabase via HTTP from Rust (emitting `solver_uploading` events)
   - Save spot config to Supabase via HTTP from Rust
   - Set phase to `Done`
   - Returns immediately with `{ started: true }`

2. `solver_status()` — returns current `SolverPhase` snapshot. Non-blocking (`try_lock`). Called by frontend on every page mount.

3. `solver_cancel()` — unchanged, sets cancel flag.

**Cloud upload from Rust:**

Move the Supabase upload out of the browser and into Rust using `reqwest`:
- POST to Supabase Storage REST API with the anon key
- POST/PATCH to Supabase PostgREST API to upsert `solved_spots` row
- Supabase URL and anon key passed from frontend env vars via `solver_start` config

This eliminates the browser dependency for uploads entirely.

### Frontend: Stateless View

**On any page mount:**
```typescript
const status = await solver.status();
// Render based on status.phase
```

**Event subscription (optional, for live updates):**
```typescript
solver.listen({
  onProgress: (p) => updateProgressBar(p),
  onDone: (result) => showCompletionToast(result),
  onError: (err) => showErrorToast(err),
});
```

**On unmount:**
```typescript
solver.dispose(); // just unsubscribes events, solver keeps running
```

**Solve page changes:**
- "Solve" button calls `solver_start(config)` then immediately shows progress
- Results display calls `solver_status()` on mount — if phase is `Done`, fetch results via `solver_get_results`
- No more `await invoke("solver_solve")` promise chain
- Remove all cloud save logic from frontend (`handleSaveToCloud`, `uploadTree` calls)
- Remove the "Save to Cloud" button (it's automatic now)
- Remove the reconnect `useEffect`

### Global Progress Bar

A thin (3px) green progress bar fixed to the very top of the browser viewport, visible on every page. Lives in the root layout, not in any individual page.

**Component: `SolverProgressBar`**

Placed in `app/layout.tsx`:
```tsx
<html>
  <body>
    <SolverProgressBar />
    {children}
  </body>
</html>
```

**Behavior:**
- **Idle**: hidden (height 0, no space taken)
- **Solving**: green bar animating left-to-right, width = `iteration / maxIterations * 100%`
- **Extracting**: bar at 100%, pulsing/indeterminate animation
- **Uploading**: bar shows upload progress (if available) or pulsing
- **Done**: bar fills to 100% green, then fades out after 2 seconds
- **Error**: bar turns red, stays visible until dismissed

**Styling:**
```css
.solver-progress-bar {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  z-index: 9999;
  background: #22c55e; /* green-500 */
  transition: width 200ms ease-out;
}
```

**State source:**
- Polls `solver_status()` on mount
- Subscribes to `solver_progress` events for real-time iteration updates
- Works on every page because it lives in the layout

### Events (unchanged format, new events added)

| Event | Payload | When |
|-------|---------|------|
| `solver_progress` | `{ iteration, maxIterations, exploitability?, phase }` | Each iteration / exploitability check |
| `solver_extracting` | `{ nodeCount }` | Tree extraction starts |
| `solver_uploading` | `{ bytesSent, bytesTotal }` | Upload progress |
| `solver_done` | `{ exploitability, spotId, uploadPath }` | Full pipeline complete |
| `solver_error` | `{ phase, message }` | Any failure |

### Persistent Frontend State

Currently, all Solve page state (board cards, ranges, positions, pot type, results, navigation history) lives in React `useState` — it resets on every page navigation. The user loses their entire config when switching tabs.

**Problem:** Navigate away from Solve → come back → board cards change, ranges reset, results gone.

**Solution:** Store the full Solve page config in the Rust backend alongside the solver state. The frontend reads it on mount.

**New `SolverState` fields:**
```rust
pub struct SolverState {
    // ... existing fields ...
    config: Mutex<Option<SolveConfig>>,  // the full UI config, not just solver params
}

pub struct SolveConfig {
    pub board: Vec<String>,            // ["Qs", "Jh", "2h"]
    pub oop_range: String,
    pub ip_range: String,
    pub oop_position: String,          // "UTG"
    pub ip_position: String,           // "BTN"
    pub game_type: String,             // "6-max"
    pub pot_type: String,              // "Single raised pot"
    pub starting_pot: i32,
    pub effective_stack: i32,
    pub tree_config: serde_json::Value, // bet sizes, thresholds
    pub max_iterations: u32,
    pub target_exploitability: f32,
}
```

**New commands:**
- `solver_set_config(config)` — called when user changes any setting on the Solve page. Stores in Rust.
- `solver_get_config()` — called on Solve page mount. Returns the stored config so the UI restores exactly.

**Frontend behavior:**
- On mount: call `solver_get_config()` → if config exists, populate all fields from it
- On any user change (board, ranges, positions, bet sizes): call `solver_set_config()` to persist
- On `solver_start()`: config is already stored, Rust reads it directly

This means the Solve page is fully resumable — navigate away, close the tab, come back, everything is exactly where you left it. The Rust backend is the single source of truth for both the solver state and the UI configuration.

## Implementation Order

1. **Rust: `SolverPhase` state machine** — add phase tracking to `SolverState`
2. **Rust: `solver_start` command** — fire-and-forget background thread with full pipeline
3. **Rust: HTTP upload** — add `reqwest` dependency, implement Supabase Storage + PostgREST upload from Rust
4. **Rust: new events** — `solver_extracting`, `solver_uploading`, `solver_done`, `solver_error`
5. **Frontend: `SolverProgressBar`** — layout-level component, subscribes to events
6. **Frontend: refactor Solve page** — remove promise chain, remove cloud save, call `solver_start`
7. **Frontend: cleanup** — remove `tree-storage.ts` browser upload code, remove reconnect logic

## Dependencies

- `reqwest` crate (with `rustls-tls` feature for HTTPS) added to `src-tauri/Cargo.toml`
- Supabase URL + anon key passed to Rust at startup or per-solve

## Risks

- **`reqwest` binary size**: adds ~1-2 MB to the Tauri binary. Acceptable.
- **Supabase auth from Rust**: anon key is sufficient for current RLS policies. No user auth needed yet.
- **Large tree extraction**: extracting 50K+ nodes holds the game lock for seconds. The `try_lock` pattern on `solver_get_results` handles this already — frontend retries if busy.

## Success Metrics

- User can start a solve, navigate to any page, come back, and see results — no reconnect delay
- Progress bar visible on simulations page while solve runs on another spot
- Zero frontend orchestration code for solve → extract → upload pipeline
- Cloud save never fails due to navigation
- Solve speed improved 10-20x from build/compiler optimizations alone

---

## Solver Performance Audit

Full audit of `web/src-tauri/src/solver.rs` and `engine/src/solver.rs` on M1 MacBook Air (10 cores: 4 perf + 6 efficiency).

### Finding 1: No Release-Mode Optimizations (CRITICAL — 5-10x)

The Tauri dev build runs `cargo run` with `dev` profile — **unoptimized + debuginfo**. There are no `[profile.dev]` or `[profile.release]` overrides anywhere. The engine is CPU-bound f32 math (regret matching, inner products, CFV computation) — running unoptimized is easily 5-10x slower than release.

**Current state:** No profile overrides in `web/src-tauri/Cargo.toml`.

**Fix:** Add optimized dev profile for the engine crate and a tuned release profile:
```toml
# Optimize the engine even in dev builds (solves are CPU-bound)
[profile.dev.package.postflop-solver]
opt-level = 3

[profile.release]
opt-level = 3
lto = true
codegen-units = 1
```

This gives release-grade engine performance even during `npm run tauri dev`, while keeping the Tauri shell itself fast to compile in debug mode.

### Finding 2: No Native CPU Target (SIGNIFICANT — 1.5-2x)

No `RUSTFLAGS="-C target-cpu=native"` configured anywhere. On M1 (Apple Silicon), this means the compiler can't use NEON SIMD instructions for the hot f32 slice operations in `engine/src/sliceop.rs`. The engine has no explicit ARM SIMD — it relies on LLVM auto-vectorization, which only works well with `target-cpu=native`.

**Current state:** No `.cargo/config.toml` exists in `web/src-tauri/`.

**Fix:** Create `web/src-tauri/.cargo/config.toml`:
```toml
[build]
rustflags = ["-C", "target-cpu=native"]
```

Note: This makes the binary non-portable (M1-only). For distribution, build without this flag or use `target-cpu=apple-m1` explicitly.

### Finding 3: Per-Iteration Event Emission Overhead (MODERATE — 1.1-1.3x)

In `solver_solve_blocking`, every single iteration emits a `solver_progress` Tauri event:
```rust
// This runs on EVERY iteration — serialization + IPC overhead
app.emit("solver_progress", ProgressEvent { ... })
```

The engine's own `solve()` function only computes exploitability every 10 iterations. Our wrapper emits on every iteration AND does string formatting inside `emit_log()` on the hot path during exploitability checks.

**Fix:**
- Only emit progress events every N iterations (e.g., every 10 or on exploitability intervals)
- Remove `emit_log()` from inside the solve loop — it allocates a String on every exploitability check
- Batch iteration count in the event instead of per-iteration emission

### Finding 4: Root Values Recomputed on Every `get_results` Call (MODERATE)

Every call to `solver_get_results` traverses to root and computes:
```rust
game.back_to_root();
let (root_ev_oop, root_eq_oop) = root_values(game, 0);  // full tree traversal
let (root_ev_ip, root_eq_ip) = root_values(game, 1);    // full tree traversal
```

Each `root_values()` call does `cache_normalized_weights()` + `expected_values()` + `equity()` + `normalized_weights()` — expensive operations that traverse the strategy data. These values don't change after a solve completes.

**Fix:** Compute root EV/EQ once after `finalize()`, store in `SolverState`:
```rust
pub struct SolverState {
    // ...
    root_values: Mutex<Option<RootValues>>,
}

struct RootValues {
    ev_oop: f32, eq_oop: f32,
    ev_ip: f32, eq_ip: f32,
}
```

### Finding 5: Tree Extraction Replays History From Root for Every Node (SIGNIFICANT)

`solver_extract_tree_blocking` uses a stack-based DFS but calls `apply_history(game, &history)` for every node:
```rust
while let Some(history) = stack.pop() {
    apply_history(game, &history);  // back_to_root() + play() × history.len()
    // ...
}
```

For a tree with 10K nodes at average depth 8, this does ~80K `play()` calls when only ~10K are needed. A proper iterative DFS that advances one step at a time and only backtracks when needed would be much faster.

**Fix:** Refactor to track current position and only advance/backtrack incrementally:
```rust
// Instead of replaying full history each time,
// compute the common prefix with the previous history
// and only backtrack/advance the difference.
```

### Finding 6: `available_actions()` Called Twice Per Node (MINOR)

In `solver_get_results`, lines 409 and 418 both call `game.available_actions()`:
```rust
let actions = game.available_actions()  // call 1
    .iter().map(|action| format!("{action:?}")).collect();
let num_actions = game.available_actions().len();  // call 2 (redundant)
```

**Fix:** Call once, reuse:
```rust
let available = game.available_actions();
let num_actions = available.len();
let actions = available.iter().map(|action| format!("{action:?}")).collect();
```

### Finding 7: `custom-alloc` Feature Not Enabled (MODERATE — 1.2-1.5x)

The engine has a `custom-alloc` feature with `StackAlloc` for temporary vectors in the hot solve loop (regret matching, CFV computation). This avoids heap allocations during tree traversal — significant for deep trees with many nodes.

**Current state in `web/src-tauri/Cargo.toml`:**
```toml
postflop-solver = { path = "../../engine", default-features = false, features = ["rayon"] }
```

**Fix:**
```toml
postflop-solver = { path = "../../engine", default-features = false, features = ["rayon", "custom-alloc"] }
```

### Finding 8: Parallelization Only at Flop/Turn Level (ENGINE DESIGN)

`enable_parallelization()` returns `true` only when `river == NOT_DEALT`:
```rust
fn enable_parallelization(&self) -> bool {
    self.river == NOT_DEALT
}
```

This means rayon parallelism only kicks in at flop and turn chance nodes. River subtrees (the bulk of computation for complex trees) run single-threaded on the M1's 10 cores. This is an intentional engine design choice to avoid rayon overhead on small subtrees, but there may be room for more aggressive parallelization on larger trees.

**Status:** Not changing for now — this requires engine-level changes and benchmarking to determine the right threshold. Document for future investigation.

### Performance Implementation Order

| Priority | Fix | Est. Speedup | Effort | Risk |
|----------|-----|-------------|--------|------|
| P0 | Release-mode opt for engine | **5-10x** | 2 lines in Cargo.toml | None |
| P0 | `target-cpu=native` for ARM NEON | **1.5-2x** | 3 lines in config.toml | Non-portable binary |
| P0 | Enable `custom-alloc` feature | **1.2-1.5x** | 1 line change | None |
| P1 | Reduce per-iteration event emission | **1.1-1.3x** | ~10 lines | None |
| P1 | Cache root EV/EQ values | **faster UI** | ~20 lines | None |
| P1 | Fix DFS replay-from-root extraction | **faster extract** | ~40 lines | Low |
| P2 | Deduplicate `available_actions()` | **negligible** | 3 lines | None |
| P2 | Investigate river parallelization | **unknown** | Engine changes | Needs benchmarks |

**Combined P0 items alone: estimated 10-20x speedup.** A 60-second solve becomes 3-6 seconds.
