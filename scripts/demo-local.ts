import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { normalizeError, sanitizeMessage } from "@/core/worker/error-redaction";
import { db } from "@/server/drizzle/db";

type Spawned = Pick<ChildProcess, "once" | "on" | "kill"> & {
    exited?: Promise<number>;
    stdout?: { on(event: "data", listener: (chunk: Buffer) => void): void };
    stderr?: { on(event: "data", listener: (chunk: Buffer) => void): void };
    pid?: number;
};
type Spawn = (command: string, args: string[], options?: object) => Spawned;

type DemoOptions = {
    spawn?: Spawn;
    signal?: AbortSignal;
    databasePing?: () => Promise<void>;
    waitForAnvil?: () => Promise<void>;
    signals?: Pick<NodeJS.Process, "on" | "removeListener">;
};

const phases = [
    "db:migrate",
    "db:seed",
    "chain:anvil",
    "chain:deploy",
    "chain:bootstrap-local",
    "chain:seed-history",
    "chain:index",
    "chain:reconcile",
] as const;

export async function checkDatabaseReachable(
    ping: () => Promise<void> = async () => {
        await db.execute(sql`select 1`);
    },
): Promise<void> {
    try {
        await ping();
    } catch (error) {
        throw new Error(
            `database preflight failed; verify DATABASE_URL before starting Anvil: ${normalizeError(error).message}`,
        );
    }
}

export async function waitForAnvilReady(
    input: { rpcUrl?: string; timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
    if (process.env.NODE_ENV === "production") {
        throw new Error("demo seeding requires development mode");
    }
    const rpcUrl =
        input.rpcUrl ?? process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
    const deadline = Date.now() + (input.timeoutMs ?? 30_000);
    let lastError = "unavailable";
    while (Date.now() < deadline) {
        try {
            const response = await fetch(rpcUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_chainId",
                    params: [],
                }),
            });
            const payload = (await response.json()) as {
                result?: string;
                error?: { message?: string };
            };
            if (payload.result) {
                if (Number.parseInt(payload.result, 16) !== 31337) {
                    throw new Error("demo seeding requires chain id 31337");
                }
                return;
            }
            lastError =
                payload.error?.message ?? "eth_chainId returned no result";
        } catch (error) {
            lastError = normalizeError(error).message;
            if (lastError.includes("requires chain id 31337")) throw error;
        }
        await new Promise((resolve) =>
            setTimeout(resolve, input.pollMs ?? 100),
        );
    }
    throw new Error(`Anvil readiness check timed out: ${lastError}`);
}

function attachRedactedOutput(child: Spawned): void {
    child.stdout?.on("data", (chunk) =>
        process.stdout.write(sanitizeMessage(String(chunk))),
    );
    child.stderr?.on("data", (chunk) =>
        process.stderr.write(sanitizeMessage(String(chunk))),
    );
}

function runChild(
    spawn: Spawn,
    phase: string,
): { child: Spawned; done: Promise<void> } {
    const args =
        phase === "chain:anvil"
            ? ["--host", "127.0.0.1", "--port", "8545"]
            : [phase];
    const command = phase === "chain:anvil" ? "anvil" : "pnpm";
    const child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
    });
    attachRedactedOutput(child);
    const done = child.exited
        ? child.exited.then((code) => {
              if (code !== 0)
                  throw new Error(`${phase} exited with code ${code}`);
          })
        : new Promise<void>((resolve, reject) => {
              child.once("error", reject);
              child.once("exit", (code) => {
                  if (code === 0 || code === null) resolve();
                  else reject(new Error(`${phase} exited with code ${code}`));
              });
          });
    return { child, done };
}

function describePhaseError(phase: string, error: unknown): Error {
    const message = normalizeError(error).message;
    if (
        phase === "chain:bootstrap-local" &&
        /mapped café owner mismatch/i.test(message)
    ) {
        return new Error(
            `chain bootstrap detected stale database/chain state; run demo:local from a fresh database: ${message}`,
        );
    }
    return new Error(`${phase} failed: ${message}`);
}

export async function runDemoLocal(options: DemoOptions = {}): Promise<void> {
    const spawn = options.spawn ?? (nodeSpawn as Spawn);
    const started: Array<{ child: Spawned; done: Promise<void> }> = [];
    let terminating = false;
    let signalPromise: Promise<void> | undefined;
    const terminate = () => {
        if (terminating) return;
        terminating = true;
        signalPromise = Promise.allSettled(
            started.map((entry) => entry.done),
        ).then(() => undefined);
        for (const entry of started) {
            if (entry.child.pid) {
                try {
                    process.kill(-entry.child.pid, "SIGTERM");
                } catch {
                    entry.child.kill("SIGTERM");
                }
            } else {
                entry.child.kill("SIGTERM");
            }
        }
    };
    const signals = options.signals ?? process;
    const onSignal = () => terminate();
    options.signal?.addEventListener("abort", onSignal, { once: true });
    signals.on("SIGINT", onSignal);
    signals.on("SIGTERM", onSignal);

    try {
        await checkDatabaseReachable(
            options.databasePing ??
                (options.spawn ? async () => undefined : undefined),
        );
        for (const phase of phases) {
            let running: { child: Spawned; done: Promise<void> };
            try {
                running = runChild(spawn, phase);
                started.push(running);
                if (phase === "chain:anvil") {
                    await (
                        options.waitForAnvil ??
                        (options.spawn
                            ? async () => undefined
                            : waitForAnvilReady)
                    )();
                    continue;
                }
                await running.done;
            } catch (error) {
                throw describePhaseError(phase, error);
            }
        }
        const worker = runChild(spawn, "worker");
        started.push(worker);
        const app = runChild(spawn, "dev");
        started.push(app);
        await Promise.all([worker.done, app.done]);
    } catch (error) {
        terminate();
        await signalPromise;
        throw error instanceof Error
            ? error
            : new Error(normalizeError(error).message);
    } finally {
        options.signal?.removeEventListener("abort", onSignal);
        signals.removeListener("SIGINT", onSignal);
        signals.removeListener("SIGTERM", onSignal);
    }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
    runDemoLocal().catch((error) => {
        console.error(normalizeError(error));
        process.exitCode = 1;
    });
}
