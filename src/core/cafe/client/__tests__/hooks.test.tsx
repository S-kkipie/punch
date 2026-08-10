// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { queryFn, cafes } = vi.hoisted(() => {
    const queryFn = vi.fn().mockResolvedValue({ response: [] });
    const cafes = vi.fn(() => ({
        products: {
            get: {
                queryOptions: () => ({ queryFn }),
            },
        },
    }));
    return { queryFn, cafes };
});

vi.mock("@/frontend/lib/eden", () => ({
    useElysia: () => ({ cafes }),
}));

import { useCafeProducts } from "../hooks";

function ProductsProbe({ cafeId }: { cafeId: string }) {
    const products = useCafeProducts(cafeId);
    return <span>{products.fetchStatus}</span>;
}

describe("useCafeProducts", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("does not execute the products request for an empty cafe id", async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const container = document.createElement("div");
        document.body.append(container);
        const root = createRoot(container);

        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <ProductsProbe cafeId="" />
                </QueryClientProvider>,
            );
        });
        expect(container.textContent).toBe("idle");
        expect(queryFn).not.toHaveBeenCalled();

        await act(async () => {
            root.render(
                <QueryClientProvider client={queryClient}>
                    <ProductsProbe cafeId="cafe-1" />
                </QueryClientProvider>,
            );
        });
        expect(queryFn).toHaveBeenCalledTimes(1);

        await act(async () => root.unmount());
        queryClient.clear();
    });
});
