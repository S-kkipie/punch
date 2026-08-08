import "server-only";

import { expirePurchases } from "../repository/purchase-repository";

export async function expirePurchasesService(): Promise<number> {
    return expirePurchases();
}
