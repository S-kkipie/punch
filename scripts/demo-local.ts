import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { normalizeError } from "@/core/worker/error-redaction";

type Spawned = Pick<ChildProcess, "once" | "on" | "kill"> & {
    exited?: Promise<number>;
};
type Spawn = (command: string, args: string[], options?: object) => Spawned;

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

function runChild(
    spawn: Spawn,
    phase: string,
): { child: Spawned; done: Promise<void> } {
    const child = spawn("pnpm", [phase], { stdio: "inherit" });
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

export async function runDemoLocal(
    options: { spawn: Spawn; signal?: AbortSignal } = {
        spawn: nodeSpawn as Spawn,
    },
): Promise<void> {
    const started: Spawned[] = [];
    let terminating = false;
    const terminate = () => {
        if (terminating) return;
        terminating = true;
        for (const child of started) child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", terminate, { once: true });

    try {
        for (const phase of phases) {
            const running = runChild(options.spawn, phase);
            started.push(running.child);
            await running.done;
        }
        const worker = runChild(options.spawn, "worker");
        started.push(worker.child);
        const app = runChild(options.spawn, "dev");
        started.push(app.child);
        await Promise.all([worker.done, app.done]);
    } catch (error) {
        terminate();
        throw new Error(normalizeError(error).message);
    } finally {
        options.signal?.removeEventListener("abort", terminate);
    }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
    runDemoLocal().catch((error) => {
        console.error(normalizeError(error));
        process.exitCode = 1;
    });
}
