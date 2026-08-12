// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { StateStrip } from "../state-strip";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("StateStrip", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
    });

    it("announces itself to screen readers as a status", async () => {
        await render(
            <StateStrip tone="chain">Confirmando en la cadena</StateStrip>,
        );
        const strip = document.querySelector("[role='status']");
        expect(strip?.textContent).toContain("Confirmando en la cadena");
    });

    it("carries a modifier class per tone", async () => {
        await render(<StateStrip tone="offline">Sin conexión</StateStrip>);
        expect(document.querySelector(".state-strip--offline")).not.toBeNull();
    });
});
