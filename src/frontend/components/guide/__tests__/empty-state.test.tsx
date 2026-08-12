// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { EmptyState } from "../empty-state";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("EmptyState", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
    });

    it("states the cause of the emptiness, not just its absence", async () => {
        await render(
            <EmptyState
                title="Aún no hay rutas en tu zona"
                cause="Las rutas nacen cuando hay 3 o más cafeterías cerca."
            />,
        );
        expect(document.body.textContent).toContain("Aún no hay rutas");
        expect(document.body.textContent).toContain("3 o más cafeterías");
    });

    it("offers a way out when an action is given", async () => {
        await render(
            <EmptyState
                title="Aún no hay rutas en tu zona"
                cause="En Barranco ya hay dos."
                action={{ label: "Ver cafés de Barranco", href: "/discover" }}
            />,
        );
        const link = document.querySelector("a");
        expect(link?.getAttribute("href")).toBe("/discover");
        expect(link?.textContent).toBe("Ver cafés de Barranco");
    });

    it("renders no link when no action is given", async () => {
        await render(<EmptyState title="Sin actividad" cause="Todavía." />);
        expect(document.querySelector("a")).toBeNull();
    });
});
