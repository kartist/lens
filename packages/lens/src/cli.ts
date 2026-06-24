#!/usr/bin/env node
// ============================================================
// Lens CLI — compile, check, and generate from .lens files
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { Parser, ParseError } from './parser';
import { check, CheckError } from './checker';
import { generateTypeScript, generateJsonSchemas } from './codegen';

// Simple chalk-like coloring
const colors = {
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
};

interface CliOptions {
  command: 'check' | 'generate' | 'run';
  files: string[];
  output?: string;
  format?: 'typescript' | 'json-schema' | 'both';
}

function parseArgs(args: string[]): CliOptions {
  const command = args[0] as CliOptions['command'];
  const files: string[] = [];
  let output: string | undefined;
  let format: CliOptions['format'] = 'typescript';

  let i = 1;
  while (i < args.length) {
    switch (args[i]) {
      case '-o':
      case '--output':
        output = args[++i];
        break;
      case '-f':
      case '--format':
        format = args[++i] as CliOptions['format'];
        break;
      default:
        files.push(args[i]);
        break;
    }
    i++;
  }

  return { command, files, output, format };
}

function printUsage(): void {
  console.log(colors.bold('Lens DSL — Schema-first Data Integration Language'));
  console.log('');
  console.log('Usage: lens <command> [options] <files...>');
  console.log('');
  console.log('Commands:');
  console.log('  check     Type-check .lens files');
  console.log('  generate  Generate TypeScript / JSON Schema from .lens files');
  console.log('  run       Execute a mapping against JSON data');
  console.log('');
  console.log('Options:');
  console.log('  -o, --output <dir>    Output directory for generated files');
  console.log('  -f, --format <fmt>    Output format: typescript, json-schema, both');
  console.log('');
  console.log('Examples:');
  console.log('  lens check examples/customer.lens');
  console.log('  lens generate examples/customer.lens -o dist/ -f both');
}

function formatSpan(span: { start: { line: number; column: number } }): string {
  return `${span.start.line}:${span.start.column}`;
}

function formatError(err: ParseError | CheckError, source: string): string {
  const prefix = err.severity === 'error' ? colors.red('error') : colors.yellow('warning');
  const loc = formatSpan(err.span);
  return `${colors.bold(loc)} ${prefix}: ${err.message}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const opts = parseArgs(args);

  if (opts.files.length === 0) {
    console.error(colors.red('Error: No input files specified'));
    process.exit(1);
  }

  // Collect and parse all files
  const parser = new Parser();
  const allErrors: (ParseError | CheckError)[] = [];
  const documents: { file: string; doc: ReturnType<typeof parser.parse>['document'] }[] = [];

  for (const file of opts.files) {
    if (!fs.existsSync(file)) {
      console.error(colors.red(`Error: File not found: ${file}`));
      process.exit(1);
    }

    const source = fs.readFileSync(file, 'utf-8');
    const result = parser.parse(source);

    // Report parse errors
    for (const err of result.errors) {
      console.error(formatError(err, source));
    }
    allErrors.push(...result.errors);

    documents.push({ file, doc: result.document });
  }

  if (opts.command === 'check' || opts.command === 'generate') {
    // Type check all documents
    for (const { file, doc } of documents) {
      const source = fs.readFileSync(file, 'utf-8');
      const checkResult = check(doc);

      for (const err of checkResult.errors) {
        console.error(formatError(err, source));
      }
      for (const warn of checkResult.warnings) {
        console.warn(formatError(warn, source));
      }

      allErrors.push(...checkResult.errors, ...checkResult.warnings);
    }
  }

  if (opts.command === 'generate') {
    const outputDir = opts.output ?? 'dist';

    for (const { file, doc } of documents) {
      const basename = path.basename(file, '.lens');

      if (opts.format === 'typescript' || opts.format === 'both') {
        const tsCode = generateTypeScript(doc);
        const outPath = path.join(outputDir, `${basename}.ts`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, tsCode, 'utf-8');
        console.log(colors.green(`Generated: ${outPath}`));
      }

      if (opts.format === 'json-schema' || opts.format === 'both') {
        const schemas = generateJsonSchemas(doc);
        for (const [name, schema] of Object.entries(schemas)) {
          const outPath = path.join(outputDir, `${name}.schema.json`);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, JSON.stringify(schema, null, 2), 'utf-8');
          console.log(colors.green(`Generated: ${outPath}`));
        }
      }

      // Also generate runtime
      if (opts.format === 'typescript' || opts.format === 'both') {
        const runtimePath = path.join(outputDir, 'lens-runtime.ts');
        const runtimeCode = generateRuntime();
        fs.writeFileSync(runtimePath, runtimeCode, 'utf-8');
        console.log(colors.green(`Generated: ${runtimePath}`));
      }
    }
  }

  if (opts.command === 'run') {
    console.log(colors.yellow('Run mode: executing mapping with sample data...'));
    // For now, just demonstrate by loading the first file
    for (const { file, doc } of documents) {
      console.log(colors.cyan(`\nFile: ${file}`));
      console.log(`  Declarations: ${doc.declarations.length}`);

      for (const decl of doc.declarations) {
        switch (decl.kind) {
          case 'schema_decl':
            console.log(`  Schema: ${decl.name} (${decl.fields.length} fields)`);
            break;
          case 'mapping_decl':
            console.log(`  Mapping: ${decl.name} (${decl.source} -> ${decl.target})`);
            break;
          case 'bidirectional_mapping_decl':
            console.log(`  Bidirectional: ${decl.name} (${decl.source} <-> ${decl.target})`);
            break;
          case 'type_alias_decl':
            console.log(`  Type: ${decl.name}`);
            break;
        }
      }
    }
  }

  // Summary
  const errorCount = allErrors.filter(e => e.severity === 'error').length;
  const warningCount = allErrors.filter(e => e.severity === 'warning').length;

  if (errorCount > 0 || warningCount > 0) {
    console.log('');
    console.log(`${colors.red(`${errorCount} error(s)`)} ${colors.yellow(`${warningCount} warning(s)`)}`);
  }

  if (errorCount > 0) {
    process.exit(1);
  }
}

function generateRuntime(): string {
  return `// ============================================================
// Lens Runtime — built-in functions for generated code
// Auto-generated, DO NOT EDIT
// ============================================================

export function __trim(s: string): string { return s.trim(); }
export function __titleCase(s: string): string { return s.toLowerCase().replace(/(?:^|\\s)\\S/g, (c: string) => c.toUpperCase()); }
export function __lowercase(s: string): string { return s.toLowerCase(); }
export function __uppercase(s: string): string { return s.toUpperCase(); }
export function __normalizeEmail(s: string): string { return s.trim().toLowerCase(); }
export function __normalizeCity(s: string): string { return __titleCase(s.trim()); }
export function __parseUuid(s: string): string { const re = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; if (!re.test(s.trim())) throw new Error('Invalid UUID: ' + s); return s.trim(); }
export function __parseInt(s: string): number { const n = parseInt(s, 10); if (isNaN(n)) throw new Error('Not an integer: ' + s); return n; }
export function __toString(n: number): string { return String(n); }
export function __filterNone<T>(arr: (T | null | undefined)[]): T[] { return arr.filter((x): x is T => x != null); }
export function __splitFirst(s: string): string { const i = s.indexOf(' '); return i === -1 ? s : s.slice(0, i); }
export function __splitLast(s: string): string { const i = s.lastIndexOf(' '); return i === -1 ? s : s.slice(i + 1); }
export function __now(): Date { return new Date(); }
`;
}

main().catch(err => {
  console.error(colors.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
