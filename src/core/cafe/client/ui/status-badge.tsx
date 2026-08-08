import type { CafeOnboardingStatus } from "@/core/cafe/domain/types";
import { Badge } from "@/frontend/components/ui/badge";

const labels: Record<CafeOnboardingStatus, string> = {
    draft: "Borrador",
    submitted: "En revisión",
    approved: "Aprobado",
    rejected: "Rechazado",
};

const styles: Record<CafeOnboardingStatus, string> = {
    draft: "bg-muted text-muted-foreground",
    submitted:
        "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
    approved:
        "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
};

export function StatusBadge({ status }: { status: CafeOnboardingStatus }) {
    return <Badge className={styles[status]}>{labels[status]}</Badge>;
}
