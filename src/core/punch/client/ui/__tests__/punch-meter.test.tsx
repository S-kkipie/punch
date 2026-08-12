// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { PunchMeter, punchMeterLabel } from "../punch-meter";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("punchMeterLabel", () => {
    it("shows the raw fraction below the cap", () => {
        expect(punchMeterLabel(5)).toBe("5 / 12");
    });
    it("shows the eligible message at or above the cap", () => {
        expect(punchMeterLabel(12)).toBe("12 / 12 — Recompensa disponible");
        expect(punchMeterLabel(15)).toBe("12 / 12 — Recompensa disponible");
    });
});

describe("PunchMeter", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
    });

    it("renders 12 punch cells", async () => {
        await render(<PunchMeter balance={5} />);
        expect(document.querySelectorAll(".punch-meter__cell")).toHaveLength(
            12,
        );
    });

    it("fills one cell per punch up to balance", async () => {
        await render(<PunchMeter balance={5} />);
        expect(
            document.querySelectorAll(".punch-meter__cell--filled"),
        ).toHaveLength(5);
    });

    it("caps filled cells at twelve", async () => {
        await render(<PunchMeter balance={15} />);
        expect(
            document.querySelectorAll(".punch-meter__cell--filled"),
        ).toHaveLength(12);
    });
});
