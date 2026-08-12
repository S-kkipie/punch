// @vitest-environment happy-dom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
    type CampaignChainOp,
    CampaignChainTrail,
    groupOps,
    liveOp,
    receiptState,
} from "../campaign-chain-trail";

const op = (overrides: Partial<CampaignChainOp> = {}): CampaignChainOp => ({
    kind: "campaign_publish",
    status: "submitted",
    txHash: "0x1234567890abcdef1234567890abcdef12345678",
    error: null,
    createdAt: "2026-08-12T15:00:00.000Z",
    ...overrides,
});

describe("receiptState", () => {
    it("renames the queue state the receipt already knows", () => {
        expect(receiptState("pending")).toBe("queued");
        expect(receiptState("submitted")).toBe("submitted");
        expect(receiptState("confirmed")).toBe("confirmed");
        expect(receiptState("failed")).toBe("failed");
    });
});

describe("liveOp", () => {
    it("picks the write that has not landed", () => {
        expect(
            liveOp([
                op({ kind: "campaign_publish", status: "pending" }),
                op({ kind: "campaign_create", status: "confirmed" }),
            ])?.kind,
        ).toBe("campaign_publish");
    });

    it("returns nothing once every write confirmed", () => {
        expect(liveOp([op({ status: "confirmed" })])).toBeNull();
    });

    it("ignores a dead retry whose operation later confirmed", () => {
        // El caso real: un depósito fallido seguía tapando la publicación,
        // que es donde el dueño estaba realmente atascado.
        expect(
            liveOp([
                op({ kind: "campaign_publish", status: "failed" }),
                op({ kind: "campaign_fund", status: "failed" }),
                op({ kind: "campaign_fund", status: "confirmed" }),
            ])?.kind,
        ).toBe("campaign_publish");
    });

    it("points at the furthest step still stuck", () => {
        expect(
            liveOp([
                op({ kind: "campaign_fund", status: "failed" }),
                op({ kind: "campaign_create", status: "confirmed" }),
            ])?.kind,
        ).toBe("campaign_fund");
    });
});

describe("CampaignChainTrail", () => {
    it("renders nothing when the campaign never touched the chain", () => {
        expect(renderToStaticMarkup(<CampaignChainTrail ops={[]} />)).toBe("");
    });

    it("names the operation in progress and shows its hash", () => {
        const markup = renderToStaticMarkup(
            <CampaignChainTrail ops={[op({ status: "submitted" })]} />,
        );
        expect(markup).toContain("Publicación de la campaña");
        // El hash abreviado es lo que el dueño copia o abre para verificar.
        expect(markup).toContain("0x123456");
        expect(markup).toContain("Confirmando en la cadena");
    });

    it("says a queued write has no hash yet instead of showing nothing", () => {
        const markup = renderToStaticMarkup(
            <CampaignChainTrail
                ops={[op({ status: "pending", txHash: null })]}
            />,
        );
        expect(markup).toContain("sin hash todavía");
        expect(markup).toContain("Preparando la operación");
    });

    it("keeps confirmed writes as a verifiable history", () => {
        const markup = renderToStaticMarkup(
            <CampaignChainTrail
                ops={[
                    op({ kind: "campaign_create", status: "confirmed" }),
                    op({
                        kind: "campaign_fund",
                        status: "confirmed",
                        txHash: "0xfeedfacefeedfacefeedfacefeedfacefeedface",
                    }),
                ]}
            />,
        );
        expect(markup).toContain("Creación de la campaña");
        expect(markup).toContain("Depósito del presupuesto");
        expect(markup).toContain("0xfeedfa");
    });
});

describe("groupOps", () => {
    it("collapses relayer retries into one row per operation", () => {
        const grouped = groupOps([
            op({ kind: "campaign_fund", status: "failed", txHash: null }),
            op({ kind: "campaign_fund", status: "failed", txHash: null }),
            op({ kind: "campaign_fund", status: "failed", txHash: null }),
        ]);
        expect(grouped).toHaveLength(1);
        expect(grouped[0].attempts).toBe(3);
    });

    it("lets a confirmed attempt win over a later failed one", () => {
        const grouped = groupOps([
            op({ kind: "campaign_fund", status: "failed", txHash: null }),
            op({ kind: "campaign_fund", status: "confirmed", txHash: "0xok" }),
        ]);
        expect(grouped[0].status).toBe("confirmed");
        expect(grouped[0].txHash).toBe("0xok");
    });

    it("orders rows by the real lifecycle, not by arrival", () => {
        const grouped = groupOps([
            op({ kind: "campaign_publish", status: "confirmed" }),
            op({ kind: "campaign_create", status: "confirmed" }),
            op({ kind: "campaign_fund", status: "confirmed" }),
        ]);
        expect(grouped.map((group) => group.kind)).toEqual([
            "campaign_create",
            "campaign_fund",
            "campaign_publish",
        ]);
    });
});

describe("CampaignChainTrail progress", () => {
    it("hides the live receipt on a closed campaign", () => {
        // Una campaña cancelada no tiene nada pendiente: dejar el recibo de un
        // intento fallido sugiere que todavía falta hacer algo.
        const markup = renderToStaticMarkup(
            <CampaignChainTrail
                ops={[op({ kind: "campaign_publish", status: "failed" })]}
                showProgress={false}
            />,
        );
        expect(markup).not.toContain("No se pudo escribir");
        expect(markup).toContain("Publicación de la campaña");
    });
});
