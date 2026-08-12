import type { PropsWithChildren } from "react";
import "@/frontend/components/guide/guide.css";
import { ClientConfig } from "@/config/client-config";
import { DemoBar } from "@/frontend/components/guide/demo-bar";
import { requireAuth } from "@/server/auth/require-auth";

export default async function AppLayout({ children }: PropsWithChildren) {
    await requireAuth();

    const showDemoBar = Boolean(
        ClientConfig.demoMode && ClientConfig.demoPassword,
    );

    return (
        <div
            className={showDemoBar ? "app-shell app-shell--demo" : "app-shell"}
        >
            <DemoBar />
            <main className="app-shell__content">{children}</main>
        </div>
    );
}
