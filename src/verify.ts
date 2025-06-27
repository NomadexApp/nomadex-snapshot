import { indexer } from "./node.ts";

const poolId = 411756;

if (import.meta.main) {
  console.log();
  const dir = Array.from(Deno.readDirSync("data/")).filter((d) =>
    d.name.endsWith(".json")
  ).sort((a, b) => b.name < a.name ? -1 : 0);
  for (const file of dir) {
    if (!file.isFile) continue;
    if (!file.name.endsWith(".json")) continue;
    const text = Deno.readTextFileSync(`data/${file.name}`);
    const json = JSON.parse(text);
    if (json.pool !== poolId) continue;
    for (const txId of json.distrib.map((d: any) => d.txnId)) {
      try {
        const receipt = await indexer.lookupTransactionByID(txId).do();
        console.log("Exists:", receipt.transaction.id);
        console.log(
          `https://block.voi.network/explorer/transaction/${receipt.transaction.id}`,
        );
        console.log();
      } catch (_: any) {
        console.log("Confirmation Failed:", txId);
        console.log("File:", `data/${file.name}`);
        console.log();
        Deno.exit(1);
      }
    }
  }
}
