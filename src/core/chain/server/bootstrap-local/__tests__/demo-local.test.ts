import { describe, expect, it } from "vitest";
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
            "chain:anvil",
            "chain:deploy",
            "chain:bootstrap-local",
            "chain:seed-history",
            "chain:index",
            "chain:reconcile",
            "worker",
            "dev",
        ]);
    });
});
