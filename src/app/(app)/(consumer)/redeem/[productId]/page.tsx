"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useCafeProducts } from "@/core/cafe/client/hooks";
import {
    useRequestPunchRedemption,
    useRequestVoucherRedemption,
} from "@/core/consumption/client/hooks";
import { useDashboard, useVouchers } from "@/core/punch/client/hooks";
import { canRedeem } from "@/core/punch/domain/progress";
import { Button } from "@/frontend/components/ui/button";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function RedeemPage() {
    const { productId } = useParams<{ productId: string }>();
    const searchParams = useSearchParams();
    const cafeId = searchParams.get("cafeId") ?? "";
    const voucherId = searchParams.get("voucherId");
    const voucherSource = searchParams.get("source");
    const dashboard = useDashboard();
    const products = useCafeProducts(cafeId);
    const vouchers = useVouchers();
    const punchRedemption = useRequestPunchRedemption(cafeId);
    const voucherRedemption = useRequestVoucherRedemption(cafeId);
    const [isOnline, setIsOnline] = useState(true);
    const [lastKnownBalance, setLastKnownBalance] = useState<number | null>(
        null,
    );
    useEffect(() => {
        const currentBalance = (
            dashboard.data as { balance: number | null } | undefined
        )?.balance;
        if (
            currentBalance !== null &&
            currentBalance !== undefined &&
            currentBalance !== lastKnownBalance
        ) {
            setLastKnownBalance(currentBalance);
        }
    }, [dashboard.data, lastKnownBalance]);
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
    if (dashboard.isPending || products.isPending || vouchers.isPending)
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Spinner />
            </div>
        );
    const dashboardBalance = dashboard.data as
        | { balance: number | null; stale: boolean }
        | undefined;
    const currentBalance = dashboardBalance?.balance;
    const balance = currentBalance ?? lastKnownBalance;
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
    const eligible =
        balance !== null && balance !== undefined && canRedeem(balance);
    const isVoucherFlow = Boolean(voucherId);
    const isLocalChain =
        (dashboard.data as { chainMode?: "mock" | "local" } | undefined)
            ?.chainMode === "local";
    const isUnknownBalance =
        currentBalance === null || currentBalance === undefined;
    const redeem = () => {
        if (voucherId) {
            if (voucher) voucherRedemption.mutate({ voucherId });
            return;
        }
        punchRedemption.mutate({ productId });
    };
    return (
        <div className="mx-auto grid w-full max-w-md gap-5">
            <section className="grid gap-2">
                <span className="consumer-eyebrow">En la cafetería</span>
                <h1 className="consumer-title text-4xl font-bold">
                    {product?.name ?? "Recompensa"}
                </h1>
            </section>
            <div className="consumer-panel grid gap-2 p-5">
                <p className="font-semibold">
                    {isVoucherFlow
                        ? voucher
                            ? "Voucher disponible"
                            : "Voucher no disponible"
                        : "Costo fijo: 12 PUNCH"}
                </p>
                {!isVoucherFlow &&
                    balance !== null &&
                    balance !== undefined && (
                        <p className="text-[var(--color-ink-2)] text-sm">
                            Tu progreso: {Math.min(balance, 12)} / 12
                        </p>
                    )}
                {!isVoucherFlow && isUnknownBalance && (
                    <p
                        className="text-[var(--color-ink-2)] text-sm"
                        role="status"
                    >
                        Actualizando desde la cadena
                    </p>
                )}
                {!isVoucherFlow && isLocalChain && (
                    <p className="text-amber-700 text-sm">
                        La redención on-chain aún no disponible.
                    </p>
                )}
                {!isVoucherFlow && !isLocalChain && !eligible && (
                    <p className="text-amber-700 text-sm">
                        Necesitas 12 PUNCH para canjear.
                    </p>
                )}
            </div>
            {!isOnline && (
                <p
                    className="rounded-md bg-amber-100 p-3 text-sm"
                    role="status"
                >
                    Vuelve a conectarte para solicitar un canje.
                </p>
            )}
            <Button
                size="lg"
                className="min-h-12 w-full"
                disabled={
                    !isOnline ||
                    (isVoucherFlow
                        ? !voucher
                        : isLocalChain || isUnknownBalance || !eligible) ||
                    punchRedemption.isPending ||
                    voucherRedemption.isPending
                }
                onClick={redeem}
            >
                {punchRedemption.isPending || voucherRedemption.isPending
                    ? "Enviando…"
                    : voucher
                      ? "Usar voucher"
                      : "Canjear 12 PUNCH"}
            </Button>
        </div>
    );
}
