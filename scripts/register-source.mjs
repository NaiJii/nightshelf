import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Match Metro's extensionless local TypeScript imports in the Node-only tests.
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.includes('/src/')) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(fileURLToPath(url))) return next(url.href, context);
  }
  return next(specifier, context);
} });
