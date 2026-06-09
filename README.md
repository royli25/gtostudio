# GTO Studio

A free, open-source postflop GTO solver for Texas Hold'em — built as a native desktop app with a modern web UI.

GTO Studio runs solver computations locally on your machine using a Rust-based engine compiled to a Tauri backend, with a Next.js + React frontend. No cloud compute, no subscription — just accurate GTO solutions on your hardware.

## Features

- **Postflop solver** — Configure ranges, board, pot/stack sizes, and bet sizing trees. Runs counterfactual regret minimization to compute GTO strategies with real-time progress tracking.
- **Strategy browser** — Navigate the full game tree with an interactive strategy matrix, action frequencies, and EV display for every combo.
- **Simulations practice** — Review previously solved spots and study strategy across runouts.
- **Sessions** — Save and revisit solved spots backed by Supabase cloud storage.
- **Configurable bet trees** — Set per-street bet/raise sizes for both OOP and IP, with allin threshold and merging controls.
- **Node locking** — Lock strategies at specific nodes to explore exploitative adjustments.

## Architecture

```
engine/          Rust postflop solver library (fork of b-inary/postflop-solver)
  └─ wasm/       WASM build target
web/             Next.js 16 + React 19 frontend
  └─ src-tauri/  Tauri v2 desktop shell (invokes the Rust engine natively)
  └─ src/lib/    Solver client, poker utilities, cloud storage
  └─ supabase/   Database schema & migrations for saved spots
```

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+
- [Tauri CLI](https://tauri.app/) v2

### Development

```bash
cd web
npm install
npm run tauri dev
```

This starts the Next.js dev server and launches the Tauri window.

### Build

```bash
cd web
npm run tauri build
```

Produces a `.dmg` / `.app` bundle in `web/src-tauri/target/release/bundle/`.

## Engine

The solver engine is a fork of [postflop-solver](https://github.com/b-inary/postflop-solver) by Wataru Inariba, licensed under AGPL-3.0. It implements counterfactual regret minimization for postflop play with support for arbitrary bet sizing trees, node locking, and multithreaded solving via Rayon.

## License

Engine: AGPL-3.0-or-later (see `engine/LICENSE`)
