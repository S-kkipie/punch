import type { RelayerJobKind } from "@/core/chain/server/relayer/job-repository";
import { campaignCancelHandler } from "./campaign-cancel";
import { campaignCreateHandler } from "./campaign-create";
import {
    campaignFundApproveHandler,
    campaignFundHandler,
} from "./campaign-fund";
import { campaignPublishHandler } from "./campaign-publish";
import { consumptionRecordHandler } from "./consumption-record";
import { referralRecordHandler } from "./referral-record";
import type { JobHandler } from "./types";
import { voucherRedeemHandler } from "./voucher-redeem";
import { voucherUnlockHandler } from "./voucher-unlock";

const handlers: Partial<Record<RelayerJobKind, JobHandler>> = {
    campaign_create: campaignCreateHandler,
    campaign_fund_approve: campaignFundApproveHandler,
    campaign_fund: campaignFundHandler,
    campaign_publish: campaignPublishHandler,
    campaign_cancel: campaignCancelHandler,
    consumption: consumptionRecordHandler,
    consumption_record: consumptionRecordHandler,
    referral_record: referralRecordHandler,
    voucher_unlock: voucherUnlockHandler,
    voucher_redeem: voucherRedeemHandler,
};

export function handlerFor(kind: RelayerJobKind): JobHandler {
    const handler = handlers[kind];
    if (!handler) throw new Error(`unsupported relayer job kind ${kind}`);
    return handler;
}
