"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
    useCafeCampaigns,
    useCreateCampaign,
    useFundCampaign,
    usePublishCampaign,
} from "@/core/campaign/client/hooks";
import {
    formatMpenAsSoles,
    parseSolesToMpen,
} from "@/core/campaign/domain/money";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Stat } from "@/frontend/components/guide/stat";
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

const parseSafeCap = (value: string): number | null => {
    if (!/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value.trim());
    return parsed > 0 && parsed <= Number.MAX_SAFE_INTEGER ? parsed : null;
};

const lifecycleTag: Record<Campaign["lifecycle"], string> = {
    creating: "CREÁNDOSE",
    draft: "BORRADOR",
    published: "PUBLICADA",
    cancelled: "CANCELADA",
};

const campaignExplain =
    "Una campaña invita el café a alguien que nunca te visitó. Apartas el presupuesto por adelantado en un contrato; cuando un cliente nuevo se gana el voucher y se lo entregas, ese contrato te paga a ti.";

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
        const payoutValue = parseSolesToMpen(payout);
        const capValue = parseSafeCap(cap);
        return payoutValue && capValue
            ? formatMpenAsSoles(payoutValue * BigInt(capValue))
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
        const payoutValue = parseSolesToMpen(payout);
        const capValue = parseSafeCap(cap);
        if (!name.trim()) {
            setMessage("Ponle un nombre a la campaña.");
            return;
        }
        if (!payoutValue) {
            setMessage("El monto por voucher va en soles, por ejemplo 5.00.");
            return;
        }
        if (!capValue) {
            setMessage("El máximo de vouchers es un número entero mayor a 0.");
            return;
        }
        if (!windowStart || !windowEnd) {
            setMessage("Elige la fecha de inicio y la de fin.");
            return;
        }
        createCampaign.mutate(
            {
                name: name.trim(),
                voucherPayout: payoutValue.toString(),
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
            <PageIntro
                eyebrow="Traer clientes nuevos"
                title="Campañas del café"
                explain={campaignExplain}
            />
            <p className="sr-only" role="status" aria-live="polite">
                {message}
            </p>

            <Card>
                <CardContent className="space-y-3 p-4">
                    <h2 className="font-medium">Nueva campaña</h2>
                    <p className="text-muted-foreground text-sm">
                        Tres pasos: la creas, la financias y la publicas. Solo
                        puedes publicarla cuando el presupuesto cubra todos los
                        vouchers que prometes.
                    </p>
                    <Input
                        aria-label="Nombre de la campaña"
                        placeholder="Nombre (ej. Bienvenida de agosto)"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                            aria-label="Monto por voucher en soles"
                            inputMode="decimal"
                            placeholder="Monto por voucher (S/, ej. 5.00)"
                            value={payout}
                            onChange={(event) => setPayout(event.target.value)}
                        />
                        <Input
                            aria-label="Máximo de vouchers"
                            inputMode="numeric"
                            placeholder="Máximo de vouchers (ej. 10)"
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
                    <Stat
                        label="Presupuesto que tendrás que apartar"
                        value={prospectiveRequired}
                        hint="monto por voucher × máximo de vouchers"
                        lead
                    />
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
                                        {lifecycleTag[campaign.lifecycle]}
                                    </span>
                                </div>
                                <div className="guide-stat-row">
                                    <Stat
                                        label="Presupuesto requerido"
                                        value={formatMpenAsSoles(
                                            campaign.required,
                                        )}
                                        hint={`${campaign.maxVouchers} vouchers × ${formatMpenAsSoles(campaign.voucherPayout)}`}
                                    />
                                    <Stat
                                        label="Ya apartado en el contrato"
                                        value={formatMpenAsSoles(
                                            campaign.funded,
                                        )}
                                        hint="bloqueado en CampaignEscrow"
                                        lead
                                    />
                                </div>
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
                                                {formatMpenAsSoles(
                                                    campaign.missing,
                                                )}{" "}
                                                para poder publicarla.
                                            </p>
                                        )}
                                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                                            <Input
                                                aria-label={`Monto en soles para financiar ${campaign.name}`}
                                                inputMode="decimal"
                                                placeholder="Monto a financiar (S/)"
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
                                                    !parseSolesToMpen(
                                                        fundingAmount,
                                                    ) || isFunding
                                                }
                                                onClick={() => {
                                                    const amount =
                                                        parseSolesToMpen(
                                                            fundingAmount,
                                                        );
                                                    if (!amount) return;
                                                    fundCampaign.mutate(
                                                        {
                                                            campaignId:
                                                                campaign.id,
                                                            amount: amount.toString(),
                                                        },
                                                        {
                                                            onSuccess: () =>
                                                                setMessage(
                                                                    "Financiamiento en cola para aprobación.",
                                                                ),
                                                        },
                                                    );
                                                }}
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
                                    <div className="guide-note">
                                        <span className="guide-note__label">
                                            Publicada
                                        </span>
                                        <p>
                                            Ya no se puede cancelar ni cambiar
                                            el monto: eso es lo que le garantiza
                                            al cliente que el voucher vale. La
                                            primera compra de un cliente nuevo
                                            desbloquea su voucher solo. Lo que
                                            sobre al cerrar la ventana vuelve a
                                            ti.
                                        </p>
                                    </div>
                                ) : (
                                    <p className="text-muted-foreground">
                                        Campaña cancelada. El presupuesto que
                                        habías apartado volvió a tu billetera.
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
