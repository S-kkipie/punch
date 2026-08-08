# PUNCH Landing Page Design

**Date:** 2026-08-07  
**Status:** Design approved; written spec awaiting review  
**Source of truth:** `docs/superpowers/specs/2026-08-07-punch-master-spec.md`, refined by the approved positioning decisions recorded here

## 1. Goal

Create a Spanish-language landing page that explains PUNCH through the structural problem it solves: independent cafés compete individually while chains benefit from coordinated reach, retention, and shared network effects.

The page must convert two audiences:

1. **Primary:** independent café owners considering network membership.
2. **Secondary:** consumers who want to discover and use the network.

The page must preserve each café's independence as part of the product promise. PUNCH helps independent cafés move demand like a chain without asking them to look or operate like one.

## 2. Positioning

### Core problem

Independent cafés acquire and retain customers alone. Large chains coordinate multiple locations, shared reach, customer data, and repeat visits across a network. This creates a structural disadvantage that product quality alone does not solve.

### Core solution

PUNCH connects independent cafés into a shared demand network. The network attracts visits, makes returns measurable, and lets customer benefits travel across participating cafés. Each café keeps its brand, margin, direct payment relationship, and operating identity.

### Hero thesis

> No necesitas parecer cadena. Necesitas mover clientes como una.

Supporting copy:

> PUNCH conecta visitas entre cafés independientes. Cada local conserva su identidad; toda la red gana alcance.

### Messaging hierarchy

1. Structural problem: cafés compete alone; chains compete as networks.
2. Coalition solution: PUNCH creates shared demand and measurable returns.
3. Café outcome: greater reach without surrendering identity or direct customer relationships.
4. Consumer outcome: discover independent cafés and receive benefits across the network.
5. Operating trust: direct payments, prefunded reserves, and verifiable state.
6. Product mechanics and current commercial terms.

Redemption thresholds, PUNCH quantities, payouts, and campaign conditions are operational parameters. They may be explained where necessary, but must not function as the brand promise or dominate the hero. Copy must not imply that a particular threshold is permanent.

## 3. Visual Direction

### Concept: “Visitas en movimiento — Light”

The page uses a warm, editorial visual system centered on real cafés, real people, and visible movement between them.

- Warm cream background dominates.
- Warm charcoal provides structure and typography.
- Stamp red represents action and movement.
- Sun yellow adds energy and optimism.
- Café blue provides secondary depth.
- Existing Fraunces, IBM Plex Sans, and JetBrains Mono fonts remain.
- Bright café and customer photography appears in layered, slightly rotated editorial frames.
- Dotted routes connect people, cafés, and sections as a recurring network motif.
- Solid print-like borders and shadows preserve the tactile “cartón perforado, tinta de sello, mostrador de barrio” identity.

The system must avoid generic SaaS gradients, glassmorphism, interchangeable feature-card grids, floating icon decoration, and blockchain-first imagery.

### Motion

Motion reinforces travel through the network:

- route lines draw as sections enter view;
- collage frames enter with small positional offsets;
- tickers move slowly where they add rhythm;
- navigation transitions remain subtle;
- all motion respects `prefers-reduced-motion`.

No animation may block reading, trigger layout shifts, or become necessary for understanding content.

## 4. Page Narrative

### 4.1 Navigation

Navigation includes:

- PUNCH wordmark;
- `Cómo funciona`;
- `Para tu café`;
- `Modelo`;
- primary CTA: `Sumar mi café`.

A compact disclosure identifies the experience as a simulated Arbitrum Sepolia demo. It must remain visible enough to prevent confusion but must not dominate the page.

### 4.2 Hero: the problem

The hero presents the approved thesis and supporting copy. A luminous café photograph, customer portrait, and dotted route make demand movement tangible.

Actions:

- primary: `Quiero sumar mi café`;
- secondary: `Explorar la red`.

The hero must not lead with a redemption threshold, token quantity, payout, plan breakdown, blockchain terminology, or speculative metrics.

### 4.3 Structural disadvantage

A visual comparison shows:

- isolated café: limited acquisition, enclosed loyalty, and reduced reach;
- chain: multiple doors, coordinated return, and shared customer understanding;
- coalition: independent identities connected through shared demand.

The section must not frame another independent café as the enemy.

### 4.4 PUNCH solution

A concise sequence explains the product at a stable level:

1. the network creates discovery;
2. the customer visits and pays the café directly;
3. the café delivers its own experience;
4. PUNCH records eligible participation and supports the return loop;
5. the customer can continue through the network.

Any displayed campaign or redemption rule must be described as configurable, not permanent brand identity.

### 4.5 Network in motion

A map or editorial collage connects participating cafés through a customer route:

> Descubre → visita → regresa.

This section makes the coalition visible and leads with outcomes:

- paid visits;
- measurable returns;
- broader network reach.

### 4.6 Value for cafés

The café section communicates:

- more reach through the coalition;
- shared demand rather than isolated acquisition;
- direct customer-to-café payment through Yape;
- preserved brand, margin, and customer relationship;
- current membership offer, including the S/49 monthly plan, as commercial detail rather than hero message.

The plan explanation must follow the current master spec. It must not revive discarded campaign-fee or free-forever models.

### 4.7 Operating trust

A technical-but-readable section explains:

- rewards are prefunded rather than issued as unfunded debt;
- relevant states are verifiable;
- the consumer does not need to understand blockchain;
- `Arbitrum manda. Postgres proyecta.` appears here, not as the primary headline.

The section must visually and verbally separate PUNCH from campaign vouchers.

### 4.8 Consumer door

A smaller consumer-focused section invites people to:

- discover independent cafés;
- participate in the network;
- earn and use network benefits under active rules.

Consumer copy must never present PUNCH as cash, an investment, a transferable asset, a withdrawable balance, or a fixed monetary unit.

### 4.9 Dual final CTA

The final conversion section has two distinct doors:

- primary: `Quiero sumar mi café`;
- secondary: `Quiero descubrir la red`.

The café path receives greater visual weight.

### 4.10 Footer

The footer includes:

- Lima, Perú as initial market;
- simulated-demo disclosure;
- note that campaign and redemption conditions can vary under active network rules;
- product/legal links when routes exist;
- no fictional simulation result presented as market traction.

## 5. Component Architecture

```text
PunchLanding
├── LandingNav
├── HeroNetwork
├── StructuralProblem
├── PunchSolution
├── NetworkJourney
├── CafeValue
├── OperatingTrust
├── ConsumerDoor
├── DualCTA
└── LandingFooter
```

Each component owns one narrative job and exposes no unnecessary shared state. Section copy remains close to the component that renders it unless an existing content pattern provides a better source.

Implementation constraints:

- preserve `.pnch` style scoping so landing styles do not affect the authenticated app;
- extend the existing root `tokens.css` rather than introducing hardcoded visual values;
- reuse the existing three-font setup;
- keep the landing modular instead of expanding a single monolithic component;
- retain existing working landing code where it matches this design and replace only contradictory content or structure;
- do not overwrite unrelated uncommitted files.

## 6. Interaction and Failure Behavior

The page is readable and navigable without client-side JavaScript. JavaScript may enhance the mobile menu, dismissible disclosure, scroll-aware navigation, and motion.

- Anchor navigation lands on the correct section without hiding headings under the sticky header.
- Mobile navigation exposes an accessible open state and closes after selection.
- CTAs use real destinations. If onboarding is not implemented, they use one explicit waitlist/contact destination rather than dead links.
- Image containers retain layout and a branded fallback if an asset fails.
- The page makes no runtime request to an external service merely to render core content.
- Animation failure does not hide content.

## 7. Accessibility

- WCAG AA contrast for text and controls.
- Semantic `header`, `nav`, `main`, `section`, and `footer` landmarks.
- One `h1`; logical heading order thereafter.
- Visible keyboard focus.
- Interactive targets at least 44×44 CSS pixels where practical.
- Accessible mobile menu state and labels.
- Decorative images use empty alt text; meaningful images use concise descriptive alt text.
- `prefers-reduced-motion` disables nonessential movement.
- Content and CTAs remain usable at 200% zoom.

## 8. Responsive Behavior

Validate at 320, 375, 768, 1024, and 1440 CSS pixels.

- Hero copy and collage form two columns on wide screens.
- On small screens, copy appears first and collage stacks beneath it.
- Route artwork adapts to the stacked composition rather than causing horizontal overflow.
- Tables or economic detail use an internal horizontal scroller if they cannot reflow cleanly.
- The body never scrolls horizontally.
- Type remains legible without clipping or forced line breaks.

## 9. Content Guardrails

The current master spec overrides earlier landing, pitch, simulation, and economic documents.

The landing must not:

- state or imply that PUNCH has a fixed monetary value;
- show peer-to-peer PUNCH transfer;
- present PUNCH as withdrawable, divisible, speculative, or cash-redeemable;
- hardcode a redemption threshold as the enduring product proposition;
- claim that host cafés receive the full retail value when the current model does not support that claim;
- present an unapproved campaign fee as committed MVP revenue;
- describe the initial market as Arequipa;
- present seeded simulations as real traction;
- use stale CLUTCH or SELLO naming;
- make blockchain knowledge a consumer prerequisite.

Current numeric details may appear only where useful and must match the master spec or a newer approved configuration source.

## 10. Verification

Before completion:

1. run typecheck, lint, and production build;
2. test keyboard navigation and mobile menu behavior;
3. verify all anchors and CTAs;
4. verify a clean browser console;
5. capture desktop and mobile screenshots;
6. check 320–1440px layouts for horizontal overflow;
7. test reduced-motion behavior;
8. audit all copy against the master spec and content guardrails;
9. run a final Hallmark review for hierarchy, rhythm, visual specificity, responsiveness, and generic-design slop.

## 11. Success Criteria

The redesign succeeds when a first-time café owner can answer, without reading technical mechanics:

1. What problem does PUNCH solve?
2. Why does a network help an independent café?
3. What independence does the café retain?
4. What business outcome should the café expect?
5. What is the next step to join?

A consumer should also understand that PUNCH helps them discover and return to independent cafés across a network without needing to understand blockchain or treat PUNCH as money.
