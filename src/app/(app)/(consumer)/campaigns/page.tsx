"use client";

import Link from "next/link";
import { useCampaigns } from "@/core/punch/client/hooks";
import type { Campaign } from "@/core/punch/domain/types";
import { EmptyState } from "@/frontend/components/guide/empty-state";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Stat } from "@/frontend/components/guide/stat";
import { Spinner } from "@/frontend/components/ui/spinner";

const campaignExplain =
    "Una cafetería pone dinero del fondo común para invitarte algo. Si te la ganas, la red le devuelve el costo.";

function formatCurrency(value: string | null | undefined) {
    if (!value) return "S/0.00";
    return `S/${Number(value).toFixed(2)}`;
}

function CampaignProgress({ campaign }: { campaign: Campaign }) {
    const maxVouchers = campaign.maxVouchers;
    const payoutText = formatCurrency(campaign.voucherPayout);
    const maxText =
        maxVouchers === null || maxVouchers === undefined ? "—" : maxVouchers;
    const taken = Math.max(0, 0);
    const max =
        campaign.maxVouchers && campaign.maxVouchers > 0
            ? campaign.maxVouchers
            : 1;
    const fraction = Math.max(0, Math.min(1, taken / max));

    return (
        <>
            <div
                aria-hidden="true"
                className="h-2 rounded-full border border-[var(--color-ink)] bg-[var(--color-paper-2)]"
            >
                <div
                    className="h-full rounded-full bg-[var(--color-accent)]"
                    style={{ width: `${Math.round(fraction * 100)}%` }}
                />
            </div>
            <div className="guide-stat-row">
                <Stat
                    label="Vouchers tomados"
                    value={`${taken} de ${maxText}`}
                    hint="sobre el máximo publicado"
                />
                <Stat
                    label="Payout"
                    value={payoutText}
                    hint="valor por voucher"
                    lead
                />
            </div>
        </>
    );
}

export default function CampaignsPage() {
    const query = useCampaigns();
    if (query.isPending)
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Spinner />
            </div>
        );
    if (query.isError)
        return (
            <p className="text-destructive">
                No se pudieron cargar las campañas.
            </p>
        );

    const campaigns = (query.data ?? []) as Campaign[];
    return (
        <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
            <PageIntro
                eyebrow="Para tu próxima visita"
                title="Campañas"
                explain={campaignExplain}
            />
            {campaigns.length === 0 ? (
                <EmptyState
                    mark="🧩"
                    title="Sin campañas activas"
                    cause="Las campañas aparecen aquí cuando las cafeterías activan una ruta de recompensa."
                    action={{
                        label: "Descubrir cafeterías",
                        href: "/discover",
                    }}
                />
            ) : (
                campaigns.map((campaign) => (
                    <Link
                        className="consumer-panel grid gap-3 p-5 transition hover:-translate-y-0.5"
                        key={campaign.id}
                        href={`/campaigns/${campaign.id}`}
                    >
                        <div className="flex items-start justify-between gap-2">
                            <h2 className="consumer-title text-xl">
                                {campaign.name}
                            </h2>
                            <span className="consumer-eyebrow">Activa</span>
                        </div>
                        <CampaignProgress campaign={campaign} />
                        <span className="text-sm text-[var(--color-accent)]">
                            Ver detalles →
                        </span>
                    </Link>
                ))
            )}
        </div>
    );
}
