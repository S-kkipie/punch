import { describe, expect, it } from "vitest";
import type { Cafe } from "@/core/cafe/domain/types";
import { distanceKm, sortCafesByDistance } from "../discovery-distance";

const cafe = (id: string, lat: string | null, lng: string | null) =>
    ({ id, lat, lng }) as Cafe;

describe("discovery distance helpers", () => {
    it("returns zero for identical coordinates", () => {
        expect(
            distanceKm(
                { lat: -12.0464, lng: -77.0428 },
                { lat: -12.0464, lng: -77.0428 },
            ),
        ).toBe(0);
    });

    it("calculates known Lima coordinates within tolerance", () => {
        const distance = distanceKm(
            { lat: -12.0464, lng: -77.0428 },
            { lat: -12.1191, lng: -77.0349 },
        );
        expect(distance).toBeGreaterThan(8);
        expect(distance).toBeLessThan(9);
    });

    it("places cafés without coordinates after located cafés", () => {
        const cafes = [
            cafe("missing", null, null),
            cafe("far", "-12.2", "-77.1"),
            cafe("near", "-12.0464", "-77.0428"),
        ];
        expect(
            sortCafesByDistance(cafes, { lat: -12.0464, lng: -77.0428 }).map(
                ({ id }) => id,
            ),
        ).toEqual(["near", "far", "missing"]);
    });
});
