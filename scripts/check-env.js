// Runs before `npm run dist`: refuse to package an installer without a real Gemini key,
// because the .env file is what gets bundled into the app for students.
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', '.env');
if (!fs.existsSync(file)) {
  console.error('\n✖ Missing .env — copy .env.example to .env and set GEMINI_API_KEY before packaging.\n');
  process.exit(1);
}
const match = /^\s*GEMINI_API_KEY\s*=\s*(.*)$/m.exec(fs.readFileSync(file, 'utf8'));
const key = match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
if (!key || key === 'YOUR_KEY_HERE') {
  console.error('\n✖ GEMINI_API_KEY in .env is still empty/placeholder. Add your key before packaging.\n');
  process.exit(1);
}
console.log('✔ .env has a GEMINI_API_KEY; it will be bundled into the installer.');
