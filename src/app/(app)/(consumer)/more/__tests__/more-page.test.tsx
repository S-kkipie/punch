import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/frontend/components/auth/sign-out-button", () => ({
    SignOutButton: () => <button type="button">Cerrar sesión</button>,
}));

import MorePage from "../page";

describe("MorePage", () => {
    it("keeps navigation destinations and exposes sign out", () => {
        const markup = renderToStaticMarkup(<MorePage />);
        expect(markup).toContain('href="/campaigns"');
        expect(markup).toContain('href="/crawls"');
        expect(markup).toContain('href="/profile"');
        expect(markup).toContain('href="/install"');
        expect(markup).toContain("Cerrar sesión");
    });
});
