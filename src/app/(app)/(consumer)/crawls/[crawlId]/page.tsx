"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCrawl, useDashboard, useVouchers } from "@/core/punch/client/hooks";
import type { CoffeeCrawl } from "@/core/punch/domain/types";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { Spinner } from "@/frontend/components/ui/spinner";

function normalizeActiveSteps(
    crawlId: string,
    dashboardData: ReturnType<typeof useDashboard> | null,
) {
    const data = dashboardData?.data as
        | { activeCrawl?: { id: string; completedSteps: number } | null }
        | undefined;
    if (!data?.activeCrawl) return 0;
    if (data.activeCrawl.id !== crawlId) return 0;
    return data.activeCrawl.completedSteps;
}

function CrawlSteps({
    steps,
    completedSteps,
}: {
    steps: Array<{ stepIndex: number; cafeId: string }>;
    completedSteps: number;
}) {
    if (steps.length === 0) {
        return (
            <p className="text-[var(--color-ink-2)] text-sm">
                Sin pasos definidos.
            </p>
        );
    }

    return (
        <ol className="grid gap-3">
            {steps
                .slice()
                .sort((a, b) => a.stepIndex - b.stepIndex)
                .map((step) => {
                    const done = step.stepIndex < completedSteps;
                    return (
                        <li
                            key={step.stepIndex}
                            className={`journey__step${
                                done ? " journey__step--done" : ""
                            }`}
                        >
                            <span className="font-bold text-[var(--color-accent)] mr-2">
                                {step.stepIndex + 1}.
                            </span>
                            {done ? (
                                <s>{step.cafeId}</s>
                            ) : (
                                <span>{step.cafeId}</span>
                            )}
                        </li>
                    );
                })}
        </ol>
    );
}

export default function CrawlDetailPage() {
    const { crawlId } = useParams<{ crawlId: string }>();
    const query = useCrawl(crawlId);
    const vouchersQuery = useVouchers();
    const dashboard = useDashboard();

    if (query.isPending)
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Spinner />
            </div>
        );
    if (query.isError || !query.data)
        return <p className="text-destructive">No se pudo cargar la ruta.</p>;
    const crawl = query.data as CoffeeCrawl;
    const eligibleCafeId = crawl.steps[0]?.cafeId;
    const completedSteps = normalizeActiveSteps(crawlId, dashboard);
    const voucher = (
        (vouchersQuery.data ?? []) as Array<{
            id: string;
            crawlId: string | null;
            source: string;
            status: string;
            cafeId: string | null;
        }>
    ).find(
        (item) =>
            item.crawlId === crawlId &&
            item.source === "crawl" &&
            item.status === "available",
    );

    return (
        <div className="mx-auto grid w-full max-w-md gap-5 p-6">
            <PageIntro
                eyebrow="Tu ruta"
                title="Detalle de ruta"
                explain="Avanza por el orden correcto para completar el recorrido."
            />
            <div className="consumer-panel grid gap-4 p-6">
                <h1 className="consumer-title text-3xl font-bold">
                    {crawl.name}
                </h1>
                <CrawlSteps
                    steps={crawl.steps}
                    completedSteps={completedSteps}
                />
                {voucher && eligibleCafeId && (
                    <Link
                        className="font-semibold text-[var(--color-accent)] underline"
                        href={`/redeem/${voucher.id}?cafeId=${eligibleCafeId}&voucherId=${voucher.id}&source=crawl`}
                    >
                        Usar tu voucher
                    </Link>
                )}
            </div>
        </div>
    );
}
