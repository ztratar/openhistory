import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  existsSync,
  readFileSync
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { ensurePrivateDirectory, writePrivateFile } from "./private-storage";

const AgentConnectionRecordSchema = z.object({
  id: z.string().uuid(),
  tokenHash: z.string().length(64),
  name: z.string().min(1).max(200),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().optional(),
  accessCount: z.number().int().nonnegative(),
  lastTool: z.string().min(1).max(128).optional(),
  clientName: z.string().min(1).max(200).optional(),
  clientVersion: z.string().min(1).max(100).optional(),
  revokedAt: z.string().datetime().optional()
});

const AgentAccessFileSchema = z.object({
  version: z.literal(1),
  connections: z.array(AgentConnectionRecordSchema).max(1_000)
});

type AgentConnectionRecord = z.infer<typeof AgentConnectionRecordSchema>;

export interface AgentCredential {
  connectionId: string;
  token: string;
}

export interface AgentConnectionView {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  accessCount: number;
  lastTool?: string;
  clientName?: string;
  clientVersion?: string;
  revokedAt?: string;
}

export class AgentAccessStore {
  constructor(private readonly path: string) {
    ensurePrivateDirectory(dirname(path));
  }

  createCredential(name = "Local agent"): AgentCredential {
    const token = `oh_${randomBytes(32).toString("base64url")}`;
    const record: AgentConnectionRecord = {
      id: randomUUID(),
      tokenHash: hashToken(token),
      name,
      createdAt: new Date().toISOString(),
      accessCount: 0
    };
    const file = this.load();
    file.connections.push(record);
    this.save(file);
    return { connectionId: record.id, token };
  }

  authenticate(token: string): AgentConnectionView | undefined {
    const candidateHash = Buffer.from(hashToken(token), "hex");
    const record = this.load().connections.find((connection) => {
      if (connection.revokedAt) return false;
      const storedHash = Buffer.from(connection.tokenHash, "hex");
      return storedHash.length === candidateHash.length && timingSafeEqual(storedHash, candidateHash);
    });
    return record ? toView(record) : undefined;
  }

  recordAccess(
    id: string,
    operation: string,
    client?: { name?: string; version?: string }
  ): AgentConnectionView | undefined {
    const file = this.load();
    const record = file.connections.find((connection) => connection.id === id && !connection.revokedAt);
    if (!record) return undefined;
    record.lastUsedAt = new Date().toISOString();
    record.accessCount += 1;
    record.lastTool = operation.slice(0, 128);
    if (client?.name) record.clientName = client.name.slice(0, 200);
    if (client?.version) record.clientVersion = client.version.slice(0, 100);
    this.save(file);
    return toView(record);
  }

  revoke(id: string): boolean {
    const file = this.load();
    const record = file.connections.find((connection) => connection.id === id && !connection.revokedAt);
    if (!record) return false;
    record.revokedAt = new Date().toISOString();
    this.save(file);
    return true;
  }

  list(): AgentConnectionView[] {
    return this.load().connections
      .map(toView)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private load(): z.infer<typeof AgentAccessFileSchema> {
    if (!existsSync(this.path)) return { version: 1, connections: [] };
    try {
      return AgentAccessFileSchema.parse(JSON.parse(readFileSync(this.path, "utf8")));
    } catch (error) {
      console.error("Unable to read agent access store", {
        name: error instanceof Error ? error.name : "UnknownError"
      });
      return { version: 1, connections: [] };
    }
  }

  private save(file: z.infer<typeof AgentAccessFileSchema>): void {
    const parsed = AgentAccessFileSchema.parse(file);
    writePrivateFile(this.path, `${JSON.stringify(parsed, null, 2)}\n`);
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toView(record: AgentConnectionRecord): AgentConnectionView {
  const { tokenHash: _tokenHash, ...view } = record;
  return view;
}
