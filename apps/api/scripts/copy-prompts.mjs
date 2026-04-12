import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src", "modules", "sophia");
const outDir = join(here, "..", "dist", "modules", "sophia");

mkdirSync(outDir, { recursive: true });

for (const file of ["sophia.system.md", "sophia.runtime.md"]) {
  cpSync(join(srcDir, file), join(outDir, file));
  console.log(`copied ${file} → dist/modules/sophia/`);
}
