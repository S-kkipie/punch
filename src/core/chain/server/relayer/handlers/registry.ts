import type { RelayerJobKind } from "@/core/chain/server/relayer/job-repository";
import { campaignCreateHandler } from "./campaign-create";
import { consumptionRecordHandler } from "./consumption-record";
import type { JobHandler } from "./types";

const handlers: Partial<Record<RelayerJobKind, JobHandler>> = {
    campaign_create: campaignCreateHandler,
    consumption_record: consumptionRecordHandler,
};

export function handlerFor(kind: RelayerJobKind): JobHandler {
    const handler = handlers[kind];
    if (!handler) throw new Error(`unsupported relayer job kind ${kind}`);
    return handler;
}
