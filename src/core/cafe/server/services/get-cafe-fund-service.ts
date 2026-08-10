import "server-only";

import { createPublicClient, http } from "viem";
import { foundry } from "viem/chains";
import { abis } from "@/core/chain/abis";
import { getAddresses } from "@/core/chain/addresses";
import { currentEpoch } from "@/core/chain/server/network-fund/epoch";
import { requireCafeRole } from "@/server/auth/membership/require-cafe-role";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { findCafeById } from "../repository/find-cafe-by-id";

export type CafeFund = {
    epoch: number;
    referrals: number;
    pendingCreditMpen: bigint;
    estimated: boolean;
    buckets: {
        origin: bigint;
        acquisition: bigint;
        crawl: bigint;
        contingency: bigint;
    };
};

type FundReader = {
    readContract: (request: {
        address: `0x${string}`;
        abi: typeof abis.networkFund;
        functionName: "referrals" | "pendingOriginCredit" | "getEpoch";
        args: readonly bigint[];
    }) => Promise<unknown>;
};

type CafeFundDeps = {
    reader?: FundReader;
};

function defaultReader(): FundReader {
    return createPublicClient({
        chain: foundry,
        transport: http(process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545"),
    }) as FundReader;
}

export async function getCafeFundService(
    userId: string,
    cafeId: string,
    deps: CafeFundDeps = {},
): AsyncAppResult<CafeFund> {
    try {
        const auth = await requireCafeRole(userId, cafeId, ["owner"]);
        if (!auth.ok) return auth;

        const cafe = await findCafeById(cafeId);
        if (cafe?.chainCafeId == null) {
            return err(AppErrors.conflict({ targets: ["chainCafeId"] }));
        }

        const reader = deps.reader ?? defaultReader();
        const epoch = currentEpoch();
        const address = getAddresses().networkFund;
        const chainEpoch = BigInt(epoch);
        const chainCafeId = BigInt(cafe.chainCafeId);
        const [referrals, epochState] = await Promise.all([
            reader.readContract({
                address,
                abi: abis.networkFund,
                functionName: "referrals",
                args: [chainEpoch, chainCafeId],
            }) as Promise<bigint>,
            reader.readContract({
                address,
                abi: abis.networkFund,
                functionName: "getEpoch",
                args: [chainEpoch],
            }) as Promise<{
                originPool: bigint;
                originPaid: bigint;
                acquisitionPool: bigint;
                crawlPool: bigint;
                contingencyPool: bigint;
                totalReferrals: bigint;
                finalized: boolean;
                originReleased: boolean;
            }>,
        ]);

        const pendingCreditMpen = epochState.finalized
            ? ((await reader.readContract({
                  address,
                  abi: abis.networkFund,
                  functionName: "pendingOriginCredit",
                  args: [chainEpoch, chainCafeId],
              })) as bigint)
            : epochState.totalReferrals === 0n
              ? 0n
              : (epochState.originPool * referrals) / epochState.totalReferrals;

        return ok({
            epoch,
            referrals: Number(referrals),
            pendingCreditMpen,
            estimated: !epochState.finalized,
            buckets: {
                origin: epochState.originPool,
                acquisition: epochState.acquisitionPool,
                crawl: epochState.crawlPool,
                contingency: epochState.contingencyPool,
            },
        });
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
