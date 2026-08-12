// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { ChainReceipt, stagesDone } from "../chain-receipt";

const HASH =
    "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("ChainReceipt", () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
    });

    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
    });

    it("shows no link while the job is still queued", async () => {
        await render(<ChainReceipt state="queued" />);
        expect(document.querySelector("a")).toBeNull();
        expect(document.body.textContent).toContain("Preparando");
    });

    it("shows the explorer link as soon as the tx is submitted", async () => {
        await render(<ChainReceipt state="submitted" txHash={HASH} />);
        expect(document.querySelector("a")?.getAttribute("href")).toBe(
            `https://sepolia.arbiscan.io/tx/${HASH}`,
        );
        expect(document.body.textContent).toContain("Confirmando");
    });

    it("shows the block number once confirmed", async () => {
        await render(
            <ChainReceipt
                state="confirmed"
                txHash={HASH}
                blockNumber={9123456}
            />,
        );
        expect(document.body.textContent).toContain("9123456");
        expect(document.querySelector("a")).not.toBeNull();
    });

    it("makes the public-chain permanence claim when confirmed on Arbitrum", async () => {
        await render(<ChainReceipt state="confirmed" txHash={HASH} />);
        expect(document.body.textContent).toContain("Nadie puede borrarlo");
    });

    it("does not make the permanence claim when confirmed on the local chain", async () => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
        await render(<ChainReceipt state="confirmed" txHash={HASH} />);
        expect(document.body.textContent).not.toContain("Nadie puede borrarlo");
        expect(document.body.textContent).toContain("cadena local");
    });

    it("explains the failure and offers a retry", async () => {
        const onRetry = vi.fn();
        await render(
            <ChainReceipt
                state="failed"
                failureReason="Fondos insuficientes del relayer"
                onRetry={onRetry}
            />,
        );
        expect(document.body.textContent).toContain("Fondos insuficientes");
        const button = document.querySelector("button");
        await act(async () => button?.click());
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("marks how far the write got on each state", () => {
        expect(stagesDone("queued")).toBe(1);
        expect(stagesDone("submitted")).toBe(2);
        expect(stagesDone("confirmed")).toBe(3);
    });

    it("shows the stage tracker and the waiting timer while queued", async () => {
        await render(<ChainReceipt state="queued" />);
        const stages = document.querySelectorAll(".chain-receipt__stage");
        expect(stages).toHaveLength(3);
        expect(stages[0].className).toContain("chain-receipt__stage--done");
        expect(stages[1].className).not.toContain("chain-receipt__stage--done");
        expect(document.body.textContent).toContain("Esperando");
    });

    it("hides the tracker and the timer on a failed write", async () => {
        await render(<ChainReceipt state="failed" />);
        expect(document.querySelector(".chain-receipt__track")).toBeNull();
        expect(document.body.textContent).not.toContain("Esperando");
    });

    it("survives a submitted state that has no hash yet", async () => {
        await render(<ChainReceipt state="submitted" txHash={null} />);
        expect(document.querySelector("a")).toBeNull();
        expect(document.body.textContent).toContain("Confirmando");
    });
});
