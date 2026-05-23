"use client";

import Image from "next/image";
import Link from "next/link";

type Seat = {
  id: number;
  name: string;
  position: string;
  stack: string;
  bet?: string;
  cards?: [string, string];
  status: "active" | "waiting" | "folded" | "hero";
  x: string;
  y: string;
};

const SEATS: Seat[] = [
  { id: 0, name: "Hero", position: "BTN", stack: "$910", bet: "$52", cards: ["Ah", "Kh"], status: "hero", x: "50%", y: "89%" },
  { id: 1, name: "Maya", position: "SB", stack: "$884", bet: "$5", status: "waiting", x: "2%", y: "70%" },
  { id: 2, name: "Noah", position: "BB", stack: "$900", bet: "$10", status: "active", x: "2%", y: "30%" },
  { id: 3, name: "Iris", position: "UTG", stack: "$1,120", status: "folded", x: "50%", y: "11%" },
  { id: 4, name: "Ken", position: "CO", stack: "$740", status: "waiting", x: "90%", y: "30%" },
  { id: 5, name: "Ava", position: "HJ", stack: "$1,034", status: "waiting", x: "90%", y: "70%" },
];

const BOARD = ["Qs", "Jh", "2h"];
const HERO_SEAT = SEATS.find((seat) => seat.status === "hero") ?? SEATS[0];

const TABLE_ASPECT = 1.55;
const TABLE_WIDTH_PX = 896;
const TABLE_HEIGHT_PX = Math.round(TABLE_WIDTH_PX / TABLE_ASPECT);

function cardAsset(card: string): string {
  if (card === "back") return "/PokerCards/cardback.svg";

  const rank = card.slice(0, -1).replace("T", "10").toUpperCase();
  const suit = card.slice(-1).toUpperCase();
  return `/PokerCards/${rank}${suit}.svg`;
}

const CARD_ASPECT = 50 / 67;
const HOLE_CARD_HEIGHT_PX = 80;
const SEAT_TAB_HEIGHT_PX = Math.round(HOLE_CARD_HEIGHT_PX * 0.8);

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
  position,
  stack,
  hero = false,
  placement,
}: {
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
    : "border-sky-300/35 bg-[#142238] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_3px_10px_rgba(0,0,0,0.4)]";

  return (
    <div
      className={`relative z-0 flex min-w-[6.5rem] shrink-0 flex-col justify-center border-2 py-1 ${surfaceClass} ${edgeClass} ${textClass}`}
      style={{ height: SEAT_TAB_HEIGHT_PX }}
    >
      <div className="w-full text-[11px] font-semibold uppercase tracking-wide text-sky-200/70">{position}</div>
      <div className="w-full text-[15px] font-bold leading-tight text-zinc-100">{stack}</div>
    </div>
  );
}

type SeatLayout = {
  anchorClass: string;
  barAfterCards: boolean;
};

function getSeatLayout(x: string): SeatLayout {
  const pct = parseFloat(x);

  if (pct >= 60) {
    return {
      anchorClass: "-translate-x-full -translate-y-1/2",
      barAfterCards: false,
    };
  }

  if (pct <= 40) {
    return {
      anchorClass: "-translate-y-1/2",
      barAfterCards: true,
    };
  }

  return {
    anchorClass: "-translate-x-1/2 -translate-y-1/2",
    barAfterCards: true,
  };
}

function Seat({ seat }: { seat: Seat }) {
  const layout = getSeatLayout(seat.x);

  return (
    <div
      className={`absolute z-20 ${layout.anchorClass} ${seat.status === "folded" ? "opacity-45" : ""}`}
      style={{ left: seat.x, top: seat.y }}
    >
      <div className="flex shrink-0 items-end">
        {layout.barAfterCards ? (
          <>
            <div className="relative z-10 shrink-0">
              <HoleCards cards={seat.cards} />
            </div>
            <SeatInfoPlate
              hero={seat.status === "hero"}
              placement="right"
              position={seat.position}
              stack={seat.stack}
            />
          </>
        ) : (
          <>
            <SeatInfoPlate
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

function ChipStack({ amount, className = "" }: { amount: string; className?: string }) {
  return (
    <div className={`absolute z-10 flex flex-col items-center gap-1 ${className}`}>
      <div className="flex -space-x-3">
        <span className="h-6 w-6 rounded-full border-2 border-white/70 bg-[#d64b43] shadow" />
        <span className="h-6 w-6 rounded-full border-2 border-white/70 bg-[#2f8ed6] shadow" />
        <span className="h-6 w-6 rounded-full border-2 border-white/70 bg-[#e3c84b] shadow" />
      </div>
      <span className="rounded bg-zinc-900/55 px-2 py-0.5 text-xs font-semibold text-zinc-100">{amount}</span>
    </div>
  );
}

function SimulationConfigBar() {
  const items = [
    { label: "Format", value: "6-max" },
    { label: "Pot", value: "Single raised" },
    { label: "Hero", value: HERO_SEAT.position },
    { label: "Stack", value: HERO_SEAT.stack },
    { label: "Depth", value: "100bb" },
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

      <button
        className="shrink-0 rounded border border-white/10 bg-[#242528] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-sky-300/40 hover:bg-[#22313a]"
        type="button"
      >
        Edit
      </button>
    </div>
  );
}

const PANEL_CARD_CLASS =
  "rounded border border-white/10 bg-[#161719]/95 shadow-lg backdrop-blur-sm";

function GtoReviewPanel() {
  return (
    <div className="p-4">
      <div>
        <h2 className="text-lg font-semibold">GTO Review</h2>
        <p className="mt-1 text-sm text-zinc-500">How your line compares to solver play</p>
      </div>
    </div>
  );
}

function ActionPanel() {
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Action</h2>
          <p className="text-xs text-zinc-500">Choose your line for this node</p>
        </div>
        <span className="rounded bg-sky-300 px-2 py-1 text-xs font-semibold text-black">{HERO_SEAT.position}</span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded bg-black/20 px-3 py-2">
          <div className="text-xs text-zinc-500">Facing</div>
          <div className="font-semibold">$52 bet</div>
        </div>
        <div className="rounded bg-black/20 px-3 py-2">
          <div className="text-xs text-zinc-500">Pot</div>
          <div className="font-semibold">$119</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {["Fold", "Call", "Raise", "All in"].map((action) => (
          <button
            className={
              action === "Raise"
                ? "h-11 rounded bg-sky-300 text-sm font-semibold text-black hover:bg-sky-200"
                : "h-11 rounded border border-white/10 bg-[#242528] text-sm font-semibold text-zinc-200 hover:border-sky-300/50 hover:bg-[#22313a]"
            }
            key={action}
            type="button"
          >
            {action}
          </button>
        ))}
      </div>
    </div>
  );
}

const SIDE_PANEL_WIDTH_CLASS = "w-[min(100vw-2rem,22.5rem)]";

function SimulationSideCards() {
  return (
    <>
      <div
        className={`pointer-events-auto fixed right-4 top-[calc(3.5rem+1rem)] z-30 max-h-[calc(100vh-20rem)] overflow-y-auto ${SIDE_PANEL_WIDTH_CLASS} ${PANEL_CARD_CLASS}`}
      >
        <GtoReviewPanel />
      </div>
      <div
        className={`pointer-events-auto fixed bottom-4 right-4 z-40 ${SIDE_PANEL_WIDTH_CLASS} ${PANEL_CARD_CLASS}`}
      >
        <ActionPanel />
      </div>
    </>
  );
}

export default function SimulationsPage() {
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
          <button className="rounded bg-white/8 px-3 py-1.5 text-zinc-200 hover:bg-white/12" type="button">
            New Hand
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <section className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_center,#1a1a1c_0,#101112_62%)] p-4 pr-[min(100vw-1rem,24rem)]">
          <SimulationConfigBar />
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <div
              className="relative shrink-0"
              style={{ height: TABLE_HEIGHT_PX, width: TABLE_WIDTH_PX }}
            >
              <div className="absolute inset-[8%_5%] rounded-[25rem] border border-zinc-500/25 bg-[#222326] shadow-[inset_0_0_0_18px_rgba(8,8,10,0.65),inset_0_0_80px_rgba(0,0,0,0.45),0_40px_110px_rgba(0,0,0,0.5)]" />
              <div className="absolute inset-[14%_9%] rounded-[24rem] border border-zinc-400/15 bg-[radial-gradient(circle_at_center,#5a5b61_0,#424348_58%,#2b2c30_100%)]" />

              <div className="absolute left-1/2 top-[46%] z-10 -translate-x-1/2 -translate-y-1/2">
                <div className="mb-5 flex justify-center gap-2">
                  {BOARD.map((card) => (
                    <PlayingCard card={card} key={card} />
                  ))}
                  <div className="grid h-20 w-14 place-items-center rounded border border-dashed border-zinc-500/30 bg-zinc-900/30 text-xs text-zinc-500">
                    Turn
                  </div>
                  <div className="grid h-20 w-14 place-items-center rounded border border-dashed border-zinc-500/30 bg-zinc-900/30 text-xs text-zinc-500">
                    River
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs uppercase text-zinc-500">Pot</div>
                  <div className="text-2xl font-semibold text-zinc-100">$119</div>
                </div>
              </div>

              <ChipStack amount="$52" className="bottom-[32%] left-1/2 -translate-x-1/2" />
              <ChipStack amount="$10" className="left-[24%] top-[38%]" />
              <ChipStack amount="$5" className="bottom-[34%] left-[22%]" />

              {SEATS.map((seat) => (
                <Seat key={seat.id} seat={seat} />
              ))}
            </div>
          </div>
        </section>

        <SimulationSideCards />
      </div>
    </main>
  );
}
