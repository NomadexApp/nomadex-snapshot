import { Distribution, DistributionData } from "./distribution.ts";
import { getLatestRound } from "./node.ts";
import { Pool, PoolTxn, Token } from "./type.ts";

let tokens: Token[] = [];
let pools: Pool[] = [];
let transactions: PoolTxn[] = [];

const yearBlockCount = Math.floor(365 * 24 * 60 * 60 / 2.81);

const poolId = 411756;
const rangeStart = getRangeStart(poolId);
const rangeEnd = await getLatestRound();

console.log(
  "Processing rewards for",
  rangeEnd - rangeStart,
  "rounds of pool",
  poolId,
);
console.log("Round start:", rangeStart);
console.log("Round end:", rangeEnd);

const aprTarget = 0.2875;

console.log("Target APR:", Number((aprTarget * 100).toFixed(2)));

const reward = 100_000_000;
const rewardPerRound = BigInt(Math.floor(reward / (rangeEnd - rangeStart)));
console.log(
  "Duration days approx:",
  (365 * (rangeEnd - rangeStart) / yearBlockCount).toFixed(2),
);
console.log(
  "Duration Rate:",
  (aprTarget * 100 * (rangeEnd - rangeStart) / yearBlockCount).toFixed(4),
  "%",
);

const rewardsMap: Record<string, bigint> = {};

function getBalancesAtRound(round: number) {
  const balances: Record<string, bigint> = {};

  for (const event of transactions) {
    if (event.round > round) break;
    const user = event.sender;
    if (event.type === 1) {
      if (typeof balances[user] !== "bigint") {
        balances[user] = 0n;
      }
      balances[user] += event.out[2];
    } else if (event.type === 2) {
      if (typeof balances[user] !== "bigint") {
        throw Error("lp removed for non-user");
      }
      balances[user] -= event.in[2];
    }
  }
  return balances;
}

function getTVLAtRound(round: number) {
  let tvl = 0n;

  for (const event of transactions) {
    if (event.round > round) break;
    tvl = event.tvl[0] * 2n;
    if (event.tvl[0] === 0n) tvl = 0n;
    if (event.tvl[1] === 0n) tvl = 0n;
  }
  return tvl;
}

async function snapshot(poolIndex: number) {
  const pool = pools.find((p) => p.id === poolIndex);
  if (!pool) throw Error("pool not found");
  const alpha = tokens.find((t) => t.id === pool.alphaId);
  if (!alpha) throw Error("alpha not found");
  const beta = tokens.find((t) => t.id === pool.betaId);
  if (!beta) throw Error("beta not found");
  const resp = await fetch(
    `https://voimain-analytics.nomadex.app/pools/${pool.id}?type=1&type=2`,
  );
  transactions = (await resp.json())
    .sort((a: any, b: any) => a.round - b.round)
    .map((t: PoolTxn) => ({
      ...t,
      in: t.in.map((x) => BigInt(x)),
      out: t.out.map((x) => BigInt(x)),
      tvl: t.tvl.map((x) => BigInt(x)),
    }));

  let accumulativeTVL = 0n;

  for (let round = rangeStart; round <= rangeEnd; round++) {
    const balances = getBalancesAtRound(round);
    const total = Object.values(balances).reduce((acc, a) => acc + a, 0n);

    for (const addr in balances) {
      if (typeof rewardsMap[addr] !== "bigint") {
        rewardsMap[addr] = 0n;
      }
      const balance = balances[addr];
      rewardsMap[addr] += (rewardPerRound * balance) / total;
    }

    accumulativeTVL += getTVLAtRound(round);
  }

  const tvl = accumulativeTVL / BigInt(rangeEnd - rangeStart);
  console.log(
    "Avg TVL in provided duration:",
    (Number(tvl) / 1e6).toLocaleString(),
  );
  const reward = Number(tvl) * aprTarget * (rangeEnd - rangeStart) /
    yearBlockCount;
  console.log("Reward:", (reward / 1e6).toLocaleString());

  const distributionData: DistributionData = {
    pool: poolId,
    fromRound: rangeStart,
    toRound: rangeEnd,
    tokens: [alpha.symbol, beta.symbol],
    tvl: tvl.toString(),
    distrib: [],
  };

  for (
    const [addr, value] of Object.entries(rewardsMap).sort(
      (a, b) => Number(b[1]) - Number(a[1]),
    )
  ) {
    if (value === 0n) continue;
    const userReward = reward * Number(value) / 1e8;
    console.log(addr, userReward / 1e6, "VOI");
    distributionData.distrib.push({
      address: addr,
      amount: BigInt(Math.floor(userReward)).toString(),
      tvl: BigInt(Math.floor(Number(tvl) * Number(value) / 1e8)).toString(),
      txnId: "",
    });
  }

  const distribution = new Distribution(distributionData);
  await distribution.process();
}

if (import.meta.main) {
  const resp = await fetch("https://voimain-analytics.nomadex.app/tokens");
  tokens = await resp.json();
  tokens.unshift({
    id: 0,
    type: 0,
    decimals: 6,
    name: "VOI",
    symbol: "VOI",
    total: 10_000_000_000_000000n,
  });
  const respPools = await fetch("https://voimain-analytics.nomadex.app/pools");
  pools = await respPools.json();
  await snapshot(poolId);
}

function getRangeStart(poolId: number) {
  const dir = Deno.readDirSync("data/");
  let end = 0;
  for (const file of dir) {
    if (!file.isFile) continue;
    if (!file.name.endsWith(".json")) continue;
    const text = Deno.readTextFileSync(`data/${file.name}`);
    const json = JSON.parse(text);
    if (json.pool !== poolId) continue;
    end = Math.max(end, json.toRound);
  }
  return end + 1;
}
