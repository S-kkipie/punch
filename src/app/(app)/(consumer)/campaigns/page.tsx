"use client";

import Link from "next/link";
import { useHistory } from "@/core/consumption/client/hooks";
import { useCampaigns, useVouchers } from "@/core/punch/client/hooks";
import {
    type CampaignViewerState,
    campaignViewerState,
    vouchersLeft,
} from "@/core/punch/domain/campaign-view";
import type { Campaign } from "@/core/punch/domain/types";
import { EmptyState } from "@/frontend/components/guide/empty-state";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Stat } from "@/frontend/components/guide/stat";
import { Spinner } from "@/frontend/components/ui/spinner";

const campaignExplain =
    "Una cafetería aparta dinero para invitarle el café a alguien que nunca la visitó. Si esa persona eres tú, el café te sale gratis y la campaña le devuelve el costo a la cafetería.";

function formatSoles(value: number | null | undefined) {
    if (value === null || value === undefined) return "S/0.00";
    return `S/${value.toFixed(2)}`;
}

// `toLocaleDateString` abrevia el mes con punto ("11 set."), que choca con el
// punto de la frase.
const dayLabel = (iso: string) =>
    new Date(iso)
        .toLocaleDateString("es-PE", { day: "numeric", month: "short" })
        .replace(/\.$/, "");

/** Lo que le pasa al cliente con esta campaña, en una frase. */
const stateLine: Record<CampaignViewerState, string> = {
    won: "Ya la ganaste: tienes un voucher esperando.",
    used: "Ya la usaste. Ese café te salió gratis.",
    not_new:
        "Ya eras cliente de esta cafetería, así que esta no aplica para ti.",
    full: "Se agotaron los vouchers de esta campaña.",
    closed: "La ventana de esta campaña ya cerró.",
    not_started: "Todavía no empieza.",
    pending: "La cafetería la está activando en la cadena.",
    open: "Puedes ganarla ahora.",
};

const stateTag: Record<CampaignViewerState, string> = {
    won: "GANADA",
    used: "USADA",
    not_new: "NO APLICA",
    full: "AGOTADA",
    closed: "CERRADA",
    not_started: "PRONTO",
    pending: "ACTIVÁNDOSE",
    open: "ABIERTA",
};

type VoucherRow = {
    campaignId: string | null;
    status: "available" | "redeemed" | "expired";
};

type HistoryRow = { cafeId: string; operation: string; status: string };

function CampaignCard({
    campaign,
    state,
}: {
    campaign: Campaign;
    state: CampaignViewerState;
}) {
    const left = vouchersLeft(campaign.unlockedCount, campaign.maxVouchers);
    const cap = campaign.maxVouchers ?? 0;
    const fraction = cap > 0 ? Math.min(1, campaign.unlockedCount / cap) : 0;
    const cafeName = campaign.cafeName ?? "una cafetería de la red";

    return (
        <div className="consumer-panel grid gap-4 p-5">
            <div className="flex items-start justify-between gap-2">
                <div className="grid gap-1">
                    <h2 className="consumer-title text-xl">{campaign.name}</h2>
                    <span className="text-[var(--color-ink-2)] text-sm">
                        en {cafeName}
                    </span>
                </div>
                <span className="consumer-eyebrow">{stateTag[state]}</span>
            </div>

            <p className="text-[var(--color-ink)] text-sm">
                {stateLine[state]}
            </p>

            <div className="guide-note">
                <span className="guide-note__label">Cómo se gana</span>
                <p>
                    Con tu <strong>primera compra en {cafeName}</strong>, entre
                    el {dayLabel(campaign.windowStart)} y el{" "}
                    {dayLabel(campaign.windowEnd)}. El voucher se desbloquea
                    solo, sin pedirlo.
                </p>
            </div>

            <div>
                <div
                    aria-hidden="true"
                    className="h-2 rounded-full border border-[var(--color-ink)] bg-[var(--color-paper-2)]"
                >
                    <div
                        className="h-full rounded-full bg-[var(--color-accent)]"
                        style={{ width: `${Math.round(fraction * 100)}%` }}
                    />
                </div>
            </div>

            <div className="guide-stat-row">
                <Stat
                    label="Vouchers disponibles"
                    value={left === null ? "sin límite" : String(left)}
                    hint={
                        cap > 0
                            ? `${campaign.unlockedCount} de ${cap} ya tomados`
                            : undefined
                    }
                    lead
                />
                <Stat
                    label="Lo que cubre la campaña"
                    value={formatSoles(campaign.voucherPayoutSoles)}
                    hint="se lo paga a la cafetería, no sale de tu bolsillo"
                />
            </div>

            <div className="flex flex-wrap gap-4">
                <Link
                    className="font-semibold text-[var(--color-accent)]"
                    href={`/campaigns/${campaign.id}`}
                >
                    Ver detalles →
                </Link>
                <Link
                    className="text-[var(--color-ink-2)]"
                    href={`/discover/${campaign.cafeId}`}
                >
                    Ver la cafetería
                </Link>
            </div>
        </div>
    );
}

export default function CampaignsPage() {
    const query = useCampaigns();
    const vouchersQuery = useVouchers();
    const historyQuery = useHistory();

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
    const vouchers = (vouchersQuery.data ?? []) as VoucherRow[];
    const history = (historyQuery.data ?? []) as HistoryRow[];
    const now = new Date();

    const stateFor = (campaign: Campaign) =>
        campaignViewerState({
            published: campaign.published,
            windowStart: new Date(campaign.windowStart),
            windowEnd: new Date(campaign.windowEnd),
            unlockedCount: campaign.unlockedCount,
            maxVouchers: campaign.maxVouchers,
            voucherStatus:
                vouchers.find((row) => row.campaignId === campaign.id)
                    ?.status ?? null,
            // La compra que desbloquea la campaña cuenta como previa: si ya
            // ganaste el voucher el estado se resolvió antes de llegar aquí.
            hasPriorPurchaseAtCafe: history.some(
                (row) =>
                    row.cafeId === campaign.cafeId &&
                    row.operation === "emission" &&
                    row.status === "confirmed",
            ),
            now,
        });

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
                    <CampaignCard
                        key={campaign.id}
                        campaign={campaign}
                        state={stateFor(campaign)}
                    />
                ))
            )}
        </div>
    );
}
