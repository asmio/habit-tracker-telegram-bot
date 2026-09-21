import { defineConfig } from 'drizzle-kit';
import { loadDbConfig } from './src/config';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: loadDbConfig().dbPath,
  },
});
