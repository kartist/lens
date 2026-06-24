// ============================================================
// Lens Runtime Interpreter — evaluates IR mappings on data
// ============================================================

import {
  IRDocument, IRMapping, IRMappingField, IRExpr,
  IRFieldAccess, IRLiteral, IRFunctionCall, IRMatch,
  IRMatchArm, IRPipe, IRBinary, IRCoalesce, IRSubMapping,
  IRArrayLiteral,
} from '../ir';
import {
  __trim, __titleCase, __lowercase, __uppercase,
  __normalizeEmail, __normalizeCity, __parseUuid,
  __parseInt, __toString, __filterNone,
  __splitFirst, __splitLast, __now,
} from './functions';

// ---- Public API ----

export interface ExecuteResult {
  /** The transformed data */
  data: Record<string, unknown>;
  /** Field-level lineage: targetField → sourcePath */
  lineage: Map<string, string>;
}

/**
 * Execute a mapping on a single source record.
 *
 * @param ir       The compiled IR document containing the mapping
 * @param mappingName  Name of the mapping to execute
 * @param sourceData   Source data record (plain object)
 */
export function executeMapping(
  ir: IRDocument,
  mappingName: string,
  sourceData: Record<string, unknown>,
): ExecuteResult {
  // Find mapping in regular mappings
  const mapping = ir.mappings.find(m => m.name === mappingName);
  if (mapping) {
    const target: Record<string, unknown> = {};
    const lineage = new Map<string, string>();

    for (const field of mapping.fields) {
      const result = evaluateExpr(field.expression, sourceData, ir);
      target[field.name] = result.value;
      if (result.sourcePath) {
        lineage.set(field.name, result.sourcePath);
      }
    }

    return { data: target, lineage };
  }

  throw new Error(`Mapping '${mappingName}' not found in IR`);
}

/**
 * Execute a bidirectional mapping in the specified direction.
 */
export function executeBidirectionalMapping(
  ir: IRDocument,
  mappingName: string,
  direction: 'forward' | 'backward',
  sourceData: Record<string, unknown>,
): ExecuteResult {
  const mapping = ir.bidirectionalMappings.find(m => m.name === mappingName);
  if (!mapping) {
    throw new Error(`Bidirectional mapping '${mappingName}' not found in IR`);
  }

  const fields = direction === 'forward' ? mapping.fields : (mapping.backwardFields ?? []);
  const target: Record<string, unknown> = {};
  const lineage = new Map<string, string>();

  for (const field of fields) {
    const result = evaluateExpr(field.expression, sourceData, ir);
    target[field.name] = result.value;
    if (result.sourcePath) {
      lineage.set(field.name, result.sourcePath);
    }
  }

  return { data: target, lineage };
}

// ---- Expression Evaluator ----

interface EvalResult {
  value: unknown;
  /** Field path that produced this value (for lineage) */
  sourcePath?: string;
}

function evaluateExpr(expr: IRExpr, source: Record<string, unknown>, ir: IRDocument): EvalResult {
  switch (expr.kind) {
    case 'field_access':
      return evaluateFieldAccess(expr, source);
    case 'literal':
      return { value: expr.value };
    case 'function_call':
      return evaluateFunctionCall(expr, source, ir);
    case 'match':
      return evaluateMatch(expr, source, ir);
    case 'pipe':
      return evaluatePipe(expr, source, ir);
    case 'binary':
      return evaluateBinary(expr, source, ir);
    case 'coalesce':
      return evaluateCoalesce(expr, source, ir);
    case 'sub_mapping':
      return evaluateSubMapping(expr, source, ir);
    case 'array_literal':
      return evaluateArrayLiteral(expr, source, ir);
    default:
      return { value: null };
  }
}

function evaluateFieldAccess(
  expr: IRFieldAccess,
  source: Record<string, unknown>,
): EvalResult {
  const path = expr.path;

  // If path starts with 'source', access source data fields
  if (path.length > 0 && path[0] === 'source') {
    const fieldPath = path.slice(1);
    if (fieldPath.length === 0) {
      return { value: source, sourcePath: '(root)' };
    }

    let current: unknown = source;
    for (const segment of fieldPath) {
      if (current === null || current === undefined) {
        return { value: null, sourcePath: path.join('.') };
      }
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[segment];
      } else {
        return { value: null, sourcePath: path.join('.') };
      }
    }
    return { value: current, sourcePath: path.join('.') };
  }

  // Bare identifier (no 'source' prefix) → treat as literal/enum value
  // This handles union variant literals like `active`, `suspended`
  return { value: path[0] };
}

function evaluateFunctionCall(
  expr: IRFunctionCall,
  source: Record<string, unknown>,
  ir: IRDocument,
): EvalResult {
  const args = expr.args.map(a => evaluateExpr(a, source, ir).value);
  const fn = BUILTIN_FUNCTIONS[expr.name];

  if (!fn) {
    throw new Error(`Runtime function '${expr.name}' not found`);
  }

  const value = fn(...args);
  return { value };
}

function evaluateMatch(
  expr: IRMatch,
  source: Record<string, unknown>,
  ir: IRDocument,
): EvalResult {
  const subject = evaluateExpr(expr.subject, source, ir).value;

  // Try each arm
  for (const arm of expr.arms) {
    if (arm.patterns.length === 0) {
      // Wildcard — this is a catch-all
      continue; // Wildcard arms should be handled as the fallback if no match
    }
    for (const pattern of arm.patterns) {
      if (subject === pattern) {
        return evaluateExpr(arm.body, source, ir);
      }
    }
  }

  // Check wildcard arms
  for (const arm of expr.arms) {
    if (arm.patterns.length === 0) {
      return evaluateExpr(arm.body, source, ir);
    }
  }

  // Default arm
  if (expr.defaultArm) {
    return evaluateExpr(expr.defaultArm, source, ir);
  }

  throw new Error(`Match error: no arm matched for value '${subject}'`);
}

function evaluatePipe(
  expr: IRPipe,
  source: Record<string, unknown>,
  ir: IRDocument,
): EvalResult {
  const left = evaluateExpr(expr.left, source, ir);

  if (expr.right.kind === 'function_call') {
    const fn = BUILTIN_FUNCTIONS[expr.right.name];
    if (!fn) {
      throw new Error(`Runtime function '${expr.right.name}' not found`);
    }
    const extraArgs = expr.right.args.map(a => evaluateExpr(a, source, ir).value);
    const value = fn(left.value, ...extraArgs);
    return { value, sourcePath: left.sourcePath };
  }

  // Fallback: call right as a function on left
  if (typeof (evaluateExpr(expr.right, source, ir).value) === 'function') {
    const fn = evaluateExpr(expr.right, source, ir).value as Function;
    return { value: fn(left.value) };
  }

  return left;
}

function evaluateBinary(
  expr: IRBinary,
  source: Record<string, unknown>,
  ir: IRDocument,
): EvalResult {
  const left = evaluateExpr(expr.left, source, ir).value;
  const right = evaluateExpr(expr.right, source, ir).value;

  if (expr.operator === '+') {
    // String concatenation
    return { value: String(left) + String(right) };
  }
  // '-' not implemented yet
  return { value: null };
}

function evaluateCoalesce(
  expr: IRCoalesce,
  source: Record<string, unknown>,
  ir: IRDocument,
): EvalResult {
  const inner = evaluateExpr(expr.expr, source, ir);
  // Coalesce propagates nulls — if the value is null/undefined, it stays null
  return inner;
}

function evaluateSubMapping(
  expr: IRSubMapping,
  source: Record<string, unknown>,
  ir: IRDocument,
): EvalResult {
  // If source is null/undefined, skip sub-mapping
  if (source === null || source === undefined) {
    return { value: null };
  }

  const result = executeMapping(ir, expr.mappingName, source);
  return { value: result.data };
}

function evaluateArrayLiteral(
  expr: IRArrayLiteral,
  source: Record<string, unknown>,
  ir: IRDocument,
): EvalResult {
  const elements = expr.elements.map(e => {
    const result = evaluateExpr(e, source, ir);
    // For coalesce expressions, keep null
    return result.value;
  });
  return { value: elements };
}

// ---- Built-in Function Registry ----
const BUILTIN_FUNCTIONS: Record<string, (...args: unknown[]) => unknown> = {
  trim: (s) => __trim(s as string),
  title_case: (s) => __titleCase(s as string),
  lowercase: (s) => __lowercase(s as string),
  uppercase: (s) => __uppercase(s as string),
  normalize_email: (s) => __normalizeEmail(s as string),
  normalize_city: (s) => __normalizeCity(s as string),
  parse_uuid: (s) => __parseUuid(s as string),
  parse_int: (s) => __parseInt(s as string),
  to_string: (v) => __toString(v),
  filter_none: (arr) => __filterNone(arr as (unknown | null | undefined)[]),
  split_first: (s) => __splitFirst(s as string),
  split_last: (s) => __splitLast(s as string),
  now: () => __now(),
};
