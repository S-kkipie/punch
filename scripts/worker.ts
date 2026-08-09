import { pathToFileURL } from "node:url";
import { getLogger } from "@logtape/logtape";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import { runReconcilerOnce } from "@/core/chain/server/reconciler/reconciler";
import {
    recoverStuckJobs,
    runRelayerOnce,
} from "@/core/chain/server/relayer/relayer";
import { expirePurchasesService } from "@/core/purchase/server/services/expire-purchases-service";

const intervals = {
    relayer: 2_000,
    indexer: 2_000,
    expiry: 30_000,
    reconciler: 60_000,
} as const;

type Timer = ReturnType<typeof setInterval>;
type Signal = "SIGINT" | "SIGTERM";

export interface WorkerLogger {
    error(message: string, properties?: Record<string, unknown>): void;
}

export interface WorkerSignals {
    on(signal: Signal, listener: () => void): void;
    removeListener(signal: Signal, listener: () => void): void;
}

export interface WorkerDependencies {
    recoverStuckJobs: () => Promise<unknown>;
    runRelayerOnce: () => Promise<unknown>;
    runIndexerOnce: () => Promise<unknown>;
    expirePurchasesService: () => Promise<unknown>;
    runReconcilerOnce: () => Promise<unknown>;
    logger: WorkerLogger;
    setInterval?: typeof setInterval;
    clearInterval?: typeof clearInterval;
    signals?: WorkerSignals;
    exit?: (code: number) => void;
}

export interface WorkerController {
    shutdown(): Promise<void>;
}

function sanitizeMessage(message: string): string {
    return message
        .replace(
            /([a-z][a-z\d+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
            "$1[redacted]@",
        )
        .replace(
            /([?&](?:token|secret|password|passwd|key|api[_-]?key|authorization|mnemonic|private[_-]?key)=)[^&#\s]+/gi,
            "$1[redacted]",
        )
        .replace(/\b(bearer)\s+[^\s,;]+/gi, "$1 [redacted]")
        .replace(
            /\b(password|passwd|token|secret|mnemonic|private[_-]?key|api[_-]?key|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
            "$1=[redacted]",
        );
}

function normalizeError(error: unknown): { name: string; message: string } {
    if (error instanceof Error) {
        return { name: error.name, message: sanitizeMessage(error.message) };
    }
    return { name: "Error", message: "Unknown error" };
}

export async function startWorker(
    overrides: Partial<WorkerDependencies> = {},
): Promise<WorkerController> {
    const dependencies: WorkerDependencies = {
        recoverStuckJobs: () => recoverStuckJobs(),
        runRelayerOnce: () => runRelayerOnce(),
        runIndexerOnce: () => runIndexerOnce(),
        expirePurchasesService: () => expirePurchasesService(),
        runReconcilerOnce: () => runReconcilerOnce(),
        logger: getLogger(["worker"]),
        setInterval,
        clearInterval,
        signals: process,
        exit: (code) => process.exit(code),
        ...overrides,
    };

    const active = new Set<Promise<void>>();
    const timers: Timer[] = [];
    let shuttingDown = false;
    let shutdownPromise: Promise<void> | undefined;

    const logFailure = (name: string, error: unknown) => {
        dependencies.logger.error(`${name} tick failed`, {
            error: normalizeError(error),
        });
    };

    const startLoop = (
        name: keyof typeof intervals,
        fn: () => Promise<unknown>,
    ) => {
        let running = false;
        const timer = dependencies.setInterval?.(() => {
            if (shuttingDown || running) return;
            running = true;
            const tick = (async () => {
                try {
                    await fn();
                } catch (error) {
                    logFailure(name, error);
                } finally {
                    running = false;
                }
            })();
            active.add(tick);
            void tick.then(() => active.delete(tick));
        }, intervals[name]);
        if (timer !== undefined) timers.push(timer);
    };

    const onSignal = () => {
        if (shutdownPromise) return;
        shuttingDown = true;
        shutdownPromise = (async () => {
            for (const timer of timers) dependencies.clearInterval?.(timer);
            dependencies.signals?.removeListener("SIGINT", onSignal);
            dependencies.signals?.removeListener("SIGTERM", onSignal);
            await Promise.all(active);
            dependencies.exit?.(0);
        })();
    };
    dependencies.signals?.on("SIGINT", onSignal);
    dependencies.signals?.on("SIGTERM", onSignal);

    const startup = (async () => {
        try {
            await dependencies.recoverStuckJobs();
        } catch (error) {
            logFailure("recovery", error);
        }
    })();
    active.add(startup);
    void startup.then(() => active.delete(startup));
    await startup;

    if (!shuttingDown) {
        startLoop("relayer", dependencies.runRelayerOnce);
        startLoop("indexer", dependencies.runIndexerOnce);
        startLoop("expiry", dependencies.expirePurchasesService);
        startLoop("reconciler", dependencies.runReconcilerOnce);
    }

    return {
        shutdown: () => {
            onSignal();
            return shutdownPromise as Promise<void>;
        },
    };
}

export async function main(): Promise<void> {
    await startWorker();
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
    void main();
}
