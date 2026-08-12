// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const usePathname = vi.fn();
vi.mock("next/navigation", () => ({
    usePathname: () => usePathname(),
}));

import { CafeTabs } from "../cafe-tabs";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function renderTabs(cafeId = "cafe-1") {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(<CafeTabs cafeId={cafeId} />));
}

describe("CafeTabs", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("points every tab at a route that already exists", async () => {
        usePathname.mockReturnValue("/cafe/cafe-1");
        await renderTabs();
        const hrefs = [...document.querySelectorAll("a")].map((a) =>
            a.getAttribute("href"),
        );
        expect(hrefs).toEqual([
            "/cafe/cafe-1",
            "/cafe/cafe-1/terminal",
            "/cafe/cafe-1/redemptions",
            "/cafe/cafe-1/campaigns",
            "/cafe/cafe-1/plan",
        ]);
    });

    it("marks the active tab for assistive tech", async () => {
        usePathname.mockReturnValue("/cafe/cafe-1/terminal");
        await renderTabs();
        const current = document.querySelector("[aria-current='page']");
        expect(current?.getAttribute("href")).toBe("/cafe/cafe-1/terminal");
    });

    it("does not mark the summary tab active on a child route", async () => {
        usePathname.mockReturnValue("/cafe/cafe-1/plan");
        await renderTabs();
        const currents = [
            ...document.querySelectorAll("[aria-current='page']"),
        ];
        expect(currents.length).toBe(1);
        expect(currents[0]?.getAttribute("href")).toBe("/cafe/cafe-1/plan");
    });
});
