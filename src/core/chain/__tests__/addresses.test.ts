import { describe, expect, it } from "vitest";
import { abis } from "../abis";
import { contractNames, getAddresses } from "../addresses";

describe("chain config", () => {
    it("exposes an ABI for every contract name", () => {
        for (const name of contractNames) {
            expect(abis[name], name).toBeDefined();
            expect(abis[name].length).toBeGreaterThan(0);
        }
    });

    it("getAddresses returns a full address map", () => {
        const map = getAddresses();
        for (const name of contractNames) {
            expect(map[name]).toMatch(/^0x[0-9a-fA-F]{40}$/);
        }
    });
});
