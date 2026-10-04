'use strict';

/**
 * `npm test` entry point: runs every test/*.test.js with `node --test`.
 *
 * Why a script instead of `node --test test/`: directory and glob arguments
 * behave differently across Node 18 / 20 / 22+ and across shells (cmd.exe does
 * not expand globs). Listing the files ourselves works everywhere.
 *
 *   npm test                       every test file
 *   npm test -- roulette           only files whose name contains "roulette"
 *   npm test -- --test-name-pattern="rebet"     flags are forwarded to node
 *
 * A single file can also be run directly:  node --test test/roulette.test.js
 */

// If a test runner picks this file up by itself, do nothing.
if (process.env.NODE_TEST_CONTEXT) return;

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith('-'));
const filters = args.filter((arg) => !arg.startsWith('-'));

const files = fs
  .readdirSync(__dirname)
  .filter((name) => name.endsWith('.test.js'))
  .filter((name) => filters.length === 0 || filters.some((filter) => name.includes(filter)))
  .sort()
  .map((name) => path.join('test', name));

if (files.length === 0) {
  console.error(filters.length > 0 ? `No test file matches: ${filters.join(', ')}` : 'No test files found.');
  process.exit(1);
}

const child = spawn(process.execPath, ['--test', ...flags, ...files], { cwd: root, stdio: 'inherit' });
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : code === null ? 1 : code);
});
