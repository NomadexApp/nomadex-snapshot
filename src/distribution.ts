import algosdk from "algosdk";
import { algod } from "./node.ts";
import { account } from "./account.ts";
import { encodeBase64 } from "jsr:@std/encoding/base64";

export type DistributionData = {
  pool: number;
  tvl: string;
  tokens: string[];
  fromRound: number;
  toRound: number;
  distrib: {
    address: string;
    amount: string;
    tvl: string;
    txnId: string;
  }[];
};

export class Distribution {
  distribution: DistributionData;

  constructor(distribution: DistributionData) {
    this.distribution = distribution;
  }

  static loadFromFile(path: string) {
    const json = Deno.readTextFileSync(path);
    const distribution = JSON.parse(json);
    return new Distribution(distribution);
  }

  exportFile() {
    const json = JSON.stringify(this.distribution, null, "    ");
    Deno.writeTextFile(`data/${Math.floor(Date.now() / 1000)}.json`, json);
  }

  exportCsv() {
    let csv = "pool,user,round_from,round_to,tvl,user_tvl,amount,txid\n";
    for (const distrib of this.distribution.distrib) {
      csv += `${this.distribution.pool},`;
      csv += `${distrib.address},`;
      csv += `${this.distribution.fromRound},`;
      csv += `${this.distribution.toRound},`;
      csv += `${this.distribution.tvl},`;
      csv += `${distrib.tvl},`;
      csv += `${distrib.amount},`;
      csv += `${distrib.txnId}\n`;
    }
    Deno.writeTextFile(`data/${Math.floor(Date.now() / 1000)}.csv`, csv);
  }

  async process() {
    const suggestedParams = await algod.getTransactionParams().do();
    console.log("Distributor Address: ", account.addr);
    const txnsToSign: string[] = [];
    for (const distrib of this.distribution.distrib) {
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        suggestedParams: suggestedParams,
        sender: account.addr,
        receiver: distrib.address,
        amount: BigInt(distrib.amount),
        note: new TextEncoder().encode(
          `Nomadex; Liquidity provider reward ${
            this.distribution.tokens.join("/")
          }; ` +
            `Pool=${this.distribution.pool}; ` +
            `TVL=${this.distribution.tvl}; ` +
            `Round: ${this.distribution.fromRound}-${this.distribution.toRound};`,
        ),
      });
      distrib.txnId = txn.txID();
      this.exportFile();
      txnsToSign.push(encodeBase64(txn.toByte()));
    }
    this.exportFile();
    this.exportCsv();
    Deno.writeTextFile(
      `data/${Math.floor(Date.now() / 1000)}.txns`,
      txnsToSign.join(","),
    );
  }
}
