import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { writePrivateFile } from "./private-storage";
import type { InferenceProvider } from "@shared/inference";

interface EncryptionProvider {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

const StoredApiKeySchema = z.object({
  version: z.literal(1),
  ciphertext: z.string().min(1)
}).strict();

export class ApiKeyStore {
  private readonly path: string;

  constructor(
    dataDirectory: string,
    private readonly encryption: EncryptionProvider,
    provider: InferenceProvider = "openai"
  ) {
    this.path = resolve(dataDirectory, `${provider}-credential.json`);
  }

  load(): string | undefined {
    if (!existsSync(this.path) || !this.encryption.isEncryptionAvailable()) return undefined;
    try {
      const stored = StoredApiKeySchema.parse(JSON.parse(readFileSync(this.path, "utf8")));
      return this.encryption.decryptString(Buffer.from(stored.ciphertext, "base64")).trim() || undefined;
    } catch (error) {
      console.error("Unable to read the saved API key", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
      return undefined;
    }
  }

  save(apiKey: string): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error("Secure API key storage is unavailable");
    }
    const normalized = apiKey.trim();
    if (normalized.length < 20 || normalized.length > 500) throw new Error("Invalid API key");
    const ciphertext = this.encryption.encryptString(normalized).toString("base64");
    writePrivateFile(this.path, `${JSON.stringify({ version: 1, ciphertext }, null, 2)}\n`);
  }

  clear(): void {
    if (existsSync(this.path)) rmSync(this.path);
  }
}
