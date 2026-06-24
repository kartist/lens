// ============================================================
// Lens IR — Intermediate Representation
//
// The IR is the SINGLE contract between the compiler frontend
// (Lexer → Parser → Checker) and all codegen backends.
//
// Properties:
//   - All types are fully resolved (no type lookups needed)
//   - No source-span information (backends don't need it)
//   - Serializable (JSON-compatible structure)
//   - Language-independent (Python, Go, etc. can consume)
// ============================================================

// ---- Resolved Semantic Types ----
// Mirrors checker/types.ts SemType but flattened for serializability.
export type IResolvedType =
  | { kind: 'primitive'; name: string }
  | { kind: 'nominal'; name: string }
  | { kind: 'optional'; inner: IResolvedType }
  | { kind: 'array'; inner: IResolvedType }
  | { kind: 'union'; variants: IResolvedType[] }
  | { kind: 'refined'; base: IResolvedType; constraint: string }
  | { kind: 'schema_ref'; name: string }  // reference to another schema

// ---- IR Document ----
export interface IRDocument {
  schemas: IRSchema[];
  typeAliases: IRTypeAlias[];
  mappings: IRMapping[];
  bidirectionalMappings: IRMapping[];
}

// ---- Type Alias ----
export interface IRTypeAlias {
  name: string;
  /** Fully resolved semantic type */
  resolvedType: IResolvedType;
  /** Original definition kind (for idiomatic codegen) */
  defKind: 'regex' | 'union' | 'wrapper';
  /** Regex pattern (if defKind === 'regex') */
  pattern?: string;
  /** Union variants as string literals (if defKind === 'union') */
  variants?: string[];
}

// ---- Schema ----
export interface IRSchema {
  name: string;
  fields: IRSchemaField[];
}

export interface IRSchemaField {
  name: string;
  type: IResolvedType;
  annotations: IRAnnotation[];
}

export interface IRAnnotation {
  name: string;
  args: (string | number | boolean)[];
}

// ---- Mappings ----
export interface IRMapping {
  name: string;
  source: string;
  target: string;
  isBidirectional: boolean;
  fields: IRMappingField[];
  // Backward fields (only for bidirectional)
  backwardFields?: IRMappingField[];
}

export interface IRMappingField {
  name: string;
  expression: IRExpr;
}

// ---- Mapping Expressions (typed) ----
export type IRExpr =
  | IRFieldAccess
  | IRLiteral
  | IRFunctionCall
  | IRMatch
  | IRPipe
  | IRBinary
  | IRCoalesce
  | IRSubMapping
  | IRArrayLiteral

export interface IRFieldAccess {
  kind: 'field_access';
  path: string[];
  /** Resolved type of the accessed field */
  resolvedType: IResolvedType;
}

export interface IRLiteral {
  kind: 'literal';
  value: string | number | boolean | null;
  resolvedType: IResolvedType;
}

export interface IRFunctionCall {
  kind: 'function_call';
  name: string;
  args: IRExpr[];
  resolvedType: IResolvedType;
}

export interface IRMatch {
  kind: 'match';
  subject: IRExpr;
  arms: IRMatchArm[];
  defaultArm?: IRExpr;
  resolvedType: IResolvedType;
}

export interface IRMatchArm {
  patterns: (string | number | boolean)[];
  body: IRExpr;
}

export interface IRPipe {
  kind: 'pipe';
  left: IRExpr;
  right: IRExpr;
  resolvedType: IResolvedType;
}

export interface IRBinary {
  kind: 'binary';
  left: IRExpr;
  operator: '+' | '-';
  right: IRExpr;
  resolvedType: IResolvedType;
}

export interface IRCoalesce {
  kind: 'coalesce';
  /** The inner expression whose nullability is propagated */
  expr: IRExpr;
  resolvedType: IResolvedType;
}

export interface IRSubMapping {
  kind: 'sub_mapping';
  mappingName: string;
  resolvedType: IResolvedType;
}

export interface IRArrayLiteral {
  kind: 'array_literal';
  elements: IRExpr[];
  resolvedType: IResolvedType;
}
