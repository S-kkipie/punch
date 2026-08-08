# Task 5 report: EIP-712 proof module

## Implementation

Added the server-only proof module at `src/core/chain/server/proof/proof.ts`.

- Defines the `ConsumptionProof` interface with bigint numeric fields.
- Builds order-salted Yape receipt hashes with `keccak256(toBytes(`${orderId}:${yapeRef}`))`.
- Generates a full-range uint256 nonce from 32 random bytes using `crypto.getRandomValues`.
- Produces EIP-712 typed data for `PUNCH ConsumptionLog` version `1`, the active environment chain ID, and the configured `consumptionLog` address.
- Matches `ConsumptionLog.sol`'s exact `ConsumptionProof` field order and Solidity types.
- Signs proofs with the requested derived custodial wallet.
- Serializes all bigint fields to decimal strings and deserializes them back to exact bigint values.
- Keeps the module server-only and does not expose mnemonic or private-key material.

Added tests at `src/core/chain/server/proof/__tests__/proof.test.ts` covering receipt-hash salting, nonce bounds/distinctness, signature recovery, JSONB round-trip serialization, and digest stability plus digest change after mutating a signed field.

## Verification

- `pnpm test src/core/chain/server/proof` — passed: 1 file, 5 tests.
- `pnpm typecheck` — passed.
- `pnpm exec biome check src/core/chain/server/proof/proof.ts src/core/chain/server/proof/__tests__/proof.test.ts` — passed.

The first requested failing-test run could not start because this isolated worktree had no local `node_modules`; after linking the repository's existing dependency installation, the test command ran successfully.

## Review fix

Hardened `deserializeProof` as an untrusted JSONB boundary. It now accepts `unknown`, rejects null/non-object payloads and unexpected or missing keys, validates the EVM address and exact bytes32 receipt hash shape, and validates every uint256 field as a decimal integer within the inclusive `[0, 2^256 - 1]` range. Errors identify the invalid field without including payload contents. Added table-driven malformed-payload tests plus zero/max uint256 boundary coverage.

Review-fix verification:

- `pnpm test src/core/chain/server/proof` — passed: 1 file, 16 tests.
- `pnpm typecheck` — passed.
- `pnpm exec biome check src/core/chain/server/proof/proof.ts src/core/chain/server/proof/__tests__/proof.test.ts` — passed.

## Re-review fix

Relaxed address validation to `isAddress(user, { strict: false })`, preserving the supplied casing while requiring a valid 20-byte hexadecimal EVM address. Added coverage for lowercase and mixed-case non-checksummed addresses, plus short, nonhex, and 21-byte rejection cases.

Re-review-fix verification:

- `pnpm test src/core/chain/server/proof` — passed: 1 file, 20 tests.
- `pnpm typecheck` — passed.
- `pnpm exec biome check src/core/chain/server/proof/proof.ts src/core/chain/server/proof/__tests__/proof.test.ts` — passed.
