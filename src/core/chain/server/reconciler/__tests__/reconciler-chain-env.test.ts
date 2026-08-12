import { afterEach, describe, expect, it, vi } from "vitest";

import { runReconcilerOnce } from "../reconciler";

const original = process.env.CHAIN_ENV;
afterEach(() => {
    process.env.CHAIN_ENV = original;
    vi.restoreAllMocks();
});

describe("runReconcilerOnce on a public chain", () => {
    it("does nothing, instead of wiping projections it cannot rebuild", async () => {
        // El chequeo cuenta eventos desde el bloque 0: en una red pública eso
        // no cuadra nunca y el "arreglo" borraba proyecciones buenas.
        process.env.CHAIN_ENV = "arbitrumSepolia";
        const pub = {
            getBlockNumber: vi.fn(),
            getLogs: vi.fn(),
            readContract: vi.fn(),
        };
        const database = {
            select: vi.fn(),
            transaction: vi.fn(),
            insert: vi.fn(),
        };

        const result = await runReconcilerOnce({
            pub: pub as never,
            database: database as never,
            addresses: {} as never,
        });

        expect(result).toEqual({ diverged: false, repaired: false });
        expect(pub.readContract).not.toHaveBeenCalled();
        expect(pub.getLogs).not.toHaveBeenCalled();
        expect(database.select).not.toHaveBeenCalled();
        expect(database.transaction).not.toHaveBeenCalled();
    });
});
