import "server-only";
import { eq } from "drizzle-orm";
import { mpenToSoles } from "@/core/plan/domain/schemas";
import type { Campaign } from "@/core/punch/domain/types";
import {
    AppErrors,
    type AsyncAppResult,
    err,
    ok,
} from "@/server/common/responses";
import { db } from "@/server/drizzle/db";
import { cafe } from "@/server/drizzle/schemas/cafe-schema";
import { projectionCampaign } from "@/server/drizzle/schemas/chain-schema";
import { campaign } from "@/server/drizzle/schemas/punch-schema";

type CampaignJoin = {
    campaign: typeof campaign.$inferSelect;
    cafeName: string | null;
    unlockedCount: number | null;
    chainStatus: string | null;
};

const toCampaign = (row: CampaignJoin): Campaign => ({
    id: row.campaign.id,
    kind: row.campaign.kind,
    cafeId: row.campaign.cafeId,
    name: row.campaign.name,
    windowStart: row.campaign.windowStart.toISOString(),
    windowEnd: row.campaign.windowEnd.toISOString(),
    active: row.campaign.active,
    voucherPayout:
        row.campaign.voucherPayout === null
            ? null
            : row.campaign.voucherPayout.toString(),
    voucherPayoutSoles:
        row.campaign.voucherPayout === null
            ? null
            : mpenToSoles(row.campaign.voucherPayout),
    maxVouchers: row.campaign.maxVouchers,
    cafeName: row.cafeName,
    unlockedCount: row.unlockedCount ?? 0,
    published: row.chainStatus === "published",
});

/**
 * La campaña vive en dos lados: la fila de la app tiene el nombre y la ventana,
 * y la proyección de la cadena tiene cuántos vouchers se desbloquearon de verdad.
 * El join es `left` porque una campaña recién creada todavía no tiene proyección.
 */
const selection = {
    campaign,
    cafeName: cafe.name,
    unlockedCount: projectionCampaign.unlockedCount,
    chainStatus: projectionCampaign.status,
};

const withJoins = () =>
    db
        .select(selection)
        .from(campaign)
        .leftJoin(cafe, eq(cafe.id, campaign.cafeId))
        .leftJoin(
            projectionCampaign,
            eq(projectionCampaign.chainCampaignId, campaign.chainCampaignId),
        );

export async function listCampaignsService(): AsyncAppResult<Campaign[]> {
    try {
        const rows = await withJoins().where(eq(campaign.active, true));
        return ok(rows.map(toCampaign));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}

export async function getCampaignService(id: string): AsyncAppResult<Campaign> {
    try {
        const [row] = await withJoins().where(eq(campaign.id, id));
        return row
            ? ok(toCampaign(row))
            : err(AppErrors.notFound({ targets: ["id"] }));
    } catch (cause) {
        return err(AppErrors.unexpected(cause));
    }
}
