// Runs before any test file's own imports, so `src/db/index.ts` (which reads `DB_PATH` at module
// load time) and `src/config.ts`'s `dotenv/config` (which never overrides an already-set variable)
// both see this instead of the real `./data/habit-tracker.db`.
process.env.DB_PATH = ':memory:';
