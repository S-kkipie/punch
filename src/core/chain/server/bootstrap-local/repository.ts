import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { DEMO_CAMPAIGN_NAME } from "@/core/punch/domain/demo-state";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import {
    cafe,
    cafeMember,
    cafeProduct,
} from "@/server/drizzle/schemas/cafe-schema";
import { campaign } from "@/server/drizzle/schemas/punch-schema";
import type {
    ApprovedSeedCafe,
    BootstrapRepository,
    DemoCampaignRepository,
} from "./service";

export const bootstrapRepository: BootstrapRepository & DemoCampaignRepository =
    {
        async listApprovedSeedCafes(): Promise<ApprovedSeedCafe[]> {
            const cafes = await db
                .select({
                    id: cafe.id,
                    slug: cafe.slug,
                    chainCafeId: cafe.chainCafeId,
                    ownerWalletIndex: user.walletIndex,
                    ownerWalletAddress: user.walletAddress,
                })
                .from(cafe)
                .innerJoin(
                    cafeMember,
                    and(
                        eq(cafeMember.cafeId, cafe.id),
                        eq(cafeMember.role, "owner"),
                    ),
                )
                .innerJoin(user, eq(user.id, cafeMember.userId))
                .where(eq(cafe.onboardingStatus, "approved"))
                .orderBy(asc(cafe.slug));

            const result: ApprovedSeedCafe[] = [];
            for (const row of cafes) {
                const operators = await db
                    .select({ walletAddress: user.walletAddress })
                    .from(cafeMember)
                    .innerJoin(user, eq(user.id, cafeMember.userId))
                    .where(
                        and(
                            eq(cafeMember.cafeId, row.id),
                            eq(cafeMember.role, "barista"),
                        ),
                    );
                const products = await db
                    .select({
                        id: cafeProduct.id,
                        chainProductId: cafeProduct.chainProductId,
                        createdAt: cafeProduct.createdAt,
                        type: cafeProduct.type,
                        approvalStatus: cafeProduct.approvalStatus,
                        active: cafeProduct.active,
                    })
                    .from(cafeProduct)
                    .where(
                        and(
                            eq(cafeProduct.cafeId, row.id),
                            eq(cafeProduct.type, "emission"),
                            eq(cafeProduct.approvalStatus, "approved"),
                            eq(cafeProduct.active, true),
                        ),
                    )
                    .orderBy(asc(cafeProduct.createdAt), asc(cafeProduct.id));
                result.push({
                    ...row,
                    operatorWalletAddresses: operators
                        .map((operator) => operator.walletAddress)
                        .filter(
                            (address): address is string => address !== null,
                        ),
                    products,
                });
            }
            return result;
        },

        async persistCafeMappings(input) {
            await db.transaction(async (tx) => {
                await tx
                    .update(cafe)
                    .set({ chainCafeId: input.chainCafeId })
                    .where(eq(cafe.id, input.cafeId));
                for (const product of input.products) {
                    await tx
                        .update(cafeProduct)
                        .set({ chainProductId: product.chainProductId })
                        .where(
                            and(
                                eq(cafeProduct.id, product.productId),
                                eq(cafeProduct.cafeId, input.cafeId),
                            ),
                        );
                }
            });
        },

        async findCafeForCampaign(slug) {
            const [row] = await db
                .select({
                    id: cafe.id,
                    slug: cafe.slug,
                    chainCafeId: cafe.chainCafeId,
                    ownerWalletIndex: user.walletIndex,
                    ownerWalletAddress: user.walletAddress,
                    campaignId: campaign.id,
                    campaignCafeId: campaign.cafeId,
                    chainCampaignId: campaign.chainCampaignId,
                    voucherPayout: campaign.voucherPayout,
                    maxVouchers: campaign.maxVouchers,
                    windowEnd: campaign.windowEnd,
                })
                .from(cafe)
                .innerJoin(
                    cafeMember,
                    and(
                        eq(cafeMember.cafeId, cafe.id),
                        eq(cafeMember.role, "owner"),
                    ),
                )
                .innerJoin(user, eq(user.id, cafeMember.userId))
                .leftJoin(
                    campaign,
                    and(
                        eq(campaign.cafeId, cafe.id),
                        eq(campaign.name, DEMO_CAMPAIGN_NAME),
                        eq(campaign.kind, "verified_acquisition"),
                    ),
                )
                .where(eq(cafe.slug, slug));
            if (!row) return null;
            return {
                id: row.id,
                slug: row.slug,
                chainCafeId: row.chainCafeId,
                ownerWalletIndex: row.ownerWalletIndex,
                ownerWalletAddress: row.ownerWalletAddress,
                campaign:
                    row.campaignId && row.campaignCafeId && row.windowEnd
                        ? {
                              id: row.campaignId,
                              cafeId: row.campaignCafeId,
                              chainCampaignId: row.chainCampaignId,
                              voucherPayout: row.voucherPayout,
                              maxVouchers: row.maxVouchers,
                              windowEnd: row.windowEnd,
                          }
                        : null,
            };
        },

        async insertDemoCampaign(input) {
            return db.transaction(async (tx) => {
                await tx.execute(
                    sql`select pg_advisory_xact_lock(hashtextextended(${`${input.cafeId}:${DEMO_CAMPAIGN_NAME}`}, 0))`,
                );
                const [existing] = await tx
                    .select()
                    .from(campaign)
                    .where(
                        and(
                            eq(campaign.cafeId, input.cafeId),
                            eq(campaign.name, DEMO_CAMPAIGN_NAME),
                            eq(campaign.kind, "verified_acquisition"),
                        ),
                    );
                if (existing) return existing;
                const [inserted] = await tx
                    .insert(campaign)
                    .values({
                        ...input.values,
                        voucherPayout: input.voucherPayout,
                        maxVouchers: input.maxVouchers,
                    })
                    .returning();
                if (!inserted)
                    throw new Error(
                        `bootstrap ${input.cafeId}: campaign intent was not created`,
                    );
                return inserted;
            });
        },

        async linkCampaign(input) {
            await db
                .update(campaign)
                .set({ chainCampaignId: input.chainCampaignId })
                .where(eq(campaign.id, input.campaignId));
        },
    };

export const demoCampaignRepository: DemoCampaignRepository =
    bootstrapRepository;
