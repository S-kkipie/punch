import Link from "next/link";
import type { PropsWithChildren } from "react";
import { SignOutButton } from "@/frontend/components/auth/sign-out-button";
import { requireAuth } from "@/server/auth/require-auth";

export default async function WorkspaceLayout({ children }: PropsWithChildren) {
    const { user } = await requireAuth();
    return (
        <div className="ws-shell">
            <header className="ws-header">
                <div className="ws-header__brand">
                    <b>PUNCH</b>
                    <span>Red de cafeterías</span>
                </div>
                <nav
                    className="ws-header__nav"
                    aria-label="Navegación principal"
                >
                    <Link href="/cafe">Cafés</Link>
                    <Link href="/discover">Descubrir</Link>
                    {user.isOps ? <Link href="/ops">Ops</Link> : null}
                </nav>
                <div className="ws-header__meta">
                    <span>{user.email}</span>
                    <SignOutButton />
                </div>
            </header>
            <main className="ws-main">{children}</main>
        </div>
    );
}
