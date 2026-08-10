"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
    useCafeCampaigns,
    useCreateCampaign,
    useFundCampaign,
    usePublishCampaign,
} from "@/core/campaign/client/hooks";
import { Button } from "@/frontend/components/ui/button";
import { Card, CardContent } from "@/frontend/components/ui/card";
import { Input } from "@/frontend/components/ui/input";
import { Spinner } from "@/frontend/components/ui/spinner";

type Campaign = {
    id: string;
    name: string;
    windowStart: string;
    windowEnd: string;
    voucherPayout: string;
    maxVouchers: number;
    lifecycle: "creating" | "draft" | "published" | "cancelled";
    required: string;
    funded: string;
    missing: string;
    canPublish: boolean;
};

const parsePositiveInteger = (value: string): bigint | null => {
    if (!/^\d+$/.test(value)) return null;
    try {
        const parsed = BigInt(value);
        return parsed > 0n ? parsed : null;
    } catch {
        return null;
    }
};
const formatAmount = (value: string) => value;
const parseSafeCap = (value: string): number | null => {
    const parsed = parsePositiveInteger(value);
    if (parsed === null || parsed > BigInt(Number.MAX_SAFE_INTEGER))
        return null;
    return Number(parsed);
};

export default function CafeCampaignsPage() {
    const { cafeId } = useParams<{ cafeId: string }>();
    const campaignsQuery = useCafeCampaigns(cafeId);
    const createCampaign = useCreateCampaign(cafeId);
    const fundCampaign = useFundCampaign(cafeId);
    const publishCampaign = usePublishCampaign(cafeId);
    const [name, setName] = useState("");
    const [payout, setPayout] = useState("");
    const [cap, setCap] = useState("");
    const [windowStart, setWindowStart] = useState("");
    const [windowEnd, setWindowEnd] = useState("");
    const [fundingAmounts, setFundingAmounts] = useState<
        Record<string, string>
    >({});
    const [message, setMessage] = useState("");

    const prospectiveRequired = useMemo(() => {
        const payoutValue = parsePositiveInteger(payout);
        const capValue = parsePositiveInteger(cap);
        return payoutValue && capValue
            ? (payoutValue * capValue).toString()
            : "—";
    }, [payout, cap]);

    if (campaignsQuery.isPending)
        return (
            <div
                className="flex justify-center p-12"
                role="status"
                aria-label="Cargando campañas"
            >
                <Spinner />
            </div>
        );
    if (campaignsQuery.isError)
        return (
            <p className="p-6 text-destructive" role="alert">
                No se pudieron cargar las campañas.
            </p>
        );

    const campaigns = (campaignsQuery.data ?? []) as Campaign[];
    const submitCreate = () => {
        const payoutValue = parsePositiveInteger(payout);
        const capValue = parseSafeCap(cap);
        if (
            !name.trim() ||
            !payoutValue ||
            !capValue ||
            !windowStart ||
            !windowEnd
        ) {
            setMessage("Completa todos los campos con valores válidos.");
            return;
        }
        createCampaign.mutate(
            {
                name: name.trim(),
                voucherPayout: payout,
                maxVouchers: capValue,
                windowStart: new Date(windowStart).toISOString(),
                windowEnd: new Date(windowEnd).toISOString(),
            },
            {
                onSuccess: () => {
                    setMessage("Campaña en creación on-chain.");
                    setName("");
                    setPayout("");
                    setCap("");
                },
            },
        );
    };

    return (
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 sm:p-6">
            <h1 className="font-semibold text-2xl">Campañas del café</h1>
            <p className="text-muted-foreground">
                Crea campañas y financia su presupuesto antes de publicarlas.
            </p>
            <p className="sr-only" role="status" aria-live="polite">
                {message}
            </p>
            <Card>
                <CardContent className="space-y-3 p-4">
                    <h2 className="font-medium">Nueva campaña</h2>
                    <Input
                        aria-label="Nombre de la campaña"
                        placeholder="Nombre"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                            aria-label="Payout por voucher"
                            inputMode="numeric"
                            placeholder="Payout por voucher"
                            value={payout}
                            onChange={(event) => setPayout(event.target.value)}
                        />
                        <Input
                            aria-label="Máximo de vouchers"
                            inputMode="numeric"
                            placeholder="Máximo de vouchers"
                            value={cap}
                            onChange={(event) => setCap(event.target.value)}
                        />
                        <Input
                            aria-label="Inicio de ventana"
                            type="datetime-local"
                            value={windowStart}
                            onChange={(event) =>
                                setWindowStart(event.target.value)
                            }
                        />
                        <Input
                            aria-label="Fin de ventana"
                            type="datetime-local"
                            value={windowEnd}
                            onChange={(event) =>
                                setWindowEnd(event.target.value)
                            }
                        />
                    </div>
                    <p>
                        Presupuesto requerido (vista previa):{" "}
                        <strong>{prospectiveRequired}</strong>
                    </p>
                    <Button
                        className="min-h-11"
                        disabled={createCampaign.isPending}
                        onClick={submitCreate}
                    >
                        {createCampaign.isPending
                            ? "Creando…"
                            : "Crear campaña"}
                    </Button>
                </CardContent>
            </Card>
            {campaigns.length === 0 ? (
                <Card>
                    <CardContent className="p-6 text-muted-foreground">
                        No hay campañas todavía.
                    </CardContent>
                </Card>
            ) : (
                campaigns.map((campaign) => {
                    const fundingAmount = fundingAmounts[campaign.id] ?? "";
                    const isFunding = fundCampaign.isPending;
                    return (
                        <Card key={campaign.id}>
                            <CardContent className="space-y-3 p-4">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <h2 className="font-medium">
                                        {campaign.name}
                                    </h2>
                                    <span className="rounded-full border px-2 py-1 text-xs">
                                        {campaign.lifecycle}
                                    </span>
                                </div>
                                <p>
                                    Presupuesto requerido:{" "}
                                    <strong>
                                        {formatAmount(campaign.required)}
                                    </strong>
                                </p>
                                <p>
                                    Financiado on-chain:{" "}
                                    <strong>
                                        {formatAmount(campaign.funded)}
                                    </strong>
                                </p>
                                {campaign.lifecycle === "creating" ? (
                                    <p
                                        role="status"
                                        className="text-muted-foreground"
                                    >
                                        Creando campaña on-chain. El presupuesto
                                        estará disponible cuando se confirme.
                                    </p>
                                ) : campaign.lifecycle === "draft" ? (
                                    <>
                                        {campaign.missing !== "0" && (
                                            <p
                                                role="alert"
                                                className="text-destructive"
                                            >
                                                Faltan{" "}
                                                {formatAmount(campaign.missing)}{" "}
                                                para financiar la campaña.
                                            </p>
                                        )}
                                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                                            <Input
                                                aria-label={`Monto para financiar ${campaign.name}`}
                                                inputMode="numeric"
                                                placeholder="Monto a financiar"
                                                value={fundingAmount}
                                                onChange={(event) =>
                                                    setFundingAmounts(
                                                        (current) => ({
                                                            ...current,
                                                            [campaign.id]:
                                                                event.target
                                                                    .value,
                                                        }),
                                                    )
                                                }
                                            />
                                            <Button
                                                className="min-h-11"
                                                variant="outline"
                                                disabled={
                                                    !parsePositiveInteger(
                                                        fundingAmount,
                                                    ) || isFunding
                                                }
                                                onClick={() =>
                                                    fundCampaign.mutate(
                                                        {
                                                            campaignId:
                                                                campaign.id,
                                                            amount: fundingAmount,
                                                        },
                                                        {
                                                            onSuccess: () =>
                                                                setMessage(
                                                                    "Financiamiento en cola para aprobación.",
                                                                ),
                                                        },
                                                    )
                                                }
                                            >
                                                {isFunding
                                                    ? "Enviando…"
                                                    : "Financiar"}
                                            </Button>
                                        </div>
                                        <Button
                                            className="min-h-11"
                                            disabled={
                                                !campaign.canPublish ||
                                                publishCampaign.isPending
                                            }
                                            onClick={() =>
                                                publishCampaign.mutate(
                                                    campaign.id,
                                                    {
                                                        onSuccess: () =>
                                                            setMessage(
                                                                "Publicación en cola para operaciones.",
                                                            ),
                                                    },
                                                )
                                            }
                                        >
                                            {publishCampaign.isPending
                                                ? "Publicando…"
                                                : "Publicar campaña"}
                                        </Button>
                                    </>
                                ) : campaign.lifecycle === "published" ? (
                                    <p className="text-muted-foreground">
                                        Campaña publicada. No hay acciones
                                        pendientes.
                                    </p>
                                ) : (
                                    <p className="text-muted-foreground">
                                        Campaña cancelada.
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    );
                })
            )}
        </div>
    );
}
