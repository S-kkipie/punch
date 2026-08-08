import "server-only";
import type { Cafe, CafeAdmin } from "@/core/cafe/domain/types";
import type { CafeRow } from "@/server/drizzle/schemas/cafe-schema";

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

export function slugify(name: string): string {
    return name
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
}
