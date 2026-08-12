import type { PropsWithChildren } from "react";
import "@/frontend/components/guide/guide.css";
import { DemoBar } from "@/frontend/components/guide/demo-bar";
import { requireAuth } from "@/server/auth/require-auth";

export default async function AppLayout({ children }: PropsWithChildren) {
    await requireAuth();

    return (
        <div className="app-shell">
            <DemoBar />
            <main className="app-shell__content">{children}</main>
        </div>
    );
}
