"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import devSolves from "../solve/dev-fixtures/solves.json";
import {
  actionAmount,
  actionPutsMoneyIn,
  bestActionIndex,
  buildComboRows,
  cardLabelFromId,
  formatAction,
  formatStrategyPercent,
  frequencyBand,
  splitActions,
  type ComboRow,
  type SolveResults,
} from "@/lib/poker";

type PracticeFixture = {
  boardSlots: string[];
  effectiveStack: number;
  gameType: string;
  heroPosition: string;
  id: string;
  label: string;
  nodes: Array<{ history: number[]; result: SolveResults }>;
  potType: string;
  startingPot: number;
  villainPosition: string;
};

type PracticeQuestion = {
  actions: string[];
  combo: ComboRow;
  fixture: PracticeFixture;
  history: number[];
  node: SolveResults;
};

type AnimationPhase = "idle" | "accepted" | "heroChipsMoving" | "opponentActing" | "review";

type Seat = {
  cards?: [string, string];
  name: string;
  position: string;
  stack: string;
  status: "hero" | "villain";
  x: string;
  y: string;
};

const FIXTURES = devSolves as PracticeFixture[];
const HERO_SOLVER_ROLE = "oop";
const TABLE_ASPECT = 1.55;
const TABLE_WIDTH_PX = 896;
const TABLE_HEIGHT_PX = Math.round(TABLE_WIDTH_PX / TABLE_ASPECT);
const CARD_ASPECT = 50 / 67;
const HOLE_CARD_HEIGHT_PX = 80;
const SEAT_TAB_HEIGHT_PX = Math.round(HOLE_CARD_HEIGHT_PX * 0.8);
const OPPONENT_ACTING_MS = 700;

function cardAsset(card: string): string {
  if (card === "back") return "/PokerCards/cardback.svg";

  const rank = card.slice(0, -1).replace("T", "10").toUpperCase();
  const suit = card.slice(-1).toUpperCase();
  return `/PokerCards/${rank}${suit}.svg`;
}

function buildQuestions(fixtures: PracticeFixture[]): PracticeQuestion[] {
  return fixtures.flatMap((fixture) =>
    fixture.nodes.flatMap(({ history, result }) => {
      if (
        result.isTerminal ||
        result.isChance ||
        result.player !== HERO_SOLVER_ROLE ||
        result.numActions < 1 ||
        result.privateCards.length < 2
      ) {
        return [];
      }

      const actions = splitActions(result.actions);
      if (actions.length === 0) return [];

      return buildComboRows(result).map((combo) => ({
        actions,
        combo,
        fixture,
        history,
        node: result,
      }));
    })
  );
}

function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString()}`;
}

function currentPot(question: PracticeQuestion): number {
  return question.fixture.startingPot + question.node.totalBetAmount.reduce((sum, value) => sum + value, 0);
}

function facingAmount(question: PracticeQuestion): number {
  const [oopBet = 0, ipBet = 0] = question.node.totalBetAmount;
  return Math.max(0, ipBet - oopBet);
}

function boardCards(question: PracticeQuestion): string[] {
  return question.node.currentBoard.length
    ? question.node.currentBoard.map(cardLabelFromId)
    : question.fixture.boardSlots;
}

function selectedActionAmount(question: PracticeQuestion, selectedAction: number | null): number {
  if (selectedAction === null) return facingAmount(question);

  const action = question.actions[selectedAction] ?? "";
  const amount = actionAmount(action);
  if (amount !== null) return amount;

  return action.toLowerCase().includes("call") ? facingAmount(question) : 0;
}

type CardSize = "medium" | "large";

const CARD_HEIGHTS: Record<CardSize, { className: string; px: number }> = {
  medium: { className: "h-20", px: HOLE_CARD_HEIGHT_PX },
  large: { className: "h-20", px: HOLE_CARD_HEIGHT_PX },
};

function PlayingCard({
  card,
  size = "large",
  className = "",
}: {
  card: string;
  size?: CardSize;
  className?: string;
}) {
  const { className: heightClass, px: height } = CARD_HEIGHTS[size];
  const width = Math.round(height * CARD_ASPECT);

  return (
    <Image
      alt={card === "back" ? "Card back" : card}
      className={`${heightClass} w-auto shrink-0 aspect-[50/67] object-contain rounded shadow-lg ring-1 ring-black/25 ${className}`}
      height={height}
      src={cardAsset(card)}
      unoptimized
      width={width}
    />
  );
}

function HoleCards({ cards }: { cards?: [string, string] }) {
  const [left, right] = cards ?? ["back", "back"];
  const overlap = cards ? "-space-x-3" : "-space-x-5";

  return (
    <div className={`flex shrink-0 items-end ${overlap}`}>
      <PlayingCard
        card={left}
        className="relative z-0 -rotate-[5deg] origin-bottom !shadow-sm"
        size="medium"
      />
      <div className="relative z-10 drop-shadow-[-4px_2px_6px_rgba(0,0,0,0.55)]">
        <PlayingCard card={right} className="rotate-[5deg] origin-bottom !shadow-none" size="medium" />
      </div>
    </div>
  );
}

function SeatInfoPlate({
  acting,
  position,
  stack,
  hero = false,
  placement,
}: {
  acting?: boolean;
  position: string;
  stack: string;
  hero?: boolean;
  placement: "left" | "right";
}) {
  const edgeClass =
    placement === "right"
      ? "-ml-5 rounded-l-none rounded-r-2xl border-l-0 pl-7 pr-3"
      : "-mr-5 rounded-r-none rounded-l-2xl border-r-0 pl-3 pr-7";

  const textClass = placement === "right" ? "items-end text-right" : "items-start text-left";

  const surfaceClass = hero
    ? "border-sky-400/55 bg-[#1a2d4a] shadow-[inset_0_1px_0_rgba(125,211,252,0.12),0_3px_10px_rgba(0,0,0,0.4)]"
    : acting
      ? "sim-opponent-acting border-amber-200/75 bg-[#2a2416] shadow-[inset_0_1px_0_rgba(253,230,138,0.14),0_3px_10px_rgba(0,0,0,0.4)]"
      : "border-sky-300/35 bg-[#142238] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_3px_10px_rgba(0,0,0,0.4)]";

  return (
    <div
      className={`relative z-0 flex min-w-[6.5rem] shrink-0 flex-col justify-center border-2 py-1 ${surfaceClass} ${edgeClass} ${textClass}`}
      style={{ height: SEAT_TAB_HEIGHT_PX }}
    >
      <div className="w-full text-[11px] font-semibold uppercase tracking-wide text-sky-200/70">{position}</div>
      <div className="w-full text-[15px] font-bold leading-tight text-zinc-100">{stack}</div>
      {acting && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-black shadow">
          Acting
        </div>
      )}
    </div>
  );
}

function Seat({ acting = false, seat }: { acting?: boolean; seat: Seat }) {
  const pct = parseFloat(seat.x);
  const rightSide = pct >= 60;
  const center = pct > 40 && pct < 60;
  const anchorClass = rightSide
    ? "-translate-x-full -translate-y-1/2"
    : center
      ? "-translate-x-1/2 -translate-y-1/2"
      : "-translate-y-1/2";
  const barAfterCards = !rightSide;

  return (
    <div
      className={`absolute z-20 ${anchorClass}`}
      style={{ left: seat.x, top: seat.y }}
    >
      <div className="flex shrink-0 items-end">
        {barAfterCards ? (
          <>
            <div className="relative z-10 shrink-0">
              <HoleCards cards={seat.cards} />
            </div>
            <SeatInfoPlate
              acting={acting}
              hero={seat.status === "hero"}
              placement="right"
              position={seat.position}
              stack={seat.stack}
            />
          </>
        ) : (
          <>
            <SeatInfoPlate
              acting={acting}
              hero={seat.status === "hero"}
              placement="left"
              position={seat.position}
              stack={seat.stack}
            />
            <div className="relative z-10 shrink-0">
              <HoleCards cards={seat.cards} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChipStack({
  amount,
  className = "",
  moving = false,
}: {
  amount: string;
  className?: string;
  moving?: boolean;
}) {
  return (
    <div className={`absolute z-10 flex flex-col items-center gap-1 ${moving ? "sim-chip-travel" : ""} ${className}`}>
      <div className="flex -space-x-3">
        <span className="h-6 w-6 rounded-full border-2 border-white/70 bg-[#d64b43] shadow" />
        <span className="h-6 w-6 rounded-full border-2 border-white/70 bg-[#2f8ed6] shadow" />
        <span className="h-6 w-6 rounded-full border-2 border-white/70 bg-[#e3c84b] shadow" />
      </div>
      <span className="rounded bg-zinc-900/55 px-2 py-0.5 text-xs font-semibold text-zinc-100">{amount}</span>
    </div>
  );
}

function SimulationConfigBar({ question }: { question: PracticeQuestion }) {
  const items = [
    { label: "Format", value: question.fixture.gameType },
    { label: "Pot", value: question.fixture.potType.replace(" pot", "") },
    { label: "Hero", value: question.fixture.heroPosition },
    { label: "Villain", value: question.fixture.villainPosition },
    { label: "Stack", value: formatMoney(question.fixture.effectiveStack) },
  ];

  return (
    <div className="mb-4 flex w-fit max-w-full items-center gap-3 rounded border border-white/10 bg-[#161719]/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-zinc-500">Spot</span>
      <div className="hidden h-4 w-px bg-white/10 sm:block" />

      <div className="flex items-center gap-2 overflow-x-auto text-sm">
        {items.map((item) => (
          <div
            className="flex shrink-0 items-center gap-2 rounded bg-[#1d1e21] px-2.5 py-1"
            key={item.label}
          >
            <span className="text-xs text-zinc-500">{item.label}</span>
            <span className="font-medium text-zinc-100">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const PANEL_CARD_CLASS =
  "rounded border border-white/10 bg-[#161719]/95 shadow-lg backdrop-blur-sm";

function GtoReviewPanel({
  phase,
  question,
  selectedAction,
}: {
  phase: AnimationPhase;
  question: PracticeQuestion;
  selectedAction: number | null;
}) {
  const preferredAction = bestActionIndex(question.combo.freqs);
  const reviewVisible = phase === "review";

  return (
    <div className={`p-4 transition-all duration-300 ${reviewVisible ? "opacity-100" : "opacity-70"}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">EV Review</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {reviewVisible ? "Your action against the solver frequency bands." : "Make a decision to reveal the bands."}
          </p>
        </div>
        <span className="rounded bg-black/25 px-2 py-1 text-xs font-semibold text-zinc-300">
          {question.combo.label}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded border border-sky-300/35 bg-sky-300/10 p-3">
          <div className="text-xs text-sky-200">OOP EV</div>
          <div className="text-xl font-semibold">{question.node.rootEvOop.toFixed(2)}</div>
        </div>
        <div className="rounded border border-white/10 bg-[#222326] p-3">
          <div className="text-xs text-zinc-500">Equity</div>
          <div className="text-xl font-semibold">{(question.node.rootEqOop * 100).toFixed(1)}%</div>
        </div>
      </div>

      <div className={`space-y-2 ${reviewVisible ? "sim-review-reveal" : ""}`}>
        {question.actions.map((action, index) => {
          const freq = question.combo.freqs[index] ?? 0;
          const isSelected = selectedAction === index;
          const isPrimary = index === preferredAction;
          const band = frequencyBand(freq, isPrimary);

          return (
            <div
              className={`rounded border p-2 transition-colors ${
                isSelected
                  ? "border-sky-300/70 bg-sky-300/12"
                  : "border-white/10 bg-black/20"
              }`}
              key={action}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-zinc-100">{formatAction(action)}</span>
                <div className="flex items-center gap-2">
                  <span className={
                    band === "Primary"
                      ? "text-emerald-200"
                      : band === "Mixed"
                        ? "text-sky-200"
                        : band === "Rare"
                          ? "text-amber-100"
                          : "text-zinc-500"
                  }>
                    {band}
                  </span>
                  <span className="font-mono text-zinc-400">{formatStrategyPercent(freq)}%</span>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-black/35">
                <div
                  className={`h-full rounded ${isPrimary ? "bg-emerald-300" : "bg-sky-300"}`}
                  style={{ width: `${Math.max(2, Math.round(freq * 100))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionPanel({
  disabled,
  onSelectAction,
  phase,
  question,
  selectedAction,
}: {
  disabled: boolean;
  onSelectAction: (index: number) => void;
  phase: AnimationPhase;
  question: PracticeQuestion;
  selectedAction: number | null;
}) {
  const facing = facingAmount(question);

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Action</h2>
          <p className="text-xs text-zinc-500">Choose your line for {question.combo.cards}</p>
        </div>
        <span className="rounded bg-sky-300 px-2 py-1 text-xs font-semibold text-black">
          {question.fixture.heroPosition}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded bg-black/20 px-3 py-2">
          <div className="text-xs text-zinc-500">Facing</div>
          <div className="font-semibold">{facing > 0 ? formatMoney(facing) : "No bet"}</div>
        </div>
        <div className="rounded bg-black/20 px-3 py-2">
          <div className="text-xs text-zinc-500">Pot</div>
          <div className="font-semibold">{formatMoney(currentPot(question))}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {question.actions.map((action, index) => {
          const active = selectedAction === index;

          return (
            <button
              className={`h-11 rounded text-sm font-semibold transition ${
                active
                  ? "sim-action-ack bg-sky-300 text-black"
                  : "border border-white/10 bg-[#242528] text-zinc-200 hover:border-sky-300/50 hover:bg-[#22313a]"
              } disabled:cursor-not-allowed disabled:opacity-55`}
              disabled={disabled}
              key={action}
              onClick={() => onSelectAction(index)}
              type="button"
            >
              {formatAction(action)}
            </button>
          );
        })}
      </div>

      <div className="mt-3 h-5 text-xs text-zinc-500">
        {phase === "accepted" && "Action accepted."}
        {phase === "heroChipsMoving" && "Moving chips to the pot."}
        {phase === "opponentActing" && "Opponent is acting."}
        {phase === "review" && "Review the solver bands above."}
      </div>
    </div>
  );
}

const SIDE_PANEL_WIDTH_CLASS = "w-[min(100vw-2rem,22.5rem)]";

function SimulationSideCards({
  disabled,
  onSelectAction,
  phase,
  question,
  selectedAction,
}: {
  disabled: boolean;
  onSelectAction: (index: number) => void;
  phase: AnimationPhase;
  question: PracticeQuestion;
  selectedAction: number | null;
}) {
  return (
    <>
      <div
        className={`pointer-events-auto fixed right-4 top-[calc(3.5rem+1rem)] z-30 max-h-[calc(100vh-20rem)] overflow-y-auto ${SIDE_PANEL_WIDTH_CLASS} ${PANEL_CARD_CLASS}`}
      >
        <GtoReviewPanel phase={phase} question={question} selectedAction={selectedAction} />
      </div>
      <div
        className={`pointer-events-auto fixed bottom-4 right-4 z-40 ${SIDE_PANEL_WIDTH_CLASS} ${PANEL_CARD_CLASS}`}
      >
        <ActionPanel
          disabled={disabled}
          onSelectAction={onSelectAction}
          phase={phase}
          question={question}
          selectedAction={selectedAction}
        />
      </div>
    </>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ));

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");

    const handleChange = () => setReduced(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}

export default function SimulationsPage() {
  const questions = useMemo(() => buildQuestions(FIXTURES), []);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedAction, setSelectedAction] = useState<number | null>(null);
  const [phase, setPhase] = useState<AnimationPhase>("idle");
  const timeoutRef = useRef<number[]>([]);
  const reducedMotion = usePrefersReducedMotion();
  const question = questions[questionIndex % questions.length];

  useEffect(() => {
    return () => {
      timeoutRef.current.forEach(window.clearTimeout);
    };
  }, []);

  if (!question) {
    return (
      <main className="grid h-screen place-items-center bg-[#101112] text-zinc-100">
        <div className="rounded border border-white/10 bg-[#161719] p-6 text-sm text-zinc-400">
          No practice fixtures are available.
        </div>
      </main>
    );
  }

  const resetTimers = () => {
    timeoutRef.current.forEach(window.clearTimeout);
    timeoutRef.current = [];
  };

  const schedule = (callback: () => void, delay: number) => {
    const timeout = window.setTimeout(callback, delay);
    timeoutRef.current.push(timeout);
  };

  const startNewHand = () => {
    resetTimers();
    setQuestionIndex((current) => (current + 17) % questions.length);
    setSelectedAction(null);
    setPhase("idle");
  };

  const selectAction = (index: number) => {
    if (phase !== "idle") return;

    const action = question.actions[index] ?? "";
    setSelectedAction(index);
    setPhase("accepted");

    if (reducedMotion) {
      setPhase("review");
      return;
    }

    const movesChips = actionPutsMoneyIn(action);
    if (movesChips) {
      schedule(() => setPhase("heroChipsMoving"), 140);
      schedule(() => setPhase("opponentActing"), 640);
      schedule(() => setPhase("review"), 640 + OPPONENT_ACTING_MS);
      return;
    }

    schedule(() => setPhase("opponentActing"), 180);
    schedule(() => setPhase("review"), 180 + OPPONENT_ACTING_MS);
  };

  const selectedActionLabel = selectedAction === null ? null : question.actions[selectedAction];
  const heroActionAmount = selectedActionAmount(question, selectedAction);
  const visibleBoard = boardCards(question);
  const pot = currentPot(question) + (phase === "review" ? heroActionAmount : 0);
  const heroSeat: Seat = {
    cards: [question.combo.cardA, question.combo.cardB],
    name: "Hero",
    position: question.fixture.heroPosition,
    stack: formatMoney(question.fixture.effectiveStack),
    status: "hero",
    x: "50%",
    y: "89%",
  };
  const villainSeat: Seat = {
    name: "Villain",
    position: question.fixture.villainPosition,
    stack: formatMoney(question.fixture.effectiveStack),
    status: "villain",
    x: "50%",
    y: "11%",
  };

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[#101112] text-zinc-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 bg-[#191a1c] px-4">
        <div className="flex items-center gap-4">
          <Image
            alt="GTOStudio"
            className="h-7 w-auto shrink-0"
            height={28}
            priority
            src="/WhiteLogo.svg"
            unoptimized
            width={126}
          />
          <nav className="ml-5 hidden items-center gap-1 text-sm text-zinc-400 md:flex">
            <Link className="rounded px-3 py-1.5 hover:bg-white/6" href="/solve">
              Study
            </Link>
            <button className="rounded px-3 py-1.5 hover:bg-white/6" type="button">Sessions</button>
            <span className="rounded bg-white/8 px-3 py-1.5 text-zinc-100">Simulations</span>
          </nav>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden rounded border border-zinc-400/30 bg-zinc-400/10 px-2.5 py-1 text-zinc-300 sm:inline">
            Practice mode
          </span>
          <Link
            className="rounded bg-white/8 px-3 py-1.5 text-zinc-200 hover:bg-white/12"
            href={`/solve?practiceFixture=${question.fixture.id}`}
          >
            Study Chart
          </Link>
          <button
            className="rounded bg-white/8 px-3 py-1.5 text-zinc-200 hover:bg-white/12"
            onClick={startNewHand}
            type="button"
          >
            New Hand
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <section className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_center,#1a1a1c_0,#101112_62%)] p-4 pr-[min(100vw-1rem,24rem)]">
          <SimulationConfigBar question={question} />
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <div
              className="relative shrink-0"
              style={{ height: TABLE_HEIGHT_PX, width: TABLE_WIDTH_PX }}
            >
              <div className="absolute inset-[8%_5%] rounded-[25rem] border border-zinc-500/25 bg-[#222326] shadow-[inset_0_0_0_18px_rgba(8,8,10,0.65),inset_0_0_80px_rgba(0,0,0,0.45),0_40px_110px_rgba(0,0,0,0.5)]" />
              <div className="absolute inset-[14%_9%] rounded-[24rem] border border-zinc-400/15 bg-[radial-gradient(circle_at_center,#5a5b61_0,#424348_58%,#2b2c30_100%)]" />

              <div className="absolute left-1/2 top-[46%] z-10 -translate-x-1/2 -translate-y-1/2">
                <div className="mb-5 flex justify-center gap-2">
                  {visibleBoard.slice(0, 5).map((card) => (
                    <PlayingCard card={card} key={card} />
                  ))}
                  {Array.from({ length: Math.max(0, 5 - visibleBoard.length) }, (_, index) => (
                    <div
                      className="grid h-20 w-14 place-items-center rounded border border-dashed border-zinc-500/30 bg-zinc-900/30 text-xs text-zinc-500"
                      key={`placeholder-${index}`}
                    >
                      {visibleBoard.length + index === 3 ? "Turn" : "River"}
                    </div>
                  ))}
                </div>
                <div className="text-center">
                  <div className="text-xs uppercase text-zinc-500">Pot</div>
                  <div className="text-2xl font-semibold text-zinc-100">{formatMoney(pot)}</div>
                </div>
              </div>

              {facingAmount(question) > 0 && (
                <ChipStack amount={formatMoney(facingAmount(question))} className="left-1/2 top-[34%] -translate-x-1/2" />
              )}
              {phase === "heroChipsMoving" && heroActionAmount > 0 && (
                <ChipStack amount={formatMoney(heroActionAmount)} className="bottom-[21%] left-1/2 -translate-x-1/2" moving />
              )}
              {phase === "review" && heroActionAmount > 0 && (
                <ChipStack amount={formatMoney(heroActionAmount)} className="bottom-[32%] left-1/2 -translate-x-1/2" />
              )}

              <Seat seat={villainSeat} acting={phase === "opponentActing"} />
              <Seat seat={heroSeat} />

              {selectedActionLabel && (
                <div className="absolute bottom-[18%] left-1/2 z-30 -translate-x-1/2 rounded bg-sky-300 px-3 py-1 text-xs font-bold text-black shadow-lg">
                  {formatAction(selectedActionLabel)}
                </div>
              )}
            </div>
          </div>
        </section>

        <SimulationSideCards
          disabled={phase !== "idle"}
          onSelectAction={selectAction}
          phase={phase}
          question={question}
          selectedAction={selectedAction}
        />
      </div>
    </main>
  );
}
