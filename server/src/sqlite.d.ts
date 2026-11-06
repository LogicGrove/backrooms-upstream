// @types/node 20 no trae node:sqlite (Node >= 22.13 lo trae sin flag): lo mínimo que se usa aquí
declare module 'node:sqlite' {
  type Value = string | number | bigint | null | Uint8Array;
  interface RunResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }
  interface Statement {
    run(...params: Value[]): RunResult;
    get(...params: Value[]): Record<string, Value> | undefined;
    all(...params: Value[]): Record<string, Value>[];
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
}
