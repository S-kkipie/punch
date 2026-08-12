"use client";

import Link from "next/link";

import { useCafeProducts, useCafes } from "@/core/cafe/client/hooks";
import type { Cafe, Product } from "@/core/cafe/domain/types";
import { useDashboard } from "@/core/punch/client/hooks";
import { canRedeem, PUNCH_REDEMPTION_COST } from "@/core/punch/domain/progress";
import { EmptyState } from "@/frontend/components/guide/empty-state";
import { JourneyCard } from "@/frontend/components/guide/journey-card";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { StateStrip } from "@/frontend/components/guide/state-strip";
import { Spinner } from "@/frontend/components/ui/spinner";

function rewardsOf(products: Product[]): Product[] {
    return products.filter(
        (product) =>
            product.type === "reward" &&
            product.approvalStatus === "approved" &&
            product.active,
    );
}

function CafeRewards({ cafe, unlocked }: { cafe: Cafe; unlocked: boolean }) {
    const productsQuery = useCafeProducts(cafe.id);
    const rewards = rewardsOf((productsQuery.data ?? []) as Product[]);

    if (productsQuery.isPending || rewards.length === 0) return null;

    return (
        <section className="grid gap-3">
            <h2 className="consumer-eyebrow">{cafe.name}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
                {rewards.map((product) => (
                    <Link
                        key={product.id}
                        href={`/redeem/${product.id}?cafeId=${cafe.id}`}
                    >
                        <article className="consumer-panel grid gap-2 p-4">
                            <h3 className="font-semibold">{product.name}</h3>
                            <p className="text-[var(--color-ink-2)] text-sm">
                                {product.description || "Sin descripción"}
                            </p>
                            <span className="mono sm text-[var(--color-accent)]">
                                {unlocked
                                    ? "Canjeable ahora"
                                    : `Cuesta ${PUNCH_REDEMPTION_COST} sellos`}
                            </span>
                        </article>
                    </Link>
                ))}
            </div>
        </section>
    );
}

export default function RedeemIndexPage() {
    const cafesQuery = useCafes();
    const dashboard = useDashboard();

    const cafes = (cafesQuery.data ?? []) as Cafe[];
    const balance =
        (dashboard.data as { balance?: number | null } | undefined)?.balance ??
        0;
    const unlocked = canRedeem(balance);

    if (cafesQuery.isPending) {
        return (
            <div className="flex justify-center p-12">
                <Spinner />
            </div>
        );
    }

    if (cafesQuery.isError) {
        return (
            <p className="p-6 text-destructive">
                No se pudieron cargar las cafeterías.
            </p>
        );
    }

    return (
        <div className="mx-auto grid w-full max-w-5xl gap-5">
            <PageIntro
                eyebrow="Tu recompensa"
                title="Pide tu canje"
                explain="Tus sellos valen en cualquiera de las cafeterías de la red. Elige dónde quieres cobrarlos."
            />
            <StateStrip tone={unlocked ? "chain" : "saved"}>
                {unlocked
                    ? `Tienes ${balance} sellos · elige una recompensa y la cafetería la entrega.`
                    : `Llevas ${balance} de ${PUNCH_REDEMPTION_COST} sellos · te faltan ${
                          PUNCH_REDEMPTION_COST - balance
                      } para canjear.`}
            </StateStrip>
            {cafes.length === 0 ? (
                <EmptyState
                    mark="☕"
                    title="Todavía no hay recompensas"
                    cause="Las cafeterías aliadas publican sus recompensas desde su panel."
                    action={{ label: "Descubrir cafés", href: "/discover" }}
                />
            ) : (
                cafes.map((cafe) => (
                    <CafeRewards
                        key={cafe.id}
                        cafe={cafe}
                        unlocked={unlocked}
                    />
                ))
            )}
            <JourneyCard currentRole="cliente" />
        </div>
    );
}
