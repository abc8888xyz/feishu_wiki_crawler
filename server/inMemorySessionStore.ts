/**
 * In-memory session store for no-DB mode.
 * Stores crawl results so export routes can access them without a database.
 */

export interface InMemoryNode {
  nodeToken: string;
  parentNodeToken: string | null;
  objToken: string | null;
  objType: string | null;
  title: string;
  depth: number;
  url: string;
}

export interface InMemorySession {
  id: number;
  spaceId: string;
  domain: string;
  apiBase: string;
  nodes: InMemoryNode[];
  createdAt: number;
}

const sessions = new Map<number, InMemorySession>();
let nextId = 1;

export function createInMemorySession(
  spaceId: string,
  domain: string,
  apiBase: string,
  nodes: InMemoryNode[]
): number {
  const id = nextId++;
  sessions.set(id, { id, spaceId, domain, apiBase, nodes, createdAt: Date.now() });
  return id;
}

export function getInMemorySession(id: number): InMemorySession | undefined {
  return sessions.get(id);
}

export function deleteInMemorySession(id: number): void {
  sessions.delete(id);
}
