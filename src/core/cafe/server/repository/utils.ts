import "server-only";
import type {
    Cafe,
    CafeAdmin,
    Product,
    ProductAdmin,
} from "@/core/cafe/domain/types";
import type {
    CafeProductRow,
    CafeRow,
} from "@/server/drizzle/schemas/cafe-schema";

export function toCafeAdmin(row: CafeRow): CafeAdmin {
    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        address: row.address,
        district: row.district,
        lat: row.lat,
        lng: row.lng,
        photoUrl: row.photoUrl,
        ruc: row.ruc,
        contactPhone: row.contactPhone,
        onboardingStatus: row.onboardingStatus,
        reviewNote: row.reviewNote,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
export function toCafe(row: CafeRow): Cafe {
    const {
        ruc: _ruc,
        contactPhone: _phone,
        reviewNote: _note,
        ...rest
    } = toCafeAdmin(row);
    return rest;
}
export function toProductAdmin(row: CafeProductRow): ProductAdmin {
    return {
        id: row.id,
        cafeId: row.cafeId,
        name: row.name,
        description: row.description,
        priceSoles: row.priceSoles,
        cogsSoles: row.cogsSoles,
        type: row.type,
        approvalStatus: row.approvalStatus,
        reviewNote: row.reviewNote,
        active: row.active,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
export function toProduct(row: CafeProductRow): Product {
    const { reviewNote: _reviewNote, ...publicProduct } = toProductAdmin(row);
    return publicProduct;
}
export function slugify(name: string): string {
    return name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}
