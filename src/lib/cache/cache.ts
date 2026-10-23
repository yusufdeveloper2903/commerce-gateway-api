/**
 * Storage-agnostic cache contract. The in-memory LRU implements it today; a
 * Redis adapter (GET/SET PX/DEL) could be dropped in without touching services.
 * Methods are async on purpose so remote stores fit the same interface.
 */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
