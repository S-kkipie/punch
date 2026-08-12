import { DurableObject } from "cloudflare:workers";
import { runIndexerOnce } from "@/core/chain/server/indexer/indexer";
import { runReconcilerOnce } from "@/core/chain/server/reconciler/reconciler";
import {
    recoverStuckJobs,
    runRelayerOnce,
} from "@/core/chain/server/relayer/relayer";
import {
    recoverStuckPlanOrders,
    runPlanRunnerOnce,
} from "@/core/plan/server/runner/plan-runner";
import { expirePurchasesService } from "@/core/purchase/server/services/expire-purchases-service";
import { normalizeError } from "@/core/worker/error-redaction";

/**
 * Cloudflare port of scripts/worker.ts.
 *
 * Cron Triggers fire at most once a minute, which would leave a punch
 * unconfirmed for up to 60s. A Durable Object alarm can be rescheduled at
 * arbitrary millisecond offsets, so the loop keeps the 2s cadence the Node
 * worker uses. Slower jobs run every Nth tick instead of on their own timer.
 */
const TICK_MS = 2_000;
const EXPIRY_EVERY_TICKS = 15; // 30s
const RECONCILER_EVERY_TICKS = 30; // 60s

type Job = { name: string; run: () => Promise<unknown> };

export class PunchWorker extends DurableObject {
    /**
     * Kicks the loop and returns immediately. Safe to call repeatedly: setting
     * an alarm while one is pending just overwrites it.
     */
    async start(): Promise<void> {
        useHyperdrive(this.env as Env);
        await this.ctx.storage.put("ticks", 0);
        await this.recover();
        await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }

    async stop(): Promise<void> {
        await this.ctx.storage.deleteAlarm();
    }

    async status(): Promise<{ ticks: number; alarm: number | null }> {
        return {
            ticks: (await this.ctx.storage.get<number>("ticks")) ?? 0,
            alarm: await this.ctx.storage.getAlarm(),
        };
    }

    async alarm(): Promise<void> {
        // El alarm despierta el objeto por su cuenta, sin pasar por fetch: si
        // no se re-aplica aquí, el pool se abre contra la URL equivocada.
        useHyperdrive(this.env as Env);
        const ticks = ((await this.ctx.storage.get<number>("ticks")) ?? 0) + 1;
        await this.ctx.storage.put("ticks", ticks);

        const jobs: Job[] = [
            { name: "relayer", run: runRelayerOnce },
            { name: "planRunner", run: runPlanRunnerOnce },
            { name: "indexer", run: runIndexerOnce },
        ];
        if (ticks % EXPIRY_EVERY_TICKS === 0) {
            jobs.push({ name: "expiry", run: expirePurchasesService });
        }
        if (ticks % RECONCILER_EVERY_TICKS === 0) {
            jobs.push({ name: "reconciler", run: runReconcilerOnce });
        }

        for (const job of jobs) await this.runSafely(job);

        // Rescheduled last and unconditionally: a thrown job must not silently
        // end the loop, which would look like a healthy but frozen worker.
        await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
    }

    private async recover(): Promise<void> {
        await this.runSafely({ name: "recoverJobs", run: recoverStuckJobs });
        await this.runSafely({
            name: "recoverPlanOrders",
            run: recoverStuckPlanOrders,
        });
    }

    private async runSafely(job: Job): Promise<void> {
        try {
            await job.run();
        } catch (error) {
            console.error(
                `${job.name} tick failed`,
                normalizeError(error).message,
            );
        }
    }
}

/**
 * Apunta la base a Hyperdrive antes de la primera consulta. El pool de
 * `@/server/drizzle/db` es perezoso justamente para esto: la cadena de
 * conexión del binding solo existe dentro del handler, y contra el pooler de
 * Supabase el socket del runtime de Workers se cae apenas se usa.
 */
function useHyperdrive(env: Env): void {
    if (!env.HYPERDRIVE?.connectionString) return;
    process.env.DATABASE_URL = env.HYPERDRIVE.connectionString;
    // El tramo worker→Hyperdrive es local; el TLS al servidor lo pone Cloudflare.
    process.env.DATABASE_SSL = "false";
}

function stub(env: Env) {
    useHyperdrive(env);
    return env.PUNCH_WORKER.get(env.PUNCH_WORKER.idFromName("singleton"));
}

/**
 * Control plane. The worker does its real work on the DO alarm, not on fetch;
 * these routes only start, stop and inspect that loop.
 */
export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const { pathname } = new URL(request.url);
        // workers.dev URLs are public and guessable, and /stop would silently
        // freeze the whole pipeline, so mutating routes need the token.
        if (
            request.headers.get("x-control-token") !== env.CONTROL_TOKEN &&
            pathname !== "/status"
        ) {
            return new Response("forbidden", { status: 403 });
        }
        const worker = stub(env);
        if (pathname === "/start") {
            await worker.start();
            return Response.json({ started: true });
        }
        if (pathname === "/stop") {
            await worker.stop();
            return Response.json({ stopped: true });
        }
        if (pathname === "/status") {
            return Response.json(await worker.status());
        }
        return new Response("punch worker: /start /stop /status", {
            status: 404,
        });
    },

    /**
     * Cron acts as a watchdog only: if the alarm chain ever dies (unhandled
     * eviction, deploy), this restarts it within the minute.
     */
    async scheduled(_event: ScheduledController, env: Env): Promise<void> {
        const worker = stub(env);
        const { alarm } = await worker.status();
        if (alarm === null) await worker.start();
    },
};
