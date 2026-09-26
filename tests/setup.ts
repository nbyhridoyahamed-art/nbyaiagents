import "dotenv/config";

// Tests always run against the dedicated test database and never call real AI providers.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5433/nby_test?schema=public";
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENAI_API_KEY = "";
process.env.GOOGLE_API_KEY = "";
process.env.OPENAI_COMPATIBLE_API_KEY = "";
process.env.OPENAI_COMPATIBLE_BASE_URL = "";
process.env.EMAIL_PROVIDER = "console";
process.env.REDIS_URL = "";
process.env.STORAGE_LOCAL_DIR = ".data/test-storage";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.SIGNING_SECRET ??= "test-signing-secret-0123456789";
