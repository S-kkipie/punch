"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useHistory } from "@/core/consumption/client/hooks";
import { useCampaign, useVouchers } from "@/core/punch/client/hooks";
import {
    type CampaignViewerState,
    campaignViewerState,
    vouchersLeft,
} from "@/core/punch/domain/campaign-view";
import type { Campaign } from "@/core/punch/domain/types";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Stat } from "@/frontend/components/guide/stat";
import { Spinner } from "@/frontend/components/ui/spinner";

const formatSoles = (value: number | null | undefined) =>
    value === null || value === undefined ? "S/0.00" : `S/${value.toFixed(2)}`;

const dayLabel = (iso: string) =>
    new Date(iso)
        .toLocaleDateString("es-PE", { day: "numeric", month: "long" })
        .replace(/\.$/, "");

/** Qué le toca hacer al cliente ahora mismo. */
const nextMove: Record<CampaignViewerState, string> = {
    won: "Tu voucher ya está listo. Úsalo en la cafetería cuando vayas.",
    used: "Nada más que hacer: esta campaña ya te invitó un café.",
    not_new:
        "Esta campaña es solo para clientes nuevos de esta cafetería, y tú ya compraste ahí antes.",
    full: "Otros clientes se llevaron todos los vouchers de esta campaña.",
    closed: "La ventana ya cerró. El dinero que sobró vuelve a la cafetería.",
    not_started: "Vuelve cuando abra la ventana.",
    pending: "La cafetería todavía la está publicando en la cadena.",
    open: "Ve a la cafetería y compra tu primer café ahí. El voucher se desbloquea solo.",
};

type VoucherRow = {
    id: string;
    campaignId: string | null;
    cafeId: string | null;
    source: string;
    status: "available" | "redeemed" | "expired";
};

type HistoryRow = { cafeId: string; operation: string; status: string };

export default function CampaignDetailPage() {
    const { campaignId } = useParams<{ campaignId: string }>();
    const query = useCampaign(campaignId);
    const vouchersQuery = useVouchers();
    const historyQuery = useHistory();

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
    const vouchers = (vouchersQuery.data ?? []) as VoucherRow[];
    const history = (historyQuery.data ?? []) as HistoryRow[];
    const cafeName = campaign.cafeName ?? "la cafetería";

    const voucher = vouchers.find(
        (item) =>
            item.campaignId === campaignId &&
            item.cafeId === campaign.cafeId &&
            item.source === "campaign",
    );
    const state = campaignViewerState({
        published: campaign.published,
        windowStart: new Date(campaign.windowStart),
        windowEnd: new Date(campaign.windowEnd),
        unlockedCount: campaign.unlockedCount,
        maxVouchers: campaign.maxVouchers,
        voucherStatus: voucher?.status ?? null,
        hasPriorPurchaseAtCafe: history.some(
            (row) =>
                row.cafeId === campaign.cafeId &&
                row.operation === "emission" &&
                row.status === "confirmed",
        ),
        now: new Date(),
    });
    const left = vouchersLeft(campaign.unlockedCount, campaign.maxVouchers);

    return (
        <div className="mx-auto grid w-full max-w-md gap-5 p-6">
            <PageIntro
                eyebrow="Campaña"
                title={campaign.name}
                explain={`${cafeName} apartó dinero para invitarle el café a clientes nuevos. Ese dinero está bloqueado en un contrato hasta que alguien se gane el voucher.`}
            />

            <div className="consumer-panel grid gap-4 p-6">
                <p className="text-[var(--color-ink)]">{nextMove[state]}</p>

                <div className="guide-note">
                    <span className="guide-note__label">La regla exacta</span>
                    <p>
                        Cuenta tu <strong>primera</strong> compra pagada en{" "}
                        {cafeName}, hecha entre el{" "}
                        {dayLabel(campaign.windowStart)} y el{" "}
                        {dayLabel(campaign.windowEnd)}. Si ya habías comprado
                        ahí antes, la campaña no aplica: existe para traer gente
                        nueva, no para premiar a quien ya iba.
                    </p>
                </div>

                <div className="guide-stat-row">
                    <Stat
                        label="Vouchers disponibles"
                        value={left === null ? "sin límite" : String(left)}
                        hint={
                            campaign.maxVouchers
                                ? `${campaign.unlockedCount} de ${campaign.maxVouchers} ya tomados`
                                : undefined
                        }
                        lead
                    />
                    <Stat
                        label="Lo que cubre por voucher"
                        value={formatSoles(campaign.voucherPayoutSoles)}
                        hint="lo cobra la cafetería al entregar el café"
                    />
                </div>

                {voucher?.status === "available" && (
                    <Link
                        className="font-semibold text-[var(--color-accent)] underline"
                        href={`/redeem/${voucher.id}?cafeId=${campaign.cafeId}&voucherId=${voucher.id}&source=campaign`}
                    >
                        Usar tu voucher →
                    </Link>
                )}
                {state === "open" && (
                    <Link
                        className="font-semibold text-[var(--color-accent)]"
                        href={`/discover/${campaign.cafeId}`}
                    >
                        Ver {cafeName} →
                    </Link>
                )}
            </div>

            <div className="guide-note">
                <span className="guide-note__label">
                    De dónde sale la plata
                </span>
                <p>
                    El presupuesto vive en el contrato{" "}
                    <code>CampaignEscrow</code>, no en la cuenta de la
                    cafetería. Publicar la campaña exige que el escrow cubra
                    todos los vouchers prometidos, así que nunca puede ofrecer
                    más de lo que tiene. Lo que sobre cuando cierre la ventana
                    vuelve a la cafetería.
                </p>
            </div>
        </div>
    );
}
