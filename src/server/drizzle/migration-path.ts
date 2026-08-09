import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../..",
);
export const drizzleRoot = resolve(projectRoot, "drizzle");
