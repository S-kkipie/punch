import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
    TransactionStatus,
    transactionStatusCopy,
} from "../transaction-status";

describe("transactionStatusCopy", () => {
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
});
