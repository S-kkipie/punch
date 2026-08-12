// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { DemoOnly } from "../demo-only";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("DemoOnly", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
    });

    it("renders the inline demo marker text", async () => {
        await render(<DemoOnly />);
        expect(document.querySelector(".demo-only")).not.toBeNull();
        expect(document.body.textContent).toContain("● solo demo");
    });

    it("is focusable and keeps the helper message in the DOM", async () => {
        await render(<DemoOnly />);
        const marker = document.querySelector(
            ".demo-only",
        ) as HTMLSpanElement | null;
        expect(marker?.getAttribute("tabindex")).toBe("0");
        const message = document.querySelector(".demo-only__message");
        expect(message?.textContent).toBe(
            "Este mensaje no aparecerá en el producto final. Existe para guiar la demo.",
        );
    });
});
