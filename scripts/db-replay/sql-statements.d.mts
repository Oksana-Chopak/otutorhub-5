export function stripComments(text: string): string;
export function splitStatements(sql: string): string[];
export function normalizeStatement(s: string): string;
export function isPersistentStatement(s: string): boolean;
export function persistentStatements(sql: string): string[];
export function indexAppliedStatements(entries: Array<{ file: string; sql: string }>): Map<string, string[]>;
export function proveByContent(
  ours: string[],
  applied: Map<string, string[]>,
  accept?: (hashFile: string) => boolean,
): { proven: boolean; missing: string[]; files: string[] };
export function acceptsHashFor(oursFile: string): (hashFile: string) => boolean;
