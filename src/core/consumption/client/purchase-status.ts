import type { PurchaseQuoteStatus } from "@/core/consumption/domain/quotes";
import type { PurchaseOrderStatus } from "@/core/purchase/domain/types";

export type UiPurchaseState =
    | "issued"
    | "queued"
    | "submitted"
    | "confirmed"
    | "failed"
    | "expired";

export const purchaseQuoteQueryKey = (quoteId: string) =>
    ["consumption", "quote", quoteId] as const;
export const purchaseOrderQueryKey = (orderId: string) =>
    ["purchase", "order", orderId] as const;

export function toUiPurchaseState(input: {
    quoteStatus: PurchaseQuoteStatus;
    orderStatus?: PurchaseOrderStatus;
}): UiPurchaseState {
    if (input.orderStatus === "confirmed") return "confirmed";
    if (input.orderStatus === "failed") return "failed";
    if (input.orderStatus === "expired") return "expired";
    if (input.orderStatus === "submitted") return "submitted";
    if (input.orderStatus === "queued") return "queued";
    return input.quoteStatus;
}

export function purchaseStatusCopy(status: UiPurchaseState): {
    label: string;
    hint: string;
} {
    switch (status) {
        case "issued":
            return {
                label: "Listo para confirmar",
                hint: "Revisa los datos y confirma.",
            };
        case "queued":
            return {
                label: "Confirmación en cola",
                hint: "Estamos registrando tu compra.",
            };
        case "submitted":
            return {
                label: "Procesando compra",
                hint: "Estamos esperando la confirmación.",
            };
        case "confirmed":
            return {
                label: "Compra confirmada",
                hint: "Tu PUNCH se actualizó.",
            };
        case "failed":
            return {
                label: "No se pudo confirmar",
                hint: "No se realizó ningún cargo. Intenta más tarde.",
            };
        case "expired":
            return {
                label: "Código vencido",
                hint: "Pide al barista uno nuevo.",
            };
    }
}
