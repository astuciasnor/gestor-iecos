import { execSync } from 'child_process';
import fs from 'fs';
try {
  const out = execSync('npx vitest run --no-color', { stdio: 'pipe' });
  console.log("Success");
} catch (e) {
  fs.writeFileSync('vitest_dump.txt', (e.stdout ? e.stdout.toString() : '') + '\n' + (e.stderr ? e.stderr.toString() : ''));
  console.log("Wrote vitest_dump.txt");
}
