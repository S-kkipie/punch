// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { TxHashLink } from "../tx-hash-link";

const HASH =
    "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("TxHashLink", () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
    });

    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
    });

    it("links to the Arbitrum Sepolia explorer", async () => {
        await render(<TxHashLink txHash={HASH} />);
        const link = document.querySelector("a");
        expect(link?.getAttribute("href")).toBe(
            `https://sepolia.arbiscan.io/tx/${HASH}`,
        );
    });

    it("names the chain so the hash is not an anonymous string", async () => {
        await render(<TxHashLink txHash={HASH} />);
        expect(document.body.textContent).toContain("Arbitrum Sepolia");
    });

    it("opens in a new tab without leaking the referrer", async () => {
        await render(<TxHashLink txHash={HASH} />);
        const link = document.querySelector("a");
        expect(link?.getAttribute("target")).toBe("_blank");
        expect(link?.getAttribute("rel")).toContain("noopener");
    });

    it("falls back to plain text when the chain has no explorer", async () => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
        await render(<TxHashLink txHash={HASH} />);
        expect(document.querySelector("a")).toBeNull();
        expect(document.body.textContent).toContain("0x8f2ad4");
    });
});
