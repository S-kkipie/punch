"use client";

import Link from "next/link";
import { useCampaigns } from "@/core/punch/client/hooks";
import { Spinner } from "@/frontend/components/ui/spinner";

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
    const campaigns = (query.data ?? []) as Array<{ id: string; name: string }>;
    return (
        <div className="mx-auto grid w-full max-w-2xl gap-5">
            <section className="grid gap-2">
                <span className="consumer-eyebrow">Para tu próxima visita</span>
                <h1 className="consumer-title text-4xl font-bold">Campañas</h1>
            </section>
            {campaigns.length === 0 ? (
                <div className="consumer-panel p-6 text-[var(--color-ink-2)]">
                    Pronto habrá nuevas campañas para ti.
                </div>
            ) : (
                campaigns.map((campaign) => (
                    <Link
                        className="consumer-panel p-5 transition hover:-translate-y-0.5"
                        key={campaign.id}
                        href={`/campaigns/${campaign.id}`}
                    >
                        <p className="font-semibold text-xl">{campaign.name}</p>
                        <span className="text-[var(--color-accent)] text-sm">
                            Ver detalles →
                        </span>
                    </Link>
                ))
            )}
        </div>
    );
}
