import { Algodv2, Indexer } from "algosdk";

export const algod = new Algodv2("", "https://voimain-api.nomadex.app", "");
export const indexer = new Indexer("", "https://mainnet-idx.voi.nodely.dev", "");

export async function getLatestRound() {
  const status = await algod.status().do();
  return Number(status.lastRound);
}
