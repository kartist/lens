// ============================================================
// Lens DSL — Public API
// ============================================================

// Parser
export { Parser, ParseError, Lexer, Token, TokenKind } from './parser';
export type {
  Document, Declaration,
  SchemaDecl, SchemaField, TypeExpr,
  PrimitiveType, NominalType, OptionalType, ArrayType, UnionType, RefinedType, SchemaRef,
  Annotation, AnnotationArg,
  TypeAliasDecl, TypeAliasDef,
  MappingDecl, MappingField, MappingExpr, MappingBlock,
  BidirectionalMappingDecl,
  FieldAccessExpr, LiteralExpr, FunctionCallExpr, MatchExpr, MatchArm, MatchPattern,
  PipeExpr, BinaryExpr, ArrayLiteralExpr, SubMappingExpr, CoalesceExpr,
  SourceLocation, Span,
} from './parser';

// Checker
export { check, buildTypeEnv, semTypeToString } from './checker';
export type { CheckResult, CheckError, TypeEnv, SchemaType, FieldType, SemType, FuncType } from './checker';

// Codegen
export { generateTypeScript, generateJsonSchemas } from './codegen';
export type { GenerateOptions } from './codegen';

// Runtime
export {
  __trim, __titleCase, __lowercase, __uppercase,
  __normalizeEmail, __normalizeCity, __parseUuid,
  __parseInt, __toString, __filterNone,
  __splitFirst, __splitLast, __now,
} from './runtime/functions';
