export type Token = {
  id: number;
  type: number;
  decimals: number;
  total: bigint;
  name: string;
  symbol: string;
};

export type Pool = {
  id: number;
  alphaId: number;
  alphaType: number;
  betaId: number;
  betaType: number;
  swapFee: bigint;
  balances: [bigint, bigint];
  volume: [bigint, bigint];
  apr: number;
  online: boolean;
};

export type PoolTxn = {
  id: string;
  pool: number;
  sender: string;
  round: number;
  timestamp: number;
  type: number;
  in: [bigint, bigint, bigint];
  out: [bigint, bigint, bigint];
  tvl: [bigint, bigint];
};
