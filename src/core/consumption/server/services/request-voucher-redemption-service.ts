import "server-only";
import type {
    RedemptionRequest,
    RequestVoucherRedemption,
} from "@/core/consumption/domain/types";
import {
    findVoucherById,
    isVoucherEligibleAtCafe,
} from "@/core/punch/server/repository/vouchers";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import {
    createRedemptionRequest,
    findActiveVoucherRedemptionRequest,
} from "../repository/redemption-requests";
import { toRedemptionRequest } from "../repository/utils";

export async function requestVoucherRedemptionService(
    consumerUserId: string,
    cafeId: string,
    input: RequestVoucherRedemption,
): AsyncAppResult<RedemptionRequest> {
    const voucher = await findVoucherById(input.voucherId);
    if (!voucher || voucher.consumerUserId !== consumerUserId) {
        return err(AppErrors.notFound({ targets: ["voucherId"] }));
    }
    if (
        voucher.status !== "available" ||
        voucher.expiresAt.getTime() <= Date.now()
    ) {
        return err(
            AppErrors.unprocessableEntity({
                targets: ["voucherId"],
                cause: "El voucher no está disponible o ya venció.",
            }),
        );
    }
    if (voucher.source === "campaign" && voucher.cafeId !== cafeId) {
        return err(
            AppErrors.unprocessableEntity({
                targets: ["cafeId"],
                cause: "Este voucher no puede canjearse en este café.",
            }),
        );
    }
    if (
        voucher.source === "crawl" &&
        !(await isVoucherEligibleAtCafe(voucher, cafeId))
    ) {
        return err(
            AppErrors.unprocessableEntity({
                targets: ["cafeId"],
                cause: "Este voucher no puede canjearse en este café.",
            }),
        );
    }

    const active = await findActiveVoucherRedemptionRequest(input.voucherId);
    if (active) return ok(toRedemptionRequest(active));

    try {
        const row = await createRedemptionRequest({
            kind: "voucher",
            consumerUserId,
            cafeId,
            productId: null,
            voucherId: input.voucherId,
            status: "pending",
            rejectionReason: null,
            decidedByUserId: null,
        });
        return ok(toRedemptionRequest(row));
    } catch (cause) {
        // A concurrent request can win the voucher's active-request race.
        const winner = await findActiveVoucherRedemptionRequest(
            input.voucherId,
        );
        if (winner) return ok(toRedemptionRequest(winner));
        throw cause;
    }
}
