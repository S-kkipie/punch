import type { RelayerJobKind } from "@/core/chain/server/relayer/job-repository";
import { consumptionRecordHandler } from "./consumption-record";
import type { JobHandler } from "./types";

const handlers: Partial<Record<RelayerJobKind, JobHandler>> = {
    consumption_record: consumptionRecordHandler,
};

export function handlerFor(kind: RelayerJobKind): JobHandler {
    const handler = handlers[kind];
    if (!handler) throw new Error(`unsupported relayer job kind ${kind}`);
    return handler;
}
