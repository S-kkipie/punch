// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const useDemoJourneyResult = vi.hoisted(() => ({
    step: 0,
    loading: false,
}));

const step2BlockedLabel = "Repetir hasta juntar 12 sellos · no aplica";

const signInAs = vi.hoisted(() => vi.fn());

vi.mock("@/frontend/components/guide/use-demo-journey", () => ({
    useDemoJourney: () => useDemoJourneyResult,
}));

vi.mock("@/frontend/components/auth/use-demo-sign-in", () => ({
    useDemoSignIn: () => ({
        signInAs,
        pending: null,
        error: null,
    }),
}));

import { JourneyCard } from "../journey-card";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

function buttonWithLabel(label: string) {
    return [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes(label),
    ) as HTMLButtonElement | undefined;
}

function linkWithLabel(label: string) {
    return [...document.querySelectorAll("a")].find((link) =>
        link.textContent?.includes(label),
    ) as HTMLAnchorElement | undefined;
}

describe("JourneyCard", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        signInAs.mockClear();
    });

    it("renders done/current/future classes for the journey", async () => {
        useDemoJourneyResult.step = 3;

        await render(<JourneyCard currentRole="cliente" />);

        const steps = [...document.querySelectorAll(".journey__step")];
        expect(steps[0].className).toContain("journey__step--done");
        expect(steps[2].className).toContain("journey__step--done");
        expect(steps[3].className).toContain("journey__step--current");
        expect(steps[4].className).toContain("journey__step--future");
        expect(steps[5].className).toContain("journey__step--future");
    });

    it("shows transfer variant to cafetería when current role is cliente", async () => {
        useDemoJourneyResult.step = 0;

        await render(<JourneyCard currentRole="cliente" />);

        const transfer = buttonWithLabel("Cambiar a Cafetería");
        expect(transfer).not.toBeNull();
        expect(document.body.textContent).toContain(
            "Este paso lo hace la cafetería · en la demo, ese barista eres tú",
        );
        await act(async () => transfer?.click());
        expect(signInAs).toHaveBeenCalledWith("brujula@punch.pe", "/cafe");
    });

    it("shows transfer variant to cliente when current role is cafetería", async () => {
        useDemoJourneyResult.step = 1;

        await render(<JourneyCard currentRole="cafeteria" />);

        const transfer = buttonWithLabel("Cambiar a Cliente");
        expect(transfer).not.toBeNull();
        expect(document.body.textContent).toContain(
            "Este paso lo hace el cliente · en la demo, ese cliente eres tú",
        );
        await act(async () => transfer?.click());
        expect(signInAs).toHaveBeenCalledWith(
            "demo-consumer@punch.pe",
            "/scan",
        );
    });

    it("shows blocked action label on intermediate state", async () => {
        useDemoJourneyResult.step = 2;

        await render(<JourneyCard currentRole="cafeteria" />);

        const action = linkWithLabel("Repetir hasta juntar 12 sellos");
        expect(action).not.toBeNull();
        expect(action?.getAttribute("aria-disabled")).toBe("true");
        expect(document.body.textContent).toContain(step2BlockedLabel);
    });

    it("respects an action override on matching role steps", async () => {
        useDemoJourneyResult.step = 4;

        await render(
            <JourneyCard
                currentRole="cafeteria"
                actionOverride={{ label: "Abrir canje", href: "/canjes/12" }}
            />,
        );

        const action = linkWithLabel("Abrir canje");
        expect(action).not.toBeNull();
        expect(action?.getAttribute("href")).toBe("/canjes/12");
    });

    it("renders loading state while queries are pending", async () => {
        useDemoJourneyResult.loading = true;

        await render(<JourneyCard currentRole="cliente" />);

        const status = document.querySelector("[role='status']");
        expect(status?.textContent).toBe("Cargando estado de la demo");
        useDemoJourneyResult.loading = false;
    });
});
