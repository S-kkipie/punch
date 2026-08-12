// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { PageIntro } from "../page-intro";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("PageIntro", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
    });

    it("renders the title as the page heading", async () => {
        await render(<PageIntro title="Campañas" />);
        const heading = document.querySelector("h1");
        expect(heading?.textContent).toBe("Campañas");
    });

    it("renders the eyebrow and the explain line when given", async () => {
        await render(
            <PageIntro
                eyebrow="Para tu próxima visita"
                title="Campañas"
                explain="Una cafetería pone dinero del fondo común para invitarte algo."
            />,
        );
        expect(document.body.textContent).toContain("Para tu próxima visita");
        expect(document.body.textContent).toContain("fondo común");
    });

    it("omits the eyebrow and explain nodes when not given", async () => {
        await render(<PageIntro title="Historial" />);
        expect(document.querySelector(".consumer-eyebrow")).toBeNull();
        expect(document.querySelector(".page-intro__explain")).toBeNull();
    });
});
