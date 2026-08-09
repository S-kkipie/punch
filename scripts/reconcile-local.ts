import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";
import {
    isChainProjectionStale,
    runReconcilerOnce,
} from "@/core/chain/server/reconciler/reconciler";
import { db } from "@/server/drizzle/db";

async function main() {
    const result = await runReconcilerOnce({
        pub: createChainPublicClient(),
        database: db,
        addresses: getAddresses(),
    });
    if (await isChainProjectionStale(db)) {
        throw new Error(
            `chain reconciliation failed: ${result.diverged ? "projection diverged" : "projection stale"}`,
        );
    }
    console.log("local chain reconciliation green");
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
