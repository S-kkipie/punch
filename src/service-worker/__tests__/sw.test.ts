import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// Executes the real worker source with a minimal service-worker harness.
describe("PUNCH service worker activation", () => {
    it("removes old shell caches before claiming clients", async () => {
        const listeners = new Map<string, (event: unknown) => void>();
        const deleted: string[] = [];
        const self = {
            addEventListener: (
                name: string,
                handler: (event: unknown) => void,
            ) => listeners.set(name, handler),
            skipWaiting: vi.fn(),
            clients: { claim: vi.fn(() => Promise.resolve()) },
            location: { origin: "https://punch.test" },
        };
        const caches = {
            keys: vi.fn(() =>
                Promise.resolve(["punch-shell-v0", "other", "punch-shell-v1"]),
            ),
            delete: vi.fn((key: string) => {
                deleted.push(key);
                return Promise.resolve(true);
            }),
            open: vi.fn(),
            match: vi.fn(),
        };
        const source = readFileSync(
            new URL("../../../public/sw.js", import.meta.url),
            "utf8",
        );
        new Function("self", "caches", source)(self, caches);
        const wait = vi.fn();
        listeners.get("activate")?.({ waitUntil: wait });
        await wait.mock.calls[0]?.[0];
        expect(deleted).toEqual(["punch-shell-v0"]);
        expect(self.clients.claim).toHaveBeenCalledOnce();
    });
});
