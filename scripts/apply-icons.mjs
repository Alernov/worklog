// Подставляет иконку приложения в проект Android, который создаёт `npx cap add android`.
// Если структура проекта другая, скрипт ничего не ломает: останется стандартная иконка.
import fs from 'node:fs';
import path from 'node:path';

const src = 'android-res';
const dst = 'android/app/src/main/res';

if (!fs.existsSync(dst)) {
  console.log('Папки android нет, иконки пропущены');
  process.exit(0);
}

let copied = 0;
for (const dir of fs.readdirSync(src)) {
  const to = path.join(dst, dir);
  if (!fs.existsSync(to)) continue;
  for (const f of fs.readdirSync(path.join(src, dir))) {
    fs.copyFileSync(path.join(src, dir, f), path.join(to, f));
    copied++;
  }
}

const bg = path.join(dst, 'values', 'ic_launcher_background.xml');
if (fs.existsSync(bg)) {
  fs.writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2563EB</color>\n</resources>\n');
}
console.log(`Иконок скопировано: ${copied}`);
