import "server-only";
import { type ConsumerChainMode, ServerConfig } from "@/config/server-config";
import { progressFraction } from "@/core/punch/domain/progress";
import type { Dashboard } from "@/core/punch/domain/types";
import { getConsumerBalance } from "@/core/purchase/server/services/get-balance-service";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { getDashboardReadData } from "../repository/dashboard";

type DashboardDeps = {
    consumerChainMode: ConsumerChainMode;
    getConsumerBalance: typeof getConsumerBalance;
};

const defaults: DashboardDeps = {
    consumerChainMode: ServerConfig.consumerChainMode,
    getConsumerBalance,
};

export async function getDashboardService(
    userId: string,
    overrides: Partial<DashboardDeps> = {},
): AsyncAppResult<Dashboard> {
    try {
        const deps = { ...defaults, ...overrides };
        const result = await deps.getConsumerBalance(userId, {
            consumerChainMode: deps.consumerChainMode,
        });
        if (!result.ok) return result;
        const balance = result.data.punchBalance;
        const stale = result.data.stale;
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
            stale,
            chainMode: deps.consumerChainMode,
            progress: balance === null ? null : progressFraction(balance),
            ...summaries,
        });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
