# PUNCH Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the outdated points-as-money landing narrative with an editorial-light, café-owner-first PUNCH landing page that sells shared demand, paid visits, and measurable returns while preserving each café's identity.

**Architecture:** Keep the root page as a server-rendered composition under the existing `.pnch` style scope. Move canonical Spanish copy and CTA destinations into one typed content module, split the current 545-line page into focused narrative sections, and keep only navigation state and progressive motion enhancement client-side. Preserve the current Hallmark token system, extend it for the approved light palette, and verify canonical copy with Vitest plus browser-level responsive and accessibility checks.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, CSS, `next/font`, Vitest 3, React DOM server rendering, Biome, Hallmark, Playwright MCP.

## Global Constraints

- Canonical product source: `docs/superpowers/specs/2026-08-07-punch-master-spec.md`, refined by `docs/superpowers/specs/2026-08-07-punch-landing-page-design.md`.
- Primary audience: independent café owners; secondary audience: consumers.
- Hero thesis: `No necesitas parecer cadena. Necesitas mover clientes como una.`
- Redemption thresholds and PUNCH quantities are configurable operating parameters, not the brand promise.
- Never state or imply a fixed monetary value per PUNCH.
- Never describe PUNCH as transferable, withdrawable, divisible, speculative, cash-redeemable, or applicable to arbitrary invoice value.
- Never revive the discarded `1 punto = S/0.01`, full-S/12 host payout, free-forever, or 10–15% campaign-fee model.
- Initial market is Lima, Perú; seeded simulations are not traction.
- The customer pays the café directly through Yape; PUNCH does not intermediate the sale.
- Current café plan is S/49/month, shown as commercial detail rather than hero copy.
- Preserve `.pnch` style isolation, root `tokens.css`, and Fraunces / IBM Plex Sans / JetBrains Mono.
- Core content must render without client-side JavaScript; animation is progressive enhancement.
- All motion must honor `prefers-reduced-motion`.
- Body must never scroll horizontally from 320px through 1440px.
- Do not overwrite unrelated uncommitted files under `docs/economia/`, `docs/pitch/`, `docs/simulacion-4-cafes/`, `.playwright-mcp/`, or root pitch screenshots.
- Do not mass-stage the working tree. Every commit command must name only files changed by its task.

## File Structure

### Files to create

- `src/frontend/components/landing/landing-content.ts` — typed source for approved Spanish copy, links, commercial facts, and footer disclosures.
- `src/frontend/components/landing/__tests__/landing-content.test.ts` — canonical-copy and forbidden-claim regression tests.
- `src/frontend/components/landing/__tests__/punch-landing.test.ts` — server-rendered semantic structure and CTA tests.
- `src/frontend/components/landing/landing-art.tsx` — decorative route, café frame, customer frame, and network-map primitives with explicit accessibility behavior.
- `src/frontend/components/landing/sections/hero-network.tsx` — café-owner-first hero and dual entry actions.
- `src/frontend/components/landing/sections/structural-problem.tsx` — isolated café versus coordinated network comparison.
- `src/frontend/components/landing/sections/punch-solution.tsx` — stable, configurable product mechanism.
- `src/frontend/components/landing/sections/network-journey.tsx` — discovery/visit/return route and outcomes.
- `src/frontend/components/landing/sections/cafe-value.tsx` — café benefits and current S/49 commercial offer.
- `src/frontend/components/landing/sections/operating-trust.tsx` — direct payment, prefunding, and verifiable-state explanation.
- `src/frontend/components/landing/sections/consumer-door.tsx` — secondary consumer value proposition.
- `src/frontend/components/landing/sections/dual-cta.tsx` — final café-primary conversion split.
- `src/frontend/components/landing/sections/landing-footer.tsx` — Lima/testnet/configurability disclosures and contract list.
- `public/landing/ATTRIBUTION.md` — source/license record for any local photography selected by Hallmark.
- `public/landing/cafe-interior.webp` — optimized bright café image selected during Hallmark asset pass.
- `public/landing/coffee-customer.webp` — optimized customer image selected during Hallmark asset pass.

### Files to modify

- `src/frontend/components/landing/punch-landing.tsx` — replace monolith with section composition.
- `src/frontend/components/landing/landing-nav.tsx` — café-first CTA, accessible mobile menu, and approved anchors.
- `src/frontend/components/landing/landing.css` — approved light editorial system, collage, routes, responsive behavior, and reduced motion.
- `src/app/layout.tsx` — canonical metadata; retain current fonts, viewport, providers, and language.
- `tokens.css` — add named sun, café-blue, route, image-frame, and print-shadow tokens.

### Files to preserve unchanged

- `src/app/page.tsx` — already correctly renders `PunchLanding`.
- `src/app/globals.css` — authenticated app tokens remain separate.
- Current pitch/economic/simulation documents and screenshot artifacts.

---

### Task 1: Lock canonical landing content with regression tests

**Files:**
- Create: `src/frontend/components/landing/landing-content.ts`
- Create: `src/frontend/components/landing/__tests__/landing-content.test.ts`

**Interfaces:**
- Consumes: approved positioning from the design spec and current routes `/auth/sign-up` and `/auth/sign-up?rol=cafe`.
- Produces: `LANDING_LINKS`, `LANDING_COPY`, `LandingLink`, and `LandingCopy`; every later section imports these constants rather than repeating product claims.

- [ ] **Step 1: Invoke Hallmark for implementation preflight**

Invoke skill `hallmark` with:

```text
Implement the approved PUNCH landing design in docs/superpowers/specs/2026-08-07-punch-landing-page-design.md. Preserve the existing .pnch scope, tokens.css, font stack, and current uncommitted landing work. Direction: “Visitas en movimiento — Light”: warm cream, bright café/customer imagery, editorial collage, dotted travel routes, stamp red, sun yellow, café blue. Primary conversion is café membership; consumer is secondary. Do not use fixed redemption thresholds or points-as-money language as the brand proposition. Record asset sources locally and run Hallmark QA after implementation.
```

Review `.hallmark/preflight.json` before editing. Accept only recommendations compatible with Global Constraints.

- [ ] **Step 2: Write failing canonical-copy tests**

Create `src/frontend/components/landing/__tests__/landing-content.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LANDING_COPY, LANDING_LINKS } from "../landing-content";

const flattenStrings = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.flatMap(flattenStrings);
    if (value && typeof value === "object") {
        return Object.values(value).flatMap(flattenStrings);
    }
    return [];
};

describe("landing content contract", () => {
    const copy = flattenStrings(LANDING_COPY).join(" ");

    it("leads with the approved coalition thesis", () => {
        expect(LANDING_COPY.hero.title).toBe(
            "No necesitas parecer cadena. Necesitas mover clientes como una.",
        );
        expect(LANDING_COPY.hero.body).toContain(
            "Cada local conserva su identidad",
        );
    });

    it("keeps the café path primary", () => {
        expect(LANDING_LINKS.cafe).toBe("/auth/sign-up?rol=cafe");
        expect(LANDING_LINKS.consumer).toBe("/auth/sign-up");
        expect(LANDING_COPY.hero.primaryCta).toBe("Quiero sumar mi café");
    });

    it("uses Lima and identifies changing operating rules", () => {
        expect(LANDING_COPY.footer.market).toContain("Lima, Perú");
        expect(LANDING_COPY.footer.conditions).toContain("pueden variar");
    });

    it.each([
        "1 punto",
        "S/0.01",
        "1,200",
        "S/12 completos",
        "10–15 %",
        "gratis para siempre",
        "Arequipa",
    ])("excludes discarded claim %s", (claim) => {
        expect(copy).not.toContain(claim);
    });
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run:

```bash
npm test -- src/frontend/components/landing/__tests__/landing-content.test.ts
```

Expected: FAIL because `../landing-content` does not exist.

- [ ] **Step 4: Add typed canonical content**

Create `src/frontend/components/landing/landing-content.ts` with this public shape and approved copy:

```ts
export const LANDING_LINKS = {
    cafe: "/auth/sign-up?rol=cafe",
    consumer: "/auth/sign-up",
    signIn: "/auth/sign-in",
} as const;

export const LANDING_COPY = {
    nav: {
        how: "Cómo funciona",
        cafe: "Para tu café",
        model: "Modelo",
        primaryCta: "Sumar mi café",
    },
    hero: {
        eyebrow: "Red de cafeterías independientes · Lima",
        title: "No necesitas parecer cadena. Necesitas mover clientes como una.",
        body: "PUNCH conecta visitas entre cafés independientes. Cada local conserva su identidad; toda la red gana alcance.",
        primaryCta: "Quiero sumar mi café",
        secondaryCta: "Explorar la red",
        route: "VISITA → DESCUBRE → REGRESA",
        quote: "Llegué por la red. Volví por el café.",
    },
    problem: {
        eyebrow: "El problema",
        title: "La calidad no compensa competir solo.",
        body: "Una cadena coordina alcance y retorno entre muchas puertas. Un café independiente suele pagar adquisición, construir lealtad y aprender de cada visita por su cuenta.",
        isolatedTitle: "Cada café por su cuenta",
        isolatedBody: "Adquisición aislada. Lealtad encerrada. Menor alcance.",
        networkTitle: "Una red compartida",
        networkBody: "Demanda colectiva. Retornos medibles. Identidad propia.",
    },
    solution: {
        eyebrow: "Cómo funciona",
        title: "La red trae la visita. Tu café hace que vuelva.",
        steps: [
            {
                title: "Descubre",
                body: "La red conecta al cliente con una cafetería independiente que todavía no conoce.",
            },
            {
                title: "Visita",
                body: "El cliente paga directo al café. PUNCH registra una participación elegible sin intermediar la venta.",
            },
            {
                title: "Regresa",
                body: "Los beneficios activos ayudan a convertir una visita aislada en una relación con toda la red.",
            },
        ],
        conditions:
            "Cada campaña define sus condiciones activas. El umbral no es la promesa de PUNCH; la red sí.",
    },
    journey: {
        eyebrow: "Red en movimiento",
        title: "Más puertas para descubrir. Más razones para regresar.",
        outcomes: [
            { title: "Más alcance", body: "La coalición crea oportunidades que un local aislado no puede crear solo." },
            { title: "Visitas pagadas", body: "El valor aparece cuando una persona entra y compra, no cuando ve un anuncio." },
            { title: "Retornos medibles", body: "La relación continúa dentro de una red, no en una tarjeta olvidada." },
        ],
    },
    cafeValue: {
        eyebrow: "Para tu café",
        title: "Comparte demanda. Conserva lo que te hace independiente.",
        benefits: [
            "Tu marca y experiencia siguen siendo tuyas.",
            "El cliente te paga directamente por Yape.",
            "La red amplía tu alcance y hace visible el retorno.",
            "La reserva protege el cumplimiento de beneficios activos.",
        ],
        planLabel: "Plan de red",
        planPrice: "S/49 al mes",
        planBody: "Incluye reserva de recompensas, aporte al fondo común y créditos de emisión según la configuración vigente.",
        cta: "Quiero sumar mi café",
    },
    trust: {
        eyebrow: "Confianza operativa",
        title: "Primero respaldo. Después beneficio.",
        body: "PUNCH usa reservas prefondadas y estados verificables para que la red no dependa de promesas informales entre cafés.",
        direct: "El pago de consumo va del cliente al café.",
        invisible: "El consumidor no necesita wallet, gas ni conocimiento de blockchain.",
        technical: "Arbitrum manda. Postgres proyecta.",
    },
    consumer: {
        eyebrow: "Para quienes toman café",
        title: "Tu próxima cafetería favorita puede estar a pocas cuadras.",
        body: "Descubre cafés independientes y participa en beneficios activos de toda la red, sin tratar PUNCH como dinero ni activo financiero.",
        cta: "Quiero descubrir la red",
    },
    finalCta: {
        cafeTitle: "Tu café puede seguir siendo independiente sin competir solo.",
        cafeBody: "Súmate a una red diseñada para mover demanda entre cafeterías independientes.",
        cafeCta: "Quiero sumar mi café",
        consumerTitle: "¿Buscas mejor café, no otra cadena?",
        consumerBody: "Explora una red de lugares con identidad propia.",
        consumerCta: "Quiero descubrir la red",
    },
    footer: {
        summary: "PUNCH — red de demanda y lealtad para cafeterías independientes.",
        market: "Mercado inicial: Lima, Perú.",
        demo: "Demo en Arbitrum Sepolia. Los fondos y la actividad del demo son simulados; no representan tracción real.",
        conditions: "Las condiciones de campaña, emisión y canje pueden variar según la configuración activa de la red.",
        contracts: "CafeRegistry · PlanManager · ConsumptionLog · PunchVault · CampaignEscrow · MockPEN",
    },
} as const;

export type LandingLink = keyof typeof LANDING_LINKS;
export type LandingCopy = typeof LANDING_COPY;
```

- [ ] **Step 5: Run the content tests**

Run:

```bash
npm test -- src/frontend/components/landing/__tests__/landing-content.test.ts
```

Expected: PASS, 10 tests including all seven forbidden claims.

- [ ] **Step 6: Commit the content contract**

```bash
git add src/frontend/components/landing/landing-content.ts src/frontend/components/landing/__tests__/landing-content.test.ts
git commit -m "test: lock canonical PUNCH landing copy

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Build café-first navigation and hero

**Files:**
- Create: `src/frontend/components/landing/__tests__/punch-landing.test.ts`
- Create: `src/frontend/components/landing/landing-art.tsx`
- Create: `src/frontend/components/landing/sections/hero-network.tsx`
- Modify: `src/frontend/components/landing/landing-nav.tsx`
- Modify: `src/frontend/components/landing/punch-landing.tsx`
- Modify: `src/app/layout.tsx:26-30`
- Modify: `tokens.css:11-99`
- Add: `public/landing/cafe-interior.webp`
- Add: `public/landing/coffee-customer.webp`
- Create: `public/landing/ATTRIBUTION.md`

**Interfaces:**
- Consumes: `LANDING_COPY.hero`, `LANDING_COPY.nav`, and `LANDING_LINKS` from Task 1.
- Produces: `HeroNetwork(): React.ReactElement`, `CafeCustomerCollage(): React.ReactElement`, `RouteLine({ label }: { label: string }): React.ReactElement`, and revised `LandingNav(): React.ReactElement`.

- [ ] **Step 1: Write failing server-render structure tests**

Create `src/frontend/components/landing/__tests__/punch-landing.test.ts`:

```ts
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
});
```

Using `createElement` keeps the test in a `*.test.ts` file compatible with the current Vitest include pattern while still rendering the TSX component.

- [ ] **Step 2: Run the structure test and verify it fails**

Run:

```bash
npm test -- src/frontend/components/landing/__tests__/punch-landing.test.ts
```

Expected: FAIL because the current hero still renders `Tu tarjeta de sellos...` and discarded monetary claims.

- [ ] **Step 3: Extend the token system for the approved light direction**

Add these named tokens to `:root` in `tokens.css`; use no raw color values in component CSS:

```css
--color-sun: oklch(82% 0.14 82);
--color-sun-ink: oklch(24% 0.025 52);
--color-cafe-blue: oklch(55% 0.075 205);
--color-cafe-blue-deep: oklch(34% 0.06 210);
--color-route: var(--color-accent);
--color-photo-border: var(--color-ink);
--shadow-print-sm: 0.375rem 0.4375rem 0 var(--color-ink);
--shadow-print-lg: 0.625rem 0.75rem 0 var(--color-ink);
```

- [ ] **Step 4: Select and localize Hallmark-approved photography**

Use Hallmark's asset recommendation from Step 1 to select one bright café interior and one customer-with-coffee photograph that permit project use. Store optimized WebP files at exactly:

```text
public/landing/cafe-interior.webp
public/landing/coffee-customer.webp
```

Each image must be at least 1200px wide, under 300KB after optimization, and must not contain a recognizable chain logo. Record creator, source URL, license, download date `2026-08-07`, and local filename in `public/landing/ATTRIBUTION.md`. Use local files at runtime; no remote image request.

- [ ] **Step 5: Build decorative art primitives**

Create `landing-art.tsx` as a server component. Its public API is:

```tsx
import Image from "next/image";

export function RouteLine({ label }: { label: string }) {
    return (
        <div aria-hidden="true" className="pnch-route">
            <span className="pnch-route__line" />
            <span className="pnch-route__label">{label}</span>
        </div>
    );
}

export function CafeCustomerCollage() {
    return (
        <div aria-label="Una visita conectada entre una persona y una cafetería independiente" className="pnch-collage" role="img">
            <figure className="pnch-photo pnch-photo--cafe">
                <Image alt="" fill priority sizes="(max-width: 767px) 88vw, 42vw" src="/landing/cafe-interior.webp" />
            </figure>
            <figure className="pnch-photo pnch-photo--customer">
                <Image alt="" fill priority sizes="(max-width: 767px) 48vw, 20vw" src="/landing/coffee-customer.webp" />
            </figure>
            <RouteLine label="VISITA → DESCUBRE → REGRESA" />
            <blockquote className="pnch-collage__quote">“Llegué por la red. Volví por el café.”</blockquote>
        </div>
    );
}
```

The wrapper carries the useful accessible label; nested images use empty alt text to avoid duplicate descriptions.

- [ ] **Step 6: Build `HeroNetwork` and revise navigation**

Create `sections/hero-network.tsx`:

```tsx
import { LANDING_COPY, LANDING_LINKS } from "../landing-content";
import { CafeCustomerCollage } from "../landing-art";

export function HeroNetwork() {
    const copy = LANDING_COPY.hero;
    return (
        <section aria-labelledby="hero-title" className="pnch-hero">
            <div className="pnch-shell pnch-hero__grid">
                <div className="pnch-hero__copy">
                    <p className="pnch-eyebrow">{copy.eyebrow}</p>
                    <h1 id="hero-title">{copy.title}</h1>
                    <p className="pnch-lede">{copy.body}</p>
                    <div className="pnch-actions">
                        <a className="pnch-cta pnch-cta--fill" href={LANDING_LINKS.cafe}>{copy.primaryCta} →</a>
                        <a className="pnch-cta pnch-cta--text" href={LANDING_LINKS.consumer}>{copy.secondaryCta} →</a>
                    </div>
                </div>
                <CafeCustomerCollage />
            </div>
        </section>
    );
}
```

Revise `LandingNav` to:

- retain the honest Sepolia/simulated-money disclosure and dismiss behavior;
- use `LANDING_COPY.nav` and `LANDING_LINKS`;
- make `Sumar mi café` link to `/auth/sign-up?rol=cafe`;
- keep `Entrar` as a lower-weight text link to `/auth/sign-in`;
- add a mobile menu button with `aria-expanded`, `aria-controls="landing-menu"`, and a 44px target;
- close the mobile menu after any nav link click;
- keep `Cómo funciona`, `Para tu café`, and `Modelo` anchors.

- [ ] **Step 7: Compose temporary hero-only landing and update metadata**

Replace the current monolith temporarily with:

```tsx
import { LandingNav } from "./landing-nav";
import { HeroNetwork } from "./sections/hero-network";
import "./landing.css";

export function PunchLanding() {
    return (
        <div className="pnch" id="top">
            <LandingNav />
            <main>
                <HeroNetwork />
            </main>
        </div>
    );
}
```

Change metadata in `src/app/layout.tsx` to:

```ts
export const metadata: Metadata = {
    title: "PUNCH — una red de cafeterías independientes",
    description:
        "PUNCH conecta cafeterías independientes para compartir demanda, atraer visitas y generar retornos medibles sin perder su identidad.",
};
```

Do not change font declarations, viewport, providers, or `lang="es"`.

- [ ] **Step 8: Add hero/nav CSS and run focused tests**

Replace only obsolete hero/card/nav selectors needed by this task. Use the new tokens for sun, route, photo frames, and print shadows. Ensure initial server markup is visible; animations may only transition from visible defaults after an enhancement class is present.

Run:

```bash
npm test -- src/frontend/components/landing/__tests__/landing-content.test.ts src/frontend/components/landing/__tests__/punch-landing.test.ts
npm run typecheck
```

Expected: both test files PASS and TypeScript exits 0.

- [ ] **Step 9: Commit hero foundation**

```bash
git add tokens.css public/landing/ATTRIBUTION.md public/landing/cafe-interior.webp public/landing/coffee-customer.webp src/app/layout.tsx src/frontend/components/landing/landing-art.tsx src/frontend/components/landing/landing-nav.tsx src/frontend/components/landing/landing.css src/frontend/components/landing/punch-landing.tsx src/frontend/components/landing/sections/hero-network.tsx src/frontend/components/landing/__tests__/punch-landing.test.ts
git commit -m "feat: add café-first PUNCH landing hero

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Explain the structural problem and network mechanism

**Files:**
- Create: `src/frontend/components/landing/sections/structural-problem.tsx`
- Create: `src/frontend/components/landing/sections/punch-solution.tsx`
- Create: `src/frontend/components/landing/sections/network-journey.tsx`
- Modify: `src/frontend/components/landing/landing-art.tsx`
- Modify: `src/frontend/components/landing/punch-landing.tsx`
- Modify: `src/frontend/components/landing/landing.css`
- Modify: `src/frontend/components/landing/__tests__/punch-landing.test.ts`

**Interfaces:**
- Consumes: `LANDING_COPY.problem`, `.solution`, and `.journey`.
- Produces: `StructuralProblem`, `PunchSolution`, `NetworkJourney`, and `NetworkMap`; IDs `como-funciona` and `red-en-movimiento` become stable navigation/test hooks.

- [ ] **Step 1: Extend the failing structure test**

Add:

```ts
it("renders the problem, stable mechanism, and network journey", () => {
    const html = render();
    expect(html).toContain('id="como-funciona"');
    expect(html).toContain('id="red-en-movimiento"');
    expect(html).toContain("La calidad no compensa competir solo.");
    expect(html).toContain("La red trae la visita. Tu café hace que vuelva.");
    expect(html).toContain("VISITA → DESCUBRE → REGRESA");
    expect(html).toContain("El umbral no es la promesa de PUNCH; la red sí.");
});
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
npm test -- src/frontend/components/landing/__tests__/punch-landing.test.ts
```

Expected: FAIL because the three sections are not composed.

- [ ] **Step 3: Build the structural comparison**

Create `StructuralProblem` with:

- `section` labelled by an `h2`;
- approved eyebrow/title/body;
- left panel `Cada café por su cuenta` with three separated café stamps;
- right panel `Una red compartida` with the same stamps joined by a route;
- no unverified CAC values, competitor numbers, or chain logos.

Use semantic prose plus decorative visual nodes marked `aria-hidden="true"`.

- [ ] **Step 4: Build the stable mechanism**

Create `PunchSolution` as an ordered list from `LANDING_COPY.solution.steps`. Set `id="como-funciona"`. Render the configurability sentence in a visible `.pnch-note`, not a footnote.

The section must say that the customer pays the café directly and must not mention wallet signatures, nonce, fixed PUNCH amount, fixed redemption count, full retail payout, or gas details.

- [ ] **Step 5: Build the route journey and network map**

Extend `landing-art.tsx`:

```tsx
export function NetworkMap() {
    const cafes = ["Barranco", "Miraflores", "Surquillo"];
    return (
        <div aria-label="Tres cafeterías independientes conectadas por una ruta compartida" className="pnch-network-map" role="img">
            <span aria-hidden="true" className="pnch-network-map__route" />
            {cafes.map((cafe, index) => (
                <span aria-hidden="true" className={`pnch-network-map__node pnch-network-map__node--${index + 1}`} key={cafe}>
                    Café<br />{cafe}
                </span>
            ))}
        </div>
    );
}
```

Create `NetworkJourney` with `id="red-en-movimiento"`, the approved title, `NetworkMap`, route label, and three outcome statements.

- [ ] **Step 6: Compose sections in narrative order**

`PunchLanding` order after hero:

```tsx
<StructuralProblem />
<PunchSolution />
<NetworkJourney />
```

Keep one `main` and no additional `h1`.

- [ ] **Step 7: Style and verify sections**

Add section-specific CSS using existing shell/type primitives. Avoid a generic three-card grid: solution steps should form one directional route; problem should be a before/after diptych; journey should use the map as the visual anchor.

Run:

```bash
npm test -- src/frontend/components/landing/__tests__/punch-landing.test.ts
npm run typecheck
npm run check -- src/frontend/components/landing
```

Expected: tests PASS, typecheck exits 0, Biome reports no errors in landing files.

- [ ] **Step 8: Commit problem and mechanism**

```bash
git add src/frontend/components/landing/landing-art.tsx src/frontend/components/landing/landing.css src/frontend/components/landing/punch-landing.tsx src/frontend/components/landing/sections/structural-problem.tsx src/frontend/components/landing/sections/punch-solution.tsx src/frontend/components/landing/sections/network-journey.tsx src/frontend/components/landing/__tests__/punch-landing.test.ts
git commit -m "feat: explain PUNCH coalition journey

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Add café value and operating trust

**Files:**
- Create: `src/frontend/components/landing/sections/cafe-value.tsx`
- Create: `src/frontend/components/landing/sections/operating-trust.tsx`
- Modify: `src/frontend/components/landing/punch-landing.tsx`
- Modify: `src/frontend/components/landing/landing.css`
- Modify: `src/frontend/components/landing/__tests__/punch-landing.test.ts`

**Interfaces:**
- Consumes: `LANDING_COPY.cafeValue`, `.trust`, and `LANDING_LINKS.cafe`.
- Produces: `CafeValue` with `id="para-tu-cafe"` and `OperatingTrust` with `id="el-modelo"`.

- [ ] **Step 1: Add failing café/trust tests**

Add:

```ts
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
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- src/frontend/components/landing/__tests__/punch-landing.test.ts
```

Expected: FAIL because café-value and trust sections do not exist.

- [ ] **Step 3: Build `CafeValue`**

Render:

- approved heading and four-benefit list;
- one editorial plan slip with `S/49 al mes` and current plan body;
- primary café CTA to `LANDING_LINKS.cafe`;
- no detailed S/30/S/5/S/14 split unless the current master spec is revalidated immediately before implementation;
- no promise of fixed ROI, guaranteed customer count, or simulation result.

Use `id="para-tu-cafe"` and `aria-labelledby`.

- [ ] **Step 4: Build `OperatingTrust`**

Render a two-column ledger:

- left: `Pago de consumo` → `Cliente paga al café`;
- right: `Beneficio de red` → `Reserva prefondada` → `Estado verificable`;
- technical line `Arbitrum manda. Postgres proyecta.`;
- consumer abstraction line about no wallet, gas, or blockchain knowledge.

Use `id="el-modelo"`. Visually separate campaign vouchers from PUNCH with distinct labels and border treatments; do not assign either a monetary unit value.

- [ ] **Step 5: Compose, style, and test**

Place `<CafeValue />` before `<OperatingTrust />`. Style café value as editorial evidence plus plan slip, not a SaaS pricing card. Style trust as a ledger diagram with an internal scroller below 360px only if required.

Run:

```bash
npm test -- src/frontend/components/landing/__tests__/punch-landing.test.ts
npm run typecheck
npm run check -- src/frontend/components/landing
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit café value and trust**

```bash
git add src/frontend/components/landing/landing.css src/frontend/components/landing/punch-landing.tsx src/frontend/components/landing/sections/cafe-value.tsx src/frontend/components/landing/sections/operating-trust.tsx src/frontend/components/landing/__tests__/punch-landing.test.ts
git commit -m "feat: add café value and network trust

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Complete consumer path, final conversion, and disclosures

**Files:**
- Create: `src/frontend/components/landing/sections/consumer-door.tsx`
- Create: `src/frontend/components/landing/sections/dual-cta.tsx`
- Create: `src/frontend/components/landing/sections/landing-footer.tsx`
- Modify: `src/frontend/components/landing/punch-landing.tsx`
- Modify: `src/frontend/components/landing/landing.css`
- Modify: `src/frontend/components/landing/__tests__/punch-landing.test.ts`

**Interfaces:**
- Consumes: `LANDING_COPY.consumer`, `.finalCta`, `.footer`, and `LANDING_LINKS`.
- Produces: complete `PunchLanding` composition and final disclosure contract.

- [ ] **Step 1: Add failing completion tests**

Add:

```ts
it("offers distinct café and consumer doors", () => {
    const html = render();
    expect(html).toContain("Tu café puede seguir siendo independiente sin competir solo.");
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
```

- [ ] **Step 2: Run and verify failure**

```bash
npm test -- src/frontend/components/landing/__tests__/punch-landing.test.ts
```

Expected: FAIL because final consumer, CTA, and footer sections are absent.

- [ ] **Step 3: Build `ConsumerDoor`**

Use a bright, lower-density section with consumer copy and secondary CTA. Explain discovery and active network benefits without wallet, cash-value, investment, or transfer language.

- [ ] **Step 4: Build `DualCTA`**

Create a split section where the café side occupies roughly 60% visual weight and uses the filled CTA. Consumer side occupies roughly 40% and uses an outline/text CTA. Preserve logical DOM order: café first, consumer second.

- [ ] **Step 5: Build `LandingFooter`**

Use `LANDING_COPY.footer` verbatim. Include:

- PUNCH summary;
- Lima market;
- Sepolia simulated-demo disclosure;
- changing-conditions disclosure;
- canonical contract names;
- sign-in link.

Do not include stale Hackathon, Arequipa, fixed-point-value, or pending-Arbiscan copy.

- [ ] **Step 6: Finalize composition**

`PunchLanding` must be:

```tsx
export function PunchLanding() {
    return (
        <div className="pnch" id="top">
            <LandingNav />
            <main>
                <HeroNetwork />
                <StructuralProblem />
                <PunchSolution />
                <NetworkJourney />
                <CafeValue />
                <OperatingTrust />
                <ConsumerDoor />
                <DualCTA />
            </main>
            <LandingFooter />
        </div>
    );
}
```

- [ ] **Step 7: Run component and content tests**

```bash
npm test -- src/frontend/components/landing/__tests__/landing-content.test.ts src/frontend/components/landing/__tests__/punch-landing.test.ts
npm run typecheck
npm run check -- src/frontend/components/landing src/app/layout.tsx tokens.css
```

Expected: all tests PASS; typecheck and Biome exit 0.

- [ ] **Step 8: Commit complete narrative**

```bash
git add src/frontend/components/landing/landing.css src/frontend/components/landing/punch-landing.tsx src/frontend/components/landing/sections/consumer-door.tsx src/frontend/components/landing/sections/dual-cta.tsx src/frontend/components/landing/sections/landing-footer.tsx src/frontend/components/landing/__tests__/punch-landing.test.ts
git commit -m "feat: complete PUNCH landing conversion paths

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Add progressive motion and responsive guarantees

**Files:**
- Modify: `src/frontend/components/landing/landing.css`
- Modify: `src/frontend/components/landing/landing-nav.tsx`
- Modify: `src/frontend/components/landing/__tests__/punch-landing.test.ts`

**Interfaces:**
- Consumes: all stable section class names and route primitives.
- Produces: responsive 320–1440px layout, keyboard-safe navigation, and reduced-motion behavior without changing public component APIs.

- [ ] **Step 1: Add static accessibility assertions**

Add:

```ts
it("keeps progressive enhancements accessible", () => {
    const html = render();
    expect(html).toContain('aria-label="Cerrar el aviso"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls="landing-menu"');
    expect(html).toContain("Una visita conectada entre una persona y una cafetería independiente");
});
```

- [ ] **Step 2: Run and verify the assertion fails if mobile menu attributes are missing**

```bash
npm test -- src/frontend/components/landing/__tests__/punch-landing.test.ts
```

Expected: FAIL if Task 2 omitted the exact `aria-expanded` or `aria-controls` contract; otherwise PASS, confirming the contract already exists.

- [ ] **Step 3: Implement progressive section motion**

Use CSS-only view timelines only when supported, guarded by `@supports (animation-timeline: view())`. Content remains visible outside the guard. Route-line drawing may animate `transform: scaleX(0)` to `scaleX(1)` with transform origin aligned to journey direction.

Add:

```css
@media (prefers-reduced-motion: reduce) {
    .pnch *,
    .pnch *::before,
    .pnch *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: 0.01ms !important;
    }
}
```

- [ ] **Step 4: Enforce responsive layout rules**

At minimum:

- wide hero: copy and collage in two columns;
- below 768px: copy first, collage second;
- collage remains within its grid cell and image frames use bounded `inset` values;
- mobile menu replaces desktop links;
- dual CTA stacks café first;
- plan slip and trust ledger do not overflow;
- `.pnch` and all full-bleed sections use `max-width: 100%` and controlled overflow only for decorative art;
- no body-level `overflow-x: hidden` hack that masks layout defects.

- [ ] **Step 5: Run code checks**

```bash
npm test
npm run typecheck
npm run check
npm run build
```

Expected: full Vitest suite passes; TypeScript, Biome, and Next production build exit 0.

- [ ] **Step 6: Commit responsive and motion polish**

```bash
git add src/frontend/components/landing/landing.css src/frontend/components/landing/landing-nav.tsx src/frontend/components/landing/__tests__/punch-landing.test.ts
git commit -m "feat: polish PUNCH landing motion and responsive behavior

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Run Hallmark and browser verification

**Files:**
- Modify only if verification finds a defect: `tokens.css`, `src/frontend/components/landing/landing.css`, section components, `landing-nav.tsx`, `landing-content.ts`, or `src/app/layout.tsx`.
- Update: `.hallmark/log.json`
- Create or update: `punch-landing-desktop.png`
- Create or update: `punch-landing-mobile.png`

**Interfaces:**
- Consumes: complete landing implementation.
- Produces: verified build, responsive screenshots, and Hallmark QA record.

- [ ] **Step 1: Launch the app using the project run workflow**

Invoke skill `run`. Use its reported local URL for all browser checks. Do not start a second dev server if one is already active.

- [ ] **Step 2: Verify desktop behavior at 1440×1000**

Using Playwright MCP:

1. navigate to `/`;
2. confirm the hero thesis is visible without scrolling;
3. confirm café CTA precedes consumer CTA;
4. click each nav anchor and verify the target heading is visible;
5. dismiss the demo disclosure and verify no empty gap remains;
6. inspect console messages and require zero errors;
7. save `punch-landing-desktop.png`.

- [ ] **Step 3: Verify mobile behavior at 375×812 and 320×700**

Using Playwright MCP:

1. resize to 375×812;
2. open mobile menu, verify `aria-expanded="true"`, follow an anchor, and verify the menu closes;
3. verify hero copy appears before collage;
4. verify café CTA remains primary and both CTAs are at least 44px high;
5. evaluate `document.documentElement.scrollWidth === document.documentElement.clientWidth`;
6. repeat the overflow check at 320×700;
7. save `punch-landing-mobile.png` at 375×812.

Expected overflow expression result: `true` at both sizes.

- [ ] **Step 4: Verify reduced motion and no-JS content**

Emulate reduced motion and reload. Verify the collage, route labels, headings, and CTAs remain visible. Disable JavaScript for one page load or inspect server HTML and confirm core content, links, and all sections remain present.

- [ ] **Step 5: Run final Hallmark audit**

Invoke skill `hallmark` with:

```text
Audit the implemented PUNCH landing against docs/superpowers/specs/2026-08-07-punch-landing-page-design.md. Check visual hierarchy, editorial-light specificity, human energy, photo/collage quality, route motif consistency, café-first conversion, responsive behavior, accessibility, and generic SaaS slop. Confirm no fixed threshold or points-as-money message dominates. Apply only fixes supported by the approved design, then rerun screenshots and code checks.
```

Review `.hallmark/log.json`. Resolve every blocking finding; document any non-blocking rejection in that log with the design constraint it would violate.

- [ ] **Step 6: Re-run complete verification**

```bash
npm test
npm run typecheck
npm run check
npm run build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 7: Confirm copy guardrails directly**

Run:

```bash
grep -RInE 'S/0\.01|1,200|S/12 completos|10–15 %|gratis para siempre|Arequipa|RewardVault' src/app src/frontend/components/landing
```

Expected: no output.

- [ ] **Step 8: Commit verification fixes and evidence**

Stage only files actually changed by verification. Example when CSS, nav, Hallmark log, and screenshots changed:

```bash
git add src/frontend/components/landing/landing.css src/frontend/components/landing/landing-nav.tsx .hallmark/log.json punch-landing-desktop.png punch-landing-mobile.png
git commit -m "test: verify PUNCH landing experience

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If no tracked implementation file changed after verification, do not create an empty commit.

## Plan Self-Review

- **Spec coverage:** Tasks 1–5 cover positioning, narrative, dual audience, content guardrails, section architecture, direct payment, current plan, operating trust, disclosures, and CTA routes. Task 6 covers motion, accessibility, and responsive behavior. Task 7 covers Hallmark and browser QA.
- **Isolation:** Every commit names task files; unrelated existing uncommitted documents and pitch artifacts remain untouched.
- **Type consistency:** `LANDING_COPY` and `LANDING_LINKS` are defined once in Task 1 and consumed with unchanged names in Tasks 2–5. Section IDs match nav links and tests.
- **Testing:** Content regressions use pure Vitest tests; rendered structure uses React DOM server rendering in a `.test.ts` file compatible with current Vitest include rules. Browser checks cover behavior unavailable to node tests.
- **No scope expansion:** No backend, contract, auth, analytics, or campaign implementation is added. Existing signup routes are reused.
