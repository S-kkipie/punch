import type { PropsWithChildren } from "react";
import { BottomNav } from "@/frontend/components/nav/bottom-nav";
import { requireAuth } from "@/server/auth/require-auth";
import "@/frontend/components/consumer/consumer-shell.css";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: PropsWithChildren) {
    const { user } = await requireAuth();
    return (
        <div className="consumer-shell">
            <header className="consumer-header">
                <span className="consumer-header__brand">PUNCH</span>
                <div className="consumer-header__meta">
                    <span className="hidden sm:inline">{user.email}</span>
                    {user.isOps ? (
                        <a className="consumer-header__ops" href="/ops">
                            Ops
                        </a>
                    ) : null}
                    <SignOutButton />
                </div>
            </header>
            <main className="consumer-main">{children}</main>
            <BottomNav />
        </div>
    );
}
