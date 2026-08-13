// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
    deriveJourneyStep,
    type JourneyInput,
    journeySteps,
} from "../journey-steps";

function stepFrom(input: JourneyInput) {
    return deriveJourneyStep(input);
}

describe("journey step derivation", () => {
    it("keeps step 0 when balance is null (treated as 0)", () => {
        const step = stepFrom({
            balance: null,
            hasPendingPurchase: false,
            hasPendingRedemption: false,
            hasConfirmedRedemption: false,
        });

        expect(step).toBe(0);
    });

    it("returns 0 for confirmed purchase intermediates below 12 stamps", () => {
        const step = stepFrom({
            balance: 11,
            hasPendingPurchase: false,
            hasPendingRedemption: false,
            hasConfirmedRedemption: false,
        });

        expect(step).toBe(0);
    });

    it("returns step 1 when a purchase code is still pending", () => {
        const step = stepFrom({
            balance: 11,
            hasPendingPurchase: true,
            hasPendingRedemption: false,
            hasConfirmedRedemption: false,
        });

        expect(step).toBe(1);
    });

    it("returns 3 when balance reaches 12 with no pending redemptions", () => {
        const step = stepFrom({
            balance: 12,
            hasPendingPurchase: false,
            hasPendingRedemption: false,
            hasConfirmedRedemption: false,
        });

        expect(step).toBe(3);
    });

    it("returns 4 when there is a pending redemption request", () => {
        const step = stepFrom({
            balance: 12,
            hasPendingPurchase: false,
            hasPendingRedemption: true,
            hasConfirmedRedemption: false,
        });

        expect(step).toBe(4);
    });

    it("returns 5 right after a redemption, when the balance is back at zero", () => {
        const step = stepFrom({
            balance: 0,
            hasPendingPurchase: false,
            hasPendingRedemption: false,
            hasConfirmedRedemption: true,
        });

        expect(step).toBe(5);
    });

    it("starts a fresh cycle when the client re-accumulated stamps after a past redemption", () => {
        // Regresión: un canje de una demo anterior dejaba la guía marcada como
        // "ciclo completo" aunque el cliente ya volviera a juntar sellos.
        const step = stepFrom({
            balance: 11,
            hasPendingPurchase: false,
            hasPendingRedemption: false,
            hasConfirmedRedemption: true,
        });

        expect(step).toBe(0);
    });

    it("exports six step labels with role alignment", () => {
        expect(journeySteps).toHaveLength(6);
        expect(journeySteps[0].role).toBe("cafeteria");
        expect(journeySteps[5].role).toBe("cafeteria");
    });
});
