"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCampaign, useVouchers } from "@/core/punch/client/hooks";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function CampaignDetailPage() {
    const { campaignId } = useParams<{ campaignId: string }>();
    const query = useCampaign(campaignId);
    const vouchersQuery = useVouchers();
    if (query.isPending)
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Spinner />
            </div>
        );
    if (query.isError || !query.data)
        return (
            <p className="text-destructive">No se pudo cargar la campaña.</p>
        );
    const campaign = query.data as {
        name: string;
        cafeId: string;
        windowEnd: string;
    };
    const voucher = (
        (vouchersQuery.data ?? []) as Array<{
            id: string;
            cafeId: string | null;
            source: string;
            status: string;
        }>
    ).find(
        (item) =>
            item.id &&
            item.cafeId === campaign.cafeId &&
            item.source === "campaign" &&
            item.status === "available",
    );
    return (
        <div className="mx-auto grid w-full max-w-md gap-5">
            <div className="consumer-panel grid gap-3 p-6">
                <span className="consumer-eyebrow">Campaña</span>
                <h1 className="consumer-title text-3xl font-bold">
                    {campaign.name}
                </h1>
                <p className="text-[var(--color-ink-2)] text-sm">
                    Válida hasta{" "}
                    {new Date(campaign.windowEnd).toLocaleDateString("es-PE")}.
                </p>
                <p>
                    Visita los cafés participantes y deja que cada compra sume a
                    tu recorrido.
                </p>
                {voucher && (
                    <Link
                        className="font-semibold text-[var(--color-accent)] underline"
                        href={`/redeem/${voucher.id}?cafeId=${campaign.cafeId}&voucherId=${voucher.id}`}
                    >
                        Usar tu voucher
                    </Link>
                )}
            </div>
        </div>
    );
}
