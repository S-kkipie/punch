"use client";

import { useParams } from "next/navigation";
import { useCampaign } from "@/core/punch/client/hooks";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function CampaignDetailPage() {
    const { campaignId } = useParams<{ campaignId: string }>();
    const query = useCampaign(campaignId);
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
    const campaign = query.data as { name: string; windowEnd: string };
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
            </div>
        </div>
    );
}
