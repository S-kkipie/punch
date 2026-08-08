"use client";

import { useParams, useSearchParams } from "next/navigation";
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
    if (dashboard.isPending || products.isPending || vouchers.isPending)
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Spinner />
            </div>
        );
    const balance =
        (dashboard.data as { balance: number } | undefined)?.balance ?? 0;
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
    const eligible = canRedeem(balance);
    const isVoucherFlow = Boolean(voucherId);
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
                {!isVoucherFlow && (
                    <p className="text-[var(--color-ink-2)] text-sm">
                        Tu progreso: {balance} / 12
                    </p>
                )}
                {!isVoucherFlow && !eligible && (
                    <p className="text-amber-700 text-sm">
                        Necesitas 12 PUNCH para canjear.
                    </p>
                )}
            </div>
            <Button
                size="lg"
                className="min-h-12 w-full"
                disabled={
                    (isVoucherFlow ? !voucher : !eligible) ||
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
