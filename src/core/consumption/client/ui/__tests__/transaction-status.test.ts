import { describe, expect, it } from "vitest";
import { transactionStatusCopy } from "../transaction-status";

describe("transactionStatusCopy", () => {
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
    it("maps rejected to an actionable copy", () => {
        expect(transactionStatusCopy("rejected")).toEqual({
            label: "Rechazado",
            hint: "Revisa el motivo indicado por el café.",
        });
    });
});
