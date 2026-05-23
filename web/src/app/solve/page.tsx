"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

interface SolveLog {
  time: string;
  message: string;
}

interface SolveResults {
  actions: string;
  currentBoard: number[];
  history: number[];
  isChance: boolean;
  isTerminal: boolean;
  numActions: number;
  player: string;
  possibleCards: number[];
  privateCards: number[];
  rootEqIp: number;
  rootEqOop: number;
  rootEvIp: number;
  rootEvOop: number;
  strategy: number[];
  totalBetAmount: number[];
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

const NUMERIC_LABELS: Array<{ key: NumericSolverConfigKey; label: string }> = [
  { key: "rakeRate", label: "Rake rate" },
  { key: "rakeCap", label: "Rake cap" },
  { key: "addAllinThreshold", label: "Add all-in threshold" },
  { key: "forceAllinThreshold", label: "Force all-in threshold" },
  { key: "mergingThreshold", label: "Merging threshold" },
];

function buildBaselineActionConfig(potType: PotType): Pick<SolverConfig, ActionSolverConfigKey | NumericSolverConfigKey> {
  const compact = {
    oopFlopBet: "52%",
    oopFlopRaise: "45%",
    ipFlopBet: "52%",
    ipFlopRaise: "45%",
    oopTurnBet: "55%",
    oopTurnRaise: "45%",
    ipTurnBet: "55%",
    ipTurnRaise: "45%",
    oopRiverBet: "70%",
    oopRiverRaise: "45%",
    ipRiverBet: "70%",
    ipRiverRaise: "45%",
    rakeRate: 0,
    rakeCap: 0,
    addAllinThreshold: 0,
    forceAllinThreshold: 0,
    mergingThreshold: 0,
  };

  if (potType === "Limped pot") {
    return {
      ...compact,
      oopFlopBet: "33%, 66%",
      oopFlopRaise: "45%",
      ipFlopBet: "33%, 66%",
      ipFlopRaise: "45%",
      oopTurnBet: "50%, 75%",
      oopTurnRaise: "45%",
      ipTurnBet: "50%, 75%",
      ipTurnRaise: "45%",
      oopRiverBet: "66%, 100%",
      oopRiverRaise: "45%",
      ipRiverBet: "66%, 100%",
      ipRiverRaise: "45%",
    };
  }

  if (potType === "3-bet pot" || potType === "4-bet pot") {
    return {
      ...compact,
      oopFlopBet: "33%",
      oopFlopRaise: "45%",
      ipFlopBet: "33%",
      ipFlopRaise: "45%",
      oopTurnBet: "66%",
      oopTurnRaise: "45%",
      ipTurnBet: "66%",
      ipTurnRaise: "45%",
      oopRiverBet: "75%",
      oopRiverRaise: "45%",
      ipRiverBet: "75%",
      ipRiverRaise: "45%",
    };
  }

  return compact;
}

function formatBetSummary(config: Pick<SolverConfig, ActionSolverConfigKey>, baseline: Pick<SolverConfig, ActionSolverConfigKey>): string {
  const changed = ACTION_LABELS.filter(({ key }) => config[key] !== baseline[key]).length;

  if (changed > 0) {
    return `${changed} advanced override${changed === 1 ? "" : "s"}`;
  }

  return "Beginner baseline";
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

function colorForAction(index: number): string {
  const colors = ["#3f7fba", "#e24a42", "#8b2824", "#43a86b"];
  return colors[index % colors.length];
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

function buildComboRows(results: SolveResults | null, limit = 12) {
  if (!results) return [];

  const numHands = Math.floor(results.privateCards.length / 2);
  return Array.from({ length: Math.min(numHands, limit) }, (_, hand) => ({
    cards: `${rankFromCard(results.privateCards[hand * 2])}${suitFromCard(results.privateCards[hand * 2])} ${rankFromCard(results.privateCards[hand * 2 + 1])}${suitFromCard(results.privateCards[hand * 2 + 1])}`,
    handIndex: hand,
    label: comboLabel(results.privateCards[hand * 2], results.privateCards[hand * 2 + 1]),
    freqs: Array.from(
      { length: results.numActions },
      (_, action) => results.strategy[action * numHands + hand] ?? 0
    ),
  }));
}

function normalizedPercents(values: number[]): number[] {
  const clamped = values.map((value) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)));
  const sum = clamped.reduce((total, value) => total + value, 0);

  if (sum <= 0) {
    return clamped.map((_, index) => (index === 0 ? 1 : 0));
  }

  return clamped.map((value) => value / sum);
}

function oneHotStrategy(numActions: number, actionIndex: number): number[] {
  return Array.from({ length: numActions }, (_, index) => (index === actionIndex ? 1 : 0));
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

function cardFace(card: string) {
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  const suitSymbol: Record<string, string> = {
    c: "♣",
    d: "♦",
    h: "♥",
    s: "♠",
  };

  return `${rank}${suitSymbol[suit] ?? suit}`;
}

function streetName(cardCount: number): string {
  if (cardCount >= 5) return "River";
  if (cardCount === 4) return "Turn";
  return "Flop";
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
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
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
  const [spotPresetOpen, setSpotPresetOpen] = useState(false);
  const [solveSettingsOpen, setSolveSettingsOpen] = useState(false);
  const [nodeLockBrushAction, setNodeLockBrushAction] = useState(1);
  const [nodeLockEnabled, setNodeLockEnabled] = useState(true);
  const [nodeLockOpen, setNodeLockOpen] = useState(false);
  const [nodeLockHands, setNodeLockHands] = useState<Record<number, number[]>>({});
  const [nodeLockLabel, setNodeLockLabel] = useState<string | null>(null);
  const [nodeLockStrategy, setNodeLockStrategy] = useState<number[] | null>(null);
  const [nodeOpen, setNodeOpen] = useState(false);

  const [gameType, setGameType] = useState<GameType>("6-max");
  const [heroPosition, setHeroPosition] = useState("UTG");
  const [villainPosition, setVillainPosition] = useState("BTN");
  const [potType, setPotType] = useState<PotType>("Single raised pot");
  const initialPreset = buildPresetRanges("6-max", "UTG", "BTN", "Single raised pot");
  const initialBaseline = buildBaselineActionConfig("Single raised pot");
  const [oopRange, setOopRange] = useState(initialPreset.oopRange);
  const [ipRange, setIpRange] = useState(initialPreset.ipRange);
  const [boardSlots, setBoardSlots] = useState(["Qs", "Jh", "2h"]);
  const [activeBoardSlot, setActiveBoardSlot] = useState<number | null>(null);
  const [activeCardRank, setActiveCardRank] = useState("A");
  const [startingPot, setStartingPot] = useState(180);
  const [effectiveStack, setEffectiveStack] = useState(910);
  const [maxIterations, setMaxIterations] = useState(200);
  const [targetExpl, setTargetExpl] = useState(0.1);
  const [actionConfig, setActionConfig] = useState<Pick<SolverConfig, ActionSolverConfigKey | NumericSolverConfigKey>>(initialBaseline);

  const actions = useMemo(() => splitActions(results?.actions ?? "Check, Bet(94)"), [results]);
  const matrix = useMemo(() => buildMatrix(results), [results]);
  const comboRows = useMemo(() => buildComboRows(results), [results]);
  const lockPreviewRows = useMemo(() => buildComboRows(results, 24), [results]);
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
  const boardCards = boardSlots.filter(Boolean);
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
  const lockedHandCount = Object.keys(nodeLockHands).length;
  const primaryActionIndex = actions.length > 1 ? 1 : 0;
  const baselineConfig = useMemo(() => buildBaselineActionConfig(potType), [potType]);
  const solverConfig = useMemo<SolverConfig>(() => ({
    oopRange,
    ipRange,
    board: boardCards.length >= 3 ? parseBoard(board) : [],
    startingPot,
    effectiveStack,
    ...actionConfig,
  }), [actionConfig, board, boardCards.length, effectiveStack, ipRange, oopRange, startingPot]);
  const validationErrors = useMemo(() => validateSolveConfig(solverConfig, boardSlots), [boardSlots, solverConfig]);
  const betSummary = useMemo(() => formatBetSummary(actionConfig, baselineConfig), [actionConfig, baselineConfig]);
  const pathBoard = results?.currentBoard.length ? results.currentBoard : boardCards.map((card) => CARD_MAP[card]).filter((card) => card !== undefined);
  const pathFlopLabel = pathBoard.slice(0, 3).map(cardLabelFromId).join(" ");
  const currentNodeLabel = results?.isTerminal
    ? "Terminal"
    : results?.isChance
      ? "Chance"
      : `${actingSeat} to act`;
  const rangeIsBaseline = oopRange === presetRanges.oopRange && ipRange === presetRanges.ipRange;
  const actionConfigIsBaseline = ACTION_LABELS.every(({ key }) => actionConfig[key] === baselineConfig[key])
    && NUMERIC_LABELS.every(({ key }) => actionConfig[key] === baselineConfig[key]);
  const treeSizeWarning = ACTION_LABELS.reduce((total, { key }) => total + actionConfig[key].split(",").filter(Boolean).length, 0) > 16;

  const addLog = useCallback((message: string) => {
    setLogs((prev) => [
      ...prev.slice(-80),
      { time: new Date().toLocaleTimeString(), message },
    ]);
  }, []);

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
    setActionConfig(buildBaselineActionConfig(nextPotType));
  }, []);

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
    setActionConfig(baselineConfig);
  }, [baselineConfig, presetRanges.ipRange, presetRanges.oopRange]);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setSolving(false);
    setNodeLoading(false);
    addLog("Solve cancelled.");
  }, [addLog]);

  const navigateToHistory = useCallback((history: number[], segments: PathSegment[]) => {
    if (!results || solving || nodeLoading) return;
    if (!workerRef.current) return;

    setCurrentHistory(history);
    setPathSegments(segments);
    setNodeLoading(true);
    workerRef.current.postMessage({ type: "get_results", history });
  }, [nodeLoading, results, solving]);

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
    setSolving(true);
    setNodeLoading(false);
    setResults(null);
    setProgress(null);
    setCurrentHistory(solveHistory);
    if (!activeLock) {
      setPathSegments([]);
    }
    setLogs([]);

    const worker = new Worker("/solver-worker.js?v=14", { type: "module" });
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

  const openNodeLock = useCallback(() => {
    if (!results) return;

    setNodeLockBrushAction(results.numActions > 1 ? 1 : 0);
    setNodeLockEnabled(true);
    setNodeLockHands({});
    setNodeLockOpen(true);
  }, [results]);

  const applyNodeLock = useCallback(() => {
    if (!results || !nodeLockEnabled || lockedHandCount === 0) return;

    const strategy = buildPaintedNodeLock(results, nodeLockHands);
    const label = `${lockedHandCount} combo${lockedHandCount === 1 ? "" : "s"} locked`;

    setNodeLockStrategy(strategy);
    setNodeLockLabel(label);
    setNodeLockOpen(false);
    handleSolve(strategy);
  }, [handleSolve, lockedHandCount, nodeLockEnabled, nodeLockHands, results]);

  const clearNodeLock = useCallback(() => {
    setNodeLockHands({});
    setNodeLockStrategy(null);
    setNodeLockLabel(null);
  }, []);

  const paintHandClass = useCallback((label: string) => {
    if (!results || !nodeLockEnabled) return;

    const actionStrategy = oneHotStrategy(results.numActions, nodeLockBrushAction);
    const indices = handClassIndices(results, label);

    setNodeLockHands((current) => {
      const next = { ...current };
      indices.forEach((hand) => {
        next[hand] = actionStrategy;
      });
      return next;
    });
  }, [nodeLockBrushAction, nodeLockEnabled, results]);

  const toggleComboLock = useCallback((handIndex: number, checked: boolean) => {
    if (!results) return;

    setNodeLockHands((current) => {
      const next = { ...current };
      if (checked) {
        next[handIndex] = oneHotStrategy(results.numActions, nodeLockBrushAction);
      } else {
        delete next[handIndex];
      }
      return next;
    });
  }, [nodeLockBrushAction, results]);

  return (
    <main className="h-screen overflow-hidden bg-[#101112] text-zinc-100">
      <header className="flex h-14 items-center justify-between border-b border-white/10 bg-[#191a1c] px-4">
        <div className="flex items-center gap-3">
          <div className="grid size-8 place-items-center rounded bg-sky-300 text-sm font-black text-black">
            P
          </div>
          <div>
            <div className="text-sm font-semibold leading-4">PostFlop Solver</div>
            <div className="text-xs text-zinc-500">client-side GTO workspace</div>
          </div>
          <nav className="ml-5 hidden items-center gap-1 text-sm text-zinc-400 md:flex">
            <button className="rounded bg-white/8 px-3 py-1.5 text-zinc-100">Study</button>
            <button className="rounded px-3 py-1.5 hover:bg-white/6">Ranges</button>
            <button className="rounded px-3 py-1.5 hover:bg-white/6">Sessions</button>
            <button
              className="rounded px-3 py-1.5 hover:bg-white/6 disabled:text-zinc-700"
              disabled={!results}
              onClick={openNodeLock}
              type="button"
            >
              Nodelock
            </button>
          </nav>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden rounded border border-sky-300/30 bg-sky-300/10 px-2.5 py-1 text-sky-200 sm:inline">
            {solving ? "Solving" : results ? "Solved" : "Ready"}
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
        <aside className="overflow-y-auto border-r border-white/10 bg-[#161719] p-4">
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
                    <button
                      className={
                        active
                          ? "grid h-16 place-items-center rounded border border-sky-300 bg-sky-300/10 text-lg font-semibold text-sky-100"
                          : "grid h-16 place-items-center rounded border border-white/10 bg-[#222326] text-lg font-semibold hover:border-sky-300/60 hover:bg-[#24313a]"
                      }
                      key={label}
                      onClick={() => openBoardSlot(index)}
                      type="button"
                    >
                      <span>{card ? cardFace(card) : "+"}</span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                        {label}
                      </span>
                    </button>
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
                            <button
                              className={
                                boardSlots[activeBoardSlot] === card
                                  ? "rounded bg-sky-300 px-2 py-3 text-base font-semibold text-black"
                                  : selectedInOtherSlot
                                    ? "rounded bg-black/20 px-2 py-3 text-base text-zinc-700"
                                    : "rounded bg-[#26272a] px-2 py-3 text-base font-semibold text-zinc-100 hover:bg-[#33353a]"
                              }
                              disabled={selectedInOtherSlot}
                              key={suit}
                              onClick={() => selectBoardCard(card)}
                              type="button"
                            >
                              {cardFace(card)}
                            </button>
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
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Bet-size preset</h2>
                <span className="text-xs text-zinc-500">{betSummary}</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Flop</span>
                  <span className="text-right font-mono text-xs text-zinc-200">
                    OOP {actionConfig.oopFlopBet} · IP {actionConfig.ipFlopBet}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">Turn</span>
                  <span className="text-right font-mono text-xs text-zinc-200">
                    OOP {actionConfig.oopTurnBet} · IP {actionConfig.ipTurnBet}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">River</span>
                  <span className="text-right font-mono text-xs text-zinc-200">
                    OOP {actionConfig.oopRiverBet} · IP {actionConfig.ipRiverBet}
                  </span>
                </div>
                <button
                  className="mt-1 w-full rounded bg-white/8 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/12"
                  onClick={() => setAdvancedOpen(true)}
                  type="button"
                >
                  Edit full tree in Advanced Settings
                </button>
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
                  onClick={() => handleSolve(nodeLockStrategy)}
                  type="button"
                >
                  {solving ? "Solving..." : nodeLockStrategy ? "Solve With Lock" : "Solve Tree"}
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
          {nodeLockLabel && (
            <section className="mt-3 rounded border border-sky-300/30 bg-[#10242c] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-sky-100">Nodelock queued</div>
                  <div className="mt-1 text-xs text-zinc-400">{nodeLockLabel}</div>
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

        <section className="min-w-0 overflow-y-auto bg-[#111214] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <button className="rounded bg-white/10 px-3 py-1.5 font-medium">Strategy</button>
              <button className="rounded px-3 py-1.5 text-zinc-400 hover:bg-white/6">Ranges</button>
              <button className="rounded px-3 py-1.5 text-zinc-400 hover:bg-white/6">Breakdown</button>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>{progress ? `${progress.iteration}/${maxIterations}` : "0/0"}</span>
              <span>Exploitability {exploitabilityPct.toFixed(3)}%</span>
            </div>
          </div>

          <div className="mb-3 rounded border border-white/10 bg-[#1a1b1e] p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Action path</div>
                <div className="text-sm text-zinc-200">{currentNodeLabel}</div>
              </div>
              {nodeLoading && <span className="text-xs text-sky-200">Loading node...</span>}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                className="min-h-28 min-w-36 rounded border border-sky-300/30 bg-sky-300/10 px-3 py-2 text-left text-xs text-sky-100 hover:bg-sky-300/15 disabled:opacity-50"
                disabled={!results || solving || nodeLoading}
                onClick={jumpToRoot}
                type="button"
              >
                <span className="mb-2 block font-semibold">FLOP</span>
                <span className="font-mono text-zinc-200">{pathFlopLabel || board}</span>
              </button>
              {pathSegments.map((segment) => {
                if (segment.kind === "chance") {
                  return (
                    <button
                      className="min-h-28 min-w-32 rounded border border-white/10 bg-[#242529] px-3 py-2 text-left text-xs text-zinc-200 hover:border-sky-300/40 hover:bg-[#26313a] disabled:opacity-50"
                      disabled={!results || solving || nodeLoading}
                      key={segment.id}
                      onClick={() => jumpToSegment(segment)}
                      type="button"
                    >
                      <span className="mb-2 block font-semibold">{segment.meta}</span>
                      <span className="font-mono text-base text-zinc-100">{segment.label}</span>
                    </button>
                  );
                }

                return (
                  <div
                    className="min-h-28 min-w-36 rounded border border-white/10 bg-[#242529] px-3 py-2 text-xs text-zinc-200"
                    key={segment.id}
                  >
                    <button
                      className="mb-2 block w-full text-left font-semibold text-zinc-200 hover:text-sky-100 disabled:opacity-50"
                      disabled={!results || solving || nodeLoading}
                      onClick={() => jumpToSegment(segment)}
                      type="button"
                    >
                      {segment.player}
                    </button>
                    <div className="space-y-1">
                      {(segment.actions ?? []).map((action, index) => (
                        <button
                          className={
                            index === segment.selectedActionIndex
                              ? "block w-full rounded bg-sky-300/25 px-2 py-1 text-left font-medium text-sky-100"
                              : "block w-full rounded px-2 py-1 text-left text-zinc-400 hover:bg-white/8 hover:text-zinc-100"
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
                <div className="min-h-28 min-w-64 rounded border border-amber-300/70 bg-amber-300/10 px-3 py-2 text-xs text-zinc-200">
                  <div className="mb-2">
                    <div className="font-semibold text-amber-100">
                      {streetForBoardLength(results.currentBoard.length + 1)}
                    </div>
                    <div className="text-zinc-500">
                      Choose {results.currentBoard.length === 3 ? "turn" : "river"} card
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {results.possibleCards.map((card) => (
                      <button
                        className="rounded bg-[#25262a] px-2 py-2 font-mono text-xs text-zinc-100 hover:bg-amber-300/20 disabled:opacity-50"
                        disabled={solving || nodeLoading}
                        key={card}
                        onClick={() => navigateChanceCard(card)}
                        type="button"
                      >
                        {cardLabelFromId(card)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {results && !results.isChance && !results.isTerminal && (
                <div className="min-h-28 min-w-36 rounded border border-amber-300/70 bg-amber-300/10 px-3 py-2 text-xs text-zinc-200">
                  <div className="mb-2 font-semibold text-amber-100">{actingSeat}</div>
                  <div className="space-y-1">
                    {actions.map((action, index) => (
                      <button
                        className="block w-full rounded px-2 py-1 text-left text-zinc-100 hover:bg-amber-300/20 disabled:opacity-50"
                        disabled={solving || nodeLoading}
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
          </div>

          <div
            className="grid aspect-square max-h-[calc(100vh-8rem)] min-h-[460px] w-full overflow-hidden rounded border border-black/70 bg-black/50"
            style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
          >
            {matrix.map((cell) => {
              const primaryFreq = cell.actionFreqs[primaryActionIndex] ?? 0;
              const secondaryFreq = cell.actionFreqs[0] ?? 0;
              const locked = cell.comboCount === 0;
              const background = locked
                ? "#26272a"
                : `linear-gradient(90deg, ${colorForAction(primaryActionIndex)} 0 ${Math.round(primaryFreq * 100)}%, ${colorForAction(0)} ${Math.round(primaryFreq * 100)}% 100%)`;

              return (
                <div
                  key={cell.label}
                  className="relative min-h-0 border-b border-r border-black/55 p-1.5 text-left"
                  style={{ background }}
                  title={`${cell.label}: ${actions.map((action, i) => `${formatAction(action)} ${Math.round((cell.actionFreqs[i] ?? 0) * 100)}%`).join(", ")}`}
                >
                  <div className={locked ? "text-zinc-600" : "text-white drop-shadow"}>
                    <div className="text-sm font-semibold leading-none md:text-base">{cell.label}</div>
                    {!locked && (
                      <div className="mt-1 text-[10px] text-white/75">
                        {Math.round(primaryFreq * 100)} / {Math.round(secondaryFreq * 100)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="overflow-y-auto border-l border-white/10 bg-[#161719] p-4">
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

          <section className="rounded border border-white/10 bg-[#1d1e21] p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold">Actions</h2>
                <span className="text-xs text-zinc-500">{currentNodeLabel}</span>
              </div>
              <button
                className="rounded border border-sky-300/30 bg-sky-300/10 px-2.5 py-1 text-xs font-semibold text-sky-100 hover:bg-sky-300/15 disabled:border-white/10 disabled:bg-white/5 disabled:text-zinc-600"
                disabled={!results || solving || nodeLoading || results.isChance || results.isTerminal}
                onClick={openNodeLock}
                type="button"
              >
                Nodelock
              </button>
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
                    <div className="h-2" style={{ background: colorForAction(index), width: `${Math.max(2, total * 100)}%` }} />
                  </button>
                );
              })}
            </div>
          </section>

          <section className="mt-4 rounded border border-white/10 bg-[#1d1e21] p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Hands</h2>
              <button className="rounded bg-white/8 px-2 py-1 text-xs text-zinc-300" type="button">
                Filters
              </button>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {comboRows.length === 0 && (
                <p className="rounded bg-[#25262a] p-3 text-sm text-zinc-500">
                  Solve the current spot to populate combo frequencies.
                </p>
              )}
              {comboRows.map((row) => (
                <div key={`${row.cards}-${row.label}`} className="rounded bg-[#25262a] p-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-sm">{row.cards}</span>
                    <span className="text-xs text-zinc-500">{row.label}</span>
                  </div>
                  <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, actions.length)}, minmax(0, 1fr))` }}>
                    {actions.map((action, index) => (
                      <div key={action} className="h-6 overflow-hidden rounded bg-black/30 text-[10px]">
                        <div
                          className="flex h-full items-center px-1.5 text-white"
                          style={{
                            background: colorForAction(index),
                            width: `${Math.max(6, row.freqs[index] * 100)}%`,
                          }}
                        >
                          {Math.round(row.freqs[index] * 100)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-4 rounded border border-white/10 bg-[#1d1e21] p-3">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Run Log</h2>
              <span className="text-xs text-zinc-500">{logs.length} lines</span>
            </div>
            <div className="h-52 space-y-1 overflow-y-auto rounded bg-black/30 p-2 font-mono text-xs">
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
                  <h3 className="text-sm font-semibold">Full action tree</h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Comma-separate solver sizes. Raises also accept previous-bet-relative `x` sizes.
                  </p>
                </div>
                <span className={actionConfigIsBaseline ? "rounded bg-emerald-300/10 px-2 py-1 text-xs text-emerald-200" : "rounded bg-amber-300/10 px-2 py-1 text-xs text-amber-100"}>
                  {actionConfigIsBaseline ? "Baseline tree" : "Tree overrides"}
                </span>
              </div>
              <div className="mb-3 rounded bg-black/20 p-2 text-xs text-zinc-500">
                Grammar: `70%`, `2.5x` for raises, `100c`, `20c3r`, `e`, `2e`, `3e200%`, or `a`.
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {ACTION_LABELS.map(({ key, label }) => (
                  <label className="block" key={key}>
                    <span className="mb-1 block text-xs text-zinc-500">
                      {label}
                      {actionConfig[key] !== baselineConfig[key] && <span className="ml-1 text-amber-200">changed</span>}
                    </span>
                    <input
                      className="h-9 w-full rounded border border-white/10 bg-[#26272a] px-2 font-mono text-xs outline-none focus:border-sky-300/70"
                      value={actionConfig[key]}
                      onChange={(event) => updateActionConfig(key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded border border-white/10 bg-[#202124] p-3">
              <h3 className="text-sm font-semibold">Rake and tree tuning</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Keep these at zero unless you intentionally want rake or all-in/merge behavior.
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {NUMERIC_LABELS.map(({ key, label }) => (
                  <label className="block" key={key}>
                    <span className="mb-1 block text-xs text-zinc-500">
                      {label}
                      {actionConfig[key] !== baselineConfig[key] && <span className="ml-1 text-amber-200">changed</span>}
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
              <pre className="max-h-72 overflow-auto rounded bg-black/30 p-3 text-xs text-zinc-300">
                {JSON.stringify(solverConfig, null, 2)}
              </pre>
            </section>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                className="rounded bg-white/8 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/12"
                onClick={resetAdvancedToBaseline}
                type="button"
              >
                Reset to baseline
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
                  <span
                    className="rounded bg-black/30 px-3 py-2 text-base font-semibold"
                    key={card}
                  >
                    {cardFace(card)}
                  </span>
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

      {nodeLockOpen && results && (
        <Modal title="Nodelock current node" onClose={() => setNodeLockOpen(false)}>
          <div className="space-y-4">
            <div className="rounded border border-sky-300/30 bg-[#10242c] p-3">
              <div className="text-sm font-semibold text-sky-100">
                Lock {actingPlayer}&apos;s strategy at this node
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                Check the lock on, choose an action brush, then paint hands in the matrix or use
                combo checkboxes. The lock is applied before a fresh solve starts.
              </p>
            </div>

            <label className="flex items-center gap-2 rounded border border-white/10 bg-[#222326] px-3 py-2 text-sm">
              <input
                checked={nodeLockEnabled}
                className="accent-sky-300"
                onChange={(event) => setNodeLockEnabled(event.target.checked)}
                type="checkbox"
              />
              Enable nodelock painting
            </label>

            <div className="rounded border border-white/10 bg-[#222326] p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Paintbrush</h3>
                <span className="text-xs text-zinc-500">
                  {lockedHandCount} combo{lockedHandCount === 1 ? "" : "s"} painted
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {actions.map((action, index) => (
                  <button
                    className={
                      index === nodeLockBrushAction
                        ? "rounded bg-sky-300 px-3 py-1.5 text-sm font-semibold text-black"
                        : "rounded bg-white/8 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/12"
                    }
                    key={action}
                    onClick={() => setNodeLockBrushAction(index)}
                    type="button"
                  >
                    Paint {formatAction(action)}
                  </button>
                ))}
                <button
                  className="rounded bg-white/8 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/12"
                  onClick={() => setNodeLockHands({})}
                  type="button"
                >
                  Clear paint
                </button>
              </div>
            </div>

            <div className="rounded border border-white/10 bg-[#222326] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Paint hand classes</h3>
                <span className="text-xs text-zinc-500">Click cells to lock them</span>
              </div>
              <div
                className="grid overflow-hidden rounded border border-black/70 bg-black/40"
                style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
              >
                {matrix.map((cell) => {
                  const handIndices = results ? handClassIndices(results, cell.label) : [];
                  const paintedCount = handIndices.filter((hand) => nodeLockHands[hand]).length;
                  const painted = paintedCount > 0;

                  return (
                    <button
                      className={
                        painted
                          ? "min-h-10 border-b border-r border-black/60 bg-sky-300 p-1 text-left text-black"
                          : cell.comboCount > 0
                            ? "min-h-10 border-b border-r border-black/60 bg-[#303136] p-1 text-left text-zinc-100 hover:bg-[#3b3d43]"
                            : "min-h-10 border-b border-r border-black/60 bg-[#222326] p-1 text-left text-zinc-700"
                      }
                      disabled={!nodeLockEnabled || cell.comboCount === 0}
                      key={cell.label}
                      onClick={() => paintHandClass(cell.label)}
                      type="button"
                    >
                      <div className="text-xs font-semibold">{cell.label}</div>
                      {painted && (
                        <div className="text-[10px]">
                          {formatAction(actions[nodeLockBrushAction] ?? actions[0])}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded border border-white/10 bg-[#222326] p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Combo checkboxes</h3>
                <span className="text-xs text-zinc-500">First {lockPreviewRows.length} combos</span>
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {lockPreviewRows.map((row) => {
                  const locked = Boolean(nodeLockHands[row.handIndex]);
                  const lockedActionIndex = locked
                    ? nodeLockHands[row.handIndex].findIndex((freq) => freq > 0)
                    : nodeLockBrushAction;

                  return (
                    <div
                      className="grid grid-cols-[24px_70px_1fr] items-center gap-2 rounded bg-black/20 px-2 py-1.5"
                      key={`${row.cards}-${row.label}`}
                    >
                      <input
                        checked={locked}
                        className="accent-sky-300"
                        onChange={(event) => toggleComboLock(row.handIndex, event.target.checked)}
                        type="checkbox"
                      />
                      <div>
                        <div className="font-mono text-xs">{row.cards}</div>
                        <div className="text-[10px] text-zinc-500">{row.label}</div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {actions.map((action, index) => (
                          <button
                            className={
                              locked && lockedActionIndex === index
                                ? "rounded bg-sky-300 px-2 py-1 text-[10px] font-semibold text-black"
                                : "rounded bg-white/8 px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/12"
                            }
                            key={action}
                            onClick={() => {
                              setNodeLockBrushAction(index);
                              setNodeLockHands((current) => ({
                                ...current,
                                [row.handIndex]: oneHotStrategy(results.numActions, index),
                              }));
                            }}
                            type="button"
                          >
                            {formatAction(action)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {actions.map((action, index) => (
                <button
                  className="rounded bg-white/8 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/12"
                  key={action}
                  onClick={() => {
                    const next: Record<number, number[]> = {};
                    const actionStrategy = oneHotStrategy(results.numActions, index);
                    const numHands = Math.floor(results.privateCards.length / 2);
                    for (let hand = 0; hand < numHands; hand++) {
                      next[hand] = actionStrategy;
                    }
                    setNodeLockBrushAction(index);
                    setNodeLockHands(next);
                  }}
                  type="button"
                >
                  Paint all {formatAction(action)}
                </button>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button
                className="rounded bg-white/8 px-4 py-2 text-sm font-semibold text-zinc-200 hover:bg-white/12"
                onClick={() => setNodeLockOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded bg-sky-300 px-4 py-2 text-sm font-semibold text-black hover:bg-sky-200"
                disabled={!nodeLockEnabled || lockedHandCount === 0}
                onClick={applyNodeLock}
                type="button"
              >
                Apply and re-solve
              </button>
            </div>
          </div>
        </Modal>
      )}

    </main>
  );
}
