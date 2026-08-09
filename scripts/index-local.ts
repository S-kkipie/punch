import { getAddresses } from "@/core/chain/addresses";
import { createChainPublicClient } from "@/core/chain/chain";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import { db } from "@/server/drizzle/db";
import {
    indexerCursor,
    projectionCafeCredit,
    projectionConsumption,
    projectionPunchBalance,
    projectionStatus,
} from "@/server/drizzle/schemas/chain-schema";

async function main() {
    await db.transaction(async (tx) => {
        await tx.delete(projectionPunchBalance);
        await tx.delete(projectionCafeCredit);
        await tx.delete(projectionConsumption);
        await tx
            .insert(indexerCursor)
            .values({ contract: "punch", lastProcessedBlock: 0n })
            .onConflictDoUpdate({
                target: indexerCursor.contract,
                set: { lastProcessedBlock: 0n },
            });
        await tx
            .insert(projectionStatus)
            .values({ projection: "chain", paused: true, lastGoodBlock: 0n })
            .onConflictDoUpdate({
                target: projectionStatus.projection,
                set: { paused: true, lastGoodBlock: 0n },
            });
    });
    await runIndexerOnce({
        pub: createChainPublicClient(),
        database: db,
        addresses: getAddresses(),
        force: true,
    });
    console.log("local chain indexed from block zero");
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
