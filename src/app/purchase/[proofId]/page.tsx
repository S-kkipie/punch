import { redirect } from "next/navigation";
import { PurchaseConfirmPage } from "@/core/consumption/client/ui/purchase-confirm-page";
import { authenticate } from "@/server/auth/auth";

export default async function PublicPurchasePage({
    params,
}: {
    params: Promise<{ proofId: string }>;
}) {
    const { proofId } = await params;
    const session = await authenticate();
    if (!session) {
        redirect(
            `/auth/sign-in?redirect=${encodeURIComponent(`/purchase/${proofId}`)}`,
        );
    }
    return <PurchaseConfirmPage />;
}
