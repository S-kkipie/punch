import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PunchLanding } from "../punch-landing";

const render = () => renderToStaticMarkup(createElement(PunchLanding));

describe("PunchLanding", () => {
    it("renders one café-first hero heading", () => {
        const html = render();
        expect(html.match(/<h1/g)).toHaveLength(1);
        expect(html).toContain(
            "No necesitas parecer cadena. Necesitas mover clientes como una.",
        );
        expect(html.indexOf("Quiero sumar mi café")).toBeLessThan(
            html.indexOf("Explorar la red"),
        );
    });

    it("renders canonical navigation destinations", () => {
        const html = render();
        expect(html).toContain('href="#como-funciona"');
        expect(html).toContain('href="#para-tu-cafe"');
        expect(html).toContain('href="#el-modelo"');
        expect(html).toContain('href="/auth/sign-up?rol=cafe"');
        expect(html).toContain('href="/auth/sign-in"');
        expect(html).toContain('aria-controls="landing-menu"');
        expect(html).toContain('aria-expanded="false"');
        expect(html).not.toContain("pnch-nav--js");
        expect(html).not.toContain('class="pnch-nav__menu is-open"');
    });

    it("renders the problem, stable mechanism, and network journey", () => {
        const html = render();
        expect(html).toContain('id="como-funciona"');
        expect(html).toContain('id="red-en-movimiento"');
        expect(html).toContain("La calidad no compensa competir solo.");
        expect(html).toContain(
            "La red trae la visita. Tu café hace que vuelva.",
        );
        expect(html).toContain("VISITA → DESCUBRE → REGRESA");
        expect(html).toContain(
            "El umbral no es la promesa de PUNCH; la red sí.",
        );
    });

    it("presents café value before technical trust", () => {
        const html = render();
        const cafeIndex = html.indexOf('id="para-tu-cafe"');
        const modelIndex = html.indexOf('id="el-modelo"');
        expect(cafeIndex).toBeGreaterThan(-1);
        expect(modelIndex).toBeGreaterThan(cafeIndex);
        expect(html).toContain("S/49 al mes");
        expect(html).toContain("El cliente te paga directamente por Yape.");
        expect(html).toContain("Arbitrum manda. Postgres proyecta.");
    });

    it("does not server-render discarded economic claims", () => {
        const html = render();
        for (const claim of [
            "S/0.01",
            "1,200",
            "S/12 completos",
            "10–15 %",
            "Arequipa",
            "gratis para siempre",
        ]) {
            expect(html).not.toContain(claim);
        }
    });

    it("offers distinct café and consumer doors", () => {
        const html = render();
        expect(html).toContain(
            "Tu café puede seguir siendo independiente sin competir solo.",
        );
        expect(html).toContain("¿Buscas mejor café, no otra cadena?");
        expect(html).toContain('href="/auth/sign-up?rol=cafe"');
        expect(html).toContain('href="/auth/sign-up"');
    });

    it("renders honest Lima and demo disclosures", () => {
        const html = render();
        expect(html).toContain("Mercado inicial: Lima, Perú.");
        expect(html).toContain("no representan tracción real");
        expect(html).toContain("pueden variar según la configuración activa");
        expect(html).toContain("PlanManager");
        expect(html).toContain("PunchVault");
        expect(html).not.toContain("RewardVault");
    });
});
