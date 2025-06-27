# 🛰️ Nomadex Snapshot

A Deno-based tool for capturing TVL (Total Value Locked) snapshots of Nomadex liquidity pools and generating token distribution transactions (airdrops) for LPs.

## 📌 Purpose

This tool powers governance-led incentive programs by:

* Taking snapshots of LP positions in supported pools
* Calculating fair reward allocations
* Generating ready-to-execute transactions for airdrops

## ⚙️ Usage

### 1. Clone the repo

```bash
git clone https://github.com/NomadexApp/nomadex-snapshot.git
cd nomadex-snapshot
```

### 2. Run a snapshot
```bash
deno task start
```

This executes src/main.ts and logs output to main.log.

### 3. Verify the snapshot
```bash
deno task verify
```

This runs src/verify.ts and logs to verify.log.
