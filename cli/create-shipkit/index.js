#!/usr/bin/env node
// create-shipkit — scaffold the Skippie hackathon starter.
// Zero runtime dependencies: shallow-clones the template repo, strips the
// scaffolder + internal docs, renames the project, and re-inits git.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stdin, stdout } from "node:process";
import readline from "node:readline/promises";

const REPO = "https://github.com/S-kkipie/hackaton-starter.git";

// Paths (relative to the scaffolded project) that are template-internal and
// must not ship in a user's project.
const STRIP = [".git", "cli", "docs/superpowers", ".superpowers"];

const c = {
    reset: "\x1b[0m",
    bold: "\x1b[1m",
    dim: "\x1b[2m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
};
const color = (code, s) => `${code}${s}${c.reset}`;

function die(msg) {
    console.error(`\n${color(c.red, "✖")} ${msg}\n`);
    process.exit(1);
}

function toPackageName(name) {
    return (
        name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-~]+/g, "-")
            .replace(/^-+|-+$/g, "") || "hackaton-app"
    );
}

async function resolveTargetDir() {
    const arg = process.argv[2];
    if (arg) return arg;
    if (!stdin.isTTY) die("Usage: create-shipkit <project-directory>");
    const rl = readline.createInterface({ input: stdin, output: stdout });
    const answer = await rl.question(
        `${color(c.cyan, "?")} Project directory: ${color(c.dim, "(my-hackaton-app)")} `,
    );
    rl.close();
    return answer.trim() || "my-hackaton-app";
}

function assertGit() {
    try {
        execFileSync("git", ["--version"], { stdio: "ignore" });
    } catch {
        die("git is required but was not found on your PATH.");
    }
}

function main() {
    return resolveTargetDir().then((targetArg) => {
        const targetDir = path.resolve(process.cwd(), targetArg);
        const appName = toPackageName(path.basename(targetDir));

        if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
            die(
                `Target directory "${targetArg}" already exists and is not empty.`,
            );
        }

        assertGit();

        console.log(
            `\n${color(c.bold, "create-shipkit")} — scaffolding ${color(c.cyan, appName)}\n`,
        );

        // 1. Shallow clone the template.
        console.log(`${color(c.dim, "›")} Downloading template…`);
        try {
            execFileSync(
                "git",
                ["clone", "--depth", "1", "--quiet", REPO, targetDir],
                { stdio: "inherit" },
            );
        } catch {
            die(
                "Failed to clone the template. Check your network and that the repo is reachable.",
            );
        }

        // 2. Strip template-internal files.
        for (const rel of STRIP) {
            fs.rmSync(path.join(targetDir, rel), {
                recursive: true,
                force: true,
            });
        }

        // 3. Rename the project in package.json.
        const pkgPath = path.join(targetDir, "package.json");
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            pkg.name = appName;
            pkg.version = "0.1.0";
            fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`);
        } catch {
            console.warn(
                `${color(c.yellow, "!")} Could not rewrite package.json name — do it manually.`,
            );
        }

        // 4. Fresh git history + initial commit (best-effort: a missing git
        // identity just leaves the repo uncommitted for the user to commit).
        try {
            execFileSync("git", ["init", "--quiet"], {
                cwd: targetDir,
                stdio: "ignore",
            });
            execFileSync("git", ["add", "-A"], {
                cwd: targetDir,
                stdio: "ignore",
            });
            execFileSync(
                "git",
                [
                    "commit",
                    "--quiet",
                    "-m",
                    "Initial commit from create-shipkit",
                ],
                { cwd: targetDir, stdio: "ignore" },
            );
        } catch {
            // non-fatal — user can commit themselves
        }

        // 5. Next steps.
        const rel = path.relative(process.cwd(), targetDir) || ".";
        console.log(
            `\n${color(c.green, "✔")} Created ${color(c.cyan, appName)} at ${rel}\n`,
        );
        console.log(color(c.bold, "Next steps:"));
        console.log(`  ${color(c.cyan, `cd ${rel}`)}`);
        console.log(`  ${color(c.cyan, "pnpm install")}`);
        console.log(
            `  ${color(c.cyan, "cp .env.example .env")}   ${color(c.dim, "# then set DATABASE_URL, BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL")}`,
        );
        console.log(
            `  ${color(c.dim, "#")} BETTER_AUTH_SECRET: ${color(c.cyan, "openssl rand -base64 32")}`,
        );
        console.log(
            `  ${color(c.cyan, "pnpm db:migrate")}   ${color(c.dim, "# apply migrations")}`,
        );
        console.log(`  ${color(c.cyan, "pnpm dev")}\n`);
    });
}

main().catch((err) => die(err?.message ?? String(err)));
