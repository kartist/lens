// ============================================================
// Lens Compiler Core — source → IR pipeline
// ============================================================

import { Parser, ParseError } from './parser';
import { check, CheckResult, CheckError } from './checker';
import { generateIR } from './ir-generator';
import { IRDocument } from './ir';

export interface CompileResult {
  /** The compiled Intermediate Representation */
  ir: IRDocument;
  /** Parse errors */
  parseErrors: ParseError[];
  /** Type-check errors and warnings */
  checkResult: CheckResult;
  /** True if compilation succeeded (no errors) */
  ok: boolean;
}

/**
 * Compile Lens source code to IR in one shot.
 *
 * Pipeline: Source → Lexer → Parser → AST → Checker → IR Generator → IR
 *
 * The returned IR is the single source of truth for all codegen backends.
 */
export function compile(source: string): CompileResult {
  const parser = new Parser();
  const { document, errors: parseErrors } = parser.parse(source);

  let checkResult: CheckResult = { errors: [], warnings: [] };
  let ir: IRDocument;

  if (parseErrors.length === 0) {
    checkResult = check(document);
    ir = generateIR(document);
  } else {
    // On parse errors, still try to generate partial IR if possible
    ir = { schemas: [], typeAliases: [], mappings: [], bidirectionalMappings: [] };
  }

  const ok = parseErrors.length === 0 && checkResult.errors.length === 0;

  return { ir, parseErrors, checkResult, ok };
}
