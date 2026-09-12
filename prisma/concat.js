// prisma/concat.js
// Concatenates prisma/models/*.prisma into prisma/schema.prisma
// Run: node prisma/concat.js

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const modelsDir = join(__dirname, 'models');
const schemaPath = join(__dirname, 'schema.prisma');

const raw = readFileSync(schemaPath, 'utf8');
// Idempotent: strip previously generated models — header is generator/datasource/enums only.
const cutAt = raw.search(/^model /m);
const header = (cutAt >= 0 ? raw.slice(0, cutAt) : raw).trimEnd();

const modelFiles = readdirSync(modelsDir)
  .filter((f) => f.endsWith('.prisma'))
  .sort();

console.log('Model files found:', modelFiles);

let output = header + '\n\n';

for (const file of modelFiles) {
  const content = readFileSync(join(modelsDir, file), 'utf8');
  output += content.trimEnd() + '\n\n';
}

writeFileSync(schemaPath, output.trimEnd() + '\n');
console.log(`Generated ${schemaPath} from ${modelFiles.length} model files`);