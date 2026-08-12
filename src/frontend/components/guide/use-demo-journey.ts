"use client";

import { useHistory } from "@/core/consumption/client/hooks";
import { useDashboard } from "@/core/punch/client/hooks";
import { useDemoState } from "./demo-state";
import {
    deriveJourneyStep,
    type JourneyInput,
    journeySteps,
} from "./journey-steps";

type HistoryRow = {
    operation: "emission" | "punch_redemption" | "voucher_redemption";
    status: "pending" | "confirmed" | "rejected" | "failed";
};

const isPendingPurchase = (row: HistoryRow) =>
    row.operation === "emission" && row.status === "pending";
const isPendingRedemption = (row: HistoryRow) =>
    row.operation === "punch_redemption" && row.status === "pending";
const isConfirmedRedemption = (row: HistoryRow) =>
    row.operation === "punch_redemption" && row.status === "confirmed";

export const useDemoJourney = () => {
    const dashboard = useDashboard();
    const history = useHistory();
    const demo = useDemoState();

    const rows: HistoryRow[] = Array.isArray(history.data)
        ? history.data.filter((row): row is HistoryRow => {
              if (typeof row !== "object" || row === null) return false;

              const castRow = row as {
                  operation?: string;
                  status?: string;
              };

              return (
                  (castRow.operation === "emission" ||
                      castRow.operation === "punch_redemption" ||
                      castRow.operation === "voucher_redemption") &&
                  (castRow.status === "pending" ||
                      castRow.status === "confirmed" ||
                      castRow.status === "rejected" ||
                      castRow.status === "failed")
              );
          })
        : [];

    const dashboardData = dashboard.data as
        | { balance?: number | null }
        | undefined;
    const input: JourneyInput = {
        balance: dashboardData?.balance ?? 0,
        // El código recién generado pertenece al cliente: la sesión de
        // cafetería no lo ve en su propio historial, así que la acción local
        // es la única señal de que ese paso ya ocurrió.
        hasPendingPurchase:
            rows.some(isPendingPurchase) || demo.pendingProofUrl !== null,
        // Mismo motivo: la sesión de cafetería no ve el canje del cliente.
        hasPendingRedemption:
            rows.some(isPendingRedemption) || demo.pendingRedemptionId !== null,
        hasConfirmedRedemption:
            rows.some(isConfirmedRedemption) || demo.redemptionDelivered,
    };

    return {
        step: deriveJourneyStep(input),
        steps: journeySteps,
        loading: dashboard.isPending || history.isPending,
    };
};
