/**
 * npm run verify:banned — the OPERATING PROTOCOL's banned list, checked mechanically over the
 * deliverable (app/, lib/, scripts/, components/): TODO, FIXME, "not implemented",
 * "in production you would", empty catch blocks, `any`, and Kora calls outside lib/kora.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const ROOTS = ["app", "lib", "scripts", "components"];
const RULES: Array<{ name: string; re: RegExp; allowIn?: RegExp }> = [
  { name: "TODO", re: /\bTODO\b/ },
  { name: "FIXME", re: /\bFIXME\b/ },
  { name: "not implemented", re: /not implemented/i },
  { name: "in production you would", re: /in production you would/i },
  { name: "empty catch block", re: /catch\s*(\([^)]*\))?\s*\{\s*\}/ },
  { name: "`any` type", re: /(:\s*any\b|\bas\s+any\b|<any>|any\[\])/ },
  { name: "Kora call outside lib/kora", re: /api\.korapay\.com|fetch\([^)]*korapay/i, allowIn: /lib[\\/]kora[\\/]|lib[\\/]env\.ts|scripts[\\/]preflight\.ts|scripts[\\/]verify-banned\.ts/ },
];

async function* files(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "generated" && e.name !== "node_modules") yield* files(p);
    } else if (/\.(ts|tsx)$/.test(e.name)) yield p;
  }
}

async function main() {
  const hits: string[] = [];
  for (const root of ROOTS) {
    for await (const f of files(root)) {
      if (f.endsWith("verify-banned.ts")) continue;
      const lines = (await readFile(f, "utf8")).split("\n");
      lines.forEach((line, i) => {
        for (const r of RULES) {
          if (r.re.test(line) && !(r.allowIn && r.allowIn.test(f))) hits.push(`${f}:${i + 1}  [${r.name}]  ${line.trim().slice(0, 120)}`);
        }
      });
    }
  }
  if (hits.length) {
    console.error(`Banned patterns found (${hits.length}):\n${hits.join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("verify:banned — clean: no TODO/FIXME/'not implemented', no empty catch, no `any`, no Kora calls outside lib/kora.");
  }
}

void main();
