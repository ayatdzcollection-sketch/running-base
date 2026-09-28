// Copies the pure engine into the edge functions' shared folder so the web
// app and the Claude connector run exactly the same code. Run before deploy.
import { cpSync, rmSync, readdirSync } from 'node:fs';
const from = new URL('../src/engine/', import.meta.url);
const to = new URL('../supabase/functions/_shared/engine/', import.meta.url);
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true, filter: src => !src.includes('__tests__') });
console.log('engine synced:', readdirSync(to).join(', '));
