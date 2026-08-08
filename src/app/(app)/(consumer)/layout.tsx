import type { PropsWithChildren } from "react";
import { SignOutButton } from "@/frontend/components/auth/sign-out-button";
import { BottomNav } from "@/frontend/components/nav/bottom-nav";
import { requireAuth } from "@/server/auth/require-auth";
import "@/frontend/components/consumer/consumer-shell.css";

export default async function ConsumerLayout({ children }: PropsWithChildren) {
    const { user } = await requireAuth();
    return (
        <div className="consumer-shell">
            <header className="consumer-header">
                <span className="consumer-header__brand">PUNCH</span>
                <div className="consumer-header__meta">
                    <span className="hidden sm:inline">{user.email}</span>
                    <SignOutButton />
                </div>
            </header>
            <main className="consumer-main">{children}</main>
            <BottomNav />
        </div>
    );
}
