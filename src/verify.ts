import { indexer } from "./node.ts";

const poolId = 411756;

if (import.meta.main) {
  console.log();
  const dir = Array.from(Deno.readDirSync("data/")).filter((d) =>
    d.name.endsWith(".json")
  ).sort((a, b) => b.name < a.name ? 1 : -1);
  for (const file of dir) {
    if (!file.isFile) continue;
    if (!file.name.endsWith(".json")) continue;
    if (file.name === "0.json") continue;
    const text = Deno.readTextFileSync(`data/${file.name}`);
    const json = JSON.parse(text);
    if (json.pool !== poolId) continue;
    for (const txId of json.distrib.map((d: any) => d.txnId)) {
      try {
        const receipt = await indexer.lookupTransactionByID(txId).do();
        console.log(
          "Exists:",
          receipt.transaction.id,
          receipt.transaction.confirmedRound?.toString(),
        );
      } catch (_: any) {
        console.log("Confirmation Failed:", txId);
        console.log("File:", `data/${file.name}`);
        console.log();
        Deno.exit(1);
      }
    }
    if (file.name !== dir.at(-1)?.name) {
      Deno.writeTextFileSync("data/_.jsonl", JSON.stringify(json) + "\n", {
        append: true,
        create: true,
      });
      Deno.removeSync(`data/${file.name}`);
    }
    try {
      Deno.removeSync(`data/${file.name.replace(".json", ".csv")}`);
    } catch (_) {
      // Ignore if the CSV file does not exist
    }
    try {
      Deno.removeSync(`data/${file.name.replace(".json", ".txns")}`);
    } catch (_) {
      // Ignore if the txns file does not exist
    }
  }
}
