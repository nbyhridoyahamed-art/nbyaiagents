-- OpenAI-compatible providers with free tiers or self-hosting (OpenRouter, Ollama, Groq, Cerebras, Mistral).
ALTER TYPE "ProviderKind" ADD VALUE IF NOT EXISTS 'OPENROUTER';
ALTER TYPE "ProviderKind" ADD VALUE IF NOT EXISTS 'OLLAMA';
ALTER TYPE "ProviderKind" ADD VALUE IF NOT EXISTS 'GROQ';
ALTER TYPE "ProviderKind" ADD VALUE IF NOT EXISTS 'CEREBRAS';
ALTER TYPE "ProviderKind" ADD VALUE IF NOT EXISTS 'MISTRAL';
