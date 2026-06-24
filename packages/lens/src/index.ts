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

// IR
export { generateIR } from './ir-generator';
export { serializeIR, deserializeIR } from './ir-json';
export type {
  IRDocument, IRSchema, IRSchemaField, IRAnnotation,
  IRTypeAlias, IRMapping, IRMappingField, IRExpr,
  IRFieldAccess, IRLiteral, IRFunctionCall, IRMatch, IRMatchArm,
  IRPipe, IRBinary, IRCoalesce, IRSubMapping, IRArrayLiteral,
  IResolvedType,
} from './ir';

// Codegen
export { generateTypeScript, generateJsonSchemas, generatePython } from './codegen';
export type { GenerateOptions, PythonGenOptions } from './codegen';

// Compiler core: source → IR (parse + check + IR generation)
export { compile } from './compiler';

// Runtime
export { executeMapping, executeBidirectionalMapping } from './runtime/interpreter';
export type { ExecuteResult } from './runtime/interpreter';
export {
  __trim, __titleCase, __lowercase, __uppercase,
  __normalizeEmail, __normalizeCity, __parseUuid,
  __parseInt, __toString, __filterNone,
  __splitFirst, __splitLast, __now,
} from './runtime/functions';
