import Link from "next/link";
import type { PropsWithChildren } from "react";
import { SignOutButton } from "@/frontend/components/auth/sign-out-button";
import "@/frontend/components/nav/workspace-shell.css";
import { requireAuth } from "@/server/auth/require-auth";

export default async function WorkspaceLayout({ children }: PropsWithChildren) {
    const { user } = await requireAuth();
    return (
        <div className="workspace-shell">
            <header className="workspace-header">
                <div className="flex items-center gap-5">
                    <span className="workspace-header__brand">PUNCH</span>
                    <nav className="workspace-header__nav">
                        <Link href="/cafe">Cafés</Link>
                        <Link href="/discover">Descubrir</Link>
                        {user.isOps ? (
                            <Link data-ops="true" href="/ops">
                                Ops
                            </Link>
                        ) : null}
                    </nav>
                </div>
                <div className="workspace-header__meta">
                    <span className="hidden sm:inline">{user.email}</span>
                    <SignOutButton />
                </div>
            </header>
            <main className="workspace-main">{children}</main>
        </div>
    );
}
