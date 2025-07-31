import {
  getApplicationAddress,
  makePaymentTxnWithSuggestedParamsFromObject,
} from "algosdk";
import { encodeBase64 } from "jsr:@std/encoding";
import { algod, getLatestRound, indexer } from "./node.ts";
import { Pool, PoolTxn, Token } from "./type.ts";
import { account } from "./account.ts";
import { copy } from "https://deno.land/x/clipboard@v0.0.3/mod.ts";

type PoolRecord = {
  pool: number;
  apr: number;
  distributions: {
    fromRound: number;
    toRound: number;
    tvl: string;
    reward: string;
    payouts: {
      address: string;
      amount: string;
      tvl: string;
      txnId: string;
      verified: boolean;
    }[];
  }[];
};

class RewardDistribution {
  public fromRound = 8150000;
  public readonly pools: PoolRecord[] = [];

  private readonly baseApiEndpoint = "https://voimain-analytics.nomadex.app";

  constructor(fromRound: number) {
    this.fromRound = fromRound;
  }

  static fromJSON(json: {
    fromRound: number;
    pools: PoolRecord[];
  }): RewardDistribution {
    const distribution = new RewardDistribution(json.fromRound);
    for (const pool of json.pools) {
      distribution.addPool(pool.pool, pool.apr);
      for (const dist of pool.distributions) {
        distribution.addDistribution(
          pool.pool,
          dist.fromRound,
          dist.toRound,
          BigInt(dist.tvl),
          BigInt(dist.reward),
          dist.payouts.map((p) => ({
            address: p.address,
            amount: BigInt(p.amount),
            tvl: BigInt(p.tvl),
            txnId: p.txnId,
            verified: p.verified,
          })),
        );
      }
    }
    return distribution;
  }

  getPoolIds(): number[] {
    return this.pools.map((p) => p.pool);
  }

  getPool(poolId: number): PoolRecord | undefined {
    return this.pools.find((p) => p.pool === poolId);
  }

  poolExists(poolId: number): boolean {
    return this.pools.some((p) => p.pool === poolId);
  }

  isPoolDistributionVerified(poolId: number): boolean {
    const pool = this.getPool(poolId);
    if (!pool) return false;
    return pool.distributions.every((d) => d.payouts.every((p) => p.verified));
  }

  isVerified(): boolean {
    return this.pools.every((pool) =>
      pool.distributions.every((d) => d.payouts.every((p) => p.verified))
    );
  }

  getLastRound(poolId: number): number {
    const pool = this.getPool(poolId);
    if (!pool) throw Error("pool not found");
    return pool.distributions.reduce(
      (last, d) => Math.max(last, d.toRound),
      this.fromRound - 1,
    );
  }

  getNextRound(poolId: number): number {
    return this.getLastRound(poolId) + 1;
  }

  addPool(poolId: number, aprTarget: number) {
    if (!this.pools.some((p) => p.pool === poolId)) {
      if (aprTarget < 0 || aprTarget > 1) {
        throw new Error(`APR must be between 0 and 1, got ${aprTarget}`);
      }
      this.pools.push({ pool: poolId, apr: aprTarget, distributions: [] });
    }
  }

  addDistribution(
    poolId: number,
    fromRound: number,
    toRound: number,
    tvl: bigint,
    reward: bigint,
    payouts: {
      address: string;
      amount: bigint;
      tvl: bigint;
      txnId: string;
      verified: boolean;
    }[],
  ) {
    const pool = this.pools.find((p) => p.pool === poolId);
    if (!pool) throw new Error(`Pool ${poolId} not found`);
    pool.distributions.push({
      fromRound,
      toRound,
      tvl: tvl.toString(),
      reward: reward.toString(),
      payouts: payouts.map((p) => ({
        ...p,
        amount: p.amount.toString(),
        tvl: p.tvl.toString(),
      })),
    });
  }

  toJSON(): { fromRound: number; pools: PoolRecord[] } {
    return {
      fromRound: this.fromRound,
      pools: this.pools.map((pool) => ({
        pool: pool.pool,
        apr: pool.apr,
        distributions: pool.distributions.map((d) => ({
          fromRound: d.fromRound,
          toRound: d.toRound,
          tvl: d.tvl,
          reward: d.reward,
          payouts: d.payouts.map((p) => ({
            address: p.address,
            amount: p.amount,
            tvl: p.tvl,
            txnId: p.txnId,
            verified: p.verified,
          })),
        })),
      })),
    };
  }

  toString(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }

  async getNomadexTokens(): Promise<Token[]> {
    const resp = await fetch(`${this.baseApiEndpoint}/tokens`);
    const tokens: Token[] = await resp.json();
    tokens.unshift({
      id: 0,
      type: 0,
      decimals: 6,
      name: "VOI",
      symbol: "VOI",
      total: 10_000_000_000_000000n,
    });
    return tokens.map((t) => ({ ...t, total: BigInt(t.total) }));
  }

  async getNomadexPools(): Promise<Pool[]> {
    const respPools = await fetch(`${this.baseApiEndpoint}/pools`);
    const pools: Pool[] = await respPools.json();
    return pools;
  }

  async getNomadexPoolEvents(poolId: number): Promise<PoolTxn[]> {
    const resp = await fetch(
      `https://voimain-analytics.nomadex.app/pools/${poolId}?type=0&type=1&type=2&type=3`,
    );

    let events: PoolTxn[] = await resp.json();
    events = events.toSorted((a, b) => a.round - b.round);
    events = events.map((t: PoolTxn) => ({
      ...t,
      in: [BigInt(t.in[0]), BigInt(t.in[1]), BigInt(t.in[2])],
      out: [BigInt(t.out[0]), BigInt(t.out[1]), BigInt(t.out[2])],
      tvl: [BigInt(t.tvl[0]), BigInt(t.tvl[1])],
    }));

    return events;
  }

  static getBalancesAtRound(poolId: number, round: number, events: PoolTxn[]) {
    const balances: Record<string, bigint> = {};
    const poolAddress = getApplicationAddress(poolId).toString();

    for (const event of events) {
      if (event.round > round) break;
      if (event.type === 3) {
        if (event.sender !== poolAddress) {
          const prevBal = balances[event.sender] ?? 0n;
          balances[event.sender] = prevBal - event.in[2];
        }
        if (event.receiver !== poolAddress) {
          const prevBal = balances[event.receiver] ?? 0n;
          balances[event.receiver] = prevBal + event.out[2];
        }
      }
    }
    return balances;
  }

  static getTVLAtRound(round: number, events: PoolTxn[]) {
    let tvl = 0n;

    for (const event of events.filter((e) => [0, 1, 2].includes(e.type))) {
      if (event.round > round) break;
      tvl = event.tvl[0] * 2n;
      if (event.tvl[0] === 0n) tvl = 0n;
      if (event.tvl[1] === 0n) tvl = 0n;
    }
    return tvl;
  }

  async verifyDistributions() {
    for (const poolId of this.getPoolIds()) {
      const pool = this.getPool(poolId)!;
      for (const distribution of pool.distributions) {
        for (const payout of distribution.payouts) {
          if (payout.verified) continue;
          try {
            if (!payout.txnId) throw Error("verification failed");
            const receipt = await indexer.lookupTransactionByID(payout.txnId)
              .do();
            if (receipt.transaction.id !== payout.txnId) {
              throw Error("txn id mismatch");
            }
            payout.verified = true;
            console.log(
              "Exists:",
              receipt.transaction.id,
              receipt.transaction.confirmedRound?.toString(),
            );
          } catch (_: any) {
            console.log("Confirmation Failed:", payout.txnId);
            console.log("Pool:", poolId);
            console.log(
              "Rounds:",
              distribution.fromRound,
              "-",
              distribution.toRound,
            );
            Deno.exit(1);
          }
        }
      }
    }
  }

  async buildPayouts() {
    const payouts: (PoolRecord["distributions"][0]["payouts"][0] & {
      txn: string;
    })[] = [];
    const suggestedParams = await algod.getTransactionParams().do();

    for (const poolId of this.getPoolIds()) {
      const pool = this.getPool(poolId)!;
      for (const distribution of pool.distributions) {
        for (const payout of distribution.payouts) {
          if (payout.verified) continue;
          if (payout.txnId) continue;
          try {
            const txn = makePaymentTxnWithSuggestedParamsFromObject({
              suggestedParams: suggestedParams,
              sender: account.addr,
              receiver: payout.address,
              amount: BigInt(payout.amount),
              note: new TextEncoder().encode(
                `Nomadex; Liquidity provider reward; ` +
                  `Pool=${poolId}; ` +
                  `TVL=${distribution.tvl}; ` +
                  `Round: ${distribution.fromRound}-${distribution.toRound};`,
              ),
            });
            payout.txnId = txn.txID();
            payouts.push({ ...payout, txn: encodeBase64(txn.toByte()) });
          } catch (_: any) {
            console.log("Confirmation Failed:", payout.txnId);
            console.log("Pool:", poolId);
            console.log(
              "Rounds:",
              distribution.fromRound,
              "-",
              distribution.toRound,
            );
            Deno.exit(1);
          }
        }
      }
    }
    return payouts;
  }

  async buildNextDistribution(poolId: number, toRound: number) {
    const fromRound = this.getNextRound(poolId);
    const roundCount = toRound - fromRound + 1;
    const pool = this.getPool(poolId)!;
    const events = await this.getNomadexPoolEvents(poolId);

    let accumulativeTVL = 0n;
    const rewardsMap: Record<string, bigint> = {};
    const rewardShare = 100_000_000_000;
    const rewardPerRound = BigInt(Math.floor(rewardShare / roundCount));

    for (let round = fromRound; round <= toRound; round++) {
      const balances = RewardDistribution.getBalancesAtRound(
        poolId,
        round,
        events,
      );
      const total = Object.values(balances).reduce((acc, a) => acc + a, 0n);
      accumulativeTVL += RewardDistribution.getTVLAtRound(round, events);
      if (total === 0n) continue;

      for (const addr in balances) {
        if (typeof rewardsMap[addr] !== "bigint") {
          rewardsMap[addr] = 0n;
        }
        const balance = balances[addr];
        rewardsMap[addr] += (rewardPerRound * balance) / total;
      }
    }

    const tvl = accumulativeTVL / BigInt(roundCount);
    const reward = Math.floor(
      (Number(tvl) * pool.apr * roundCount) /
        Math.floor((365 * 24 * 60 * 60) / 2.81),
    );

    const payouts: {
      address: string;
      amount: bigint;
      tvl: bigint;
      txnId: string;
      verified: boolean;
    }[] = [];

    for (
      const [addr, value] of Object.entries(rewardsMap).sort(
        (a, b) => Number(b[1]) - Number(a[1]),
      )
    ) {
      if (value === 0n) continue;
      const userReward = (Number(value) * reward) / rewardShare;
      payouts.push({
        address: addr,
        amount: BigInt(Math.floor(userReward)),
        tvl: BigInt(Math.floor((Number(tvl) * Number(value)) / rewardShare)),
        txnId: "",
        verified: false,
      });
    }

    return {
      fromRound,
      toRound,
      tvl: tvl,
      reward: BigInt(reward),
      payouts: payouts,
    };
  }
}

const knownPools = [
  {
    poolId: 411756,
    apr: 0.2875,
  },
  {
    poolId: 40176866,
    apr: 0.14375,
  },
  {
    poolId: 40176894,
    apr: 0.14375,
  },
  {
    poolId: 40215993,
    apr: 0.14375,
  },
  {
    poolId: 411789,
    apr: 0.14375,
  },
];

if (import.meta.main) {
  let distribution: RewardDistribution;
  try {
    const content = Deno.readTextFileSync("./data/data.json");
    const json = JSON.parse(content);
    distribution = RewardDistribution.fromJSON(json);
  } catch (_) {
    throw Error("failed to load json file");
  }

  // validate
  for (const knownPool of knownPools) {
    distribution.addPool(knownPool.poolId, knownPool.apr);
  }

  await distribution.verifyDistributions();
  const latestRound = await getLatestRound();

  for (const poolId of distribution.getPoolIds()) {
    const data = await distribution.buildNextDistribution(poolId, latestRound);
    const { fromRound, toRound, tvl, reward, payouts } = data;
    distribution.addDistribution(
      poolId,
      fromRound,
      toRound,
      tvl,
      reward,
      payouts,
    );

    console.log();
    console.log(`Pool:  `, poolId.toString());
    console.log(`Range: `, `${fromRound}-${toRound}`);
    console.log(`TVL:   `, (Number(tvl) / 1e6).toLocaleString());
    console.log(`Reward:`, (Number(reward) / 1e6).toLocaleString());
    console.log();
    for (const payout of payouts) {
      console.log(
        payout.address,
        (Number(payout.amount) / 1e6).toLocaleString().padStart(12, " "),
        "VOI   |  ",
        (Number(payout.tvl) / 1e6).toLocaleString(),
        "VOI",
      );
    }
  }

  const soft = Deno.args.includes("--soft");

  if (!soft) {
    const payouts = await distribution.buildPayouts();
    const txnsBase64 = payouts.map((p) => p.txn).join(",");
    Deno.writeTextFileSync("./data/txns.txt", txnsBase64);
    Deno.writeTextFileSync("./data/data.json", distribution.toString());
    await copy(txnsBase64);
  }
}
