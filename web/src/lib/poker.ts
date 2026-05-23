export interface SolveResults {
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

export interface ComboRow {
  cardA: string;
  cardB: string;
  cards: string;
  freqs: number[];
  handIndex: number;
  label: string;
}

export interface PracticeQuestion {
  actions: string[];
  board: string[];
  combo: ComboRow;
  fixtureId: string;
  fixtureLabel: string;
  history: number[];
  node: SolveResults;
}

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";

export function splitActions(actions: string): string[] {
  return actions
    .split(",")
    .map((action) => action.trim())
    .filter(Boolean);
}

export function rankFromCard(card: number): string {
  return RANKS[Math.floor(card / 4)];
}

export function suitFromCard(card: number): string {
  return SUITS[card % 4];
}

export function cardLabelFromId(card: number): string {
  return `${rankFromCard(card)}${suitFromCard(card)}`;
}

export function comboLabel(cardA: number, cardB: number): string {
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

export function formatAction(action: string): string {
  return action.replaceAll("Bet(", "Bet ").replaceAll("Raise(", "Raise ").replaceAll(")", "");
}

export function actionAmount(action: string): number | null {
  const match = action.match(/\((\d+)\)/);
  return match ? Number(match[1]) : null;
}

export function actionPutsMoneyIn(action: string): boolean {
  const normalized = action.toLowerCase();
  return normalized.includes("bet") || normalized.includes("call") || normalized.includes("raise") || normalized.includes("allin");
}

export function buildComboRow(results: SolveResults, hand: number, numHands = Math.floor(results.privateCards.length / 2)): ComboRow {
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

export function buildComboRows(results: SolveResults | null, limit = Number.POSITIVE_INFINITY): ComboRow[] {
  if (!results) return [];

  const numHands = Math.floor(results.privateCards.length / 2);
  return Array.from({ length: Math.min(numHands, limit) }, (_, hand) =>
    buildComboRow(results, hand, numHands)
  );
}

export function buildComboRowsForLabel(results: SolveResults | null, label: string | null): ComboRow[] {
  if (!results || !label) return [];

  return buildComboRows(results).filter((row) => row.label === label);
}

export function bestActionIndex(freqs: number[]): number {
  if (freqs.length === 0) return 0;
  return freqs.reduce((best, freq, index) => (freq > freqs[best] ? index : best), 0);
}

export function frequencyBand(freq: number, isPrimary: boolean): "Primary" | "Mixed" | "Rare" | "Never" {
  if (isPrimary) return "Primary";
  if (freq >= 0.2) return "Mixed";
  if (freq > 0) return "Rare";
  return "Never";
}

export function formatStrategyPercent(freq: number): string {
  const pct = Math.max(0, Math.min(100, freq * 100));
  if (Math.abs(pct - Math.round(pct)) < 0.05) return String(Math.round(pct));
  return pct.toFixed(1);
}
