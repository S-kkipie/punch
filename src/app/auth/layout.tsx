import type { PropsWithChildren } from "react";

import "@/frontend/components/consumer/consumer-shell.css";
import "@/frontend/components/guide/guide.css";

export default function AuthLayout({ children }: PropsWithChildren) {
    return (
        <div className="consumer-shell">
            <main className="consumer-main pt-8">{children}</main>
        </div>
    );
}
