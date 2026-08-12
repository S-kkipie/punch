"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientConfig } from "@/config/client-config";
import { useCafeProducts, useCafes } from "@/core/cafe/client/hooks";
import type { Cafe } from "@/core/cafe/domain/types";
import {
    useHistory,
    useRequestPunchRedemption,
    useRequestVoucherRedemption,
} from "@/core/consumption/client/hooks";
import {
    type RedemptionOutcome,
    readRedemptionOutcome,
} from "@/core/consumption/client/redemption-outcome";
import { redemptionCode } from "@/core/consumption/domain/redemption-code";
import { useDashboard, useVouchers } from "@/core/punch/client/hooks";
import { canRedeem, PUNCH_REDEMPTION_COST } from "@/core/punch/domain/progress";
import { useDemoSignIn } from "@/frontend/components/auth/use-demo-sign-in";
import {
    distanceKm,
    sortCafesByDistance,
} from "@/frontend/components/consumer/discovery-distance";
import { isDemoCafe } from "@/frontend/components/guide/demo-cafe";
import { DemoOnly } from "@/frontend/components/guide/demo-only";
import { setPendingRedemptionId } from "@/frontend/components/guide/demo-state";
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

/**
 * Qué pasó con la solicitud, dicho en la pantalla donde se pidió. Antes el
 * botón no cambiaba nada al pulsarlo y el segundo intento devolvía un 409 que
 * el usuario nunca llegaba a ver.
 */
function RedemptionOutcomePanel({
    outcome,
    cafeId,
    cafeName,
    onRetry,
}: {
    outcome: RedemptionOutcome;
    cafeId: string;
    cafeName: string;
    onRetry: () => void;
}) {
    const { signInAs, pending } = useDemoSignIn();

    // El canje pedido tiene que seguir visible para la guía cuando el jurado
    // cambie a la sesión de cafetería para entregarlo.
    useEffect(() => {
        if (outcome.kind === "requested") setPendingRedemptionId(outcome.id);
        else if (outcome.kind === "conflict")
            setPendingRedemptionId("pendiente");
    }, [outcome]);

    if (outcome.kind === "error") {
        return (
            <section className="consumer-panel grid gap-3 p-5" role="alert">
                <span className="consumer-eyebrow">No se pidió el canje</span>
                <p className="text-sm">{outcome.message}</p>
                <p className="text-[var(--color-ink-2)] text-sm">
                    No se descontó ningún sello.
                </p>
                <Button className="min-h-11" onClick={onRetry}>
                    Reintentar
                </Button>
            </section>
        );
    }

    const alreadyPending = outcome.kind === "conflict";
    const code =
        outcome.kind === "requested" ? redemptionCode(outcome.id) : null;

    return (
        <section className="consumer-panel grid gap-3 p-5" role="status">
            <span className="consumer-eyebrow">
                {alreadyPending ? "Ya tenías un canje pedido" : "Canje pedido"}
            </span>
            <p className="text-sm">
                {alreadyPending
                    ? "Tienes un canje esperando entrega, así que no pedimos otro. Solo puede haber uno a la vez."
                    : `Le avisamos a ${cafeName}. Tus 12 sellos se descuentan cuando la cafetería confirme la entrega, no antes.`}
            </p>
            {code ? (
                <p className="text-sm">
                    Tu código de canje:{" "}
                    <span className="redemption-code">{code}</span> · el barista
                    te lo va a pedir para saber cuál de los canjes abiertos es
                    el tuyo.
                </p>
            ) : null}
            <p className="text-[var(--color-ink-2)] text-sm">
                Siguiente paso: la cafetería lo acepta desde su panel de canjes.
            </p>
            {ClientConfig.demoMode ? (
                <>
                    <Button
                        className="min-h-11"
                        disabled={pending !== null}
                        onClick={() =>
                            void signInAs(
                                "brujula@punch.pe",
                                `/cafe/${cafeId}/redemptions`,
                            )
                        }
                    >
                        {pending !== null
                            ? "Cambiando…"
                            : "Entregarlo como cafetería →"}
                    </Button>
                    <DemoOnly />
                </>
            ) : null}
            <a className="underline text-sm" href="/history">
                Ver el estado en tu historial
            </a>
        </section>
    );
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
    const history = useHistory();
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

    const hasPendingRedemption = (
        (history.data ?? []) as Array<{ operation?: string; status?: string }>
    ).some(
        (row) =>
            row.operation === "punch_redemption" && row.status === "pending",
    );

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

    const activeRedemption = isVoucherFlow
        ? voucherRedemption
        : punchRedemption;
    // Un canje pedido en una visita anterior también bloquea el botón en el
    // servidor: mejor decirlo antes de que el clic devuelva un 409.
    const outcome: RedemptionOutcome | null =
        readRedemptionOutcome(activeRedemption.data, activeRedemption.error) ??
        (hasPendingRedemption ? { kind: "conflict" } : null);

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
            {outcome ? (
                <RedemptionOutcomePanel
                    outcome={outcome}
                    cafeId={cafeId}
                    cafeName={selectedCafe?.name ?? "la cafetería"}
                    onRetry={redeem}
                />
            ) : (
                <Button
                    size="lg"
                    className="min-h-12 w-full"
                    disabled={redeemDisabled}
                    onClick={redeem}
                >
                    {redeemLabel}
                </Button>
            )}
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
