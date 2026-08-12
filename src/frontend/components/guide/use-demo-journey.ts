"use client";

import { useHistory } from "@/core/consumption/client/hooks";
import { useDashboard } from "@/core/punch/client/hooks";
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

    const input: JourneyInput = {
        balance: dashboard.data?.balance ?? 0,
        hasPendingPurchase: rows.some(isPendingPurchase),
        hasPendingRedemption: rows.some(isPendingRedemption),
        hasConfirmedRedemption: rows.some(isConfirmedRedemption),
    };

    return {
        step: deriveJourneyStep(input),
        steps: journeySteps,
        loading: dashboard.isPending || history.isPending,
    };
};
