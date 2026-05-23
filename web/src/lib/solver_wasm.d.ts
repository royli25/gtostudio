/* tslint:disable */
/* eslint-disable */

export class GameManager {
    free(): void;
    [Symbol.dispose](): void;
    actions(): string;
    allocate_memory(enable_compression: boolean): void;
    apply_history(history: Uint32Array): void;
    back_to_root(): void;
    current_board(): Uint8Array;
    current_player(): string;
    equity(player: number): Float32Array;
    expected_values(player: number): Float32Array;
    exploitability(): number;
    finalize(): void;
    history(): Uint32Array;
    init(oop_range: string, ip_range: string, board: Uint8Array, starting_pot: number, effective_stack: number, rake_rate: number, rake_cap: number, oop_flop_bet: string, oop_flop_raise: string, ip_flop_bet: string, ip_flop_raise: string, oop_turn_bet: string, oop_turn_raise: string, ip_turn_bet: string, ip_turn_raise: string, oop_river_bet: string, oop_river_raise: string, ip_river_bet: string, ip_river_raise: string, add_allin_threshold: number, force_allin_threshold: number, merging_threshold: number): void;
    is_chance_node(): boolean;
    is_terminal_node(): boolean;
    lock_current_strategy(strategy: Float32Array): void;
    memory_usage(enable_compression: boolean): BigUint64Array;
    constructor();
    normalized_weights(player: number): Float32Array;
    num_actions(): number;
    play(action: number): void;
    possible_cards(): Uint8Array;
    private_cards(player: number): Uint16Array;
    reset_traversal_stats(): void;
    root_equity(player: number): number;
    root_ev(player: number): number;
    solve_step(current_iteration: number): void;
    strategy(): Float32Array;
    total_bet_amount(): Int32Array;
    traversal_stats(): BigUint64Array;
    unlock_current_node(): void;
}

export function exitThreadPool(): Promise<any>;

export function initThreadPool(num_threads: number): Promise<any>;

export function testRayon(): Float64Array;

export class wbg_rayon_PoolBuilder {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    build(): void;
    numThreads(): number;
    receiver(): number;
}

export function wbg_rayon_start_worker(receiver: number): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly __wbg_gamemanager_free: (a: number, b: number) => void;
    readonly __wbg_wbg_rayon_poolbuilder_free: (a: number, b: number) => void;
    readonly exitThreadPool: () => any;
    readonly gamemanager_actions: (a: number) => [number, number];
    readonly gamemanager_allocate_memory: (a: number, b: number) => void;
    readonly gamemanager_apply_history: (a: number, b: number, c: number) => void;
    readonly gamemanager_back_to_root: (a: number) => void;
    readonly gamemanager_current_board: (a: number) => [number, number];
    readonly gamemanager_current_player: (a: number) => [number, number];
    readonly gamemanager_equity: (a: number, b: number) => [number, number];
    readonly gamemanager_expected_values: (a: number, b: number) => [number, number];
    readonly gamemanager_exploitability: (a: number) => number;
    readonly gamemanager_finalize: (a: number) => void;
    readonly gamemanager_history: (a: number) => [number, number];
    readonly gamemanager_init: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number, s: number, t: number, u: number, v: number, w: number, x: number, y: number, z: number, a1: number, b1: number, c1: number, d1: number, e1: number, f1: number, g1: number, h1: number, i1: number, j1: number, k1: number, l1: number) => [number, number];
    readonly gamemanager_is_chance_node: (a: number) => number;
    readonly gamemanager_is_terminal_node: (a: number) => number;
    readonly gamemanager_lock_current_strategy: (a: number, b: number, c: number) => void;
    readonly gamemanager_memory_usage: (a: number, b: number) => [number, number];
    readonly gamemanager_new: () => number;
    readonly gamemanager_normalized_weights: (a: number, b: number) => [number, number];
    readonly gamemanager_num_actions: (a: number) => number;
    readonly gamemanager_play: (a: number, b: number) => void;
    readonly gamemanager_possible_cards: (a: number) => [number, number];
    readonly gamemanager_private_cards: (a: number, b: number) => [number, number];
    readonly gamemanager_reset_traversal_stats: (a: number) => void;
    readonly gamemanager_root_equity: (a: number, b: number) => number;
    readonly gamemanager_root_ev: (a: number, b: number) => number;
    readonly gamemanager_solve_step: (a: number, b: number) => void;
    readonly gamemanager_strategy: (a: number) => [number, number];
    readonly gamemanager_total_bet_amount: (a: number) => [number, number];
    readonly gamemanager_traversal_stats: (a: number) => [number, number];
    readonly gamemanager_unlock_current_node: (a: number) => void;
    readonly initThreadPool: (a: number) => any;
    readonly testRayon: () => [number, number];
    readonly wbg_rayon_poolbuilder_build: (a: number) => void;
    readonly wbg_rayon_poolbuilder_numThreads: (a: number) => number;
    readonly wbg_rayon_poolbuilder_receiver: (a: number) => number;
    readonly wbg_rayon_start_worker: (a: number) => void;
    readonly memory: WebAssembly.Memory;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_thread_destroy: (a?: number, b?: number, c?: number) => void;
    readonly __wbindgen_start: (a: number) => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number }} module - Passing `SyncInitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput, memory?: WebAssembly.Memory, thread_stack_size?: number } | SyncInitInput, memory?: WebAssembly.Memory): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number }} module_or_path - Passing `InitInput` directly is deprecated.
 * @param {WebAssembly.Memory} memory - Deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput>, memory?: WebAssembly.Memory, thread_stack_size?: number } | InitInput | Promise<InitInput>, memory?: WebAssembly.Memory): Promise<InitOutput>;
