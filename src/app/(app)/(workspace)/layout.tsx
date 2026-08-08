import Link from "next/link";
import type { PropsWithChildren } from "react";
import { SignOutButton } from "@/frontend/components/auth/sign-out-button";
import { requireAuth } from "@/server/auth/require-auth";

export default async function WorkspaceLayout({ children }: PropsWithChildren) {
    const { user } = await requireAuth();
    return (
        <div className="min-h-svh">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
                <div className="flex items-center gap-5">
                    <span className="font-semibold">PUNCH</span>
                    <nav className="flex items-center gap-3 text-sm">
                        <Link href="/cafe">Cafés</Link>
                        <Link href="/discover">Descubrir</Link>
                        {user.isOps ? <Link href="/ops">Ops</Link> : null}
                    </nav>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground text-sm">
                    <span>{user.email}</span>
                    <SignOutButton />
                </div>
            </header>
            <main>{children}</main>
        </div>
    );
}
