import { access, copyFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");
const p5Root = resolve(projectRoot, "node_modules/p5");
const librarySource = resolve(p5Root, "lib/p5.min.js");
const libraryDestination = resolve(projectRoot, "src/vendor/p5.min.js");
const licenseDestination = resolve(projectRoot, "THIRD_PARTY_LICENSES/p5.LICENSE.txt");

await mkdir(dirname(libraryDestination), { recursive: true });
await copyFile(librarySource, libraryDestination);

for (const filename of ["license.txt", "LICENSE", "LICENSE.md"]) {
  const candidate = resolve(p5Root, filename);
  try {
    await access(candidate, constants.R_OK);
    await mkdir(dirname(licenseDestination), { recursive: true });
    await copyFile(candidate, licenseDestination);
    break;
  } catch {
    // Try the next common license filename.
  }
}

console.log("[junkpile] copied p5 1.11.0 into src/vendor/p5.min.js");
