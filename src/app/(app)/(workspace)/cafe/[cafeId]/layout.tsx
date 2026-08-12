"use client";

import { useParams } from "next/navigation";
import type { PropsWithChildren } from "react";

import { CafeTabs } from "@/frontend/components/nav/cafe-tabs";

export default function CafeDetailLayout({ children }: PropsWithChildren) {
    const { cafeId } = useParams<{ cafeId: string }>();

    if (!cafeId) {
        return <>{children}</>;
    }

    return (
        <>
            <CafeTabs cafeId={cafeId} />
            {children}
        </>
    );
}
