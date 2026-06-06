# Pre-Solved Library PRD

## Summary

Build a pre-solved GTO strategy library comparable to GTO Wizard's offering. Users should be able to open the simulator and instantly practice any common 6-max postflop spot without waiting for a solve. This requires solving tens of thousands of spots in advance, storing them in a compact binary format, and serving them from cloud storage.

## Goals

- Cover the most common 6-max postflop spots with pre-solved strategy data.
- Serve any spot to the simulator in under 3 seconds (download + decompress).
- Keep total storage under 50 GB for the full 6-max library.
- Use a compact binary format — not JSON — for strategy data.
- Build a batch solver pipeline that can churn through thousands of configs unattended.

## Non-Goals

- 9-max or heads-up libraries in this phase.
- Real-time solving as a fallback (too slow for instant play).
- Perfect coverage of every possible spot on day one — start with the most common and expand.
- Replacing the existing JSON-based tree extraction (keep it for debugging/dev).

## The Math

### Spot Count

A "spot" is one unique combination of:
- **Canonical flop** (suit-isomorphic): ~1,755 unique flops from C(52,3) = 22,100
- **Position matchup**: ~15 common pairings that reach postflop in 6-max
- **Pot type**: SRP, 3-bet pot, 4-bet pot (~3 types)

**Total unique flop spots: ~1,755 × 15 × 3 ≈ 79,000**

Each flop-level solve covers all turn and river runouts within one game tree. No need to solve per-runout.

### Storage Budget

| Format | Per-spot size (compressed) | 79K spots | 10K spots (MVP) |
|--------|---------------------------|-----------|-----------------|
| Current JSON + gzip | ~3 MB | 237 GB | 30 GB |
| Binary (f32) + gzip | ~800 KB | 63 GB | 8 GB |
| Binary (uint8 quantized) + gzip | ~200 KB | 15.8 GB | 2 GB |
| Binary (uint8) + zstd | ~150 KB | 11.8 GB | 1.5 GB |

**Target: uint8 quantized binary + zstd compression → ~150 KB per spot.**

### Prioritized Rollout

| Phase | Spots | Storage | Coverage |
|-------|-------|---------|----------|
| MVP | ~500 | ~75 MB | Top 50 flops × top 10 matchups |
| V1 | ~5,000 | ~750 MB | Common flops × all SRP matchups |
| V2 | ~25,000 | ~3.75 GB | All flops × SRP + 3bet |
| Full | ~79,000 | ~11.8 GB | Everything |

## Architecture

### 1. Flop Isomorphism Engine

Map every raw flop (22,100) to its canonical representative (1,755). Two flops are isomorphic if one can be transformed into the other by swapping suits.

```
Ah Kh Qh  →  canonical: Ac Kc Qc  (alphabetical suit order)
As Ks Qs  →  canonical: Ac Kc Qc  (same canonical)
Ah Kd Qs  →  canonical: Ac Kd Qh  (different — not monotone)
```

**Files to create:**
- `engine/src/isomorphism.rs` — canonical flop mapping, suit permutation
- `web/src/lib/flop-iso.ts` — TypeScript mirror for the frontend

### 2. Compact Binary Format

Replace JSON strategy storage with a purpose-built binary format.

**Per-node binary layout:**
```
[2 bytes] history_length
[N × 2 bytes] history (action indices, each as u16)
[1 byte] player (0 = OOP, 1 = IP)
[1 byte] num_actions
[2 bytes] num_hands
[num_actions × num_hands bytes] strategy (uint8, 0-255 maps to 0.0-1.0)
```

Skip fields the simulator doesn't need at load time (privateCards, possibleCards, rootEV — these are computable from the config).

**Per-spot file:**
```
[4 bytes] magic number "GTOS"
[2 bytes] version
[4 bytes] num_nodes
[4 bytes] num_oop_hands
[4 bytes] num_ip_hands
[num_oop_hands × 2 bytes] oop_private_cards (card pairs, stored once)
[num_ip_hands × 2 bytes] ip_private_cards (card pairs, stored once)
[...nodes] concatenated node data
```

Entire file compressed with zstd level 19.

**Files to create:**
- `web/src-tauri/src/tree_export.rs` — Rust serializer (extract from solved game → binary)
- `web/src/lib/tree-binary.ts` — TypeScript deserializer (binary → SolveResults[])

### 3. Batch Solver Pipeline

A CLI or background Tauri process that:
1. Reads a list of spot configs (flop, ranges, positions, tree params) from a JSON manifest.
2. For each config: init game → allocate memory → solve → extract tree → serialize to binary → compress → upload to storage.
3. Tracks progress in a local SQLite or JSON file.
4. Supports resume (skip already-solved spots).
5. Can run overnight on the user's machine or on a cloud VM.

**Config manifest format:**
```json
{
  "treePreset": "simple",
  "maxIterations": 200,
  "targetExploitability": 0.5,
  "spots": [
    {
      "flop": "Ac Kc Qc",
      "oopPosition": "UTG",
      "ipPosition": "BTN",
      "potType": "SRP",
      "startingPot": 180,
      "effectiveStack": 910,
      "oopRange": "...",
      "ipRange": "..."
    }
  ]
}
```

**Files to create:**
- `web/src-tauri/src/batch_solver.rs` — batch solve loop with progress events
- `web/src/lib/batch-config.ts` — manifest builder (generate configs from position/pot/flop combos)
- `web/src/lib/range-presets.ts` — canonical preflop ranges per position/pot type

### 4. Cloud Storage

**MVP (Supabase Storage):**
- Upload binary blobs to `solutions/library/{canonical_flop}_{oop}_{ip}_{pot}.gtos.zst`
- Index in `solved_spots` table with `tree_path` pointing to the blob
- Works for up to ~1 GB free tier (500-1000 spots)

**Scale (S3 or R2):**
- Cloudflare R2: free egress, $0.015/GB storage → 12 GB = $0.18/month
- S3: $0.023/GB storage + egress costs
- CDN in front for fast downloads

**Index API:**
- `/api/library/index` — returns list of available spots with metadata
- Client downloads the index once, then fetches individual spots on demand

### 5. Simulator Integration

The simulator currently downloads a full tree JSON from Supabase Storage. Update to:
1. On mount, fetch the library index (list of available spots).
2. Let the user pick a spot or auto-select based on filters (position, board texture, pot type).
3. Download the compact binary blob (~150 KB, <1 second).
4. Deserialize with `tree-binary.ts` into `SolveResults[]`.
5. Build practice questions from the nodes.

### 6. Strategy Quantization

Converting f32 strategies (4 bytes) to uint8 (1 byte):

```typescript
// Encode: float [0, 1] → uint8 [0, 255]
const encoded = Math.round(strategy * 255);

// Decode: uint8 [0, 255] → float [0, 1]
const decoded = encoded / 255;
```

Error: max 0.2% per action. For poker strategy display (shown as percentages), this is imperceptible. GTO Wizard uses similar quantization.

After quantization, re-normalize each hand's action probabilities to sum to exactly 1.0 on decode.

## Solve Time Estimates

On M1 MacBook Air with native Rust + rayon:

| Tree preset | Bet sizes | Est. time per spot | 500 spots | 5,000 spots |
|-------------|-----------|-------------------|-----------|-------------|
| Simple | 1 bet, 1 raise | ~30-60 sec | ~4-8 hrs | ~40-80 hrs |
| Standard | 2 bets, 1 raise | ~2-5 min | ~16-40 hrs | ~7-17 days |
| Complex | 3 bets, 2 raises | ~10-20 min | ~3-7 days | ~35-70 days |

**Recommendation:** Start with "simple" tree preset for MVP (500 spots in one overnight session). Upgrade to "standard" for V1 using cloud compute.

## Implementation Order

1. **Flop isomorphism** — canonical mapping so we know exactly which 1,755 flops to solve
2. **Range presets** — verified preflop ranges for each position × pot type
3. **Binary format** — Rust serializer + TypeScript deserializer
4. **Batch solver** — solve loop with progress tracking and resume
5. **Cloud upload** — integrate with Supabase Storage (MVP) or S3 (scale)
6. **Simulator integration** — swap JSON loader for binary loader
7. **Library index UI** — browse/filter available spots in the app

## Open Questions

- **Range source**: Use GTO Wizard-style simplified ranges or full preflop solver output? Simplified is faster to ship.
- **Tree preset for library**: Simple (fast, less accurate) vs Standard (slower, better)? Could ship simple first and upgrade later.
- **Multi-user sharing**: Should the library be per-user or shared? A shared library means solving once benefits everyone.
- **Cloud compute**: Solve locally on user machines or spin up cloud VMs? Cloud is faster but costs money.
- **Incremental updates**: When ranges or tree configs change, do we re-solve everything? Version the library format.

## Success Metrics

- MVP: 500 spots solvable in one overnight session on M1 MacBook Air
- V1: User can open simulator and instantly practice any top-50 flop texture
- V2: Full 6-max SRP + 3-bet coverage, <3 second load per spot
- Storage cost under $5/month at full scale
