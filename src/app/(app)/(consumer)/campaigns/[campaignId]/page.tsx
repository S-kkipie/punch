"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCampaign, useVouchers } from "@/core/punch/client/hooks";
import type { Campaign } from "@/core/punch/domain/types";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Stat } from "@/frontend/components/guide/stat";
import { Spinner } from "@/frontend/components/ui/spinner";

function formatCurrency(value: string | null | undefined) {
    if (!value) return "S/0.00";
    return `S/${Number(value).toFixed(2)}`;
}

function CampaignHeader() {
    return (
        <PageIntro
            eyebrow="Campaña"
            title="Detalle de campaña"
            explain="Una campaña premia tu compra si completas el reto. La cafetería financia el costo del premio y la red le reembolsa."
        />
    );
}

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

    const campaign = query.data as Campaign;
    const voucher = (
        (vouchersQuery.data ?? []) as Array<{
            id: string;
            campaignId: string | null;
            cafeId: string | null;
            source: string;
            status: string;
        }>
    ).find(
        (item) =>
            item.campaignId === campaignId &&
            item.cafeId === campaign.cafeId &&
            item.source === "campaign" &&
            item.status === "available",
    );
    const maxText =
        campaign.maxVouchers === null || campaign.maxVouchers === undefined
            ? "sin límite"
            : `${campaign.maxVouchers} vouchers`;

    return (
        <div className="mx-auto grid w-full max-w-md gap-5 p-6">
            <CampaignHeader />
            <div className="consumer-panel grid gap-3 p-6">
                <h1 className="consumer-title text-3xl font-bold">
                    {campaign.name}
                </h1>
                <p className="text-[var(--color-ink-2)] text-sm">
                    Válida hasta{" "}
                    {new Date(campaign.windowEnd).toLocaleDateString("es-PE")}.
                </p>
                <p className="text-sm text-[var(--color-ink-2)]">
                    Visita el circuito y deja que tu compra aporte un paso.
                </p>
                <Stat
                    label="Límite de vouchers"
                    value={maxText}
                    hint={`Payout: ${formatCurrency(campaign.voucherPayout)}`}
                />
                <p>
                    Si cumples la ruta, el sistema te entregará el voucher en
                    esta sección.
                </p>
                {voucher && (
                    <Link
                        className="font-semibold text-[var(--color-accent)] underline"
                        href={`/redeem/${voucher.id}?cafeId=${campaign.cafeId}&voucherId=${voucher.id}&source=campaign`}
                    >
                        Usar tu voucher
                    </Link>
                )}
            </div>
        </div>
    );
}
