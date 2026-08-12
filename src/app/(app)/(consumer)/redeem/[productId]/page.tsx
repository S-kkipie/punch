"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientConfig } from "@/config/client-config";
import { useCafeProducts, useCafes } from "@/core/cafe/client/hooks";
import type { Cafe } from "@/core/cafe/domain/types";
import {
    useRequestPunchRedemption,
    useRequestVoucherRedemption,
} from "@/core/consumption/client/hooks";
import { useDashboard, useVouchers } from "@/core/punch/client/hooks";
import { canRedeem, PUNCH_REDEMPTION_COST } from "@/core/punch/domain/progress";
import {
    distanceKm,
    sortCafesByDistance,
} from "@/frontend/components/consumer/discovery-distance";
import { isDemoCafe } from "@/frontend/components/guide/demo-cafe";
import { JourneyCard } from "@/frontend/components/guide/journey-card";
import { blockedLabel } from "@/frontend/components/guide/journey-steps";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Button } from "@/frontend/components/ui/button";
import { Spinner } from "@/frontend/components/ui/spinner";

type Coordinates = {
    lat: number;
    lng: number;
};

function parseCoordinates(value: {
    lat: string | null;
    lng: string | null;
}): Coordinates | null {
    if (!value.lat || !value.lng) return null;
    const lat = Number(value.lat);
    const lng = Number(value.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
}

function shortfallLabel(balance: number): string {
    const remaining = PUNCH_REDEMPTION_COST - balance;
    if (remaining <= 0) return "";
    return remaining === 1
        ? "te falta 1 sello"
        : `te faltan ${remaining} sellos`;
}

function formatDistance(distanceKmValue: number | null): string | null {
    if (distanceKmValue === null || !Number.isFinite(distanceKmValue))
        return null;
    if (distanceKmValue < 1) {
        return `${Math.round(distanceKmValue * 1000)} m`;
    }
    return `${distanceKmValue.toFixed(1)} km`;
}

export default function RedeemPage() {
    const { productId } = useParams<{ productId: string }>();
    const searchParams = useSearchParams();
    const cafeId = searchParams.get("cafeId") ?? "";
    const voucherId = searchParams.get("voucherId");
    const voucherSource = searchParams.get("source");
    const dashboard = useDashboard();
    const products = useCafeProducts(cafeId);
    const vouchers = useVouchers();
    const cafes = useCafes();
    const punchRedemption = useRequestPunchRedemption(cafeId);
    const voucherRedemption = useRequestVoucherRedemption(cafeId);
    const [isOnline, setIsOnline] = useState(true);
    const [lastKnownBalance, setLastKnownBalance] = useState<number | null>(
        null,
    );

    useEffect(() => {
        setIsOnline(navigator.onLine);
        const goOnline = () => setIsOnline(true);
        const goOffline = () => setIsOnline(false);
        window.addEventListener("online", goOnline);
        window.addEventListener("offline", goOffline);
        return () => {
            window.removeEventListener("online", goOnline);
            window.removeEventListener("offline", goOffline);
        };
    }, []);

    const dashboardData = dashboard.data as
        | { balance: number | null; stale: boolean }
        | undefined;
    useEffect(() => {
        const currentBalance = dashboardData?.balance;
        if (
            currentBalance !== null &&
            currentBalance !== undefined &&
            currentBalance !== lastKnownBalance
        ) {
            setLastKnownBalance(currentBalance);
        }
    }, [dashboardData, lastKnownBalance]);
    const currentBalance = dashboardData?.balance;
    const balance =
        currentBalance === null || currentBalance === undefined
            ? lastKnownBalance
            : currentBalance;
    const isBalanceUnknown =
        currentBalance === null || currentBalance === undefined;

    const isVoucherFlow = Boolean(voucherId);
    const product = (
        (products.data ?? []) as Array<{ id: string; name: string }>
    ).find((item) => item.id === productId);
    const voucher = voucherId
        ? (
              (vouchers.data ?? []) as Array<{
                  id: string;
                  source: "campaign" | "crawl";
                  status: string;
                  cafeId: string | null;
              }>
          ).find(
              (item) =>
                  item.id === voucherId &&
                  item.status === "available" &&
                  (voucherSource === null || item.source === voucherSource) &&
                  (item.cafeId === null || item.cafeId === cafeId),
          )
        : undefined;

    const allCafes = (cafes.data ?? []) as Cafe[];
    const selectedCafe = allCafes.find((cafe) => cafe.id === cafeId);
    const sortOrigin = useMemo(
        () =>
            parseCoordinates(
                selectedCafe ?? allCafes[0] ?? { lat: null, lng: null },
            ),
        [selectedCafe, allCafes],
    );
    const sortedCafes = useMemo(
        () =>
            sortOrigin ? sortCafesByDistance(allCafes, sortOrigin) : allCafes,
        [allCafes, sortOrigin],
    );
    const visibleCafes = sortedCafes.slice(0, 4);

    const hasEnough = balance !== null && canRedeem(balance);
    const isBlockedByBalance = !isVoucherFlow && balance !== null && !hasEnough;
    const redeemDisabled = isVoucherFlow
        ? !voucher || !isOnline || voucherRedemption.isPending
        : !isOnline ||
          isBalanceUnknown ||
          isBlockedByBalance ||
          punchRedemption.isPending;

    const redeemLabel = isVoucherFlow
        ? voucher
            ? voucherRedemption.isPending
                ? "Enviando…"
                : "Usar voucher"
            : "Voucher no disponible"
        : isBlockedByBalance
          ? blockedLabel("Canjear", shortfallLabel(balance ?? 0))
          : punchRedemption.isPending
            ? "Enviando…"
            : "Canjear 12 PUNCH";

    const redeem = () => {
        if (voucherId) {
            if (voucher) voucherRedemption.mutate({ voucherId });
            return;
        }
        if (balance === null || isBlockedByBalance) return;
        punchRedemption.mutate({ productId });
    };

    if (!cafeId)
        return (
            <div className="consumer-panel mx-auto max-w-md p-5" role="alert">
                Este enlace de canje no es válido: falta la cafetería.
            </div>
        );

    if (
        dashboard.isPending ||
        products.isPending ||
        vouchers.isPending ||
        cafes.isPending
    )
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Spinner />
            </div>
        );

    return (
        <div className="mx-auto grid w-full max-w-md gap-5">
            <PageIntro
                eyebrow="Tus 12 sellos"
                title="Canjear recompensa"
                explain="El café que elijas lo paga la red con el fondo común, no la cafetería que te atiende. Por eso puedes canjear donde quieras."
            />
            <div className="consumer-panel grid gap-2 p-5">
                <p className="font-semibold">
                    {isVoucherFlow
                        ? "Voucher disponible"
                        : product
                          ? product.name
                          : "Recompensa"}
                </p>
                {!isVoucherFlow && balance !== null && (
                    <p className="text-[var(--color-ink-2)] text-sm">
                        Tu progreso: {Math.min(balance, 12)} / 12
                    </p>
                )}
                {!isVoucherFlow && isBalanceUnknown && (
                    <p
                        className="text-[var(--color-ink-2)] text-sm"
                        role="status"
                    >
                        Actualizando desde la cadena
                    </p>
                )}
            </div>
            {visibleCafes.length > 0 ? (
                <section
                    className="consumer-panel grid gap-2 p-5"
                    aria-label="Red de cafeterías"
                >
                    <span className="consumer-eyebrow">
                        Cafeterías disponibles
                    </span>
                    <ul className="grid gap-2">
                        {visibleCafes.map((cafe) => {
                            const isSelected = cafe.id === cafeId;
                            const coordinates = parseCoordinates(cafe);
                            const distance =
                                coordinates && sortOrigin
                                    ? distanceKm(sortOrigin, coordinates)
                                    : null;
                            const distanceText = formatDistance(distance);
                            return (
                                <li
                                    key={cafe.id}
                                    data-cafe-id={cafe.id}
                                    className={`rounded-md border p-3 ${
                                        isSelected
                                            ? "border-[var(--color-accent)] bg-[var(--color-accent-wash)]"
                                            : "border-[var(--color-rule)]"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <strong>
                                                {product?.name ?? "Recompensa"}
                                            </strong>
                                            <span className="block text-xs text-[var(--color-ink-2)]">
                                                {cafe.name} ·{" "}
                                                {cafe.district ??
                                                    "Sin distrito"}
                                                {distanceText
                                                    ? ` · ${distanceText}`
                                                    : ""}
                                            </span>
                                        </div>
                                        <span className="text-sm">S/ 12</span>
                                    </div>
                                    {isSelected ? (
                                        <span className="text-[var(--color-accent)] text-xs">
                                            Elegido
                                        </span>
                                    ) : null}
                                    {ClientConfig.demoMode &&
                                    isDemoCafe(cafe) ? (
                                        <span className="demo-pick__tag">
                                            Entregable en la demo
                                        </span>
                                    ) : null}
                                </li>
                            );
                        })}
                    </ul>
                </section>
            ) : null}
            <Button
                size="lg"
                className="min-h-12 w-full"
                disabled={redeemDisabled}
                onClick={redeem}
            >
                {redeemLabel}
            </Button>
            {!isVoucherFlow && isBlockedByBalance ? (
                <p className="text-[var(--color-ink-2)] text-sm">
                    Te faltan sellos para canjear. Genera una compra en la
                    cafetería y vuelve aquí para desbloquear.
                    <a className="mx-1 underline" href="/scan">
                        Ir a escanear
                    </a>
                </p>
            ) : null}
            {!isOnline ? (
                <p
                    className="rounded-md bg-amber-100 p-3 text-sm"
                    role="status"
                >
                    Vuelve a conectarte para solicitar un canje.
                </p>
            ) : null}
            <JourneyCard currentRole="cliente" />
        </div>
    );
}
