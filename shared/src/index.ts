export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export * from './agent-adapter.js';
export * from './workflow-ir.js';
