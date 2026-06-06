import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { SolverConfig } from "@/lib/desktop-solver";

export interface SolvedSpot {
  id: string;
  board: string;
  oopRange: string;
  ipRange: string;
  oopPosition: string;
  ipPosition: string;
  gameType: string;
  potType: string;
  startingPot: number;
  effectiveStack: number;
  treeConfig: Record<string, unknown>;
  exploitability: number | null;
  iterations: number | null;
  solveTimeMs: number | null;
  memoryUsageMb: number | null;
  configHash: string;
  treePath: string | null;
  createdAt: string;
}

export interface SaveSpotParams {
  board: string;
  config: SolverConfig;
  exploitability: number;
  gameType: string;
  ipPosition: string;
  iterations: number;
  memoryUsageMb: number;
  oopPosition: string;
  potType: string;
  solveTimeMs: number;
  treePath?: string;
}

function configHash(params: SaveSpotParams): string {
  const key = [
    params.board,
    params.config.oopRange,
    params.config.ipRange,
    params.oopPosition,
    params.ipPosition,
    params.config.oopFlopBet,
    params.config.oopFlopRaise,
    params.config.ipFlopBet,
    params.config.ipFlopRaise,
    params.config.oopTurnBet,
    params.config.oopTurnRaise,
    params.config.ipTurnBet,
    params.config.ipTurnRaise,
    params.config.oopRiverBet,
    params.config.oopRiverRaise,
    params.config.ipRiverBet,
    params.config.ipRiverRaise,
    params.config.startingPot,
    params.config.effectiveStack,
  ].join("|");

  // Simple hash — enough for dedup, not security
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  }
  return `spot_${Math.abs(hash).toString(36)}`;
}

export async function saveSpotToCloud(params: SaveSpotParams): Promise<SolvedSpot> {
  const supabase = createBrowserSupabaseClient();
  const hash = configHash(params);

  const row = {
    board: params.board,
    oop_range: params.config.oopRange,
    ip_range: params.config.ipRange,
    oop_position: params.oopPosition,
    ip_position: params.ipPosition,
    game_type: params.gameType,
    pot_type: params.potType,
    starting_pot: params.config.startingPot,
    effective_stack: params.config.effectiveStack,
    tree_config: {
      oopFlopBet: params.config.oopFlopBet,
      oopFlopRaise: params.config.oopFlopRaise,
      ipFlopBet: params.config.ipFlopBet,
      ipFlopRaise: params.config.ipFlopRaise,
      oopTurnBet: params.config.oopTurnBet,
      oopTurnRaise: params.config.oopTurnRaise,
      ipTurnBet: params.config.ipTurnBet,
      ipTurnRaise: params.config.ipTurnRaise,
      oopRiverBet: params.config.oopRiverBet,
      oopRiverRaise: params.config.oopRiverRaise,
      ipRiverBet: params.config.ipRiverBet,
      ipRiverRaise: params.config.ipRiverRaise,
      rakeRate: params.config.rakeRate,
      rakeCap: params.config.rakeCap,
      addAllinThreshold: params.config.addAllinThreshold,
      forceAllinThreshold: params.config.forceAllinThreshold,
      mergingThreshold: params.config.mergingThreshold,
    },
    exploitability: params.exploitability,
    iterations: params.iterations,
    solve_time_ms: params.solveTimeMs,
    memory_usage_mb: params.memoryUsageMb,
    config_hash: hash,
    tree_path: params.treePath ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("solved_spots")
    .upsert(row, { onConflict: "config_hash" })
    .select()
    .single();

  if (error) throw new Error(`Failed to save spot: ${error.message}`);

  return mapRow(data);
}

export async function listSolvedSpots(): Promise<SolvedSpot[]> {
  const supabase = createBrowserSupabaseClient();

  const { data, error } = await supabase
    .from("solved_spots")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to list spots: ${error.message}`);

  return (data ?? []).map(mapRow);
}

export async function getSolvedSpot(id: string): Promise<SolvedSpot | null> {
  const supabase = createBrowserSupabaseClient();

  const { data, error } = await supabase
    .from("solved_spots")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return null;

  return mapRow(data);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): SolvedSpot {
  return {
    id: row.id,
    board: row.board,
    oopRange: row.oop_range,
    ipRange: row.ip_range,
    oopPosition: row.oop_position,
    ipPosition: row.ip_position,
    gameType: row.game_type,
    potType: row.pot_type,
    startingPot: row.starting_pot,
    effectiveStack: row.effective_stack,
    treeConfig: row.tree_config ?? {},
    exploitability: row.exploitability,
    iterations: row.iterations,
    solveTimeMs: row.solve_time_ms,
    memoryUsageMb: row.memory_usage_mb,
    configHash: row.config_hash,
    treePath: row.tree_path ?? null,
    createdAt: row.created_at,
  };
}

/** Rebuild a SolverConfig from a saved spot so we can re-solve it. */
export function spotToSolverConfig(spot: SolvedSpot): SolverConfig {
  const tc = spot.treeConfig as Record<string, string | number>;
  return {
    oopRange: spot.oopRange,
    ipRange: spot.ipRange,
    board: spot.board
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(cardToId),
    startingPot: spot.startingPot,
    effectiveStack: spot.effectiveStack,
    storageMode: "auto",
    oopFlopBet: String(tc.oopFlopBet ?? "33%, 75%"),
    oopFlopRaise: String(tc.oopFlopRaise ?? "3x"),
    ipFlopBet: String(tc.ipFlopBet ?? "33%, 75%"),
    ipFlopRaise: String(tc.ipFlopRaise ?? "3x"),
    oopTurnBet: String(tc.oopTurnBet ?? "33%, 75%"),
    oopTurnRaise: String(tc.oopTurnRaise ?? "3x"),
    ipTurnBet: String(tc.ipTurnBet ?? "33%, 75%"),
    ipTurnRaise: String(tc.ipTurnRaise ?? "3x"),
    oopRiverBet: String(tc.oopRiverBet ?? "33%, 75%"),
    oopRiverRaise: String(tc.oopRiverRaise ?? "3x"),
    ipRiverBet: String(tc.ipRiverBet ?? "33%, 75%"),
    ipRiverRaise: String(tc.ipRiverRaise ?? "3x"),
    rakeRate: Number(tc.rakeRate ?? 0),
    rakeCap: Number(tc.rakeCap ?? 0),
    addAllinThreshold: Number(tc.addAllinThreshold ?? 0),
    forceAllinThreshold: Number(tc.forceAllinThreshold ?? 0.15),
    mergingThreshold: Number(tc.mergingThreshold ?? 0.1),
  };
}

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const CARD_MAP: Record<string, number> = {};
for (let s = 0; s < 4; s++) {
  for (let r = 0; r < 13; r++) {
    CARD_MAP[`${RANKS[r]}${SUITS[s]}`] = 4 * r + s;
  }
}

function cardToId(card: string): number {
  const id = CARD_MAP[card];
  if (id === undefined) throw new Error(`Invalid card: ${card}`);
  return id;
}
