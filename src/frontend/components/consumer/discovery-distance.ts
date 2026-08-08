import type { Cafe } from "@/core/cafe/domain/types";

const EARTH_RADIUS_KM = 6371;

type Coordinates = { lat: number; lng: number };

const toCoordinates = (cafe: Pick<Cafe, "lat" | "lng">): Coordinates | null => {
    const lat = Number(cafe.lat);
    const lng = Number(cafe.lng);
    if (
        !cafe.lat ||
        !cafe.lng ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return null;
    }
    return { lat, lng };
};

export function distanceKm(from: Coordinates, to: Coordinates): number {
    const latDelta = ((to.lat - from.lat) * Math.PI) / 180;
    const lngDelta = ((to.lng - from.lng) * Math.PI) / 180;
    const fromLat = (from.lat * Math.PI) / 180;
    const toLat = (to.lat * Math.PI) / 180;
    const a =
        Math.sin(latDelta / 2) ** 2 +
        Math.sin(lngDelta / 2) ** 2 * Math.cos(fromLat) * Math.cos(toLat);
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function sortCafesByDistance(cafes: Cafe[], from: Coordinates): Cafe[] {
    return cafes
        .map((cafe, index) => {
            const coordinates = toCoordinates(cafe);
            return {
                cafe,
                index,
                distance: coordinates ? distanceKm(from, coordinates) : null,
            };
        })
        .sort((a, b) => {
            if (a.distance === null && b.distance === null)
                return a.index - b.index;
            if (a.distance === null) return 1;
            if (b.distance === null) return -1;
            return a.distance - b.distance || a.index - b.index;
        })
        .map(({ cafe }) => cafe);
}
