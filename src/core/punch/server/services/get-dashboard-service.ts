import "server-only";
import { progressFraction } from "@/core/punch/domain/progress";
import type { Dashboard } from "@/core/punch/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { getBalance } from "../repository/balance";
import { getDashboardReadData } from "../repository/dashboard";

export async function getDashboardService(
    userId: string,
): AsyncAppResult<Dashboard> {
    try {
        const balance = await getBalance(userId);
        let summaries: Pick<Dashboard, "activeCampaign" | "activeCrawl"> = {
            activeCampaign: null,
            activeCrawl: null,
        };
        try {
            summaries = await getDashboardReadData(userId);
        } catch {
            // Optional summaries degrade to empty state; balance remains authoritative.
        }
        return ok({
            balance,
            progress: progressFraction(balance),
            ...summaries,
        });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
