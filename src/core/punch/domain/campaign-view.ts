/**
 * Estado de una campaña de captación *para un cliente concreto*. La regla real
 * vive en `isEligibleForAcquisitionCampaign`; esto la traduce a lo único que la
 * pantalla necesita decidir: qué frase mostrar y si todavía vale la pena ir.
 */
export type CampaignViewerState =
    | "won" // el cliente ya tiene su voucher de esta campaña
    | "used" // ya lo canjeó
    | "not_new" // ya había comprado antes en esa cafetería: no califica
    | "full" // se agotaron los vouchers
    | "closed" // la ventana ya cerró
    | "not_started" // la ventana todavía no abre
    | "pending" // la campaña aún no está publicada en la cadena
    | "open"; // puede ganarla ahora

export type CampaignViewerInput = {
    published: boolean;
    windowStart: Date;
    windowEnd: Date;
    unlockedCount: number;
    maxVouchers: number | null | undefined;
    /** Voucher de esta campaña que ya tiene el cliente, si existe. */
    voucherStatus: "available" | "redeemed" | "expired" | null;
    /** El cliente ya tenía una compra pagada en esa cafetería. */
    hasPriorPurchaseAtCafe: boolean;
    now: Date;
};

export function campaignViewerState(
    input: CampaignViewerInput,
): CampaignViewerState {
    if (input.voucherStatus === "available") return "won";
    if (input.voucherStatus === "redeemed") return "used";
    if (!input.published) return "pending";
    if (input.now > input.windowEnd) return "closed";
    if (input.now < input.windowStart) return "not_started";
    if (
        input.maxVouchers !== null &&
        input.maxVouchers !== undefined &&
        input.unlockedCount >= input.maxVouchers
    ) {
        return "full";
    }
    // Se evalúa al final: no calificar importa menos que "ya cerró" o "se agotó",
    // porque esas dos cierran la campaña para todo el mundo.
    if (input.hasPriorPurchaseAtCafe) return "not_new";
    return "open";
}

/** Vouchers que todavía puede tomar alguien. */
export function vouchersLeft(
    unlockedCount: number,
    maxVouchers: number | null | undefined,
): number | null {
    if (maxVouchers === null || maxVouchers === undefined) return null;
    return Math.max(0, maxVouchers - unlockedCount);
}
