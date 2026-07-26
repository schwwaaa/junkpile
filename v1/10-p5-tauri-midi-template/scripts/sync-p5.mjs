import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'node_modules/p5/lib/p5.min.js');
const destination = resolve(root, 'src/vendor/p5.min.js');

await mkdir(dirname(destination), { recursive: true });
await copyFile(source, destination);
console.log('[junkpile] copied p5.min.js into src/vendor');
