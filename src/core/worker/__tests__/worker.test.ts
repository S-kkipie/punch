import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const packageJson = JSON.parse(
    readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
) as { scripts: Record<string, string> };

import {
    startWorker,
    type WorkerDependencies,
} from "../../../../scripts/worker";

const deferred = <T = void>() => {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

describe("worker entrypoint", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it("uses Node server conditions in the worker package script", () => {
        expect(packageJson.scripts.worker).toBe(
            "node --conditions=react-server --import tsx --env-file=.env scripts/worker.ts",
        );
    });

    it("recovers before scheduling independent loops at their exact intervals", async () => {
        const calls: string[] = [];
        const deps = workerDeps({
            recoverStuckJobs: async () => calls.push("recover"),
            runRelayerOnce: async () => calls.push("relayer"),
            runIndexerOnce: async () => calls.push("indexer"),
            expirePurchasesService: async () => calls.push("expiry"),
            runReconcilerOnce: async () => calls.push("reconciler"),
        });

        const worker = await startWorker(deps);
        expect(calls).toEqual(["recover"]);

        await vi.advanceTimersByTimeAsync(2_000);
        expect(calls).toEqual(["recover", "relayer", "indexer"]);
        await vi.advanceTimersByTimeAsync(28_000);
        expect(calls).toContain("expiry");
        expect(calls).not.toContain("reconciler");
        await vi.advanceTimersByTimeAsync(30_000);
        expect(calls).toContain("reconciler");
        await worker.shutdown();
    });

    it("does not re-enter a slow loop while other loops continue", async () => {
        const relayer = deferred();
        let relayerCalls = 0;
        let indexerCalls = 0;
        const worker = await startWorker(
            workerDeps({
                runRelayerOnce: () => {
                    relayerCalls++;
                    return relayer.promise;
                },
                runIndexerOnce: async () => {
                    indexerCalls++;
                },
            }),
        );

        await vi.advanceTimersByTimeAsync(6_000);
        expect(relayerCalls).toBe(1);
        expect(indexerCalls).toBe(3);
        relayer.resolve();
        await vi.advanceTimersByTimeAsync(0);
        await worker.shutdown();
    });

    it("logs normalized errors and keeps the other loops alive", async () => {
        const error = { secret: "do-not-log" };
        const logger = { error: vi.fn() };
        let indexerCalls = 0;
        const worker = await startWorker(
            workerDeps({
                logger,
                runRelayerOnce: async () => {
                    throw error;
                },
                runIndexerOnce: async () => {
                    indexerCalls++;
                },
            }),
        );

        await vi.advanceTimersByTimeAsync(4_000);
        expect(indexerCalls).toBe(2);
        expect(logger.error).toHaveBeenCalledWith("relayer tick failed", {
            error: { name: "Error", message: "Unknown error" },
        });
        await worker.shutdown();
    });

    it("waits for in-flight ticks and makes shutdown idempotent", async () => {
        const tick = deferred();
        const exit = vi.fn();
        const worker = await startWorker(
            workerDeps({
                runRelayerOnce: () => tick.promise,
                exit,
            }),
        );
        await vi.advanceTimersByTimeAsync(2_000);

        const first = worker.shutdown();
        const second = worker.shutdown();
        expect(first).toBe(second);
        expect(exit).not.toHaveBeenCalled();

        tick.resolve();
        await first;
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);

        await worker.shutdown();
        expect(exit).toHaveBeenCalledTimes(1);
    });
});

function workerDeps(
    overrides: Partial<WorkerDependencies> = {},
): WorkerDependencies {
    return {
        recoverStuckJobs: async () => {},
        runRelayerOnce: async () => {},
        runIndexerOnce: async () => {},
        expirePurchasesService: async () => {},
        runReconcilerOnce: async () => {},
        logger: { error: vi.fn() },
        exit: vi.fn(),
        ...overrides,
    };
}
