// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    TransactionStatus,
    transactionStatusCopy,
} from "../transaction-status";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const HASH =
    "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function renderStatus(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("transactionStatusCopy", () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
    });

    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
    });

    it("maps purchase lifecycle states to Spanish copy", () => {
        expect(transactionStatusCopy("queued")).toEqual({
            label: "Confirmación en cola",
            hint: "Estamos registrando tu compra.",
        });
        expect(transactionStatusCopy("submitted")).toEqual({
            label: "Procesando compra",
            hint: "Estamos esperando la confirmación.",
        });
        expect(transactionStatusCopy("expired")).toEqual({
            label: "Código vencido",
            hint: "Pide al barista uno nuevo.",
        });
    });
    it("maps pre-submit states to mandated Spanish labels", () => {
        expect(transactionStatusCopy("loading").label).toBe("Cargando");
        expect(transactionStatusCopy("awaiting_signature")).toEqual({
            label: "Esperando firma",
            hint: "Confirma para autorizar.",
        });
    });
    it("maps pending to the on-chain waiting copy", () => {
        expect(transactionStatusCopy("pending")).toEqual({
            label: "Pendiente on-chain",
            hint: "Esto puede tardar unos segundos.",
        });
    });
    it("maps confirmed to a success copy", () => {
        expect(transactionStatusCopy("confirmed")).toEqual({
            label: "Confirmado",
            hint: "Tu PUNCH se actualizó.",
        });
    });
    it("maps failed to a retry copy", () => {
        expect(transactionStatusCopy("failed")).toEqual({
            label: "Reintento disponible",
            hint: "Intenta de nuevo.",
        });
    });
    it("renders live status, rejection reason, and retry action", () => {
        const rejected = renderToStaticMarkup(
            <TransactionStatus
                status="rejected"
                rejectionReason="Café no disponible"
            />,
        );
        expect(rejected).toContain('role="status"');
        expect(rejected).toContain('aria-live="polite"');
        expect(rejected).toContain("Café no disponible");

        const failed = renderToStaticMarkup(
            <TransactionStatus status="failed" onRetry={() => undefined} />,
        );
        expect(failed).toContain("Reintentar");
    });

    it("links the transaction when a hash is available", async () => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
        await renderStatus(
            <TransactionStatus status="confirmed" txHash={HASH} />,
        );
        expect(document.querySelector("a")?.getAttribute("href")).toContain(
            "sepolia.arbiscan.io/tx/0x8f2ad41c",
        );
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
    });

    it("renders without a link when no hash exists yet", async () => {
        await renderStatus(<TransactionStatus status="pending" />);
        expect(document.querySelector("a")).toBeNull();
    });
});
