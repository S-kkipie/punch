# Sub-proyecto 3b — Cafe domain (Postgres-only)

**Estado:** Diseño aprobado
**Fecha:** 2026-08-07
**Depende de:** Spec maestra §07, §15, §16, §18, §22; sub-proyecto 3a (membership)
**No depende de:** contratos on-chain (CafeRegistry en vuelo no bloquea)

---

## Objetivo

Dominio `src/core/cafe`: perfil, onboarding y catálogo de cafeterías en Postgres, con flujo de aprobación de operaciones. Solo datos fuente propiedad de Postgres (spec §18). Las projection tables de estado on-chain llegan con el sub-proyecto indexer, cuando los ABIs estén estables.

## Frontera Postgres / chain (recordatorio §15–§18)

- Chain (futuro, no aquí): `cafeId` on-chain, status `pending|active|suspended|exited`, operadores autorizados, flags de elegibilidad por producto.
- Postgres (este sub-proyecto): perfil/PII/geo/fotos, catálogo rico (nombre, precio, COGS, imagen), workflow de onboarding, notas de revisión ops.
- Claves compartidas congeladas desde ya: `cafe.id` y `cafe_product.id` (uuid). El mapeo uuid ↔ identidad on-chain se define en el sub-proyecto de integración chain.

## Schema

```text
cafe
  id             uuid pk
  name           text not null
  slug           text unique
  description    text
  address        text
  district       text            -- Lima MVP
  lat / lng      numeric null
  photo_url      text null
  ruc            text null       -- verificación, PII
  contact_phone  text null       -- PII
  onboarding_status  'draft' | 'submitted' | 'approved' | 'rejected'
  review_note    text null       -- razón de rechazo accionable (§21)
  created_at / updated_at

cafe_product
  id             uuid pk
  cafe_id        fk cafe
  name           text not null
  description    text
  price_soles    numeric not null      -- precio retail real
  cogs_soles     numeric null          -- requerido si type=reward
  type           'emission' | 'reward'
  approval_status 'pending' | 'approved' | 'rejected'
  review_note    text null
  active         boolean default true
  created_at / updated_at
```

`onboarding_status` es estado operacional Postgres, distinto del estado on-chain futuro. Al aprobar ops (post-integración), se disparará `registerCafe`; en este sub-proyecto la aprobación solo cambia el estado local.

## Reglas de validación (zod, `domain/schemas.ts`)

- `cafe.name` requerido; `slug` derivado único.
- `submitted` requiere: name, address, district, contact_phone, ≥1 producto emission propuesto.
- Producto reward: `price_soles ≤ 12` (invariante §02.6), `cogs_soles` requerido; warning UI si `cogs > 3` (objetivo §07), no bloqueo.
- Producto emission: `price_soles > 0`.
- Transiciones onboarding: `draft→submitted→approved|rejected`; `rejected→submitted` (reintento). Sin saltos.

## API — Elysia `/api/v1/cafes` (patrón dominio `project` existente)

Rutas por archivo en `server/api/routes/`:

| Ruta | Guard | Acción |
|---|---|---|
| `POST /cafes` | sesión | crea cafe draft + membership owner del creador |
| `GET /cafes` | pública | lista cafés approved (descubrimiento consumidor) |
| `GET /cafes/:id` | pública si approved; owner/ops siempre | detalle + catálogo |
| `PATCH /cafes/:id` | owner | edita perfil (solo draft/rejected/approved-campos-no-críticos) |
| `POST /cafes/:id/submit` | owner | draft→submitted |
| `POST /cafes/:id/review` | ops | approved/rejected + review_note |
| `POST /cafes/:id/products` | owner | crea producto (pending) |
| `PATCH /products/:id` | owner | edita; re-aprueba si cambió precio/tipo |
| `POST /products/:id/review` | ops | aprueba/rechaza producto |

Servicios finos por caso de uso, repository por query — igual a `src/core/project`.

## UI

- **Panel café** (`/cafe/[id]` área app): form onboarding (TanStack Form), catálogo CRUD tabla (patrón data-table existente), badge de estado con razón de rechazo.
- **Consola ops** (`/ops`): cola de cafés submitted y productos pending; aprobar/rechazar con nota. Guard `requireOps`.
- **Descubrimiento consumidor**: lista simple de cafés approved con productos (home consumidor mínima; se enriquece en dominios posteriores).
- Estados obligatorios §19: cargando, error con razón accionable.

## Seed (extiende `scripts/seed.ts` de 3a)

- 4 cafés §30 en `approved`: Brújula Café, Patio 9, Nube Tostada, Esquina Sur; distritos Lima verosímiles.
- Memberships: cada owner demo → su café (role owner).
- Catálogo por café: 2–3 productos emission approved (café espresso, latte, etc.) + 1–2 rewards approved (retail ≤ S/12, COGS ≤ S/3).
- Un quinto café en `submitted` para demo de consola ops.

## Errores

| Condición | Respuesta |
|---|---|
| Submit sin campos mínimos | 422 con lista de faltantes |
| Review por no-ops | 403 |
| Editar café ajeno | 403 vía `requireCafeRole` |
| Reward > S/12 | 422, mensaje cita regla |
| Transición inválida | 409 |

## Testing

- Unit: schemas zod (límite S/12, transiciones), servicios (authz, transición estados).
- Integración ruta: submit→review happy path y rechazos.
- Seed idempotente con memberships.

## Fuera de alcance

Projection tables on-chain, registro on-chain al aprobar, plan/créditos, emisión, imágenes upload real (URL string basta en MVP), búsqueda geo.
