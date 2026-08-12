// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { ErrorState } from "../error-state";
import { LoadingState } from "../loading-state";
import { Stat } from "../stat";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("LoadingState", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
    });

    it("announces what is loading to screen readers", async () => {
        await render(<LoadingState label="Cargando tu progreso" />);
        expect(document.body.textContent).toContain("Cargando tu progreso");
    });

    it("draws one skeleton line per requested line", async () => {
        await render(<LoadingState label="Cargando" lines={4} />);
        expect(document.querySelectorAll(".guide-skeleton").length).toBe(4);
    });
});

describe("ErrorState", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
    });

    it("shows the retry button and calls back when pressed", async () => {
        const onRetry = vi.fn();
        await render(
            <ErrorState
                title="No pudimos traer tu progreso"
                detail="Tus sellos están seguros en la cadena."
                onRetry={onRetry}
            />,
        );
        const button = document.querySelector("button");
        expect(button?.textContent).toBe("Reintentar");
        await act(async () => button?.click());
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("renders no button when no retry is possible", async () => {
        await render(
            <ErrorState title="No autorizado" detail="Solo operaciones." />,
        );
        expect(document.querySelector("button")).toBeNull();
    });
});

describe("Stat", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
    });

    it("renders label, value and hint", async () => {
        await render(
            <Stat
                label="Fondo común · tu parte"
                value="S/ 18.40"
                hint="Este mes, por 4 referencias"
            />,
        );
        expect(document.body.textContent).toContain("Fondo común");
        expect(document.body.textContent).toContain("S/ 18.40");
        expect(document.body.textContent).toContain("4 referencias");
    });

    it("marks the leading stat with a modifier class", async () => {
        await render(<Stat label="Créditos" value="218" lead />);
        expect(document.querySelector(".guide-stat--lead")).not.toBeNull();
    });
});
