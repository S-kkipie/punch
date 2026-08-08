import type { PropsWithChildren } from "react";
import { requireAuth } from "@/server/auth/require-auth";

export default async function AppLayout({ children }: PropsWithChildren) {
    await requireAuth();
    return <>{children}</>;
}
