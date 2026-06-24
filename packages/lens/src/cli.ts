#!/usr/bin/env node
// ============================================================
// Lens CLI — compile, check, and generate from .lens files
// ============================================================

import * as fs from 'fs';
import * as path from 'path';
import { Parser, ParseError } from './parser';
import { check, CheckError } from './checker';
import { generateTypeScript, generateJsonSchemas, generatePython } from './codegen';
import { generateIR } from './ir-generator';
import { serializeIR } from './ir-json';
import { executeMapping, executeBidirectionalMapping } from './runtime/interpreter';

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
  format?: 'typescript' | 'json-schema' | 'python' | 'json-ir' | 'both';
  /** Mapping name to execute (for run command) */
  mapping?: string;
  /** Direction for bidirectional mapping */
  direction?: 'forward' | 'backward';
  /** Watch mode — recompile on file changes */
  watch?: boolean;
  /** Output lineage information */
  lineage?: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const command = args[0] as CliOptions['command'];
  const files: string[] = [];
  let output: string | undefined;
  let format: CliOptions['format'] = 'typescript';
  let mapping: string | undefined;
  let direction: 'forward' | 'backward' = 'forward';
  let watch = false;

  let lineage = false;

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
      case '-m':
      case '--mapping':
        mapping = args[++i];
        break;
      case '-d':
      case '--direction':
        direction = args[++i] as 'forward' | 'backward';
        break;
      case '-w':
      case '--watch':
        watch = true;
        break;
      case '-l':
      case '--lineage':
        lineage = true;
        break;
      default:
        files.push(args[i]);
        break;
    }
    i++;
  }

  return { command, files, output, format, mapping, direction, watch, lineage };
}

/** Expand glob patterns in file paths */
function expandGlobs(patterns: string[]): string[] {
  const result: string[] = [];
  for (const pattern of patterns) {
    if (pattern.includes('*') || pattern.includes('?')) {
      // Simple glob: use fs.globSync if available (Node 22+), else manual
      const dir = path.dirname(pattern) || '.';
      const base = path.basename(pattern);
      try {
        // Only expand if the directory exists
        if (fs.existsSync(dir)) {
          const entries = fs.readdirSync(dir);
          const regex = new RegExp(
            '^' + base.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
          );
          for (const entry of entries) {
            if (regex.test(entry)) {
              const fullPath = path.join(dir, entry);
              if (fs.statSync(fullPath).isFile()) {
                result.push(fullPath);
              }
            }
          }
        }
      } catch {
        // If glob fails, keep the original pattern (will fail later with file-not-found)
        result.push(pattern);
      }
    } else {
      result.push(pattern);
    }
  }
  return result;
}

function printUsage(): void {
  console.log(colors.bold('Lens DSL — Schema-first Data Integration Language'));
  console.log('');
  console.log('Usage: lens <command> [options] <files...>');
  console.log('');
  console.log('Commands:');
  console.log('  check     Type-check .lens files');
  console.log('  generate  Generate TypeScript / JSON Schema / Python from .lens files');
  console.log('  run       Execute a mapping against JSON data (read from stdin)');
  console.log('');
  console.log('Options:');
  console.log('  -o, --output <dir>     Output directory for generated files');
  console.log('  -f, --format <fmt>     Output format: typescript, json-schema, python, json-ir, both');
  console.log('  -m, --mapping <name>   Mapping name to execute (required for run)');
  console.log('  -d, --direction <dir>  Direction for bidirectional mapping: forward, backward');
  console.log('  -w, --watch            Watch files and recompile on change');
  console.log('');
  console.log('Examples:');
  console.log('  lens check examples/*.lens');
  console.log('  lens generate examples/customer.lens -o dist/ -f python');
  console.log('  lens generate examples/*.lens -o dist/ -f json-ir');
  console.log('  lens run examples/customer.lens -m LegacyToCustomer < data.json');
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

  // Expand glob patterns
  const expandedFiles = expandGlobs(opts.files);
  if (expandedFiles.length === 0) {
    console.error(colors.red('Error: No files matched the given patterns'));
    process.exit(1);
  }

  // Run once
  const errorCount = await processFiles(expandedFiles, opts);

  // Watch mode
  if (opts.watch && (opts.command === 'generate' || opts.command === 'check')) {
    console.log(colors.cyan(`\nWatching ${expandedFiles.length} file(s) for changes...`));
    for (const file of expandedFiles) {
      fs.watchFile(file, { interval: 500 }, async () => {
        console.log(colors.cyan(`\n[${new Date().toLocaleTimeString()}] File changed: ${file}`));
        await processFiles(expandedFiles, opts);
      });
    }
    // Keep process alive
    process.stdin.resume();
  } else if (errorCount > 0) {
    process.exit(1);
  }
}

async function processFiles(files: string[], opts: CliOptions): Promise<number> {
  const parser = new Parser();
  const allErrors: (ParseError | CheckError)[] = [];
  const documents: { file: string; doc: ReturnType<typeof parser.parse>['document'] }[] = [];

  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(colors.red(`Error: File not found: ${file}`));
      continue;
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
      const ir = generateIR(doc);

      if (opts.format === 'typescript' || opts.format === 'both') {
        const tsCode = generateTypeScript(ir);
        const outPath = path.join(outputDir, `${basename}.ts`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, tsCode, 'utf-8');
        console.log(colors.green(`Generated: ${outPath}`));
      }

      if (opts.format === 'json-schema' || opts.format === 'both') {
        const schemas = generateJsonSchemas(ir);
        for (const [name, schema] of Object.entries(schemas)) {
          const outPath = path.join(outputDir, `${name}.schema.json`);
          fs.mkdirSync(path.dirname(outPath), { recursive: true });
          fs.writeFileSync(outPath, JSON.stringify(schema, null, 2), 'utf-8');
          console.log(colors.green(`Generated: ${outPath}`));
        }
      }

      if (opts.format === 'python' || opts.format === 'both') {
        const pyCode = generatePython(ir);
        const outPath = path.join(outputDir, `${basename}.py`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, pyCode, 'utf-8');
        console.log(colors.green(`Generated: ${outPath}`));
      }

      if (opts.format === 'json-ir' || opts.format === 'both') {
        const irJson = serializeIR(ir);
        const outPath = path.join(outputDir, `${basename}.ir.json`);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, irJson, 'utf-8');
        console.log(colors.green(`Generated: ${outPath}`));
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
    if (!opts.mapping) {
      console.error(colors.red('Error: --mapping <name> is required for run command'));
      return 1;
    }

    // Read JSON from stdin
    let stdin: string;
    try {
      stdin = fs.readFileSync(0, 'utf-8').trim();
    } catch {
      console.error(colors.red('Error: No JSON data provided on stdin'));
      return 1;
    }
    if (!stdin) {
      console.error(colors.red('Error: No JSON data provided on stdin'));
      return 1;
    }

    let inputData: Record<string, unknown>;
    try {
      inputData = JSON.parse(stdin);
    } catch {
      console.error(colors.red('Error: Invalid JSON input'));
      return 1;
    }

    // Use the first file's IR
    for (const { file, doc } of documents) {
      const ir = generateIR(doc);

      try {
        const result = executeMapping(ir, opts.mapping, inputData);
        console.log(JSON.stringify(result.data, null, 2));
        if (opts.lineage) {
          console.log(colors.cyan('\n# Lineage:'));
          for (const [field, source] of result.lineage) {
            console.log(`  ${field} ← ${source}`);
          }
        }
        return 0;
      } catch {
        try {
          const result = executeBidirectionalMapping(ir, opts.mapping, opts.direction ?? 'forward', inputData);
          console.log(JSON.stringify(result.data, null, 2));
          if (opts.lineage) {
            console.log(colors.cyan('\n# Lineage:'));
            for (const [field, source] of result.lineage) {
              console.log(`  ${field} ← ${source}`);
            }
          }
          return 0;
        } catch (e: any) {
          console.error(colors.red(`Error executing mapping '${opts.mapping}': ${e.message}`));
          return 1;
        }
      }
    }
    return 1;
  }

  // Summary
  const errorCount = allErrors.filter(e => e.severity === 'error').length;
  const warningCount = allErrors.filter(e => e.severity === 'warning').length;

  if (errorCount > 0 || warningCount > 0) {
    console.log('');
    console.log(`${colors.red(`${errorCount} error(s)`)} ${colors.yellow(`${warningCount} warning(s)`)}`);
  }

  return errorCount;
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
