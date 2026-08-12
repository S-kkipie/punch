"use client";

import Link from "next/link";
import { useCrawls } from "@/core/punch/client/hooks";
import type { CoffeeCrawl } from "@/core/punch/domain/types";
import { EmptyState } from "@/frontend/components/guide/empty-state";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Spinner } from "@/frontend/components/ui/spinner";

function CrawlSummary({ crawl }: { crawl: CoffeeCrawl }) {
    return (
        <div className="grid gap-2">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <h2 className="consumer-title text-xl">{crawl.name}</h2>
                <span className="consumer-eyebrow">
                    {crawl.steps.length} pasos
                </span>
            </div>
            <p className="text-sm text-[var(--color-ink-2)]">
                Ruta de cafeterías aliadas · completa recorridos para
                desbloquear recompensas.
            </p>
        </div>
    );
}

export default function CrawlsPage() {
    const query = useCrawls();
    if (query.isPending)
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Spinner />
            </div>
        );
    if (query.isError)
        return (
            <p className="text-destructive">No se pudieron cargar las rutas.</p>
        );

    const crawls = (query.data ?? []) as CoffeeCrawl[];
    return (
        <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
            <PageIntro
                eyebrow="Explora tu barrio"
                title="Rutas de café"
                explain="Completa el recorrido para desbloquear un voucher de la red y canjearlo sin límites de fecha."
            />
            {crawls.length === 0 ? (
                <EmptyState
                    mark="🗺️"
                    title="No hay más rutas en tu zona"
                    cause="Las rutas nacen cuando hay 3 o más cafeterías cerca."
                    action={{
                        label: "Descubrir cafeterías",
                        href: "/discover",
                    }}
                />
            ) : (
                <div className="grid gap-4">
                    {crawls.map((crawl) => (
                        <Link
                            className="consumer-panel consumer-voucher grid gap-3 p-5 transition hover:-translate-y-0.5"
                            key={crawl.id}
                            href={`/crawls/${crawl.id}`}
                        >
                            <CrawlSummary crawl={crawl} />
                            <span className="text-sm text-[var(--color-accent)]">
                                Seguir la ruta →
                            </span>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
