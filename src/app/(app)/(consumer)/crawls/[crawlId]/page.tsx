"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCrawl, useVouchers } from "@/core/punch/client/hooks";
import { Spinner } from "@/frontend/components/ui/spinner";

export default function CrawlDetailPage() {
    const { crawlId } = useParams<{ crawlId: string }>();
    const query = useCrawl(crawlId);
    const vouchersQuery = useVouchers();
    if (query.isPending)
        return (
            <div className="flex min-h-64 items-center justify-center">
                <Spinner />
            </div>
        );
    if (query.isError || !query.data)
        return <p className="text-destructive">No se pudo cargar la ruta.</p>;
    const crawl = query.data as {
        name: string;
        steps: Array<{ stepIndex: number; cafeId: string }>;
    };
    const eligibleCafeId = crawl.steps[0]?.cafeId;
    const voucher = (
        (vouchersQuery.data ?? []) as Array<{
            id: string;
            crawlId: string | null;
            cafeId: string | null;
            source: string;
            status: string;
        }>
    ).find(
        (item) =>
            item.crawlId === crawlId &&
            item.source === "crawl" &&
            item.status === "available",
    );
    return (
        <div className="mx-auto grid w-full max-w-md gap-5">
            <div className="consumer-panel grid gap-4 p-6">
                <span className="consumer-eyebrow">Tu próxima ruta</span>
                <h1 className="consumer-title text-3xl font-bold">
                    {crawl.name}
                </h1>
                <div className="grid gap-3">
                    {crawl.steps.map((step) => (
                        <div
                            className="flex gap-3 border-[var(--color-line)] border-b pb-3 last:border-0"
                            key={step.stepIndex}
                        >
                            <span className="font-bold text-[var(--color-accent)]">
                                {step.stepIndex + 1}
                            </span>
                            <span>Cafetería aliada</span>
                        </div>
                    ))}
                </div>
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
