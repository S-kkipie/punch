import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/server/drizzle/db";
import { user } from "@/server/drizzle/schemas/auth-schema";
import {
    cafe,
    cafeMember,
    cafeProduct,
} from "@/server/drizzle/schemas/cafe-schema";
import type { ApprovedSeedCafe, BootstrapRepository } from "./service";

export const bootstrapRepository: BootstrapRepository = {
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
                        eq(cafeProduct.approvalStatus, "approved"),
                        eq(cafeProduct.active, true),
                    ),
                )
                .orderBy(asc(cafeProduct.createdAt), asc(cafeProduct.id));
            result.push({
                ...row,
                operatorWalletAddresses: operators
                    .map((operator) => operator.walletAddress)
                    .filter((address): address is string => address !== null),
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
};
