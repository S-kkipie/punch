"use client";

import Link from "next/link";
import { useCrawls } from "@/core/punch/client/hooks";
import { Spinner } from "@/frontend/components/ui/spinner";

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
    const crawls = (query.data ?? []) as Array<{ id: string; name: string }>;
    return (
        <div className="mx-auto grid w-full max-w-2xl gap-5">
            <section className="grid gap-2">
                <span className="consumer-eyebrow">Explora tu barrio</span>
                <h1 className="consumer-title text-4xl font-bold">
                    Rutas de café
                </h1>
            </section>
            {crawls.length === 0 ? (
                <div className="consumer-panel p-6 text-[var(--color-ink-2)]">
                    Pronto habrá nuevas rutas para descubrir.
                </div>
            ) : (
                crawls.map((crawl) => (
                    <Link
                        className="consumer-panel p-5 transition hover:-translate-y-0.5"
                        key={crawl.id}
                        href={`/crawls/${crawl.id}`}
                    >
                        <p className="font-semibold text-xl">{crawl.name}</p>
                        <span className="text-[var(--color-accent)] text-sm">
                            Ver ruta →
                        </span>
                    </Link>
                ))
            )}
        </div>
    );
}
