import { describe, expect, it, vi } from "vitest";
import { runDemoLocal } from "../../../../../../scripts/demo-local";

describe("runDemoLocal", () => {
    it("runs setup phases serially before worker and app", async () => {
        const phases: string[] = [];
        const spawn = ((command: string, args: string[]) => {
            phases.push(args.join(" ") || command);
            return {
                once() {
                    return this;
                },
                on() {
                    return this;
                },
                kill() {},
                exited: Promise.resolve(0),
            };
        }) as never;

        await runDemoLocal({ spawn });

        expect(phases).toEqual([
            "db:migrate",
            "db:seed",
            "--host 127.0.0.1 --port 8545",
            "chain:deploy",
            "chain:bootstrap-local",
            "chain:seed-history",
            "chain:index",
            "chain:reconcile",
            "worker",
            "dev",
        ]);
    });

    it("checks database reachability before spawning Anvil", async () => {
        const spawn = vi.fn(() => ({ exited: Promise.resolve(0) })) as never;
        await expect(
            runDemoLocal({
                spawn,
                databasePing: vi.fn(async () => {
                    throw new Error("database unavailable");
                }),
            }),
        ).rejects.toThrow("database unavailable");
        expect(spawn).not.toHaveBeenCalled();
    });

    it("polls Anvil chain id and rejects a non-local chain", async () => {
        await expect(
            runDemoLocal({
                spawn: vi.fn(() => ({
                    exited: Promise.resolve(0),
                    kill: vi.fn(),
                })) as never,
                databasePing: async () => undefined,
                waitForAnvil: async () => {
                    throw new Error("demo seeding requires chain id 31337");
                },
            }),
        ).rejects.toThrow("demo seeding requires chain id 31337");
    });
});
