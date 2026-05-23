"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ComboRow, SolveResults } from "@/lib/poker";

interface SolveLog {
  time: string;
  message: string;
}

interface ProgressPoint {
  exploitability: number;
  iteration: number;
}

interface MatrixCell {
  label: string;
  actionFreqs: number[];
  comboCount: number;
}

interface PathSegment {
  id: string;
  kind: "action" | "chance";
  actions?: string[];
  historyLength: number;
  label: string;
  meta: string;
  player?: string;
  selectedActionIndex?: number;
}

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const CARD_PICKER_RANKS = "AKQJT98765432";
const CARD_PICKER_SUITS = "shdc";
const MATRIX_RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const CARD_MAP: Record<string, number> = {};

for (let s = 0; s < 4; s++) {
  for (let r = 0; r < 13; r++) {
    CARD_MAP[`${RANKS[r]}${SUITS[s]}`] = 4 * r + s;
  }
}

const GAME_TYPES = ["Heads-up", "6-max", "9-max"] as const;
const POT_TYPES = ["Limped pot", "Single raised pot", "3-bet pot", "4-bet pot"] as const;
const POSITIONS_BY_GAME = {
  "Heads-up": ["SB", "BB"],
  "6-max": ["SB", "BB", "UTG", "HJ", "CO", "BTN"],
  "9-max": ["SB", "BB", "UTG", "UTG+1", "MP", "LJ", "HJ", "CO", "BTN"],
} as const;
const POSTFLOP_ORDER_BY_GAME = {
  "Heads-up": ["BB", "SB"],
  "6-max": ["SB", "BB", "UTG", "HJ", "CO", "BTN"],
  "9-max": ["SB", "BB", "UTG", "UTG+1", "MP", "LJ", "HJ", "CO", "BTN"],
} as const;
const POSITION_TIGHTNESS: Record<string, number> = {
  UTG: 0,
  "UTG+1": 1,
  MP: 2,
  LJ: 2,
  HJ: 3,
  CO: 4,
  BTN: 5,
  SB: 4,
  BB: 5,
};
const RANGE_TIERS = {
  "Limped pot": [
    "22+,A2s+,K9s+,QTs+,JTs,T9s,98s,87s,76s,A9o+,KJo+,QJo",
    "22+,A2s+,K8s+,Q9s+,J9s+,T8s+,98s,87s,76s,65s,A8o+,KTo+,QTo+,JTo",
    "22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,86s+,75s+,65s,54s,A7o+,KTo+,QTo+,JTo",
    "22+,A2s+,K4s+,Q7s+,J7s+,T7s+,96s+,85s+,75s+,64s+,54s,A5o+,K9o+,Q9o+,J9o+,T9o",
    "22+,A2s+,K2s+,Q5s+,J6s+,T6s+,95s+,85s+,74s+,64s+,53s+,43s,A2o+,K8o+,Q9o+,J9o+,T9o",
    "22+,A2s+,K2s+,Q2s+,J4s+,T5s+,95s+,84s+,74s+,63s+,53s+,43s,A2o+,K6o+,Q8o+,J8o+,T8o+,98o",
  ],
  "Single raised pot": [
    "66+,A9s+,KTs+,QTs+,JTs,T9s,98s,AJo+,KQo",
    "55+,A7s+,KTs+,QTs+,JTs,T9s,98s,AJo+,KQo",
    "44+,A5s+,K9s+,QTs+,JTs,T9s,98s,87s,ATo+,KQo",
    "33+,A2s+,K8s+,Q9s+,J9s+,T8s+,98s,87s,76s,A9o+,KJo+,QJo",
    "22+,A2s+,K5s+,Q8s+,J8s+,T7s+,97s+,86s+,76s,65s,A7o+,KTo+,QTo+,JTo",
    "22+,A2s+,K2s+,Q5s+,J7s+,T7s+,96s+,85s+,75s+,64s+,54s,A2o+,K9o+,Q9o+,J9o+,T9o",
  ],
  "3-bet pot": [
    "TT+,AQs+,A5s-A4s,KQs,AQo+",
    "99+,AJs+,A5s-A4s,KQs,AQo+",
    "88+,AJs+,A5s-A2s,KQs,KJs+,QJs,AQo+",
    "77+,ATs+,A5s-A2s,KQs,KJs+,QJs,JTs,AQo+,KQo",
    "66+,A9s+,A5s-A2s,KTs+,QTs+,JTs,T9s,AJo+,KQo",
    "55+,A8s+,A5s-A2s,K9s+,QTs+,JTs,T9s,98s,ATo+,KQo",
  ],
  "4-bet pot": [
    "QQ+,AKs,AKo",
    "JJ+,AKs,A5s:0.5,AKo",
    "JJ+,AQs+,A5s-A4s:0.5,AKo",
    "TT+,AQs+,A5s-A4s,KQs,AKo",
    "99+,AJs+,A5s-A2s,KQs,AQo+",
    "88+,ATs+,A5s-A2s,KQs,KJs+,AQo+",
  ],
} as const;

type GameType = (typeof GAME_TYPES)[number];
type PotType = (typeof POT_TYPES)[number];

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

type NumericSolverConfigKey =
  | "rakeRate"
  | "rakeCap"
  | "addAllinThreshold"
  | "forceAllinThreshold"
  | "mergingThreshold";

type ActionSolverConfigKey = Exclude<
  keyof SolverConfig,
  "oopRange" | "ipRange" | "board" | "startingPot" | "effectiveStack" | NumericSolverConfigKey
>;

type SolverActionConfig = Pick<SolverConfig, ActionSolverConfigKey | NumericSolverConfigKey>;

interface DevSolveFixture {
  actionConfig: SolverActionConfig;
  boardSlots: string[];
  description: string;
  effectiveStack: number;
  gameType: GameType;
  heroPosition: string;
  id: string;
  ipRange: string;
  label: string;
  maxIterations: number;
  memoryUsageMB: number;
  nodes: Array<{ history: number[]; result: SolveResults }>;
  oopRange: string;
  potType: PotType;
  progress: ProgressPoint;
  startingPot: number;
  targetExpl: number;
  villainPosition: string;
}

interface DevFixtureMode {
  id: string;
  label: string;
  nodes: Record<string, SolveResults>;
}

const DEV_SOLVE_FIXTURES_ENABLED = process.env.NODE_ENV !== "production";

const ACTION_LABELS: Array<{ key: ActionSolverConfigKey; label: string; raise: boolean }> = [
  { key: "oopFlopBet", label: "OOP flop bet", raise: false },
  { key: "oopFlopRaise", label: "OOP flop raise", raise: true },
  { key: "ipFlopBet", label: "IP flop bet", raise: false },
  { key: "ipFlopRaise", label: "IP flop raise", raise: true },
  { key: "oopTurnBet", label: "OOP turn bet", raise: false },
  { key: "oopTurnRaise", label: "OOP turn raise", raise: true },
  { key: "ipTurnBet", label: "IP turn bet", raise: false },
  { key: "ipTurnRaise", label: "IP turn raise", raise: true },
  { key: "oopRiverBet", label: "OOP river bet", raise: false },
  { key: "oopRiverRaise", label: "OOP river raise", raise: true },
  { key: "ipRiverBet", label: "IP river bet", raise: false },
  { key: "ipRiverRaise", label: "IP river raise", raise: true },
];

type TreePreset = "simple" | "complex";

const TREE_PRESETS: Record<TreePreset, {
  label: string;
  description: string;
  bets: string;
  raises: string;
}> = {
  simple: {
    label: "Simple Solve",
    description: "Fast solves with small and medium bets plus a standard 3x raise.",
    bets: "33%, 75%",
    raises: "3x",
  },
  complex: {
    label: "Complex Solve",
    description: "Full tree with overbets and all-in for closer GTO accuracy.",
    bets: "33%, 75%, 150%, a",
    raises: "2.5x, 3x",
  },
};

const DEFAULT_TREE_TUNING = {
  rakeRate: 0,
  rakeCap: 0,
  addAllinThreshold: 0,
  forceAllinThreshold: 0.15,
  mergingThreshold: 0.1,
} satisfies Pick<SolverConfig, NumericSolverConfigKey>;

const NUMERIC_LABELS: Array<{ key: NumericSolverConfigKey; label: string }> = [
  { key: "rakeRate", label: "Rake rate" },
  { key: "rakeCap", label: "Rake cap" },
  { key: "addAllinThreshold", label: "Add all-in threshold" },
  { key: "forceAllinThreshold", label: "Force all-in threshold" },
  { key: "mergingThreshold", label: "Merging threshold" },
];

function buildTreePresetActionConfig(
  preset: TreePreset
): Pick<SolverConfig, ActionSolverConfigKey | NumericSolverConfigKey> {
  const { bets, raises } = TREE_PRESETS[preset];

  return {
    oopFlopBet: bets,
    oopFlopRaise: raises,
    ipFlopBet: bets,
    ipFlopRaise: raises,
    oopTurnBet: bets,
    oopTurnRaise: raises,
    ipTurnBet: bets,
    ipTurnRaise: raises,
    oopRiverBet: bets,
    oopRiverRaise: raises,
    ipRiverBet: bets,
    ipRiverRaise: raises,
    ...DEFAULT_TREE_TUNING,
  };
}

function treePresetFromActionConfig(
  config: Pick<SolverConfig, ActionSolverConfigKey>
): TreePreset | null {
  for (const preset of Object.keys(TREE_PRESETS) as TreePreset[]) {
    const presetConfig = buildTreePresetActionConfig(preset);
    if (ACTION_LABELS.every(({ key }) => config[key] === presetConfig[key])) {
      return preset;
    }
  }

  return null;
}

function isValidBetToken(token: string, raise: boolean): boolean {
  if (/^\d+(\.\d+)?%$/.test(token)) return true;
  if (/^\d+(\.\d+)?c(\d+r)?$/.test(token)) return true;
  if (/^(\d+)?e(\d+(\.\d+)?%)?$/.test(token)) return true;
  if (token === "a") return true;
  return raise && /^\d+(\.\d+)?x$/.test(token);
}

function validateBetMenu(value: string, label: string, raise: boolean): string | null {
  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) return `${label} must include at least one size.`;

  const invalid = tokens.find((token) => !isValidBetToken(token, raise));
  if (invalid) {
    return `${label} has invalid size "${invalid}". Use %, ${raise ? "x, " : ""}c, e, or a grammar.`;
  }

  return null;
}

function validateSolveConfig(config: SolverConfig, boardSlots: string[]): string[] {
  const errors: string[] = [];

  if (boardSlots.slice(0, 3).some((card) => !card)) {
    errors.push("Choose all three flop cards before solving.");
  }
  if (!Number.isFinite(config.startingPot) || config.startingPot <= 0) {
    errors.push("Pot must be greater than 0.");
  }
  if (!Number.isFinite(config.effectiveStack) || config.effectiveStack <= 0) {
    errors.push("Stack must be greater than 0.");
  }
  if (!config.oopRange.trim()) errors.push("OOP range cannot be empty.");
  if (!config.ipRange.trim()) errors.push("IP range cannot be empty.");
  if (!Number.isFinite(config.rakeRate) || config.rakeRate < 0 || config.rakeRate > 1) {
    errors.push("Rake rate must be between 0 and 1.");
  }
  if (!Number.isFinite(config.rakeCap) || config.rakeCap < 0) {
    errors.push("Rake cap must be non-negative.");
  }
  if (!Number.isFinite(config.addAllinThreshold) || config.addAllinThreshold < 0) {
    errors.push("Add all-in threshold must be non-negative.");
  }
  if (!Number.isFinite(config.forceAllinThreshold) || config.forceAllinThreshold < 0) {
    errors.push("Force all-in threshold must be non-negative.");
  }
  if (!Number.isFinite(config.mergingThreshold) || config.mergingThreshold < 0) {
    errors.push("Merging threshold must be non-negative.");
  }

  ACTION_LABELS.forEach(({ key, label, raise }) => {
    const error = validateBetMenu(config[key], label, raise);
    if (error) errors.push(error);
  });

  return errors;
}

function rangeForSpot(position: string, potType: PotType): string {
  const tier = Math.max(0, Math.min(5, POSITION_TIGHTNESS[position] ?? 2));
  return RANGE_TIERS[potType][tier];
}

function buildPresetRanges(
  gameType: GameType,
  heroPosition: string,
  villainPosition: string,
  potType: PotType
) {
  const order: readonly string[] = POSTFLOP_ORDER_BY_GAME[gameType];
  const heroIsOop = order.indexOf(heroPosition) < order.indexOf(villainPosition);
  const heroRange = rangeForSpot(heroPosition, potType);
  const villainRange = rangeForSpot(villainPosition, potType);

  return {
    heroIsOop,
    ipPosition: heroIsOop ? villainPosition : heroPosition,
    ipRange: heroIsOop ? villainRange : heroRange,
    oopPosition: heroIsOop ? heroPosition : villainPosition,
    oopRange: heroIsOop ? heroRange : villainRange,
  };
}

function parseBoard(board: string): number[] {
  return board
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((card) => {
      const id = CARD_MAP[card];
      if (id === undefined) throw new Error(`Invalid card: ${card}`);
      return id;
    });
}

function splitActions(actions: string): string[] {
  return actions
    .split(",")
    .map((action) => action.trim())
    .filter(Boolean);
}

function rankFromCard(card: number): string {
  return RANKS[Math.floor(card / 4)];
}

function suitFromCard(card: number): string {
  return SUITS[card % 4];
}

function cardLabelFromId(card: number): string {
  return `${rankFromCard(card)}${suitFromCard(card)}`;
}

function comboLabel(cardA: number, cardB: number): string {
  const rankA = rankFromCard(cardA);
  const rankB = rankFromCard(cardB);
  const indexA = RANKS.indexOf(rankA);
  const indexB = RANKS.indexOf(rankB);
  const suited = suitFromCard(cardA) === suitFromCard(cardB);
  const hi = indexA >= indexB ? rankA : rankB;
  const lo = indexA >= indexB ? rankB : rankA;

  if (hi === lo) return `${hi}${lo}`;
  return `${hi}${lo}${suited ? "s" : "o"}`;
}

function matrixLabel(row: string, col: string): string {
  const rowIndex = MATRIX_RANKS.indexOf(row);
  const colIndex = MATRIX_RANKS.indexOf(col);

  if (row === col) return `${row}${col}`;
  return rowIndex < colIndex ? `${row}${col}s` : `${col}${row}o`;
}

function formatAction(action: string): string {
  return action.replaceAll("Bet(", "Bet ").replaceAll("Raise(", "Raise ").replaceAll(")", "");
}

function colorForAction(index: number, action = ""): string {
  const normalized = action.toLowerCase();

  if (normalized.includes("check") || normalized.includes("call")) return "#58b96a";
  if (normalized.includes("fold")) return "#3f7fba";
  if (normalized.includes("bet") || normalized.includes("raise") || normalized.includes("allin")) return "#e24a42";

  const colors = ["#58b96a", "#e24a42", "#3f7fba", "#8b2824"];
  return colors[index % colors.length];
}

function colorForComboTile(action: string, index: number): string {
  return colorForAction(index, action);
}

function comboStrategyGradient(freqs: number[], actions: string[]): string {
  const clamped = freqs.map((freq) => Math.max(0, Math.min(1, Number.isFinite(freq) ? freq : 0)));
  const total = clamped.reduce((sum, freq) => sum + freq, 0);

  if (total <= 0) return "#25262a";

  let cursor = 0;
  const stops = clamped.flatMap((freq, index) => {
    if (freq <= 0) return [];

    const start = cursor;
    const end = cursor + (freq / total) * 100;
    cursor = end;
    const color = colorForComboTile(actions[index] ?? "", index);

    return [`${color} ${start.toFixed(2)}%`, `${color} ${end.toFixed(2)}%`];
  });

  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function formatStrategyPercent(freq: number): string {
  const pct = Math.max(0, Math.min(100, freq * 100));
  if (Math.abs(pct - Math.round(pct)) < 0.05) return String(Math.round(pct));
  return pct.toFixed(1);
}

function streetForBoardLength(length: number): "FLOP" | "TURN" | "RIVER" {
  if (length >= 5) return "RIVER";
  if (length === 4) return "TURN";
  return "FLOP";
}

function buildMatrix(results: SolveResults | null): MatrixCell[] {
  const empty = MATRIX_RANKS.flatMap((row) =>
    MATRIX_RANKS.map((col) => ({
      label: matrixLabel(row, col),
      actionFreqs: [],
      comboCount: 0,
    }))
  );

  if (!results || results.privateCards.length < 2 || results.numActions < 1) {
    return empty;
  }

  const cells = new Map<string, { totals: number[]; count: number }>();
  const numHands = Math.floor(results.privateCards.length / 2);

  for (let hand = 0; hand < numHands; hand++) {
    const cardA = results.privateCards[hand * 2];
    const cardB = results.privateCards[hand * 2 + 1];
    const label = comboLabel(cardA, cardB);
    const entry = cells.get(label) ?? {
      totals: Array.from({ length: results.numActions }, () => 0),
      count: 0,
    };

    for (let action = 0; action < results.numActions; action++) {
      entry.totals[action] += results.strategy[action * numHands + hand] ?? 0;
    }
    entry.count += 1;
    cells.set(label, entry);
  }

  return empty.map((cell) => {
    const data = cells.get(cell.label);
    if (!data || data.count === 0) return cell;

    return {
      label: cell.label,
      actionFreqs: data.totals.map((value) => value / data.count),
      comboCount: data.count,
    };
  });
}

function buildComboRow(results: SolveResults, hand: number, numHands: number): ComboRow {
  const cardA = results.privateCards[hand * 2];
  const cardB = results.privateCards[hand * 2 + 1];
  const cardALabel = cardLabelFromId(cardA);
  const cardBLabel = cardLabelFromId(cardB);

  return {
    cardA: cardALabel,
    cardB: cardBLabel,
    cards: `${cardALabel} ${cardBLabel}`,
    handIndex: hand,
    label: comboLabel(cardA, cardB),
    freqs: Array.from(
      { length: results.numActions },
      (_, action) => results.strategy[action * numHands + hand] ?? 0
    ),
  };
}

function buildComboRowsForLabel(results: SolveResults | null, label: string | null): ComboRow[] {
  if (!results || !label) return [];

  const numHands = Math.floor(results.privateCards.length / 2);
  const rows: ComboRow[] = [];

  for (let hand = 0; hand < numHands; hand++) {
    const row = buildComboRow(results, hand, numHands);
    if (row.label === label) rows.push(row);
  }

  return rows;
}

function normalizedPercents(values: number[]): number[] {
  const clamped = values.map((value) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)));
  const sum = clamped.reduce((total, value) => total + value, 0);

  if (sum <= 0) {
    return clamped.map((_, index) => (index === 0 ? 1 : 0));
  }

  return clamped.map((value) => value / sum);
}

function oneHotPercents(numActions: number, actionIndex: number): number[] {
  return Array.from({ length: numActions }, (_, index) => (index === actionIndex ? 100 : 0));
}

function setBrushActionPercent(percents: number[], actionIndex: number, nextValue: number): number[] {
  const numActions = percents.length;
  const clamped = Math.max(0, Math.min(100, Math.round(nextValue)));

  if (numActions <= 1) return [100];

  const otherIndices = Array.from({ length: numActions }, (_, index) => index).filter((index) => index !== actionIndex);
  const othersSum = otherIndices.reduce((total, index) => total + percents[index], 0);
  const remainder = 100 - clamped;
  const next = [...percents];
  next[actionIndex] = clamped;

  if (othersSum <= 0) {
    const share = Math.floor(remainder / otherIndices.length);
    let leftover = remainder - share * otherIndices.length;
    otherIndices.forEach((index) => {
      next[index] = share + (leftover > 0 ? 1 : 0);
      leftover -= leftover > 0 ? 1 : 0;
    });
    return next;
  }

  let assigned = 0;
  otherIndices.forEach((index, position) => {
    if (position === otherIndices.length - 1) {
      next[index] = remainder - assigned;
      return;
    }

    const value = Math.round((percents[index] / othersSum) * remainder);
    next[index] = value;
    assigned += value;
  });

  return next;
}

function brushStrategyFromPercents(percents: number[]): number[] {
  return normalizedPercents(percents);
}

function buildPaintedNodeLock(
  results: SolveResults,
  handLocks: Record<number, number[]>
): number[] {
  const numHands = Math.floor(results.privateCards.length / 2);
  const strategy = Array.from({ length: results.numActions * numHands }, () => -1);

  Object.entries(handLocks).forEach(([handKey, freqs]) => {
    const hand = Number(handKey);
    if (!Number.isInteger(hand) || hand < 0 || hand >= numHands) return;

    const normalized = normalizedPercents(freqs.map((freq) => freq * 100));
    normalized.forEach((freq, action) => {
      strategy[action * numHands + hand] = freq;
    });
  });

  return strategy;
}

function handClassIndices(results: SolveResults, label: string): number[] {
  const numHands = Math.floor(results.privateCards.length / 2);
  const indices: number[] = [];

  for (let hand = 0; hand < numHands; hand++) {
    const cardA = results.privateCards[hand * 2];
    const cardB = results.privateCards[hand * 2 + 1];
    if (comboLabel(cardA, cardB) === label) {
      indices.push(hand);
    }
  }

  return indices;
}

function classNames(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

const PAINTBRUSH_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="%23e0f2fe" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z"/><path d="M9 8 5 12v4h4l4-4"/></svg>'
)}") 2 22, crosshair`;

function pokerCardAsset(card: string): string {
  const rank = card.slice(0, -1).toUpperCase().replace("T", "10");
  const suit = card.slice(-1).toUpperCase();
  return `/pokercards/${rank}${suit}.svg`;
}

interface PlayingCardProps {
  active?: boolean;
  card?: string;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  placeholder?: ReactNode;
  tone?: "amber" | "sky" | "zinc";
}

function PlayingCard({
  active = false,
  card,
  className,
  disabled = false,
  onClick,
  placeholder = "+",
  tone = "sky",
}: PlayingCardProps) {
  const asButton = Boolean(onClick);
  const hasCard = Boolean(card);
  const accentClass =
    tone === "amber"
      ? "hover:border-amber-200/80 hover:shadow-amber-200/10"
      : tone === "zinc"
        ? "hover:border-white/30 hover:shadow-white/5"
        : "hover:border-sky-300/80 hover:shadow-sky-300/10";
  const activeClass =
    tone === "amber"
      ? "ring-2 ring-amber-200/80 shadow-amber-200/20"
      : "ring-2 ring-sky-300/80 shadow-sky-300/20";
  const baseClass = classNames(
    "group relative block aspect-[3/4] shrink-0 overflow-hidden rounded-md border border-black/10 p-0 text-left font-[family-name:var(--font-dm-sans)] text-white shadow-lg shadow-black/25 outline-none [container-type:inline-size] transition-[transform,box-shadow,opacity] duration-150 ease-out",
    hasCard ? "border-transparent bg-transparent" : "border-dashed border-white/15 bg-[#2c2d31]",
    asButton && "active:scale-[0.98]",
    asButton && !disabled && accentClass,
    active && activeClass,
    disabled && "cursor-not-allowed opacity-35",
    className
  );
  const content = card ? (
    <Image
      alt={card}
      className="object-contain"
      draggable={false}
      fill
      sizes="80px"
      src={pokerCardAsset(card)}
      unoptimized
    />
  ) : (
    <span className="grid h-full place-items-center text-[52cqw] font-black text-white/55">
      {placeholder}
    </span>
  );

  if (asButton) {
    return (
      <button
        className={baseClass}
        disabled={disabled}
        onClick={onClick}
        style={{ aspectRatio: "3 / 4" }}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <span className={baseClass} style={{ aspectRatio: "3 / 4" }}>
      {content}
    </span>
  );
}

function streetName(cardCount: number): string {
  if (cardCount >= 5) return "River";
  if (cardCount === 4) return "Turn";
  return "Flop";
}

type CenterView = "strategy" | "ranges" | "breakdown";
type DetailTab = "hands" | "summary" | "filters" | "blockers";
type RightLockTab = "strategy" | "frequency" | "lock";

const CENTER_VIEWS: Array<{ id: CenterView; label: string }> = [
  { id: "strategy", label: "Strategy" },
  { id: "ranges", label: "Ranges" },
  { id: "breakdown", label: "Breakdown" },
];

const RIGHT_LOCK_TABS: Array<{ id: RightLockTab; label: string }> = [
  { id: "strategy", label: "Set strategy" },
  { id: "frequency", label: "Set frequency" },
  { id: "lock", label: "Lock / Unlock" },
];

const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "hands", label: "Hands" },
  { id: "summary", label: "Summary" },
  { id: "filters", label: "Filters" },
  { id: "blockers", label: "Blockers" },
];

function ComingSoonPanel({
  title,
  description,
  compact = false,
}: {
  title: string;
  description?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={
        compact
          ? "flex min-h-48 flex-col items-center justify-center rounded bg-[#25262a] p-6 text-center"
          : "flex aspect-square max-h-[calc(100vh-8rem)] min-h-[460px] w-full flex-col items-center justify-center rounded border border-white/10 bg-[#1d1e21] p-8 text-center"
      }
    >
      <h2 className={compact ? "text-sm font-semibold text-zinc-100" : "text-lg font-semibold text-zinc-100"}>
        {title}
      </h2>
      {description && (
        <p className={classNames("max-w-sm text-zinc-500", compact ? "mt-2 text-xs" : "mt-2 text-sm")}>
          {description}
        </p>
      )}
      <p className="mt-4 rounded bg-white/8 px-3 py-1.5 text-xs font-medium text-zinc-400">Coming soon</p>
    </div>
  );
}

function NodeLockMixBar({
  actions,
  percents,
  selectedAction,
  onPercentChange,
}: {
  actions: string[];
  percents: number[];
  selectedAction: number;
  onPercentChange: (actionIndex: number, value: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);

  const updateFromClientX = useCallback((clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;

    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;

    const pct = Math.round(((clientX - rect.left) / rect.width) * 100);
    const clamped = Math.max(0, Math.min(100, pct));

    if (actions.length === 2) {
      onPercentChange(0, clamped);
      return;
    }

    onPercentChange(selectedAction, clamped);
  }, [actions.length, onPercentChange, selectedAction]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bar = barRef.current;
    if (!bar) return;

    bar.setPointerCapture(event.pointerId);
    updateFromClientX(event.clientX);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      updateFromClientX(moveEvent.clientX);
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      bar.releasePointerCapture(event.pointerId);
      bar.removeEventListener("pointermove", handlePointerMove);
      bar.removeEventListener("pointerup", handlePointerUp);
    };

    bar.addEventListener("pointermove", handlePointerMove);
    bar.addEventListener("pointerup", handlePointerUp);
  }, [updateFromClientX]);

  const splitPct = actions.length === 2 ? (percents[0] ?? 0) : (percents[selectedAction] ?? 0);

  return (
    <div
      ref={barRef}
      aria-label="Strategy mix"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={splitPct}
      className="relative h-3 cursor-ew-resize touch-none select-none overflow-visible rounded-full bg-[#25262a] py-2"
      onPointerDown={handlePointerDown}
      role="slider"
      tabIndex={0}
    >
      <div className="absolute inset-x-0 top-1/2 flex h-3 -translate-y-1/2 overflow-hidden rounded-full">
        {actions.map((action, index) => {
          const pct = percents[index] ?? 0;
          if (pct <= 0) return null;

          return (
            <div
              key={action}
              className="h-full shrink-0"
              style={{ background: colorForAction(index, action), width: `${pct}%` }}
            />
          );
        })}
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md ring-1 ring-black/25"
        style={{ left: `${splitPct}%` }}
      />
    </div>
  );
}

function historyKey(history: number[]): string {
  return history.join("/");
}

async function loadDevSolveFixtures(): Promise<DevSolveFixture[]> {
  const fixtureData = await import("./dev-fixtures/solves.json");
  return fixtureData.default as DevSolveFixture[];
}

function cloneFixtureResult(result: SolveResults, history: number[], player = result.player): SolveResults {
  return {
    ...result,
    currentBoard: [...result.currentBoard],
    history: [...history],
    player,
    possibleCards: [...result.possibleCards],
    privateCards: [...result.privateCards],
    strategy: [...result.strategy],
    totalBetAmount: [...result.totalBetAmount],
  };
}

function buildDevFixtureNodeMap(fixture: DevSolveFixture): Record<string, SolveResults> {
  const nodes = Object.fromEntries(
    fixture.nodes.map((node) => [historyKey(node.history), node.result])
  ) as Record<string, SolveResults>;

  const mirrorNode = (sourceHistory: number[], targetHistory: number[], player?: string) => {
    const targetKey = historyKey(targetHistory);
    const source = nodes[historyKey(sourceHistory)];

    if (!source || nodes[targetKey]) return;

    nodes[targetKey] = cloneFixtureResult(source, targetHistory, player);
  };

  if (nodes[historyKey([0, 1])]) {
    mirrorNode([1, 0], [0, 1, 0]);
    mirrorNode([1, 1], [0, 1, 1]);
    mirrorNode([1, 1, 0], [0, 1, 1, 0]);
    mirrorNode([1, 1, 1], [0, 1, 1, 1]);
    mirrorNode([1, 2], [0, 1, 2], "ip");
  }

  return nodes;
}

function Modal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/65 p-4">
      <div className="w-full max-w-2xl overflow-hidden rounded border border-white/10 bg-[#1b1c1f] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            className="rounded bg-white/8 px-2 py-1 text-sm text-zinc-300 hover:bg-white/12"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
        <div className="scrollbar-hidden max-h-[75vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export default function SolvePage() {
  const workerRef = useRef<Worker | null>(null);
  const [logs, setLogs] = useState<SolveLog[]>([]);
  const [progress, setProgress] = useState<ProgressPoint | null>(null);
  const [results, setResults] = useState<SolveResults | null>(null);
  const [solving, setSolving] = useState(false);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [currentHistory, setCurrentHistory] = useState<number[]>([]);
  const [pathSegments, setPathSegments] = useState<PathSegment[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [devFixtures, setDevFixtures] = useState<DevSolveFixture[]>([]);
  const [devFixturesOpen, setDevFixturesOpen] = useState(false);
  const [fixtureMode, setFixtureMode] = useState<DevFixtureMode | null>(null);
  const [spotPresetOpen, setSpotPresetOpen] = useState(false);
  const [solveSettingsOpen, setSolveSettingsOpen] = useState(false);
  const [nodeLockBrushAction, setNodeLockBrushAction] = useState(1);
  const [nodeLockBrushPercents, setNodeLockBrushPercents] = useState<number[]>([0, 100]);
  const [nodeLockEnabled, setNodeLockEnabled] = useState(false);
  const [nodeLocksByHistory, setNodeLocksByHistory] = useState<Record<string, Record<number, number[]>>>({});
  const nodeLockPaintingRef = useRef(false);
  const [nodeOpen, setNodeOpen] = useState(false);
  const [hoveredHandLabel, setHoveredHandLabel] = useState<string | null>(null);
  const [centerView, setCenterView] = useState<CenterView>("strategy");
  const [detailTab, setDetailTab] = useState<DetailTab>("hands");
  const [rightLockTab, setRightLockTab] = useState<RightLockTab>("strategy");

  const [gameType, setGameType] = useState<GameType>("6-max");
  const [heroPosition, setHeroPosition] = useState("UTG");
  const [villainPosition, setVillainPosition] = useState("BTN");
  const [potType, setPotType] = useState<PotType>("Single raised pot");
  const initialPreset = buildPresetRanges("6-max", "UTG", "BTN", "Single raised pot");
  const initialBaseline = buildTreePresetActionConfig("simple");
  const [oopRange, setOopRange] = useState(initialPreset.oopRange);
  const [ipRange, setIpRange] = useState(initialPreset.ipRange);
  const [boardSlots, setBoardSlots] = useState(["Qs", "Jh", "2h"]);
  const [activeBoardSlot, setActiveBoardSlot] = useState<number | null>(null);
  const [activeCardRank, setActiveCardRank] = useState("A");
  const [chancePickerOpen, setChancePickerOpen] = useState(false);
  const [activeChanceRank, setActiveChanceRank] = useState("A");
  const [startingPot, setStartingPot] = useState(180);
  const [effectiveStack, setEffectiveStack] = useState(910);
  const [maxIterations, setMaxIterations] = useState(200);
  const [targetExpl, setTargetExpl] = useState(0.1);
  const [treePreset, setTreePreset] = useState<TreePreset>("simple");
  const [actionConfig, setActionConfig] = useState<Pick<SolverConfig, ActionSolverConfigKey | NumericSolverConfigKey>>(initialBaseline);

  const actions = useMemo(() => splitActions(results?.actions ?? "Check, Bet(94)"), [results]);
  const matrix = useMemo(() => buildMatrix(results), [results]);
  const activeHandLabel = hoveredHandLabel ?? matrix.find((cell) => cell.comboCount > 0)?.label ?? null;
  const activeComboRows = useMemo(
    () => buildComboRowsForLabel(results, activeHandLabel),
    [activeHandLabel, results]
  );
  const actionTotals = useMemo(() => {
    if (!results || results.isChance || results.isTerminal) {
      return actions.map((_, index) => (index === 0 ? 0.54 : 0.46));
    }

    const numHands = Math.floor(results.privateCards.length / 2);
    if (numHands === 0) return actions.map(() => 0);

    return actions.map((_, index) => (
      Array.from({ length: numHands }, (_unused, hand) => results.strategy[index * numHands + hand] ?? 0)
        .reduce((sum, value) => sum + value, 0) / numHands
    ));
  }, [actions, results]);
  const boardCards = useMemo(() => boardSlots.filter(Boolean), [boardSlots]);
  const pathBoardCards = useMemo(
    () => (results?.currentBoard.length ? results.currentBoard.map(cardLabelFromId) : boardCards).slice(0, 3),
    [boardCards, results]
  );
  const selectedBoardCards = useMemo(() => new Set(boardCards), [boardCards]);
  const board = boardCards.join(" ");
  const availablePositions = POSITIONS_BY_GAME[gameType];
  const presetRanges = buildPresetRanges(gameType, heroPosition, villainPosition, potType);
  const { ipPosition, oopPosition } = presetRanges;
  const actingPlayer = results?.player?.toUpperCase() ?? "OOP";
  const actingSeat = results?.player === "oop" ? oopPosition : results?.player === "ip" ? ipPosition : "Chance";
  const currentStreet = streetName(results?.currentBoard.length ?? boardCards.length);
  const finalExploitability = progress?.exploitability ?? 0;
  const exploitabilityPct = startingPot > 0 ? (finalExploitability / startingPot) * 100 : 0;
  const currentNodeLockKey = historyKey(currentHistory);
  const nodeLockHands = useMemo(
    () => nodeLocksByHistory[currentNodeLockKey] ?? {},
    [currentNodeLockKey, nodeLocksByHistory]
  );
  const lockedHandCount = Object.keys(nodeLockHands).length;
  const pendingNodeLockStrategy = useMemo(() => {
    if (!results || !nodeLockEnabled || lockedHandCount === 0) return null;
    return buildPaintedNodeLock(results, nodeLockHands);
  }, [lockedHandCount, nodeLockEnabled, nodeLockHands, results]);
  const nodeLockLabel = lockedHandCount > 0
    ? `${lockedHandCount} combo${lockedHandCount === 1 ? "" : "s"} locked at this node`
    : null;
  const presetActionConfig = useMemo(() => buildTreePresetActionConfig(treePreset), [treePreset]);
  const solverConfig = useMemo<SolverConfig>(() => ({
    oopRange,
    ipRange,
    board: boardCards.length >= 3 ? parseBoard(board) : [],
    startingPot,
    effectiveStack,
    ...actionConfig,
  }), [actionConfig, board, boardCards.length, effectiveStack, ipRange, oopRange, startingPot]);
  const validationErrors = useMemo(() => validateSolveConfig(solverConfig, boardSlots), [boardSlots, solverConfig]);
  const activeTreePreset = useMemo(() => treePresetFromActionConfig(actionConfig) ?? treePreset, [actionConfig, treePreset]);
  const activePresetMeta = TREE_PRESETS[activeTreePreset];
  const actionConfigMatchesPreset = ACTION_LABELS.every(({ key }) => actionConfig[key] === presetActionConfig[key]);
  const numericConfigIsDefault = NUMERIC_LABELS.every(({ key }) => actionConfig[key] === presetActionConfig[key]);
  const actionConfigIsDefault = actionConfigMatchesPreset && numericConfigIsDefault;
  const treeSizeWarning = treePreset === "complex" || activeTreePreset === "complex";
  const currentNodeLabel = results?.isTerminal
    ? "Terminal"
    : results?.isChance
      ? "Chance"
      : `${actingSeat} to act`;
  const rangeIsBaseline = oopRange === presetRanges.oopRange && ipRange === presetRanges.ipRange;

  const selectTreePreset = useCallback((preset: TreePreset) => {
    setTreePreset(preset);
    setActionConfig((current) => ({
      ...buildTreePresetActionConfig(preset),
      rakeRate: current.rakeRate,
      rakeCap: current.rakeCap,
    }));
  }, []);

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [
      ...prev.slice(-80),
      { time: new Date().toLocaleTimeString(), message },
    ]);
  }, []);

  const openDevFixtures = useCallback(async () => {
    if (!DEV_SOLVE_FIXTURES_ENABLED) return;

    try {
      const fixtures = await loadDevSolveFixtures();
      setDevFixtures(fixtures);
      setDevFixturesOpen(true);
    } catch (err) {
      addLog(`ERROR: Failed to load dev fixtures: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [addLog]);

  const loadDevFixture = useCallback((fixture: DevSolveFixture) => {
    const nodes = buildDevFixtureNodeMap(fixture);
    const root = nodes[historyKey([])];

    if (!root) {
      addLog(`ERROR: Dev fixture "${fixture.label}" is missing a root node.`);
      return;
    }

    workerRef.current?.terminate();
    workerRef.current = null;

    setGameType(fixture.gameType);
    setHeroPosition(fixture.heroPosition);
    setVillainPosition(fixture.villainPosition);
    setPotType(fixture.potType);
    setOopRange(fixture.oopRange);
    setIpRange(fixture.ipRange);
    setBoardSlots(fixture.boardSlots);
    setActiveBoardSlot(null);
    setStartingPot(fixture.startingPot);
    setEffectiveStack(fixture.effectiveStack);
    setMaxIterations(fixture.maxIterations);
    setTargetExpl(fixture.targetExpl);
    setActionConfig(fixture.actionConfig);
    const fixturePreset = treePresetFromActionConfig(fixture.actionConfig);
    if (fixturePreset) setTreePreset(fixturePreset);
    setProgress(fixture.progress);
    setResults(root);
    setSolving(false);
    setNodeLoading(false);
    setCurrentHistory([]);
    setPathSegments([]);
    setNodeLocksByHistory({});
    setFixtureMode({ id: fixture.id, label: fixture.label, nodes });
    setDevFixturesOpen(false);
    setLogs([
      { time: new Date().toLocaleTimeString(), message: `Loaded dev fixture: ${fixture.label}` },
      {
        time: new Date().toLocaleTimeString(),
        message: `Fixture has ${fixture.nodes.length} saved nodes; memory estimate was ${fixture.memoryUsageMB.toFixed(0)} MB.`,
      },
      {
        time: new Date().toLocaleTimeString(),
        message: `Final fixture exploitability = ${fixture.progress.exploitability.toFixed(4)}`,
      },
    ]);
  }, [addLog]);

  useEffect(() => {
    if (!DEV_SOLVE_FIXTURES_ENABLED) return;

    const fixtureId = new URLSearchParams(window.location.search).get("practiceFixture");
    if (!fixtureId || fixtureMode?.id === fixtureId) return;

    let cancelled = false;

    loadDevSolveFixtures()
      .then((fixtures) => {
        if (cancelled) return;

        const fixture = fixtures.find((item) => item.id === fixtureId);
        if (!fixture) {
          addLog(`ERROR: Practice fixture "${fixtureId}" was not found.`);
          return;
        }

        loadDevFixture(fixture);
      })
      .catch((err) => {
        if (!cancelled) {
          addLog(`ERROR: Failed to load practice fixture: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [addLog, fixtureMode?.id, loadDevFixture]);

  const applySpotPreset = useCallback((
    nextGameType: GameType,
    nextHeroPosition: string,
    nextVillainPosition: string,
    nextPotType: PotType
  ) => {
    const ranges = buildPresetRanges(nextGameType, nextHeroPosition, nextVillainPosition, nextPotType);

    setGameType(nextGameType);
    setHeroPosition(nextHeroPosition);
    setVillainPosition(nextVillainPosition);
    setPotType(nextPotType);
    setOopRange(ranges.oopRange);
    setIpRange(ranges.ipRange);
    setActionConfig(buildTreePresetActionConfig(treePreset));
  }, [treePreset]);

  const updateActionConfig = useCallback(<K extends ActionSolverConfigKey | NumericSolverConfigKey>(
    key: K,
    value: Pick<SolverConfig, ActionSolverConfigKey | NumericSolverConfigKey>[K]
  ) => {
    setActionConfig((current) => ({
      ...current,
      [key]: value,
    }));
  }, []);

  const resetAdvancedToBaseline = useCallback(() => {
    setOopRange(presetRanges.oopRange);
    setIpRange(presetRanges.ipRange);
    setTreePreset("simple");
    setActionConfig(buildTreePresetActionConfig("simple"));
  }, [presetRanges.ipRange, presetRanges.oopRange]);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setSolving(false);
    setNodeLoading(false);
    addLog("Solve cancelled.");
  }, [addLog]);

  const navigateToHistory = useCallback((history: number[], segments: PathSegment[]) => {
    if (!results || solving || nodeLoading) return;

    setChancePickerOpen(false);

    if (fixtureMode) {
      const fixtureResult = fixtureMode.nodes[historyKey(history)];
      if (!fixtureResult) {
        addLog(`Dev fixture "${fixtureMode.label}" does not include node [${history.join(", ")}].`);
        return;
      }

      setCurrentHistory(history);
      setPathSegments(segments);
      setResults(fixtureResult);
      addLog(`${history.length ? "Selected" : "Root"} fixture node: ${fixtureResult.player}`);
      return;
    }

    if (!workerRef.current) return;

    setCurrentHistory(history);
    setPathSegments(segments);
    setNodeLoading(true);
    workerRef.current.postMessage({ type: "get_results", history });
  }, [addLog, fixtureMode, nodeLoading, results, solving]);

  const navigateAction = useCallback((actionIndex: number, action: string, total: number) => {
    if (!results || results.isChance || results.isTerminal || solving || nodeLoading) return;

    const nextHistory = [...currentHistory, actionIndex];
    const seat = results.player === "oop" ? oopPosition : results.player === "ip" ? ipPosition : results.player.toUpperCase();
    const nextSegments = [
      ...pathSegments,
      {
        id: `action-${nextHistory.length}-${actionIndex}`,
        kind: "action" as const,
        actions,
        historyLength: nextHistory.length,
        label: formatAction(action),
        meta: `${Math.round(total * 100)}%`,
        player: seat,
        selectedActionIndex: actionIndex,
      },
    ];

    navigateToHistory(nextHistory, nextSegments);
  }, [actions, currentHistory, navigateToHistory, nodeLoading, oopPosition, ipPosition, pathSegments, results, solving]);

  const navigateChanceCard = useCallback((card: number) => {
    if (!results || !results.isChance || solving || nodeLoading) return;

    const nextHistory = [...currentHistory, card];
    const nextSegments = [
      ...pathSegments,
      {
        id: `chance-${nextHistory.length}-${card}`,
        kind: "chance" as const,
        historyLength: nextHistory.length,
        label: cardLabelFromId(card),
        meta: streetForBoardLength(results.currentBoard.length + 1),
      },
    ];

    setChancePickerOpen(false);
    navigateToHistory(nextHistory, nextSegments);
  }, [currentHistory, navigateToHistory, nodeLoading, pathSegments, results, solving]);

  const jumpToRoot = useCallback(() => {
    if (!results || solving || nodeLoading) return;

    navigateToHistory([], []);
  }, [navigateToHistory, nodeLoading, results, solving]);

  const jumpToSegment = useCallback((segment: PathSegment) => {
    if (!results || solving || nodeLoading) return;

    const nextHistory = currentHistory.slice(0, segment.historyLength);
    const nextSegments = pathSegments.filter((item) => item.historyLength <= segment.historyLength);
    navigateToHistory(nextHistory, nextSegments);
  }, [currentHistory, navigateToHistory, nodeLoading, pathSegments, results, solving]);

  const openBoardSlot = useCallback((slotIndex: number) => {
    setActiveBoardSlot(slotIndex);
    setActiveCardRank(boardSlots[slotIndex]?.slice(0, -1) || "A");
  }, [boardSlots]);

  const openChancePicker = useCallback(() => {
    if (!results?.isChance || results.possibleCards.length === 0) return;

    const rankStillAvailable = results.possibleCards.some((card) => rankFromCard(card) === activeChanceRank);
    const firstRank =
      CARD_PICKER_RANKS.split("").find((rank) => results.possibleCards.some((card) => rankFromCard(card) === rank))
      ?? rankFromCard(results.possibleCards[0]);

    setActiveChanceRank(rankStillAvailable ? activeChanceRank : firstRank);
    setChancePickerOpen(true);
  }, [activeChanceRank, results]);

  const selectBoardCard = useCallback((card: string) => {
    if (activeBoardSlot === null) return;

    setBoardSlots((current) => {
      if (current.some((slot, index) => slot === card && index !== activeBoardSlot)) {
        return current;
      }

      const next = [...current];
      next[activeBoardSlot] = card;
      return next;
    });
    setActiveBoardSlot(null);
  }, [activeBoardSlot]);

  const clearBoardSlot = useCallback((slotIndex: number) => {
    setBoardSlots((current) => {
      const next = [...current];
      next[slotIndex] = "";
      return next;
    });
    setActiveBoardSlot(null);
  }, []);

  const handleSolve = useCallback((lockStrategy?: number[] | null) => {
    const activeLock = Array.isArray(lockStrategy) ? lockStrategy : null;
    const solveHistory = activeLock ? currentHistory : [];
    const errors = validateSolveConfig(solverConfig, boardSlots);

    if (errors.length > 0) {
      setLogs(errors.map((message) => ({ time: new Date().toLocaleTimeString(), message: `ERROR: ${message}` })));
      return;
    }

    workerRef.current?.terminate();
    setFixtureMode(null);
    setSolving(true);
    setNodeLoading(false);
    setResults(null);
    setProgress(null);
    setCurrentHistory(solveHistory);
    if (!activeLock) {
      setPathSegments([]);
      setNodeLocksByHistory({});
    }
    setLogs([]);

    const worker = new Worker("/solver-worker.js?v=15", { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const msg = event.data;

      switch (msg.type) {
        case "init_done":
          addLog(`Game initialized. Memory: ${msg.memoryUsageMB.toFixed(0)} MB`);
          break;
        case "memory_allocated":
          addLog(activeLock ? "Memory allocated. Applying nodelock." : "Memory allocated. Starting solve.");
          if (activeLock) {
            worker.postMessage({
              type: "lock_current_node",
              history: solveHistory,
              strategy: activeLock,
            });
          } else {
            worker.postMessage({
              type: "solve",
              maxIterations,
              targetExploitability: (startingPot * targetExpl) / 100,
            });
          }
          break;
        case "locked_done":
          addLog("Nodelock applied. Starting re-solve.");
          worker.postMessage({
            type: "solve",
            maxIterations,
            targetExploitability: (startingPot * targetExpl) / 100,
          });
          break;
        case "progress":
          setProgress({
            exploitability: msg.exploitability,
            iteration: msg.iteration,
          });
          addLog(`Iteration ${msg.iteration}: exploitability = ${msg.exploitability.toFixed(4)}`);
          break;
        case "solve_done":
          setProgress((current) => ({
            exploitability: msg.exploitability,
            iteration: current?.iteration ?? maxIterations,
          }));
          addLog(`Solve complete. Final exploitability = ${msg.exploitability.toFixed(4)}`);
          setNodeLoading(true);
          worker.postMessage({ type: "get_results", history: solveHistory });
          break;
        case "results":
          setResults({
            actions: msg.actions,
            currentBoard: msg.currentBoard ?? [],
            history: msg.history ?? [],
            isChance: Boolean(msg.isChance),
            isTerminal: Boolean(msg.isTerminal),
            numActions: msg.numActions,
            player: msg.player,
            possibleCards: msg.possibleCards ?? [],
            privateCards: msg.privateCards,
            rootEqIp: msg.rootEqIp,
            rootEqOop: msg.rootEqOop,
            rootEvIp: msg.rootEvIp,
            rootEvOop: msg.rootEvOop,
            strategy: msg.strategy,
            totalBetAmount: msg.totalBetAmount ?? [],
          });
          setCurrentHistory(msg.history ?? []);
          setNodeLoading(false);
          addLog(`${msg.history?.length ? "Selected" : "Root"} node player: ${msg.player}`);
          addLog(`OOP EV = ${msg.rootEvOop.toFixed(4)}; equity = ${msg.rootEqOop.toFixed(5)}`);
          setSolving(false);
          if (activeLock) {
            setNodeLockEnabled(false);
            addLog("Nodelock applied. Returned to study mode.");
          }
          break;
        case "log":
          addLog(msg.message);
          break;
        case "error":
          addLog(`ERROR: ${msg.message}`);
          setSolving(false);
          setNodeLoading(false);
          break;
      }
    };

    worker.onerror = (err) => {
      addLog(`Worker error: ${err.message}`);
      setSolving(false);
      setNodeLoading(false);
    };

    try {
      worker.postMessage({
        type: "init",
        config: solverConfig,
      });
    } catch (err) {
      addLog(`Config error: ${err instanceof Error ? err.message : String(err)}`);
      setSolving(false);
      setNodeLoading(false);
    }
  }, [
    addLog,
    boardSlots,
    currentHistory,
    maxIterations,
    startingPot,
    solverConfig,
    targetExpl,
  ]);

  const updateNodeLockHands = useCallback((
    updater: Record<number, number[]> | ((current: Record<number, number[]>) => Record<number, number[]>)
  ) => {
    setNodeLocksByHistory((prev) => {
      const current = prev[currentNodeLockKey] ?? {};
      const nextHands = typeof updater === "function" ? updater(current) : updater;

      if (Object.keys(nextHands).length === 0) {
        const next = { ...prev };
        delete next[currentNodeLockKey];
        return next;
      }

      return { ...prev, [currentNodeLockKey]: nextHands };
    });
  }, [currentNodeLockKey]);

  const clearNodeLock = useCallback(() => {
    setNodeLocksByHistory((prev) => {
      const next = { ...prev };
      delete next[currentNodeLockKey];
      return next;
    });
  }, [currentNodeLockKey]);

  const unpaintHandClass = useCallback((label: string) => {
    if (!results) return;

    const indices = handClassIndices(results, label);
    updateNodeLockHands((current) => {
      const next = { ...current };
      indices.forEach((hand) => {
        delete next[hand];
      });
      return next;
    });
  }, [results, updateNodeLockHands]);

  const setNodeLockBrushPercent = useCallback((actionIndex: number, nextValue: number) => {
    setNodeLockBrushPercents((prev) => {
      const numActions = results?.numActions ?? prev.length;
      const base = prev.length === numActions
        ? prev
        : oneHotPercents(numActions, Math.min(nodeLockBrushAction, numActions - 1));
      return setBrushActionPercent(base, actionIndex, nextValue);
    });
  }, [nodeLockBrushAction, results?.numActions]);

  const resetNodeLockBrush = useCallback((numActions: number, actionIndex: number) => {
    const safeIndex = Math.max(0, Math.min(actionIndex, numActions - 1));
    setNodeLockBrushAction(safeIndex);
    setNodeLockBrushPercents(oneHotPercents(numActions, safeIndex));
  }, []);

  const effectiveNodeLockBrushPercents = useMemo(() => {
    if (!results || results.isChance || results.isTerminal) return nodeLockBrushPercents;
    if (nodeLockBrushPercents.length === results.numActions) return nodeLockBrushPercents;
    return oneHotPercents(results.numActions, Math.min(nodeLockBrushAction, results.numActions - 1));
  }, [nodeLockBrushAction, nodeLockBrushPercents, results]);

  const paintHandClass = useCallback((label: string) => {
    if (!results || !nodeLockEnabled) return;

    const actionStrategy = brushStrategyFromPercents(effectiveNodeLockBrushPercents);
    const indices = handClassIndices(results, label);

    updateNodeLockHands((current) => {
      const next = { ...current };
      indices.forEach((hand) => {
        next[hand] = actionStrategy;
      });
      return next;
    });
  }, [effectiveNodeLockBrushPercents, nodeLockEnabled, results, updateNodeLockHands]);

  useEffect(() => {
    if (!nodeLockEnabled) return;

    const stopPainting = () => {
      nodeLockPaintingRef.current = false;
    };

    window.addEventListener("mouseup", stopPainting);
    return () => window.removeEventListener("mouseup", stopPainting);
  }, [nodeLockEnabled]);

  const beginPaintHandClass = useCallback((label: string, isPainted: boolean) => {
    if (!nodeLockEnabled) return;
    if (isPainted) {
      unpaintHandClass(label);
      nodeLockPaintingRef.current = false;
      return;
    }
    nodeLockPaintingRef.current = true;
    paintHandClass(label);
  }, [nodeLockEnabled, paintHandClass, unpaintHandClass]);

  const continuePaintHandClass = useCallback((label: string) => {
    if (!nodeLockEnabled || !nodeLockPaintingRef.current) return;
    paintHandClass(label);
  }, [nodeLockEnabled, paintHandClass]);

  return (
    <main className="h-screen overflow-hidden bg-[#101112] text-zinc-100">
      <header className="flex h-14 items-center justify-between border-b border-white/10 bg-[#191a1c] px-4">
        <div className="flex items-center gap-4">
          <Image
            alt="PostFlop Solver"
            className="h-7 w-auto shrink-0"
            height={28}
            priority
            src="/WhiteLogo.svg"
            unoptimized
            width={126}
          />
          <nav className="ml-5 hidden items-center gap-1 text-sm text-zinc-400 md:flex">
            <button
              className={
                centerView === "strategy"
                  ? "rounded bg-white/8 px-3 py-1.5 text-zinc-100"
                  : "rounded px-3 py-1.5 hover:bg-white/6"
              }
              onClick={() => setCenterView("strategy")}
              type="button"
            >
              Study
            </button>
            <button className="rounded px-3 py-1.5 hover:bg-white/6">Sessions</button>
            <Link className="rounded px-3 py-1.5 hover:bg-white/6" href="/simulations">
              Simulations
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden rounded border border-sky-300/30 bg-sky-300/10 px-2.5 py-1 text-sky-200 sm:inline">
            {solving ? "Solving" : fixtureMode ? "Dev fixture" : results ? "Solved" : "Ready"}
          </span>
          <button
            className="rounded bg-white/8 px-3 py-1.5 text-zinc-200 hover:bg-white/12"
            type="button"
          >
            Export
          </button>
        </div>
      </header>

      <div className="grid h-[calc(100vh-3.5rem)] grid-cols-1 overflow-hidden xl:grid-cols-[360px_minmax(520px,1fr)_430px]">
        <aside className="scrollbar-hidden overflow-y-auto border-r border-white/10 bg-[#161719] p-4">
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold">Configure Spot</h1>
                <p className="text-xs text-zinc-500">{gameType} postflop tree</p>
              </div>
              <span className="rounded bg-white/8 px-2 py-1 text-xs text-zinc-400">300bb</span>
            </div>

            <button
              className="w-full rounded border border-white/10 bg-[#1d1e21] p-3 text-left hover:border-sky-300/40 hover:bg-[#162b35]"
              onClick={() => setSpotPresetOpen(true)}
              type="button"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Spot Preset</h2>
                <span className="text-xs text-zinc-500">Configure ›</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Game</span>
                  <span className="font-semibold text-zinc-100">{gameType}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Players</span>
                  <span className="font-semibold text-zinc-100">
                    Hero {heroPosition} / Villain {villainPosition}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Pot</span>
                  <span className="font-semibold text-zinc-100">{potType}</span>
                </div>
                <div className="rounded bg-black/20 px-3 py-2 text-xs text-zinc-500">
                  OOP <span className="font-semibold text-zinc-200">{oopPosition}</span>
                  <span className="px-1 text-zinc-700">/</span>
                  IP <span className="font-semibold text-zinc-200">{ipPosition}</span>
                </div>
              </div>
            </button>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-400">Board</span>
                <span className="text-xs text-zinc-500">Flop only</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {boardSlots.map((card, index) => {
                  const active = activeBoardSlot === index;
                  const label = `Flop ${index + 1}`;

                  return (
                    <div className="space-y-1" key={label}>
                      <PlayingCard
                        active={active}
                        card={card || undefined}
                        className="w-full"
                        onClick={() => openBoardSlot(index)}
                        tone="sky"
                      />
                      <div className="text-center text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-500">
                        {label}
                      </div>
                    </div>
                  );
                })}
              </div>

              {activeBoardSlot !== null && (
                <div className="mt-3 rounded border border-white/10 bg-[#1d1e21] p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">Choose card</div>
                      <div className="text-xs text-zinc-500">
                        Flop card {activeBoardSlot + 1}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {boardSlots[activeBoardSlot] && (
                        <button
                          className="rounded bg-white/8 px-2 py-1 text-xs text-zinc-300 hover:bg-white/12"
                          onClick={() => clearBoardSlot(activeBoardSlot)}
                          type="button"
                        >
                          Clear
                        </button>
                      )}
                      <button
                        className="rounded bg-white/8 px-2 py-1 text-xs text-zinc-300 hover:bg-white/12"
                        onClick={() => setActiveBoardSlot(null)}
                        type="button"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <div className="mb-1.5 text-xs font-medium text-zinc-500">Rank</div>
                      <div className="grid grid-cols-7 gap-1.5">
                        {CARD_PICKER_RANKS.split("").map((rank) => (
                          <button
                            className={
                              activeCardRank === rank
                                ? "rounded bg-sky-300 px-2 py-2 text-sm font-semibold text-black"
                                : "rounded bg-[#26272a] px-2 py-2 text-sm font-semibold text-zinc-100 hover:bg-[#33353a]"
                            }
                            key={rank}
                            onClick={() => setActiveCardRank(rank)}
                            type="button"
                          >
                            {rank}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-xs font-medium text-zinc-500">Suit</span>
                        <span className="text-xs text-zinc-600">Pick {activeCardRank} suit</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {CARD_PICKER_SUITS.split("").map((suit) => {
                          const card = `${activeCardRank}${suit}`;
                          const selectedInOtherSlot =
                            selectedBoardCards.has(card) && boardSlots[activeBoardSlot] !== card;

                          return (
                            <PlayingCard
                              active={boardSlots[activeBoardSlot] === card}
                              card={card}
                              className="w-full"
                              disabled={selectedInOtherSlot}
                              key={suit}
                              onClick={() => selectBoardCard(card)}
                              tone="sky"
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-400">Pot</span>
                <input
                  className="h-10 w-full rounded border border-white/10 bg-[#222326] px-3 text-sm outline-none focus:border-sky-300/70"
                  type="number"
                  value={startingPot}
                  onChange={(event) => setStartingPot(Number(event.target.value))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-400">Stack</span>
                <input
                  className="h-10 w-full rounded border border-white/10 bg-[#222326] px-3 text-sm outline-none focus:border-sky-300/70"
                  type="number"
                  value={effectiveStack}
                  onChange={(event) => setEffectiveStack(Number(event.target.value))}
                />
              </label>
            </div>

            <div className="rounded border border-white/10 bg-[#1d1e21] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Bet sizing</h2>
                {!actionConfigMatchesPreset && (
                  <span className="rounded bg-amber-300/10 px-2 py-0.5 text-[11px] text-amber-100">Custom tree</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TREE_PRESETS) as TreePreset[]).map((preset) => {
                  const active = treePreset === preset && actionConfigMatchesPreset;

                  return (
                    <button
                      className={
                        active
                          ? "rounded border border-sky-300/60 bg-sky-300 px-3 py-2.5 text-left text-xs font-semibold text-black"
                          : "rounded border border-white/10 bg-[#222326] px-3 py-2.5 text-left text-xs font-semibold text-zinc-200 hover:border-sky-300/50 hover:bg-[#22313a]"
                      }
                      key={preset}
                      onClick={() => selectTreePreset(preset)}
                      type="button"
                    >
                      {TREE_PRESETS[preset].label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">{activePresetMeta.description}</p>
              <div className="mt-2 rounded bg-black/20 px-3 py-2 font-mono text-[11px] text-zinc-400">
                Bets {activePresetMeta.bets} · Raises {activePresetMeta.raises}
              </div>
            </div>

            <div className="space-y-2">
              {validationErrors.length > 0 && (
                <div className="rounded border border-amber-300/30 bg-amber-300/10 p-3 text-xs text-amber-100">
                  <div className="mb-1 font-semibold">Before solving</div>
                  <ul className="list-disc space-y-1 pl-4">
                    {validationErrors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="grid grid-cols-[1fr_44px] gap-2">
                <button
                  className="h-11 w-full rounded bg-sky-300 font-semibold text-black transition hover:bg-sky-200 disabled:bg-zinc-700 disabled:text-zinc-400"
                  disabled={solving || validationErrors.length > 0}
                  onClick={() => handleSolve(pendingNodeLockStrategy)}
                  type="button"
                >
                  {solving ? "Solving..." : pendingNodeLockStrategy ? "Solve With Lock" : "Solve Tree"}
                </button>
                <button
                  aria-label="Solve settings"
                  className="grid h-11 place-items-center rounded border border-white/10 bg-[#222326] text-xl text-zinc-200 hover:border-sky-300/60 hover:bg-[#24313a]"
                  onClick={() => setSolveSettingsOpen(true)}
                  type="button"
                >
                  ⚙
                </button>
              </div>
              {solving && (
                <button
                  className="h-10 w-full rounded border border-white/10 text-sm text-zinc-300 hover:bg-white/8"
                  onClick={stopWorker}
                  type="button"
                >
                  Cancel
                </button>
              )}
              {DEV_SOLVE_FIXTURES_ENABLED && (
                <div className="rounded border border-amber-300/30 bg-amber-300/10 p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-amber-100">Development</div>
                      <div className="mt-1 text-xs text-zinc-400">
                        Load a saved solved spot without running the worker.
                      </div>
                    </div>
                    {fixtureMode && (
                      <span className="rounded bg-black/20 px-2 py-1 text-[10px] text-amber-100">
                        Fixture
                      </span>
                    )}
                  </div>
                  {fixtureMode && (
                    <div className="mb-2 truncate text-xs text-zinc-300">{fixtureMode.label}</div>
                  )}
                  <button
                    className="h-9 w-full rounded bg-amber-200 text-sm font-semibold text-black hover:bg-amber-100"
                    onClick={openDevFixtures}
                    type="button"
                  >
                    Load Dev Fixture
                  </button>
                </div>
              )}
            </div>
          </section>

          <section className="mt-5">
            <button
              className="flex w-full items-center justify-between rounded border border-white/10 bg-[#1d1e21] px-3 py-3 text-left hover:border-sky-300/40 hover:bg-[#162b35]"
              onClick={() => setAdvancedOpen(true)}
              type="button"
            >
              <span>
                <span className="block text-sm font-semibold">Advanced settings</span>
                <span className="text-xs text-zinc-500">Ranges, full tree, rake, and generated payload</span>
              </span>
              <span className="text-lg text-zinc-500">›</span>
            </button>
          </section>
          {nodeLockLabel && !nodeLockEnabled && (
            <section className="mt-3 rounded border border-sky-300/20 bg-[#10242c]/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-zinc-300">Manual locks</div>
                  <div className="mt-1 text-xs text-zinc-500">{nodeLockLabel} — highlighted on the matrix</div>
                </div>
                <button
                  className="rounded bg-white/8 px-2 py-1 text-xs text-zinc-300 hover:bg-white/12"
                  onClick={clearNodeLock}
                  type="button"
                >
                  Clear
                </button>
              </div>
            </section>
          )}
        </aside>

        <section className="scrollbar-hidden min-w-0 overflow-y-auto bg-[#111214] p-3">
          <div className="scrollbar-hidden mb-2 flex gap-2 overflow-x-auto pb-1">
            {nodeLoading && (
              <span className="shrink-0 self-center rounded bg-sky-300/10 px-2.5 py-1.5 text-xs text-sky-200">
                Loading node...
              </span>
            )}
              <button
                className="flex h-28 min-w-28 shrink-0 flex-col overflow-hidden rounded border border-sky-300/30 bg-sky-300/10 px-2.5 py-3 text-left text-xs text-sky-100 hover:bg-sky-300/15 disabled:opacity-50"
                disabled={!results || solving || nodeLoading}
                onClick={jumpToRoot}
                type="button"
              >
                <span className="block font-semibold leading-none">FLOP</span>
                <div className="mt-3 flex gap-1">
                  {pathBoardCards.map((card) => (
                    <PlayingCard
                      card={card}
                      className="w-7 rounded shadow-sm shadow-black/20"
                      key={card}
                      tone="zinc"
                    />
                  ))}
                </div>
                {pathBoardCards.length === 0 && (
                  <span className="mt-3 rounded bg-black/20 px-2 py-1 text-[11px] text-sky-100/70">
                    Board
                  </span>
                )}
              </button>
              {pathSegments.map((segment) => {
                if (segment.kind === "chance") {
                  return (
                    <button
                      className="flex h-28 min-w-20 shrink-0 flex-col overflow-hidden rounded border border-white/10 bg-[#242529] px-2.5 py-3 text-left text-xs text-zinc-200 hover:border-sky-300/40 hover:bg-[#26313a] disabled:opacity-50"
                      disabled={!results || solving || nodeLoading}
                      key={segment.id}
                      onClick={() => jumpToSegment(segment)}
                      type="button"
                    >
                      <span className="mb-2 block font-semibold leading-none">{segment.meta}</span>
                      <PlayingCard card={segment.label} className="w-14 shadow-black/15" tone="zinc" />
                    </button>
                  );
                }

                return (
                  <div
                    className="h-28 min-w-24 shrink-0 overflow-hidden rounded border border-white/10 bg-[#242529] px-2.5 py-3 text-xs text-zinc-200"
                    key={segment.id}
                  >
                    <button
                      className="mb-1 block w-full rounded px-1.5 text-left font-semibold leading-none text-zinc-200 hover:text-sky-100 disabled:opacity-50"
                      disabled={!results || solving || nodeLoading}
                      onClick={() => jumpToSegment(segment)}
                      type="button"
                    >
                      {segment.player}
                    </button>
                    <div className="space-y-0.5">
                      {(segment.actions ?? []).map((action, index) => (
                        <button
                          className={
                            index === segment.selectedActionIndex
                              ? "block w-full rounded bg-sky-300/25 px-1.5 py-0.5 text-left font-medium text-sky-100"
                              : "block w-full rounded px-1.5 py-0.5 text-left text-zinc-400 hover:bg-white/8 hover:text-zinc-100"
                          }
                          disabled={!results || solving || nodeLoading}
                          key={`${segment.id}-${action}`}
                          onClick={() => jumpToSegment(segment)}
                          type="button"
                        >
                          {formatAction(action)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {results?.isChance && (
                <div className="relative flex h-28 min-w-24 shrink-0 flex-col overflow-hidden rounded border border-amber-300/70 bg-amber-300/10 px-2.5 py-3 text-xs text-zinc-200">
                  <div className="mb-2">
                    <div className="font-semibold leading-none text-amber-100">
                      {streetForBoardLength(results.currentBoard.length + 1)}
                    </div>
                  </div>
                  <PlayingCard
                    className="w-14 border-dashed"
                    disabled={solving || nodeLoading || results.possibleCards.length === 0}
                    onClick={openChancePicker}
                    placeholder="+"
                    tone="amber"
                  />
                  {chancePickerOpen && (
                    <div
                      className="fixed inset-0 z-50 bg-black/20"
                      onClick={() => setChancePickerOpen(false)}
                    >
                      <div
                        className="absolute left-1/2 top-24 w-72 -translate-x-1/2 rounded border border-amber-200/40 bg-[#1d1e21] p-3 text-zinc-100 shadow-2xl shadow-black/50"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-amber-100">Select card</div>
                            <div className="text-xs text-zinc-500">
                              Pick rank, then suit
                            </div>
                          </div>
                          <button
                            className="rounded bg-white/8 px-2 py-1 text-xs text-zinc-300 hover:bg-white/12"
                            onClick={() => setChancePickerOpen(false)}
                            type="button"
                          >
                            Close
                          </button>
                        </div>
                        <div className="space-y-3">
                          <div>
                            <div className="mb-1.5 text-xs font-medium text-zinc-500">Rank</div>
                            <div className="grid grid-cols-7 gap-1.5">
                              {CARD_PICKER_RANKS.split("").map((rank) => {
                                const rankAvailable = results.possibleCards.some((card) => rankFromCard(card) === rank);

                                return (
                                  <button
                                    className={
                                      activeChanceRank === rank
                                        ? "rounded bg-amber-200 px-2 py-2 text-sm font-semibold text-black"
                                        : rankAvailable
                                          ? "rounded bg-[#26272a] px-2 py-2 text-sm font-semibold text-zinc-100 hover:bg-[#33353a]"
                                          : "rounded bg-black/20 px-2 py-2 text-sm text-zinc-700"
                                    }
                                    disabled={!rankAvailable}
                                    key={rank}
                                    onClick={() => setActiveChanceRank(rank)}
                                    type="button"
                                  >
                                    {rank}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          <div>
                            <div className="mb-1.5 flex items-center justify-between">
                              <span className="text-xs font-medium text-zinc-500">Suit</span>
                              <span className="text-xs text-zinc-600">Pick {activeChanceRank} suit</span>
                            </div>
                            <div className="grid grid-cols-4 gap-1.5">
                              {CARD_PICKER_SUITS.split("").map((suit) => {
                                const card = `${activeChanceRank}${suit}`;
                                const cardId = CARD_MAP[card];
                                const possible = cardId !== undefined && results.possibleCards.includes(cardId);

                                return (
                                  <PlayingCard
                                    card={card}
                                    className="w-full"
                                    disabled={!possible || solving || nodeLoading}
                                    key={suit}
                                    onClick={() => {
                                      if (possible) navigateChanceCard(cardId);
                                    }}
                                    tone="amber"
                                  />
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  {!chancePickerOpen && results.possibleCards.length === 0 && (
                    <div className="mt-2 text-xs text-zinc-500">No legal cards available.</div>
                  )}
                </div>
              )}
              {results && !results.isChance && !results.isTerminal && (
                <div className="h-28 min-w-24 shrink-0 overflow-hidden rounded border border-amber-300/70 bg-amber-300/10 px-2.5 py-3 text-xs text-zinc-200">
                  <div className="mb-1 rounded px-1.5 font-semibold leading-none text-amber-100">{actingSeat}</div>
                  <div className="space-y-0.5">
                    {actions.map((action, index) => (
                      <button
                        disabled={solving || nodeLoading}
                        className="block w-full rounded px-1.5 py-0.5 text-left text-zinc-100 hover:bg-amber-300/20 disabled:opacity-50"
                        key={`current-${action}`}
                        onClick={() => navigateAction(index, action, actionTotals[index] ?? 0)}
                        type="button"
                      >
                        {formatAction(action)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {CENTER_VIEWS.map(({ id, label }) => (
                <button
                  className={
                    centerView === id
                      ? "rounded bg-white/10 px-3 py-1.5 font-medium text-zinc-100"
                      : "rounded px-3 py-1.5 text-zinc-400 hover:bg-white/6"
                  }
                  key={id}
                  onClick={() => setCenterView(id)}
                  type="button"
                >
                  {label}
                </button>
              ))}
              <label
                className={classNames(
                  "flex cursor-pointer items-center gap-2 rounded px-3 py-1.5 transition-colors",
                  nodeLockEnabled || lockedHandCount > 0
                    ? "bg-sky-300/15 text-sky-100 ring-1 ring-sky-300/40"
                    : "text-zinc-400 hover:bg-white/6",
                  (!results || solving || nodeLoading || results.isChance || results.isTerminal) &&
                    "pointer-events-none opacity-40"
                )}
              >
                <input
                  checked={nodeLockEnabled}
                  className="accent-sky-300"
                  disabled={!results || solving || nodeLoading || results?.isChance || results?.isTerminal}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setNodeLockEnabled(enabled);
                    if (enabled) {
                      setCenterView("strategy");
                      setRightLockTab("strategy");
                      if (results) {
                        resetNodeLockBrush(results.numActions, results.numActions > 1 ? 1 : 0);
                      }
                    }
                  }}
                  type="checkbox"
                />
                Nodelocking
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>{progress ? `${progress.iteration}/${maxIterations}` : "0/0"}</span>
              <span>Exploitability {exploitabilityPct.toFixed(3)}%</span>
            </div>
          </div>

          {centerView === "ranges" && (
            <ComingSoonPanel
              description="Range composition, weighting, and comparison views for the current spot."
              title="Ranges"
            />
          )}

          {centerView === "breakdown" && (
            <ComingSoonPanel
              description="Street-by-street EV, equity, and action-frequency breakdowns."
              title="Breakdown"
            />
          )}

          {centerView === "strategy" && (
          <div
            className={classNames(
              "grid aspect-square max-h-[calc(100vh-8rem)] min-h-[460px] w-full overflow-hidden rounded border border-black/70 bg-black/50",
              nodeLockEnabled && "select-none"
            )}
            style={{
              gridTemplateColumns: "repeat(13, minmax(0, 1fr))",
              ...(nodeLockEnabled ? { cursor: PAINTBRUSH_CURSOR } : {}),
            }}
          >
            {matrix.map((cell) => {
              const primaryActionIndex = actions.length > 1 ? 1 : 0;
              const primaryFreq = cell.actionFreqs[primaryActionIndex] ?? 0;
              const secondaryFreq = cell.actionFreqs[0] ?? 0;
              const locked = cell.comboCount === 0;
              const handIndices = results ? handClassIndices(results, cell.label) : [];
              const paintedHand = handIndices.find((hand) => nodeLockHands[hand]);
              const painted = paintedHand !== undefined;
              const paintedActionIndex = painted
                ? (nodeLockHands[paintedHand] ?? []).findIndex((freq) => freq > 0)
                : -1;
              const background = locked
                ? "#26272a"
                : comboStrategyGradient(cell.actionFreqs, actions);

              return (
                <button
                  key={cell.label}
                  className={classNames(
                    "relative min-h-0 border-b border-r border-black/55 p-1.5 text-left outline-none transition-[box-shadow,filter] duration-150 disabled:cursor-default",
                    !locked && !nodeLockEnabled && "cursor-crosshair hover:z-10 hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-sky-200",
                    !locked && nodeLockEnabled && "hover:z-10 hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-sky-200",
                    painted && "z-10 ring-2 ring-inset ring-sky-300/70",
                    hoveredHandLabel === cell.label && !nodeLockEnabled && "z-10 ring-2 ring-white/80"
                  )}
                  disabled={locked}
                  onFocus={() => {
                    if (!locked && !nodeLockEnabled) setHoveredHandLabel(cell.label);
                  }}
                  onMouseDown={(event) => {
                    if (locked || !nodeLockEnabled) return;
                    event.preventDefault();
                    beginPaintHandClass(cell.label, painted);
                  }}
                  onMouseEnter={() => {
                    if (locked) return;
                    if (nodeLockEnabled) {
                      continuePaintHandClass(cell.label);
                      return;
                    }
                    setHoveredHandLabel(cell.label);
                  }}
                  style={{ background }}
                  title={
                    painted
                      ? `${cell.label}: locked to ${formatAction(actions[paintedActionIndex] ?? actions[0])}${nodeLockEnabled ? " — click to unlock" : ""}`
                      : `${cell.label}: ${actions.map((action, i) => `${formatAction(action)} ${Math.round((cell.actionFreqs[i] ?? 0) * 100)}%`).join(", ")}`
                  }
                  type="button"
                >
                  <div className={locked ? "text-zinc-600" : "text-white drop-shadow"}>
                    <div className="text-sm font-semibold leading-none md:text-base">{cell.label}</div>
                    {!locked && (
                      <div className="mt-1 text-[10px] text-white/75">
                        {Math.round(primaryFreq * 100)} / {Math.round(secondaryFreq * 100)}
                      </div>
                    )}
                  </div>
                  {painted && (
                    <div className="pointer-events-none absolute inset-0 bg-sky-400/25 mix-blend-screen" />
                  )}
                  {painted && (
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-sky-200/60" />
                  )}
                </button>
              );
            })}
          </div>
          )}
        </section>

        <aside className="scrollbar-hidden overflow-y-auto border-l border-white/10 bg-[#161719] p-4">
          {nodeLockEnabled ? (
            <button
              className="mb-4 h-11 w-full rounded bg-sky-300 font-semibold text-black transition hover:bg-sky-200 disabled:bg-zinc-700 disabled:text-zinc-400"
              disabled={solving || validationErrors.length > 0 || !pendingNodeLockStrategy}
              onClick={() => handleSolve(pendingNodeLockStrategy)}
              type="button"
            >
              {solving ? "Solving..." : "Solve With Lock"}
            </button>
          ) : (
            <div className="mb-4 grid grid-cols-3 gap-2">
              <div className="rounded border border-sky-300/40 bg-sky-300/10 p-3">
                <div className="text-xs text-sky-200">OOP EV</div>
                <div className="text-xl font-semibold">{results ? results.rootEvOop.toFixed(2) : "--"}</div>
              </div>
              <div className="rounded border border-white/10 bg-[#222326] p-3">
                <div className="text-xs text-zinc-500">Equity</div>
                <div className="text-xl font-semibold">{results ? `${(results.rootEqOop * 100).toFixed(1)}%` : "--"}</div>
              </div>
              <div className="rounded border border-white/10 bg-[#222326] p-3">
                <div className="text-xs text-zinc-500">Pot odds</div>
                <div className="text-xl font-semibold">40%</div>
              </div>
            </div>
          )}

          <section className="rounded border border-white/10 bg-[#1d1e21] p-3">
            {nodeLockEnabled && results ? (
              <>
                <div className="mb-3 flex items-center gap-1 rounded-lg bg-black/25 p-1 text-xs">
                  {RIGHT_LOCK_TABS.map(({ id, label }) => (
                    <button
                      className={
                        rightLockTab === id
                          ? "flex flex-1 items-center justify-center rounded-md bg-white px-2 py-2 font-medium text-zinc-900"
                          : "flex flex-1 items-center justify-center rounded-md px-2 py-2 text-zinc-400 hover:bg-white/6 hover:text-zinc-200"
                      }
                      key={id}
                      onClick={() => setRightLockTab(id)}
                      type="button"
                    >
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>

                {rightLockTab === "strategy" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      {actions.map((action, index) => {
                        const actionColor = colorForAction(index, action);
                        const brushPct = effectiveNodeLockBrushPercents[index] ?? 0;

                        return (
                          <div
                            className="overflow-hidden rounded-lg text-left text-white opacity-90 transition-[transform,opacity] duration-150 hover:opacity-100"
                            key={action}
                            style={{ background: actionColor }}
                          >
                            <div className="p-3 pb-2">
                              <div className="text-sm font-semibold leading-tight">{formatAction(action)}</div>
                            </div>

                            <div className="flex items-center justify-center gap-2 px-3 pb-2">
                              <button
                                aria-label={`Decrease ${formatAction(action)} frequency`}
                                className="flex h-7 w-7 items-center justify-center rounded bg-black/20 text-lg leading-none text-white/90 hover:bg-black/30"
                                onClick={() => setNodeLockBrushPercent(index, brushPct - 1)}
                                type="button"
                              >
                                −
                              </button>
                              <input
                                aria-label={`${formatAction(action)} frequency`}
                                className="w-16 rounded bg-white px-2 py-1 text-center text-lg font-semibold tabular-nums text-zinc-900 outline-none"
                                inputMode="numeric"
                                max={100}
                                min={0}
                                onChange={(event) => {
                                  const parsed = Number.parseInt(event.target.value, 10);
                                  if (Number.isFinite(parsed)) {
                                    setNodeLockBrushPercent(index, parsed);
                                  }
                                }}
                                type="number"
                                value={brushPct}
                              />
                              <button
                                aria-label={`Increase ${formatAction(action)} frequency`}
                                className="flex h-7 w-7 items-center justify-center rounded bg-black/20 text-lg leading-none text-white/90 hover:bg-black/30"
                                onClick={() => setNodeLockBrushPercent(index, brushPct + 1)}
                                type="button"
                              >
                                +
                              </button>
                            </div>

                            <div className="grid grid-cols-5 border-t border-black/20 bg-black/15">
                              {[0, 25, 50, 75, 100].map((pct) => (
                                <button
                                  className={classNames(
                                    "py-1.5 text-center text-[11px] font-medium transition-colors",
                                    pct === brushPct ? "bg-black/25 text-white" : "text-white/70 hover:bg-black/10 hover:text-white"
                                  )}
                                  key={pct}
                                  onClick={() => setNodeLockBrushPercent(index, pct)}
                                  type="button"
                                >
                                  {pct}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <NodeLockMixBar
                      actions={actions}
                      onPercentChange={setNodeLockBrushPercent}
                      percents={effectiveNodeLockBrushPercents}
                      selectedAction={nodeLockBrushAction}
                    />

                    <div className="flex items-center justify-between text-xs text-zinc-500">
                      <span>
                        {lockedHandCount > 0
                          ? `${lockedHandCount} combo${lockedHandCount === 1 ? "" : "s"} painted — click cells to unlock`
                          : "Paint hand classes on the matrix"}
                      </span>
                      <button
                        className="rounded px-2 py-1 text-zinc-400 hover:bg-white/8 hover:text-zinc-200 disabled:opacity-40"
                        disabled={lockedHandCount === 0}
                        onClick={clearNodeLock}
                        type="button"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}

                {rightLockTab === "frequency" && (
                  <ComingSoonPanel
                    compact
                    description="Set mixed action frequencies before painting hand classes."
                    title="Set frequency"
                  />
                )}

                {rightLockTab === "lock" && (
                  <ComingSoonPanel
                    compact
                    description="Bulk lock or unlock hand categories, draws, and equity buckets."
                    title="Lock / Unlock"
                  />
                )}
              </>
            ) : (
              <>
                <div className="mb-3">
                  <h2 className="text-sm font-semibold">Actions</h2>
                  <span className="text-xs text-zinc-500">{currentNodeLabel}</span>
                </div>
                <div className="space-y-2">
                  {results?.isTerminal && (
                    <div className="rounded bg-[#25262a] p-3 text-sm text-zinc-400">
                      This line has reached a terminal node.
                    </div>
                  )}

                  {results?.isChance && (
                    <div className="rounded bg-[#25262a] p-3 text-sm text-zinc-400">
                      Choose the next board card in the action path.
                    </div>
                  )}

                  {!results?.isChance && !results?.isTerminal && actions.map((action, index) => {
                    const numHands = results ? Math.floor(results.privateCards.length / 2) : 0;
                    const total = actionTotals[index] ?? 0;

                    return (
                      <button
                        key={action}
                        className="block w-full overflow-hidden rounded bg-[#25262a] text-left hover:bg-[#303238] disabled:hover:bg-[#25262a]"
                        disabled={!results || solving || nodeLoading}
                        onClick={() => navigateAction(index, action, total)}
                        type="button"
                      >
                        <div className="flex items-end justify-between p-3">
                          <div>
                            <div className="text-lg font-semibold">{formatAction(action)}</div>
                            <div className="text-xs text-zinc-500">{numHands ? `${(total * numHands).toFixed(1)} combos` : "pending"}</div>
                          </div>
                          <div className="text-2xl font-semibold">{Math.round(total * 100)}%</div>
                        </div>
                        <div className="h-2" style={{ background: colorForAction(index, action), width: `${Math.max(2, total * 100)}%` }} />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          <section className="mt-4 overflow-hidden rounded border border-white/10 bg-[#1d1e21]">
            <div className="flex items-center gap-1 border-b border-white/10 bg-black/20 px-2 pt-2 text-sm">
              {DETAIL_TABS.map(({ id, label }) => (
                <button
                  className={
                    detailTab === id
                      ? "rounded-t bg-[#25262a] px-3 py-2 font-medium text-zinc-100"
                      : "rounded-t px-3 py-2 text-zinc-500 hover:bg-white/6 hover:text-zinc-300"
                  }
                  key={id}
                  onClick={() => setDetailTab(id)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="p-3">
              {detailTab === "hands" && (
                <>
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold">
                        {activeHandLabel ? `${activeHandLabel} Combos` : "Combo Inspector"}
                      </h2>
                      <p className="text-xs text-zinc-500">
                        {activeHandLabel
                          ? "Hover another matrix cell to inspect its exact suits."
                          : "Hover a hand in the strategy grid to inspect exact combos."}
                      </p>
                    </div>
                    {activeComboRows.length > 0 && (
                      <span className="rounded bg-white/8 px-2 py-1 text-xs text-zinc-400">
                        {activeComboRows.length} combo{activeComboRows.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>

                  {activeComboRows.length === 0 ? (
                    <p className="rounded bg-[#25262a] p-3 text-sm text-zinc-500">
                      Solve the current spot, then hover the matrix to populate combo frequencies.
                    </p>
                  ) : (
                    <div className="scrollbar-hidden grid max-h-72 grid-cols-2 gap-1 overflow-y-auto pr-1">
                      {activeComboRows.map((row) => {
                        const tileBackground = comboStrategyGradient(row.freqs, actions);

                        return (
                          <div
                            className="min-h-36 rounded-sm border border-black/35 p-2 text-sm text-white shadow-inner shadow-white/10"
                            key={row.handIndex}
                            style={{ background: tileBackground }}
                          >
                            <div className="mb-5 flex items-start justify-between">
                              <div className="flex items-center gap-1">
                                {[row.cardA, row.cardB].map((card) => (
                                  <PlayingCard
                                    card={card}
                                    className="w-8 rounded shadow-sm shadow-black/20"
                                    key={card}
                                    tone="zinc"
                                  />
                                ))}
                              </div>
                              <span className="font-mono text-sm text-black/70">%</span>
                            </div>

                            <div className="space-y-0.5 text-black/75">
                              {actions.map((action, index) => (
                                <div className="grid grid-cols-[1fr_auto] gap-2 leading-5" key={action}>
                                  <span>{formatAction(action)}</span>
                                  <span className="font-mono">{formatStrategyPercent(row.freqs[index] ?? 0)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {detailTab === "summary" && (
                <ComingSoonPanel
                  compact
                  description="Aggregated stats for the hovered hand class and current node."
                  title="Summary"
                />
              )}

              {detailTab === "filters" && (
                <ComingSoonPanel
                  compact
                  description="Filter combos by suit, strength, and action frequency."
                  title="Filters"
                />
              )}

              {detailTab === "blockers" && (
                <ComingSoonPanel
                  compact
                  description="Blocker effects on villain range and board interaction."
                  title="Blockers"
                />
              )}
            </div>
          </section>

          <section className="mt-4 rounded border border-white/10 bg-[#1d1e21] p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Run Log</h2>
              <span className="text-xs text-zinc-500">{logs.length} lines</span>
            </div>
            <div className="scrollbar-hidden h-52 space-y-1 overflow-y-auto rounded bg-black/30 p-2 font-mono text-xs">
              {logs.length === 0 && <p className="text-zinc-600">No solve started.</p>}
              {logs.map((log, index) => (
                <div key={`${log.time}-${index}`} className={log.message.startsWith("ERROR") ? "text-red-300" : "text-zinc-400"}>
                  <span className="text-zinc-600">[{log.time}]</span> {log.message}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {DEV_SOLVE_FIXTURES_ENABLED && devFixturesOpen && (
        <Modal title="Load dev fixture" onClose={() => setDevFixturesOpen(false)}>
          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Pre-solved development spots</h3>
              <p className="mt-1 text-xs text-zinc-500">
                These JSON fixtures hydrate the UI instantly. They include root and shallow action-path nodes only.
              </p>
            </div>
            <div className="space-y-2">
              {devFixtures.map((fixture) => (
                <button
                  className="block w-full rounded border border-white/10 bg-[#222326] p-3 text-left hover:border-amber-200/60 hover:bg-[#2a2923]"
                  key={fixture.id}
                  onClick={() => loadDevFixture(fixture)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-100">{fixture.label}</div>
                      <div className="mt-1 text-xs text-zinc-500">{fixture.description}</div>
                    </div>
                    <span className="shrink-0 rounded bg-black/20 px-2 py-1 text-[10px] text-zinc-400">
                      {fixture.nodes.length} nodes
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-zinc-500">
                    <span className="rounded bg-black/20 px-2 py-1">{fixture.boardSlots.join(" ")}</span>
                    <span className="rounded bg-black/20 px-2 py-1">{fixture.maxIterations} iterations</span>
                    <span className="rounded bg-black/20 px-2 py-1">
                      Expl {fixture.progress.exploitability.toFixed(2)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {spotPresetOpen && (
        <Modal title="Configure spot preset" onClose={() => setSpotPresetOpen(false)}>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Preset Inputs</h3>
              <p className="mt-1 text-xs text-zinc-500">
                These choices determine the heuristic OOP and IP ranges sent to the solver.
              </p>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">Game type</span>
              <select
                className="h-10 w-full rounded border border-white/10 bg-[#222326] px-3 text-sm outline-none focus:border-sky-300/70"
                onChange={(event) => {
                  const nextGameType = event.target.value as GameType;
                  const nextPositions: readonly string[] = POSITIONS_BY_GAME[nextGameType];
                  const nextHeroPosition = nextPositions.includes(heroPosition) ? heroPosition : nextPositions[0];
                  const nextVillainPosition =
                    nextPositions.includes(villainPosition) && villainPosition !== nextHeroPosition
                      ? villainPosition
                      : nextPositions.find((position) => position !== nextHeroPosition) ?? nextPositions[0];

                  applySpotPreset(nextGameType, nextHeroPosition, nextVillainPosition, potType);
                }}
                value={gameType}
              >
                {GAME_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Hero</span>
                <select
                  className="h-10 w-full rounded border border-white/10 bg-[#222326] px-3 text-sm outline-none focus:border-sky-300/70"
                  onChange={(event) => {
                    const nextHeroPosition = event.target.value;
                    const nextVillainPosition =
                      nextHeroPosition === villainPosition
                        ? availablePositions.find((position) => position !== nextHeroPosition) ?? villainPosition
                        : villainPosition;

                    applySpotPreset(gameType, nextHeroPosition, nextVillainPosition, potType);
                  }}
                  value={heroPosition}
                >
                  {availablePositions.map((position) => (
                    <option disabled={position === villainPosition} key={position} value={position}>
                      {position}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Villain</span>
                <select
                  className="h-10 w-full rounded border border-white/10 bg-[#222326] px-3 text-sm outline-none focus:border-sky-300/70"
                  onChange={(event) => {
                    applySpotPreset(gameType, heroPosition, event.target.value, potType);
                  }}
                  value={villainPosition}
                >
                  {availablePositions.map((position) => (
                    <option disabled={position === heroPosition} key={position} value={position}>
                      {position}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs text-zinc-500">Pot type</span>
              <select
                className="h-10 w-full rounded border border-white/10 bg-[#222326] px-3 text-sm outline-none focus:border-sky-300/70"
                onChange={(event) => {
                  applySpotPreset(gameType, heroPosition, villainPosition, event.target.value as PotType);
                }}
                value={potType}
              >
                {POT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded border border-white/10 bg-[#222326] p-3 text-sm">
              <div className="mb-1 text-xs text-zinc-500">Solver ranges</div>
              <div className="font-semibold">
                OOP {oopPosition} <span className="px-1 text-zinc-600">/</span> IP {ipPosition}
              </div>
            </div>
            <div className="flex justify-end">
              <button
                className="rounded bg-sky-300 px-4 py-2 text-sm font-semibold text-black hover:bg-sky-200"
                onClick={() => setSpotPresetOpen(false)}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}

      {solveSettingsOpen && (
        <Modal title="Solve settings" onClose={() => setSolveSettingsOpen(false)}>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Run Controls</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Tune solver runtime and convergence target before starting a solve.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Iterations</span>
                <input
                  className="h-10 w-full rounded border border-white/10 bg-[#222326] px-3 text-sm outline-none focus:border-sky-300/70"
                  type="number"
                  value={maxIterations}
                  onChange={(event) => setMaxIterations(Number(event.target.value))}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">Target % pot</span>
                <input
                  className="h-10 w-full rounded border border-white/10 bg-[#222326] px-3 text-sm outline-none focus:border-sky-300/70"
                  type="number"
                  step="0.1"
                  value={targetExpl}
                  onChange={(event) => setTargetExpl(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button
                className="rounded bg-sky-300 px-4 py-2 text-sm font-semibold text-black hover:bg-sky-200"
                onClick={() => setSolveSettingsOpen(false)}
                type="button"
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}

      {advancedOpen && (
        <Modal title="Advanced settings" onClose={() => setAdvancedOpen(false)}>
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Ranges</h3>
                <p className="mt-1 text-xs text-zinc-500">
                  Starter ranges are heuristic. Manual edits are sent directly to the solver.
                </p>
              </div>
              <span className={rangeIsBaseline ? "rounded bg-emerald-300/10 px-2 py-1 text-xs text-emerald-200" : "rounded bg-amber-300/10 px-2 py-1 text-xs text-amber-100"}>
                {rangeIsBaseline ? "Preset ranges" : "Manual range edits"}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">OOP range</span>
                <textarea
                  className="h-32 w-full resize-none rounded border border-white/10 bg-[#222326] p-2 font-mono text-xs outline-none focus:border-sky-300/70"
                  value={oopRange}
                  onChange={(event) => setOopRange(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">IP range</span>
                <textarea
                  className="h-32 w-full resize-none rounded border border-white/10 bg-[#222326] p-2 font-mono text-xs outline-none focus:border-sky-300/70"
                  value={ipRange}
                  onChange={(event) => setIpRange(event.target.value)}
                />
              </label>
            </div>

            <section className="rounded border border-white/10 bg-[#202124] p-3">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Action tree preset</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Same bet and raise sizes for OOP and IP on flop, turn, and river.
                  </p>
                </div>
                <span className={actionConfigIsDefault ? "rounded bg-emerald-300/10 px-2 py-1 text-xs text-emerald-200" : "rounded bg-amber-300/10 px-2 py-1 text-xs text-amber-100"}>
                  {actionConfigIsDefault ? activePresetMeta.label : "Custom tree"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(TREE_PRESETS) as TreePreset[]).map((preset) => {
                  const active = treePreset === preset && actionConfigMatchesPreset;

                  return (
                    <button
                      className={
                        active
                          ? "rounded border border-sky-300/60 bg-sky-300 px-3 py-3 text-left"
                          : "rounded border border-white/10 bg-[#242528] px-3 py-3 text-left hover:border-sky-300/50 hover:bg-[#22313a]"
                      }
                      key={preset}
                      onClick={() => selectTreePreset(preset)}
                      type="button"
                    >
                      <div className={active ? "text-sm font-semibold text-black" : "text-sm font-semibold text-zinc-200"}>
                        {TREE_PRESETS[preset].label}
                      </div>
                      <div className={active ? "mt-1 text-[11px] text-black/70" : "mt-1 text-[11px] text-zinc-500"}>
                        Bets {TREE_PRESETS[preset].bets} · Raises {TREE_PRESETS[preset].raises}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-zinc-500">{activePresetMeta.description}</p>
            </section>

            <section className="rounded border border-white/10 bg-[#202124] p-3">
              <h3 className="text-sm font-semibold">Rake and tree tuning</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Presets enable force-all-in (0.15) and bet merging (0.1). Change only if you need custom tree behavior or rake.
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {NUMERIC_LABELS.map(({ key, label }) => (
                  <label className="block" key={key}>
                    <span className="mb-1 block text-xs text-zinc-500">
                      {label}
                      {actionConfig[key] !== presetActionConfig[key] && <span className="ml-1 text-amber-200">changed</span>}
                    </span>
                    <input
                      className="h-9 w-full rounded border border-white/10 bg-[#26272a] px-2 text-sm outline-none focus:border-sky-300/70"
                      min="0"
                      max={key === "rakeRate" ? 1 : undefined}
                      step="0.01"
                      type="number"
                      value={actionConfig[key]}
                      onChange={(event) => updateActionConfig(key, Number(event.target.value))}
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded border border-white/10 bg-[#202124] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Generated config preview</h3>
                <span className="text-xs text-zinc-500">{validationErrors.length === 0 ? "Ready" : `${validationErrors.length} issue${validationErrors.length === 1 ? "" : "s"}`}</span>
              </div>
              {treeSizeWarning && (
                <div className="mb-3 rounded border border-amber-300/30 bg-amber-300/10 p-2 text-xs text-amber-100">
                  This tree has many bet and raise options and may require more memory or solve time.
                </div>
              )}
              {validationErrors.length > 0 && (
                <ul className="mb-3 list-disc space-y-1 rounded border border-red-300/30 bg-red-300/10 p-3 pl-6 text-xs text-red-100">
                  {validationErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
              <pre className="scrollbar-hidden max-h-72 overflow-auto rounded bg-black/30 p-3 text-xs text-zinc-300">
                {JSON.stringify(solverConfig, null, 2)}
              </pre>
            </section>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                className="rounded bg-white/8 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/12"
                onClick={resetAdvancedToBaseline}
                type="button"
              >
                Reset to Simple Solve
              </button>
              <button
                className="rounded bg-sky-300 px-4 py-2 text-sm font-semibold text-black hover:bg-sky-200"
                onClick={() => setAdvancedOpen(false)}
                type="button"
              >
                Apply
              </button>
            </div>
          </div>
        </Modal>
      )}

      {nodeOpen && (
        <Modal title="Current node" onClose={() => setNodeOpen(false)}>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded border border-white/10 bg-[#222326] p-3">
                <div className="text-xs text-zinc-500">Player</div>
                <div className="mt-1 font-semibold">{actingPlayer}</div>
              </div>
              <div className="rounded border border-white/10 bg-[#222326] p-3">
                <div className="text-xs text-zinc-500">Street</div>
                <div className="mt-1 font-semibold">{currentStreet}</div>
              </div>
              <div className="rounded border border-white/10 bg-[#222326] p-3">
                <div className="text-xs text-zinc-500">Pot</div>
                <div className="mt-1 font-semibold">{startingPot}</div>
              </div>
              <div className="rounded border border-white/10 bg-[#222326] p-3">
                <div className="text-xs text-zinc-500">Stack</div>
                <div className="mt-1 font-semibold">{effectiveStack}</div>
              </div>
            </div>
            <div className="rounded border border-white/10 bg-[#222326] p-3">
              <div className="text-xs text-zinc-500">Board</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {boardCards.map((card) => (
                  <PlayingCard card={card} className="w-12 rounded-lg p-1 shadow-black/15" key={card} tone="zinc" />
                ))}
              </div>
            </div>
            <div className="rounded border border-white/10 bg-[#222326] p-3">
              <div className="text-xs text-zinc-500">Available strategy</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {actions.map((action) => (
                  <span className="rounded bg-white/8 px-3 py-1.5 font-medium" key={action}>
                    {formatAction(action)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Modal>
      )}

    </main>
  );
}
