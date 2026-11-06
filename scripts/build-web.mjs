// Собирает папку www, из которой Capacitor делает приложение.
import fs from 'node:fs';
import path from 'node:path';

const out = 'www';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'styles.css', 'app.js']) {
  fs.copyFileSync(f, path.join(out, f));
}
console.log('Папка www готова');
