# Cimientos de UX y cadena visible — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la capa de componentes de guía sobre `tokens.css` y hacer visible en la UI toda transacción de Arbitrum Sepolia que el usuario dispare.

**Architecture:** Componentes de presentación puros en `src/frontend/components/guide/`, sin consultas propias — reciben props. Un único `guide.css` importado en `src/app/(app)/layout.tsx` para que ambos shells (consumidor y workspace) compartan el mismo lenguaje visual. `ChainReceipt` envuelve el `TxHashLink` existente y expone el ciclo de vida completo de una transacción.

**Tech Stack:** Next.js App Router, React 19, TypeScript, vitest + happy-dom, Biome, CSS plano con tokens de `tokens.css`.

## Global Constraints

Copiadas del spec `docs/superpowers/specs/2026-08-11-ux-guiada-demo-design.md`. Aplican a **todas** las tareas:

- **Ninguna ruta cambia.** No se crean, fusionan, dividen ni renombran páginas en este plan.
- **Ningún hook, servicio ni consulta existente se modifica**, salvo exponer hashes que el relayer ya persiste.
- **Todo color, tipografía y espaciado sale de `tokens.css`.** Cero valores literales en CSS nuevo. Cero clases de shadcn (`text-muted-foreground`, `border-b`, `text-destructive`) en componentes nuevos.
- **Toda copia visible al usuario va en español**, tuteando, sin jerga técnica salvo cuando el concepto lo exige (`Arbitrum Sepolia`, hash).
- **Explorador:** `https://sepolia.arbiscan.io` vía `explorerTxUrl` de `src/config/explorer.ts`. Nunca se construye la URL a mano.
- **No se toca `assertLocalChain31337`** (`src/core/chain/server/bootstrap-local/historical-consumptions.ts:30`).
- **Nunca mainnet.**
- Los tests siguen la convención del repo: `// @vitest-environment happy-dom`, `createRoot` + `act` manual, `vi.mock` para hooks. Sin testing-library.
- Cada tarea termina con `pnpm check` y `pnpm typecheck` en verde antes del commit.

---

## Estructura de archivos

**Crear:**

| Archivo | Responsabilidad |
|---|---|
| `src/frontend/components/guide/guide.css` | Todas las clases de la capa de guía. Único lugar donde vive su CSS. |
| `src/frontend/components/guide/page-intro.tsx` | Encabezado de página: eyebrow, título, línea explicativa. |
| `src/frontend/components/guide/empty-state.tsx` | Vacío con causa y salida. |
| `src/frontend/components/guide/state-strip.tsx` | Tira de aviso: cadena, offline, datos guardados. |
| `src/frontend/components/guide/loading-state.tsx` | Skeleton con la forma del contenido. |
| `src/frontend/components/guide/error-state.tsx` | Error con reintento. |
| `src/frontend/components/guide/stat.tsx` | Cifra grande con etiqueta y pista. |
| `src/frontend/components/guide/chain-receipt.tsx` | Ciclo de vida de una transacción on-chain. |
| `src/frontend/components/nav/cafe-tabs.tsx` | Pestañas de la cafetería sobre rutas existentes. |

**Modificar:**

| Archivo | Cambio |
|---|---|
| `src/app/(app)/layout.tsx` | Importar `guide.css`. |
| `src/frontend/components/tx-hash-link.tsx` | Etiqueta de cadena + tipografía de marca. |
| `src/app/(app)/(workspace)/layout.tsx` | Rebrandear a tokens; montar `CafeTabs`. |
| `src/app/(app)/(consumer)/history/page.tsx` | Renderizar `transactionHash` por fila. |
| `src/core/consumption/client/ui/transaction-status.tsx` | Aceptar `txHash`. |

---

### Task 1: `PageIntro` y la hoja de estilos de la capa de guía

**Files:**
- Create: `src/frontend/components/guide/guide.css`
- Create: `src/frontend/components/guide/page-intro.tsx`
- Create: `src/frontend/components/guide/__tests__/page-intro.test.tsx`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: `PageIntro({ eyebrow?: string; title: string; explain?: string })`. Las tareas siguientes y los planes 2 y 3 lo usan como encabezado único de página.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/frontend/components/guide/__tests__/page-intro.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm vitest run src/frontend/components/guide/__tests__/page-intro.test.tsx`
Expected: FAIL — no se resuelve el módulo `../page-intro`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `src/frontend/components/guide/page-intro.tsx`:

```tsx
/**
 * Encabezado único de página. La línea `explain` traduce el concepto del
 * dominio a lenguaje humano: es obligatoria en toda página que nombre un
 * concepto propio de PUNCH (sello, fondo común, ruta, campaña).
 */
export function PageIntro({
    eyebrow,
    title,
    explain,
}: {
    eyebrow?: string;
    title: string;
    explain?: string;
}) {
    return (
        <div className="page-intro">
            {eyebrow ? <span className="consumer-eyebrow">{eyebrow}</span> : null}
            <h1 className="consumer-title page-intro__title">{title}</h1>
            {explain ? <p className="page-intro__explain">{explain}</p> : null}
        </div>
    );
}
```

- [ ] **Step 4: Crear la hoja de estilos de la capa**

Crear `src/frontend/components/guide/guide.css`:

```css
@import "../../../../tokens.css";

/* Capa de guía. Compartida por el shell de consumidor y el de workspace:
   un solo sistema de color, tipografía y espacio para los dos mundos. */

.page-intro {
    display: grid;
    gap: var(--space-2xs);
}
.page-intro__title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.05;
}
.page-intro__explain {
    margin: var(--space-3xs) 0 0;
    border-left: var(--rule-thick) solid var(--color-accent-wash);
    padding-left: var(--space-sm);
    color: var(--color-ink-2);
    font-size: var(--text-sm);
}

@media (min-width: 768px) {
    .page-intro__title {
        font-size: var(--text-2xl);
    }
}
```

`.consumer-eyebrow` y `.consumer-title` ya existen en `consumer-shell.css`; se duplican aquí para que el workspace, que no importa ese archivo, las tenga:

```css
.page-intro .consumer-eyebrow {
    color: var(--color-accent);
    font-family: var(--font-outlier);
    font-size: var(--text-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
}
.page-intro .consumer-title {
    font-family: var(--font-display);
    text-wrap: balance;
}
```

- [ ] **Step 5: Importar la hoja en el layout compartido**

En `src/app/(app)/layout.tsx`, añadir el import junto a los que ya existan:

```tsx
import "@/frontend/components/guide/guide.css";
```

- [ ] **Step 6: Ejecutar el test y verificar que pasa**

Run: `pnpm vitest run src/frontend/components/guide/__tests__/page-intro.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 7: Verificar tipos y estilo**

Run: `pnpm typecheck && pnpm check`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/frontend/components/guide/ src/app/\(app\)/layout.tsx
git commit -m "feat(guide): add PageIntro and the shared guide stylesheet"
```

---

### Task 2: `EmptyState` y `StateStrip`

**Files:**
- Create: `src/frontend/components/guide/empty-state.tsx`
- Create: `src/frontend/components/guide/state-strip.tsx`
- Create: `src/frontend/components/guide/__tests__/empty-state.test.tsx`
- Create: `src/frontend/components/guide/__tests__/state-strip.test.tsx`
- Modify: `src/frontend/components/guide/guide.css`

**Interfaces:**
- Consumes: `guide.css` de la Task 1.
- Produces:
  - `EmptyState({ mark?: string; title: string; cause: string; action?: { label: string; href: string } })`
  - `StateStrip({ tone: "chain" | "offline" | "saved"; children: React.ReactNode })`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/frontend/components/guide/__tests__/empty-state.test.tsx`:

```tsx
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
```

Crear `src/frontend/components/guide/__tests__/state-strip.test.tsx`:

```tsx
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
        await render(<StateStrip tone="chain">Confirmando en la cadena</StateStrip>);
        const strip = document.querySelector("[role='status']");
        expect(strip?.textContent).toContain("Confirmando en la cadena");
    });

    it("carries a modifier class per tone", async () => {
        await render(<StateStrip tone="offline">Sin conexión</StateStrip>);
        expect(document.querySelector(".state-strip--offline")).not.toBeNull();
    });
});
```

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `pnpm vitest run src/frontend/components/guide/__tests__/empty-state.test.tsx src/frontend/components/guide/__tests__/state-strip.test.tsx`
Expected: FAIL — no se resuelven `../empty-state` ni `../state-strip`.

- [ ] **Step 3: Escribir `EmptyState`**

Crear `src/frontend/components/guide/empty-state.tsx`:

```tsx
import Link from "next/link";

/**
 * Un vacío se explica por su causa y ofrece salida. «No hay datos» deja al
 * usuario sin siguiente paso; «las rutas nacen cuando hay 3 cafeterías cerca»
 * le enseña la mecánica del producto.
 */
export function EmptyState({
    mark,
    title,
    cause,
    action,
}: {
    mark?: string;
    title: string;
    cause: string;
    action?: { label: string; href: string };
}) {
    return (
        <div className="empty-state">
            {mark ? (
                <span className="empty-state__mark" aria-hidden="true">
                    {mark}
                </span>
            ) : null}
            <h3 className="empty-state__title">{title}</h3>
            <p className="empty-state__cause">{cause}</p>
            {action ? (
                <Link className="guide-btn guide-btn--ghost" href={action.href}>
                    {action.label}
                </Link>
            ) : null}
        </div>
    );
}
```

- [ ] **Step 4: Escribir `StateStrip`**

Crear `src/frontend/components/guide/state-strip.tsx`:

```tsx
import type { ReactNode } from "react";

export type StateStripTone = "chain" | "offline" | "saved";

/**
 * Tira de aviso de una línea. Reemplaza los <p> sueltos con estilo inline que
 * hoy anuncian estado de cadena y modo offline.
 */
export function StateStrip({
    tone,
    children,
}: {
    tone: StateStripTone;
    children: ReactNode;
}) {
    return (
        <p className={`state-strip state-strip--${tone}`} role="status">
            {children}
        </p>
    );
}
```

- [ ] **Step 5: Añadir el CSS**

Añadir al final de `src/frontend/components/guide/guide.css`:

```css
/* ── EmptyState ──────────────────────────────────────────────────── */
.empty-state {
    display: grid;
    justify-items: start;
    gap: var(--space-xs);
    border: var(--rule-hair) dashed var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-paper-3);
    padding: var(--space-lg) var(--space-md);
}
.empty-state__mark {
    font-size: var(--text-lg);
    line-height: 1;
}
.empty-state__title {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--text-md);
}
.empty-state__cause {
    margin: 0;
    color: var(--color-ink-2);
    font-size: var(--text-sm);
}

/* ── StateStrip ──────────────────────────────────────────────────── */
.state-strip {
    display: flex;
    align-items: center;
    gap: var(--space-xs);
    margin: 0;
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-paper-2);
    padding: var(--space-xs) var(--space-sm);
    font-family: var(--font-outlier);
    font-size: var(--text-xs);
    letter-spacing: 0.05em;
}
.state-strip--chain {
    border-color: var(--color-sun);
    background: color-mix(in srgb, var(--color-sun) 22%, var(--color-paper));
}
.state-strip--offline {
    border-color: var(--color-cafe-blue);
    background: color-mix(in srgb, var(--color-cafe-blue) 10%, var(--color-paper));
}

/* ── Botón de la capa de guía ────────────────────────────────────── */
.guide-btn {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    justify-content: center;
    gap: var(--space-2xs);
    border: var(--rule-thick) solid var(--color-ink);
    border-radius: var(--radius-sm);
    padding-inline: var(--space-md);
    color: var(--color-accent-ink);
    background: var(--color-accent);
    box-shadow: var(--shadow-print-sm);
    font: inherit;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
}
.guide-btn--ghost {
    color: var(--color-ink);
    background: var(--color-paper-3);
    box-shadow: none;
}
.guide-btn:disabled,
.guide-btn[aria-disabled="true"] {
    border-color: var(--color-rule);
    color: var(--color-muted);
    background: var(--color-paper-2);
    box-shadow: none;
    cursor: not-allowed;
}
```

- [ ] **Step 6: Ejecutar los tests y verificar que pasan**

Run: `pnpm vitest run src/frontend/components/guide/__tests__/empty-state.test.tsx src/frontend/components/guide/__tests__/state-strip.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 7: Verificar tipos y estilo**

Run: `pnpm typecheck && pnpm check`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/frontend/components/guide/
git commit -m "feat(guide): add EmptyState and StateStrip"
```

---

### Task 3: `LoadingState`, `ErrorState` y `Stat`

**Files:**
- Create: `src/frontend/components/guide/loading-state.tsx`
- Create: `src/frontend/components/guide/error-state.tsx`
- Create: `src/frontend/components/guide/stat.tsx`
- Create: `src/frontend/components/guide/__tests__/loading-error-stat.test.tsx`
- Modify: `src/frontend/components/guide/guide.css`

**Interfaces:**
- Consumes: `guide.css` de la Task 1, `.guide-btn` de la Task 2.
- Produces:
  - `LoadingState({ label: string; lines?: number })`
  - `ErrorState({ title: string; detail: string; onRetry?: () => void })`
  - `Stat({ label: string; value: string; hint?: string; lead?: boolean })`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/frontend/components/guide/__tests__/loading-error-stat.test.tsx`:

```tsx
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
        await render(<ErrorState title="No autorizado" detail="Solo operaciones." />);
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
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm vitest run src/frontend/components/guide/__tests__/loading-error-stat.test.tsx`
Expected: FAIL — no se resuelven los tres módulos.

- [ ] **Step 3: Escribir los tres componentes**

Crear `src/frontend/components/guide/loading-state.tsx`:

```tsx
/**
 * Skeleton con la forma del contenido que va a llegar. Un spinner centrado en
 * un contenedor vacío hace que la pantalla parezca rota mientras carga.
 */
export function LoadingState({
    label,
    lines = 3,
}: {
    label: string;
    lines?: number;
}) {
    return (
        <div className="guide-loading">
            <span className="sr-only" role="status">
                {label}
            </span>
            {Array.from({ length: lines }, (_, index) => (
                <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: purely decorative placeholder rows
                    key={index}
                    className="guide-skeleton"
                    aria-hidden="true"
                />
            ))}
        </div>
    );
}
```

Crear `src/frontend/components/guide/error-state.tsx`:

```tsx
export function ErrorState({
    title,
    detail,
    onRetry,
}: {
    title: string;
    detail: string;
    onRetry?: () => void;
}) {
    return (
        <div className="guide-error" role="alert">
            <b className="guide-error__title">{title}</b>
            <p className="guide-error__detail">{detail}</p>
            {onRetry ? (
                <button
                    className="guide-btn guide-btn--ghost"
                    type="button"
                    onClick={onRetry}
                >
                    Reintentar
                </button>
            ) : null}
        </div>
    );
}
```

Crear `src/frontend/components/guide/stat.tsx`:

```tsx
/**
 * Una cifra que importa se ve como cifra. El workspace escribe hoy sus totales
 * como párrafos, que se leen como prosa y no como dato.
 */
export function Stat({
    label,
    value,
    hint,
    lead = false,
}: {
    label: string;
    value: string;
    hint?: string;
    lead?: boolean;
}) {
    return (
        <div className={`guide-stat${lead ? " guide-stat--lead" : ""}`}>
            <span className="guide-stat__label">{label}</span>
            <span className="guide-stat__value">{value}</span>
            {hint ? <span className="guide-stat__hint">{hint}</span> : null}
        </div>
    );
}
```

- [ ] **Step 4: Añadir el CSS**

Añadir al final de `src/frontend/components/guide/guide.css`:

```css
/* ── LoadingState ────────────────────────────────────────────────── */
.guide-loading {
    display: grid;
    gap: var(--space-xs);
}
.guide-skeleton {
    display: block;
    height: 1.25rem;
    border-radius: var(--radius-xs);
    background: linear-gradient(
        90deg,
        var(--color-paper-2),
        var(--color-rule-2),
        var(--color-paper-2)
    );
    background-size: 200% 100%;
    animation: guide-shimmer 1.4s linear infinite;
}
.guide-skeleton:first-child {
    width: 40%;
}
.guide-skeleton:last-child {
    width: 70%;
}
@keyframes guide-shimmer {
    to {
        background-position: -200% 0;
    }
}
@media (prefers-reduced-motion: reduce) {
    .guide-skeleton {
        animation: none;
    }
}

/* ── ErrorState ──────────────────────────────────────────────────── */
.guide-error {
    display: grid;
    justify-items: start;
    gap: var(--space-xs);
    border: var(--rule-hair) solid var(--color-rule);
    border-left: var(--rule-thick) solid var(--color-accent);
    border-radius: var(--radius-sm);
    background: var(--color-paper-3);
    padding: var(--space-md);
}
.guide-error__title {
    font-weight: 700;
}
.guide-error__detail {
    margin: 0;
    color: var(--color-ink-2);
    font-size: var(--text-sm);
}

/* ── Stat ────────────────────────────────────────────────────────── */
.guide-stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
    gap: var(--space-sm);
}
.guide-stat {
    display: grid;
    gap: var(--space-3xs);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-paper-3);
    padding: var(--space-sm) var(--space-md);
    box-shadow: var(--shadow-print-sm);
}
.guide-stat--lead {
    border-color: var(--color-ink);
    background: var(--color-accent-wash);
}
.guide-stat__label {
    color: var(--color-accent);
    font-family: var(--font-outlier);
    font-size: var(--text-xs);
    letter-spacing: 0.09em;
    text-transform: uppercase;
}
.guide-stat__value {
    font-family: var(--font-display);
    font-size: var(--text-lg);
    font-weight: 700;
    line-height: 1;
    letter-spacing: -0.03em;
}
.guide-stat__hint {
    color: var(--color-ink-2);
    font-size: var(--text-sm);
}
```

- [ ] **Step 5: Verificar que `.sr-only` existe**

Run: `grep -rn "sr-only" src/app/globals.css`
Si no aparece, añadir a `guide.css`:

```css
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}
```

- [ ] **Step 6: Ejecutar el test y verificar que pasa**

Run: `pnpm vitest run src/frontend/components/guide/__tests__/loading-error-stat.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 7: Verificar tipos y estilo**

Run: `pnpm typecheck && pnpm check`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/frontend/components/guide/
git commit -m "feat(guide): add LoadingState, ErrorState and Stat"
```

---

### Task 4: `TxHashLink` con etiqueta de cadena

**Files:**
- Modify: `src/frontend/components/tx-hash-link.tsx`
- Create: `src/frontend/components/__tests__/tx-hash-link.test.tsx`
- Modify: `src/frontend/components/guide/guide.css`

**Interfaces:**
- Consumes: `explorerTxUrl` de `src/config/explorer.ts` (ya existe, sin cambios).
- Produces: `TxHashLink({ txHash: string; chainLabel?: string })`. `ChainReceipt` (Task 5) y la página de historial (Task 6) lo consumen.

Un jurado de Arbitrum tiene que leer la palabra «Arbitrum» en la fila, no solo un hash suelto. Hoy el componente renderiza el hash acortado con `underline` de Tailwind y nada más.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/frontend/components/__tests__/tx-hash-link.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { TxHashLink } from "../tx-hash-link";

const HASH =
    "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("TxHashLink", () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
    });

    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
    });

    it("links to the Arbitrum Sepolia explorer", async () => {
        await render(<TxHashLink txHash={HASH} />);
        const link = document.querySelector("a");
        expect(link?.getAttribute("href")).toBe(
            `https://sepolia.arbiscan.io/tx/${HASH}`,
        );
    });

    it("names the chain so the hash is not an anonymous string", async () => {
        await render(<TxHashLink txHash={HASH} />);
        expect(document.body.textContent).toContain("Arbitrum Sepolia");
    });

    it("opens in a new tab without leaking the referrer", async () => {
        await render(<TxHashLink txHash={HASH} />);
        const link = document.querySelector("a");
        expect(link?.getAttribute("target")).toBe("_blank");
        expect(link?.getAttribute("rel")).toContain("noopener");
    });

    it("falls back to plain text when the chain has no explorer", async () => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
        await render(<TxHashLink txHash={HASH} />);
        expect(document.querySelector("a")).toBeNull();
        expect(document.body.textContent).toContain("0x8f2ad4");
    });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm vitest run src/frontend/components/__tests__/tx-hash-link.test.tsx`
Expected: FAIL — el test de «names the chain» falla: el texto no contiene «Arbitrum Sepolia».

- [ ] **Step 3: Reescribir el componente**

Reemplazar el contenido de `src/frontend/components/tx-hash-link.tsx`:

```tsx
"use client";

import { explorerTxUrl } from "@/config/explorer";

function shorten(txHash: string): string {
    return `${txHash.slice(0, 8)}…${txHash.slice(-6)}`;
}

const chainLabels: Record<string, string> = {
    arbitrumSepolia: "Arbitrum Sepolia",
    local: "Cadena local",
};

/**
 * Renders a transaction hash, linking to the block explorer when the active
 * chain has one. Local Anvil runs fall back to plain text.
 *
 * The chain name travels with the hash on purpose: a bare hash reads as an
 * opaque string, while "Arbitrum Sepolia · 0x8f2a…" tells the reader what they
 * are about to verify and where.
 */
export function TxHashLink({
    txHash,
    chainLabel,
}: {
    txHash: string;
    chainLabel?: string;
}) {
    const href = explorerTxUrl(txHash);
    const label =
        chainLabel ??
        chainLabels[process.env.NEXT_PUBLIC_CHAIN_ENV ?? "local"] ??
        "Cadena";
    if (!href) return <span className="tx-link tx-link--plain">{shorten(txHash)}</span>;
    return (
        <a
            className="tx-link"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
        >
            <span className="tx-link__chain">{label}</span>
            {shorten(txHash)}
            <span aria-hidden="true">↗</span>
        </a>
    );
}
```

- [ ] **Step 4: Añadir el CSS**

Añadir al final de `src/frontend/components/guide/guide.css`:

```css
/* ── TxHashLink ──────────────────────────────────────────────────── */
.tx-link {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2xs);
    color: var(--color-cafe-blue-deep);
    font-family: var(--font-outlier);
    font-size: var(--text-xs);
    text-decoration: none;
}
.tx-link:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
}
.tx-link--plain {
    color: var(--color-muted);
}
.tx-link__chain {
    border: var(--rule-hair) solid currentColor;
    border-radius: var(--radius-full);
    padding-inline: var(--space-2xs);
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
}
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `pnpm vitest run src/frontend/components/__tests__/tx-hash-link.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 6: Verificar que no se rompió ningún consumidor existente**

Run: `grep -rn "TxHashLink" src --include="*.tsx" | grep -v __tests__`
Revisar cada uso: la firma solo ganó una prop opcional, así que ninguno debería romper. Ejecutar la suite completa para confirmarlo:

Run: `pnpm test`
Expected: PASS — sin regresiones.

- [ ] **Step 7: Verificar tipos y estilo**

Run: `pnpm typecheck && pnpm check`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/frontend/components/tx-hash-link.tsx src/frontend/components/__tests__/ src/frontend/components/guide/guide.css
git commit -m "feat(chain): name the chain alongside the tx hash"
```

---

### Task 5: `ChainReceipt` — el ciclo de vida de una transacción

**Files:**
- Create: `src/frontend/components/guide/chain-receipt.tsx`
- Create: `src/frontend/components/guide/__tests__/chain-receipt.test.tsx`
- Modify: `src/frontend/components/guide/guide.css`

**Interfaces:**
- Consumes: `TxHashLink` de la Task 4, `StateStrip` de la Task 2.
- Produces: `ChainReceipt({ state: ChainReceiptState; txHash?: string | null; blockNumber?: number | null; failureReason?: string | null; onRetry?: () => void })` con `type ChainReceiptState = "queued" | "submitted" | "confirmed" | "failed"`.

Este es el componente que cumple el requisito duro del spec: toda escritura on-chain que dispare el usuario enseña su transacción en la pantalla donde la disparó. Los planes 2 y 3 lo montan en compra, canje, entrega de canje y las tres operaciones de campaña.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/frontend/components/guide/__tests__/chain-receipt.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { ChainReceipt } from "../chain-receipt";

const HASH =
    "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function render(ui: React.ReactNode) {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(ui));
}

describe("ChainReceipt", () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
    });

    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
    });

    it("shows no link while the job is still queued", async () => {
        await render(<ChainReceipt state="queued" />);
        expect(document.querySelector("a")).toBeNull();
        expect(document.body.textContent).toContain("Preparando");
    });

    it("shows the explorer link as soon as the tx is submitted", async () => {
        await render(<ChainReceipt state="submitted" txHash={HASH} />);
        expect(document.querySelector("a")?.getAttribute("href")).toBe(
            `https://sepolia.arbiscan.io/tx/${HASH}`,
        );
        expect(document.body.textContent).toContain("Confirmando");
    });

    it("shows the block number once confirmed", async () => {
        await render(
            <ChainReceipt state="confirmed" txHash={HASH} blockNumber={9123456} />,
        );
        expect(document.body.textContent).toContain("9123456");
        expect(document.querySelector("a")).not.toBeNull();
    });

    it("explains the failure and offers a retry", async () => {
        const onRetry = vi.fn();
        await render(
            <ChainReceipt
                state="failed"
                failureReason="Fondos insuficientes del relayer"
                onRetry={onRetry}
            />,
        );
        expect(document.body.textContent).toContain("Fondos insuficientes");
        const button = document.querySelector("button");
        await act(async () => button?.click());
        expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it("survives a submitted state that has no hash yet", async () => {
        await render(<ChainReceipt state="submitted" txHash={null} />);
        expect(document.querySelector("a")).toBeNull();
        expect(document.body.textContent).toContain("Confirmando");
    });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `pnpm vitest run src/frontend/components/guide/__tests__/chain-receipt.test.tsx`
Expected: FAIL — no se resuelve `../chain-receipt`.

- [ ] **Step 3: Escribir el componente**

Crear `src/frontend/components/guide/chain-receipt.tsx`:

```tsx
"use client";

import { TxHashLink } from "@/frontend/components/tx-hash-link";

export type ChainReceiptState = "queued" | "submitted" | "confirmed" | "failed";

const copy: Record<ChainReceiptState, { label: string; hint: string }> = {
    queued: {
        label: "Preparando la operación",
        hint: "Se está firmando y encolando.",
    },
    submitted: {
        label: "Confirmando en la cadena",
        hint: "Ya está enviada. Suele tardar unos segundos.",
    },
    confirmed: {
        label: "Confirmado en Arbitrum",
        hint: "Queda escrito. Nadie puede borrarlo, ni nosotros.",
    },
    failed: {
        label: "No se pudo escribir en la cadena",
        hint: "Nada se cobró ni se descontó.",
    },
};

/**
 * Muestra el ciclo de vida completo de una escritura on-chain en la pantalla
 * donde el usuario la disparó. La espera se ve como progreso con su hash, no
 * como un cuelgue: en cuanto la transacción se envía, el enlace al explorador
 * ya funciona aunque todavía no esté confirmada.
 */
export function ChainReceipt({
    state,
    txHash,
    blockNumber,
    failureReason,
    onRetry,
}: {
    state: ChainReceiptState;
    txHash?: string | null;
    blockNumber?: number | null;
    failureReason?: string | null;
    onRetry?: () => void;
}) {
    const { label, hint } = copy[state];
    return (
        <div className={`chain-receipt chain-receipt--${state}`} role="status">
            <div className="chain-receipt__head">
                <span className="chain-receipt__label">{label}</span>
                {txHash ? <TxHashLink txHash={txHash} /> : null}
            </div>
            <p className="chain-receipt__hint">
                {state === "failed" && failureReason ? failureReason : hint}
            </p>
            {state === "confirmed" && blockNumber ? (
                <p className="chain-receipt__block">Bloque {blockNumber}</p>
            ) : null}
            {state === "failed" && onRetry ? (
                <button
                    className="guide-btn guide-btn--ghost"
                    type="button"
                    onClick={onRetry}
                >
                    Reintentar
                </button>
            ) : null}
        </div>
    );
}
```

- [ ] **Step 4: Añadir el CSS**

Añadir al final de `src/frontend/components/guide/guide.css`:

```css
/* ── ChainReceipt ────────────────────────────────────────────────── */
.chain-receipt {
    display: grid;
    justify-items: start;
    gap: var(--space-2xs);
    border: var(--rule-hair) solid var(--color-rule);
    border-radius: var(--radius-sm);
    background: var(--color-paper-3);
    padding: var(--space-sm) var(--space-md);
}
.chain-receipt__head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-xs);
}
.chain-receipt__label {
    font-family: var(--font-outlier);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
}
.chain-receipt__hint,
.chain-receipt__block {
    margin: 0;
    color: var(--color-ink-2);
    font-size: var(--text-sm);
}
.chain-receipt__block {
    font-family: var(--font-outlier);
    font-size: var(--text-xs);
}
.chain-receipt--submitted {
    border-color: var(--color-sun);
    background: color-mix(in srgb, var(--color-sun) 18%, var(--color-paper));
}
.chain-receipt--confirmed {
    border-color: var(--color-ink);
    background: var(--color-accent-wash);
}
.chain-receipt--failed {
    border-left: var(--rule-thick) solid var(--color-accent);
}
```

- [ ] **Step 5: Ejecutar el test y verificar que pasa**

Run: `pnpm vitest run src/frontend/components/guide/__tests__/chain-receipt.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 6: Verificar tipos y estilo**

Run: `pnpm typecheck && pnpm check`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/frontend/components/guide/
git commit -m "feat(chain): add ChainReceipt for on-chain write lifecycle"
```

---

### Task 6: `TransactionStatus` acepta el hash

**Files:**
- Modify: `src/core/consumption/client/ui/transaction-status.tsx`
- Modify: `src/core/consumption/client/ui/__tests__/transaction-status.test.tsx`

**Interfaces:**
- Consumes: `TxHashLink` de la Task 4.
- Produces: `TransactionStatus` con una prop nueva opcional `txHash?: string | null`. La firma existente no cambia, así que sus consumidores actuales siguen compilando.

- [ ] **Step 1: Leer el test existente antes de tocarlo**

Run: `cat src/core/consumption/client/ui/__tests__/transaction-status.test.tsx`

Entender qué cubre ya. No borrar ninguno de sus casos: se añaden dos.

- [ ] **Step 2: Añadir los tests que fallan**

Añadir al `describe` existente de `src/core/consumption/client/ui/__tests__/transaction-status.test.tsx`:

```tsx
    it("links the transaction when a hash is available", async () => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
        await renderStatus(
            <TransactionStatus
                status="confirmed"
                txHash="0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92"
            />,
        );
        expect(document.querySelector("a")?.getAttribute("href")).toContain(
            "sepolia.arbiscan.io/tx/0x8f2ad41c",
        );
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
    });

    it("renders without a link when no hash exists yet", async () => {
        await renderStatus(<TransactionStatus status="pending" />);
        expect(document.querySelector("a")).toBeNull();
    });
```

Si el archivo de test no tiene un helper `renderStatus`, usar el mismo patrón `createRoot` + `act` de las tareas anteriores, adaptado al helper que ya exista en ese archivo.

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `pnpm vitest run src/core/consumption/client/ui/__tests__/transaction-status.test.tsx`
Expected: FAIL — el primer test nuevo no encuentra ningún `<a>`.

- [ ] **Step 4: Añadir la prop al componente**

En `src/core/consumption/client/ui/transaction-status.tsx`, ampliar la firma de `TransactionStatus` y renderizar el enlace. **No tocar `transactionStatusCopy`** — su tabla de estados sigue igual:

```tsx
export function TransactionStatus({
    status,
    rejectionReason,
    txHash,
    onRetry,
}: {
    status: UiTransactionState;
    rejectionReason?: string;
    txHash?: string | null;
    onRetry?: () => void;
}) {
```

Dentro del bloque `transaction-status__copy`, después del `<span>` del hint existente, añadir:

```tsx
                {txHash ? <TxHashLink txHash={txHash} /> : null}
```

Y el import al inicio del archivo:

```tsx
import { TxHashLink } from "@/frontend/components/tx-hash-link";
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `pnpm vitest run src/core/consumption/client/ui/__tests__/transaction-status.test.tsx`
Expected: PASS — los casos existentes más los 2 nuevos.

- [ ] **Step 6: Verificar tipos y estilo**

Run: `pnpm typecheck && pnpm check`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/core/consumption/client/ui/
git commit -m "feat(chain): surface tx hash from TransactionStatus"
```

---

### Task 7: Enlace a Arbitrum por fila del historial

**Files:**
- Modify: `src/app/(app)/(consumer)/history/page.tsx`
- Create: `src/app/(app)/(consumer)/history/__tests__/history-page.test.tsx`

**Interfaces:**
- Consumes: `TxHashLink` de la Task 4, `PageIntro` de la Task 1, `StateStrip` de la Task 2, `LoadingState` y `ErrorState` de la Task 3.
- Produces: nada que consuman otras tareas.

`list-history-service.ts:98` ya devuelve `transactionHash` en cada fila y la página lo descarta. Esta tarea solo lo renderiza — sin cambios de backend.

- [ ] **Step 1: Confirmar que el campo llega al cliente**

Run: `grep -n "transactionHash" src/core/consumption/server/services/list-history-service.ts src/core/consumption/domain/types.ts`
Expected: aparece en el servicio. Si el tipo de dominio que consume el cliente **no** lo declara, añadirlo ahí como `transactionHash: string | null` — es el único cambio de tipo autorizado en esta tarea.

- [ ] **Step 2: Escribir el test que falla**

Crear `src/app/(app)/(consumer)/history/__tests__/history-page.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const useHistory = vi.fn();
vi.mock("@/core/consumption/client/hooks", () => ({
    useHistory: () => useHistory(),
}));
vi.mock("@/frontend/auth/auth", () => ({
    authClient: { useSession: () => ({ data: { user: { id: "u1" } } }) },
}));

import HistoryPage from "../page";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function renderPage() {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(<HistoryPage />));
}

const confirmedEntry = {
    id: "h1",
    operation: "emission",
    status: "confirmed",
    cafeName: "Brújula Café",
    productName: "Latte",
    campaignName: null,
    crawlName: null,
    rejectionReason: null,
    createdAt: "2026-08-11T14:14:00.000Z",
    transactionHash:
        "0x8f2ad41c00000000000000000000000000000000000000000000000000e07b92",
};

describe("HistoryPage", () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_CHAIN_ENV = "arbitrumSepolia";
    });

    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        vi.clearAllMocks();
        process.env.NEXT_PUBLIC_CHAIN_ENV = "local";
    });

    it("links each confirmed row to its Arbitrum transaction", async () => {
        useHistory.mockReturnValue({
            data: [confirmedEntry],
            isPending: false,
            isError: false,
        });
        await renderPage();
        const link = document.querySelector("a[href*='arbiscan']");
        expect(link?.getAttribute("href")).toBe(
            `https://sepolia.arbiscan.io/tx/${confirmedEntry.transactionHash}`,
        );
    });

    it("says it is waiting instead of rendering a dead link", async () => {
        useHistory.mockReturnValue({
            data: [{ ...confirmedEntry, status: "pending", transactionHash: null }],
            isPending: false,
            isError: false,
        });
        await renderPage();
        expect(document.querySelector("a[href*='arbiscan']")).toBeNull();
        expect(document.body.textContent).toContain("Esperando confirmación");
    });

    it("shows an empty state that explains how activity appears", async () => {
        useHistory.mockReturnValue({
            data: [],
            isPending: false,
            isError: false,
        });
        await renderPage();
        expect(document.body.textContent).toContain("Escanea");
    });
});
```

- [ ] **Step 3: Ejecutar y verificar que falla**

Run: `pnpm vitest run "src/app/(app)/(consumer)/history/__tests__/history-page.test.tsx"`
Expected: FAIL — no hay ningún enlace a arbiscan.

- [ ] **Step 4: Reescribir el cuerpo de la página**

En `src/app/(app)/(consumer)/history/page.tsx`:

Añadir imports:

```tsx
import { ErrorState } from "@/frontend/components/guide/error-state";
import { EmptyState } from "@/frontend/components/guide/empty-state";
import { LoadingState } from "@/frontend/components/guide/loading-state";
import { PageIntro } from "@/frontend/components/guide/page-intro";
import { StateStrip } from "@/frontend/components/guide/state-strip";
import { TxHashLink } from "@/frontend/components/tx-hash-link";
```

Añadir `transactionHash: string | null` al tipo `HistoryEntry` y al tipo inline de `entries`.

Reemplazar el bloque de carga:

```tsx
    if (query.isPending)
        return <LoadingState label="Cargando tu historial" lines={4} />;
```

Reemplazar el bloque de error:

```tsx
    if (query.isError && !savedEntries)
        return (
            <ErrorState
                title="No pudimos traer tu historial"
                detail="Tus operaciones siguen escritas en la cadena; esto es solo la vista."
                onRetry={() => query.refetch()}
            />
        );
```

Reemplazar el aviso de datos guardados:

```tsx
            {savedEntries && !query.data && (
                <StateStrip tone="saved">
                    Datos guardados · Conéctate para actualizar
                </StateStrip>
            )}
```

Reemplazar el encabezado:

```tsx
            <PageIntro
                eyebrow="Tu recorrido"
                title="Historial"
                explain="Cada línea existe en la cadena. Ni la cafetería ni PUNCH pueden cambiarla después."
            />
```

Reemplazar el estado vacío:

```tsx
            {entries.length === 0 ? (
                <EmptyState
                    mark="☕"
                    title="Todavía no tienes actividad"
                    cause="Escanea el código que te dé el barista en tu próxima compra y aparecerá aquí."
                    action={{ label: "Descubrir cafeterías", href: "/discover" }}
                />
            ) : (
```

Dentro del `map` de cada entrada, después del `<p>` de la fecha, añadir el recibo de cadena:

```tsx
                            {entry.transactionHash ? (
                                <TxHashLink txHash={entry.transactionHash} />
                            ) : entry.status === "pending" ? (
                                <span className="tx-link tx-link--plain">
                                    Esperando confirmación en la cadena…
                                </span>
                            ) : null}
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `pnpm vitest run "src/app/(app)/(consumer)/history/__tests__/history-page.test.tsx"`
Expected: PASS — 3 tests.

- [ ] **Step 6: Ejecutar la suite completa**

Run: `pnpm test`
Expected: PASS — sin regresiones.

- [ ] **Step 7: Verificar tipos y estilo**

Run: `pnpm typecheck && pnpm check`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/(consumer)/history/"
git commit -m "feat(history): link every confirmed row to its Arbitrum tx"
```

---

### Task 8: Shell del workspace con marca y pestañas de cafetería

**Files:**
- Create: `src/frontend/components/nav/cafe-tabs.tsx`
- Create: `src/frontend/components/nav/__tests__/cafe-tabs.test.tsx`
- Modify: `src/app/(app)/(workspace)/layout.tsx`
- Modify: `src/frontend/components/guide/guide.css`

**Interfaces:**
- Consumes: `guide.css`.
- Produces: `CafeTabs({ cafeId: string })`. El plan 3 lo asume montado en el layout del workspace.

**Ninguna ruta se crea.** Las cinco pestañas apuntan a rutas que ya existen; hoy están escondidas detrás de botones dentro del cuerpo de la página (`cafe/[cafeId]/page.tsx:243`).

- [ ] **Step 1: Escribir el test que falla**

Crear `src/frontend/components/nav/__tests__/cafe-tabs.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const usePathname = vi.fn();
vi.mock("next/navigation", () => ({
    usePathname: () => usePathname(),
}));

import { CafeTabs } from "../cafe-tabs";

let renderedRoot: ReturnType<typeof createRoot> | undefined;

async function renderTabs(cafeId = "cafe-1") {
    document.body.innerHTML = "";
    renderedRoot = createRoot(document.body);
    await act(async () => renderedRoot?.render(<CafeTabs cafeId={cafeId} />));
}

describe("CafeTabs", () => {
    afterEach(() => {
        act(() => renderedRoot?.unmount());
        renderedRoot = undefined;
        document.body.innerHTML = "";
        vi.clearAllMocks();
    });

    it("points every tab at a route that already exists", async () => {
        usePathname.mockReturnValue("/cafe/cafe-1");
        await renderTabs();
        const hrefs = [...document.querySelectorAll("a")].map((a) =>
            a.getAttribute("href"),
        );
        expect(hrefs).toEqual([
            "/cafe/cafe-1",
            "/cafe/cafe-1/terminal",
            "/cafe/cafe-1/redemptions",
            "/cafe/cafe-1/campaigns",
            "/cafe/cafe-1/plan",
        ]);
    });

    it("marks the active tab for assistive tech", async () => {
        usePathname.mockReturnValue("/cafe/cafe-1/terminal");
        await renderTabs();
        const current = document.querySelector("[aria-current='page']");
        expect(current?.getAttribute("href")).toBe("/cafe/cafe-1/terminal");
    });

    it("does not mark the summary tab active on a child route", async () => {
        usePathname.mockReturnValue("/cafe/cafe-1/plan");
        await renderTabs();
        const currents = [...document.querySelectorAll("[aria-current='page']")];
        expect(currents.length).toBe(1);
        expect(currents[0]?.getAttribute("href")).toBe("/cafe/cafe-1/plan");
    });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `pnpm vitest run src/frontend/components/nav/__tests__/cafe-tabs.test.tsx`
Expected: FAIL — no se resuelve `../cafe-tabs`.

- [ ] **Step 3: Escribir el componente**

Crear `src/frontend/components/nav/cafe-tabs.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Pestañas de la cafetería. Todas las rutas ya existen: esto solo deja de
 * esconderlas detrás de botones dentro del cuerpo del panel.
 */
export function CafeTabs({ cafeId }: { cafeId: string }) {
    const pathname = usePathname();
    const base = `/cafe/${cafeId}`;
    const tabs = [
        { href: base, label: "Resumen" },
        { href: `${base}/terminal`, label: "Terminal" },
        { href: `${base}/redemptions`, label: "Canjes" },
        { href: `${base}/campaigns`, label: "Campañas" },
        { href: `${base}/plan`, label: "Plan" },
    ];
    return (
        <nav className="ws-tabs" aria-label="Secciones de la cafetería">
            {tabs.map((tab) => (
                <Link
                    key={tab.href}
                    href={tab.href}
                    className="ws-tabs__link"
                    aria-current={pathname === tab.href ? "page" : undefined}
                >
                    {tab.label}
                </Link>
            ))}
        </nav>
    );
}
```

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `pnpm vitest run src/frontend/components/nav/__tests__/cafe-tabs.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Rebrandear el shell del workspace**

Reemplazar el contenido de `src/app/(app)/(workspace)/layout.tsx`. Se conserva `requireAuth()` y el enlace a Ops condicionado por `user.isOps` — solo cambian las clases y la estructura:

```tsx
import Link from "next/link";
import type { PropsWithChildren } from "react";
import { SignOutButton } from "@/frontend/components/auth/sign-out-button";
import { requireAuth } from "@/server/auth/require-auth";

export default async function WorkspaceLayout({ children }: PropsWithChildren) {
    const { user } = await requireAuth();
    return (
        <div className="ws-shell">
            <header className="ws-header">
                <div className="ws-header__brand">
                    <b>PUNCH</b>
                    <span>Red de cafeterías</span>
                </div>
                <nav className="ws-header__nav" aria-label="Navegación principal">
                    <Link href="/cafe">Cafés</Link>
                    <Link href="/discover">Descubrir</Link>
                    {user.isOps ? <Link href="/ops">Ops</Link> : null}
                </nav>
                <div className="ws-header__meta">
                    <span>{user.email}</span>
                    <SignOutButton />
                </div>
            </header>
            <main className="ws-main">{children}</main>
        </div>
    );
}
```

`CafeTabs` no se monta aquí: este layout cubre también `/cafe` y `/ops`, que no pertenecen a una cafetería concreta. Lo monta el plan 3 en las páginas bajo `/cafe/[cafeId]`, donde el `cafeId` existe.

- [ ] **Step 6: Añadir el CSS del shell**

Añadir al final de `src/frontend/components/guide/guide.css`:

```css
/* ── Shell del workspace ─────────────────────────────────────────── */
.ws-shell {
    min-height: 100svh;
    color: var(--color-ink);
    background: var(--color-paper);
    font-family: var(--font-body);
    line-height: 1.5;
}
.ws-shell :focus-visible {
    outline: 3px solid var(--color-focus);
    outline-offset: 3px;
}
.ws-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-md);
    border-bottom: var(--rule-thick) solid var(--color-ink);
    padding: var(--space-sm) var(--page-gutter);
}
.ws-header__brand {
    display: flex;
    align-items: baseline;
    gap: var(--space-sm);
}
.ws-header__brand b {
    font-family: var(--font-display);
    font-size: var(--text-md);
    letter-spacing: -0.04em;
}
.ws-header__brand span {
    color: var(--color-muted);
    font-family: var(--font-outlier);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}
.ws-header__nav {
    display: flex;
    gap: var(--space-md);
    font-size: var(--text-sm);
    font-weight: 600;
}
.ws-header__nav a {
    color: var(--color-ink-2);
    text-decoration: none;
}
.ws-header__nav a:hover {
    color: var(--color-accent);
}
.ws-header__meta {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    margin-inline-start: auto;
    color: var(--color-muted);
    font-size: var(--text-sm);
}
.ws-main {
    width: min(100% - 2rem, 72rem);
    margin-inline: auto;
    padding: var(--space-lg) 0 var(--space-xl);
    display: grid;
    gap: var(--space-md);
    align-content: start;
}

/* ── Pestañas de cafetería ───────────────────────────────────────── */
.ws-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3xs);
    border-bottom: var(--rule-hair) solid var(--color-rule);
}
.ws-tabs__link {
    min-height: 2.75rem;
    display: inline-flex;
    align-items: center;
    border-bottom: 3px solid transparent;
    padding: var(--space-xs) var(--space-sm);
    color: var(--color-ink-2);
    font-size: var(--text-sm);
    font-weight: 600;
    text-decoration: none;
}
.ws-tabs__link[aria-current="page"] {
    border-bottom-color: var(--color-accent);
    color: var(--color-ink);
}
```

- [ ] **Step 7: Verificar a ojo que el workspace ya no usa clases de shadcn**

Run: `grep -n "text-muted-foreground\|border-b\|text-destructive" "src/app/(app)/(workspace)/layout.tsx"`
Expected: sin resultados.

- [ ] **Step 8: Ejecutar la suite completa**

Run: `pnpm test`
Expected: PASS — sin regresiones. Si algún test del workspace fallaba por buscar clases viejas, se ajusta el test: el cambio es visual y deliberado.

- [ ] **Step 9: Verificar tipos y estilo**

Run: `pnpm typecheck && pnpm check`
Expected: sin errores.

- [ ] **Step 10: Commit**

```bash
git add src/frontend/components/nav/ "src/app/(app)/(workspace)/layout.tsx" src/frontend/components/guide/guide.css
git commit -m "feat(workspace): rebrand shell to design tokens and add cafe tabs"
```

---

### Task 9: Verificación manual contra Arbitrum Sepolia

**Files:** ninguno. Esta tarea produce evidencia, no código.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: la confirmación de que el requisito central del spec se cumple de verdad.

El spec es explícito: ninguna afirmación de «funciona» sin haber abierto los enlaces de arbiscan. Un test unitario que compara una cadena de texto **no** prueba que la transacción exista.

- [ ] **Step 1: Levantar la aplicación contra Sepolia**

Confirmar en `.env`:

```
CHAIN_ENV=arbitrumSepolia
NEXT_PUBLIC_CHAIN_ENV=arbitrumSepolia
CONSUMER_CHAIN_MODE=local
```

Run: `pnpm dev`

- [ ] **Step 2: Entrar como consumidor con historial existente**

Iniciar sesión como `demo-consumer@punch.pe` y abrir `/history`.

- [ ] **Step 3: Abrir cada enlace de la lista**

Para cada fila confirmada, hacer clic en el enlace de transacción. Cada uno debe abrir `sepolia.arbiscan.io` en una pestaña nueva y mostrar una transacción **que existe**, no una página de «not found».

Expected: cada enlace resuelve a una transacción real.

- [ ] **Step 4: Documentar el resultado**

Anotar en el mensaje de commit —o en el reporte al revisor— cuántas filas se comprobaron y si alguna abrió vacía. Si alguna abre vacía, **no** se cierra este plan: significa que el hash guardado no corresponde a una transacción de esta cadena, y eso es un fallo real que hay que investigar antes de seguir.

- [ ] **Step 5: Verificar el workspace**

Entrar como `brujula@punch.pe`, confirmar que el shell usa papel y tinta de la marca y que las pestañas navegan a las cinco rutas sin 404.

- [ ] **Step 6: Commit del estado verificado**

```bash
git commit --allow-empty -m "chore(verify): confirm history tx links resolve on Arbitrum Sepolia"
```

---

## Auto-revisión del plan

**Cobertura del spec.** Este plan implementa §4.1 (capa de guía: `PageIntro`, `EmptyState`, `StateStrip`, `LoadingState`, `ErrorState`, `Stat`), §4.4 completo (`ChainReceipt`, `TxHashLink` con etiqueta, historial con enlace por fila, `TransactionStatus` con hash) y §4.6 en su parte de shell (rebrand del workspace y pestañas).

Queda **fuera de este plan y asignado explícitamente** a los siguientes:

- §4.2 `useDemoJourney`, `JourneyCard`, regla de acción bloqueada → **plan 2**
- §4.3 `DemoBar`, cambio de rol, entrada por `/auth`, eliminación del redirect forzado de `/home` → **plan 2**
- §5 pase por las 22 páginas, incluido montar `ChainReceipt` en compra, canje, entrega y campañas, y montar `CafeTabs` bajo `/cafe/[cafeId]` → **plan 3**
- §4.5 pre-minteo de los 11 sellos en Arbitrum Sepolia → **plan 4**

`NextStep` (§4.1) se construye en el plan 2 junto a `JourneyCard`, porque las dos comparten el marcador «solo demo» y conviene diseñarlas juntas.

**Consistencia de tipos.** `TxHashLink` recibe `txHash: string` y opcionalmente `chainLabel`; `ChainReceipt` y el historial lo llaman con esa firma. `ChainReceiptState` se define en la Task 5 y ninguna tarea anterior lo referencia. `StateStrip` acepta `tone: "chain" | "offline" | "saved"`; la Task 7 usa `"saved"`, que está en la unión. `.guide-btn` se define en la Task 2 y lo usan las Tasks 3 y 5 — el orden de tareas lo garantiza.

**Sin placeholders.** Todo paso de código lleva el código real. Las dos incógnitas se resuelven con un comando de inspección antes de actuar, no con una suposición: si `.sr-only` ya existe (Task 3, Step 5) y si el tipo de dominio del historial declara `transactionHash` (Task 7, Step 1).
