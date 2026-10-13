// Tests for src/completion.js. Runs without VS Code.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { completionsAt, fieldAt } = require('../src/completion');
const { analyze } = require('../src/symbols');

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const source = fs.readFileSync(path.join(__dirname, 'running-light.sflisp'), 'utf8');
const analysis = analyze(source);
const at = (line, ch = line.length, a = analysis) => completionsAt(line, ch, a);
const labels = (items) => items.slice().sort((x, y) => (x.sort < y.sort ? -1 : 1)).map((x) => x.label);

test('fieldAt finds the column of the cursor', () => {
  const f = (line, ch = line.length) => fieldAt(line, ch).field;
  assert.strictEqual(f('Lo'), 'label');
  assert.strictEqual(f('Loop        LD'), 'mnemonic');
  assert.strictEqual(f('            '), 'mnemonic');
  assert.strictEqual(f('            BRA     '), 'operand');
  assert.strictEqual(f('            LDA     #1  '), 'comment');
  assert.strictEqual(f('            PSHA    '), 'comment', 'no operand: the rest is a comment');
  assert.strictEqual(f('; comment'), 'comment');
  assert.strictEqual(f('            LDA     #1 ; c'), 'comment');
});

test('mnemonic column: mnemonics, directives and lab instructions only', () => {
  const items = at('Loop        LD');
  assert.strictEqual(items.length, 92);
  assert.ok(items.every((x) => ['mnemonic', 'directive', 'lab'].includes(x.kind)));
  assert.strictEqual(items.find((x) => x.label === 'LDA').detail, 'Load A');
  assert.strictEqual(items.find((x) => x.label === 'ORG').kind, 'directive');
  assert.ok(!items.some((x) => x.label === 'Count'), 'no symbols in the mnemonic column');
});

test('operand of branches and END: code labels first', () => {
  assert.deepStrictEqual(labels(at('            BRA     ')).slice(0, 5), ['Delay', 'Next', 'Restart', 'Start', 'Wait']);
  assert.deepStrictEqual(labels(at('            END     ')).slice(0, 5), ['Delay', 'Next', 'Restart', 'Start', 'Wait']);
});

test('immediate operand: constants first', () => {
  assert.deepStrictEqual(labels(at('            LDA     #')).slice(0, 3), ['END_MARK', 'LEDS', 'SWITCHES']);
});

test('after a comma: only the index forms the instruction allows', () => {
  assert.deepStrictEqual(labels(at('            LDA     ,')), ['+X', '+Y', '-X', '-Y', 'X+', 'X-', 'Y+', 'Y-']);
  assert.deepStrictEqual(labels(at('            LDA     ,+')), ['X', 'Y']);
  assert.deepStrictEqual(labels(at('            CLR     2,')), ['SP', 'X', 'Y']);
  assert.deepStrictEqual(labels(at('            LEAX    2,')), ['SP', 'X']);
  assert.deepStrictEqual(labels(at('            CLR     ,')), [], 'CLR has no auto increment');
});

test('TFR and EXG: register pairs', () => {
  assert.deepStrictEqual(labels(at('            TFR     ')), ['A,CC', 'CC,A', 'SP,X', 'SP,Y', 'X,SP', 'X,Y', 'Y,SP', 'Y,X']);
});

test('label column: symbols that are used but not defined', () => {
  const a = analyze('\tORG\t$20\n\tBRA\tLoop\n\tJSR\tSub\nSub\tRTS\n');
  assert.deepStrictEqual(labels(at('Lo', 2, a)), ['Loop']);
});

test('no suggestions in comments, after the operand, or in FCS strings', () => {
  assert.deepStrictEqual(at('; com'), []);
  assert.deepStrictEqual(at('            LDA     #1  '), []);
  assert.deepStrictEqual(at('            PSHA    sa'), []);
  assert.deepStrictEqual(at('            FCS     '), []);
});

(async () => {
  let fails = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok    ${name}`);
    } catch (e) {
      fails++;
      console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`);
    }
  }
  process.exit(fails ? 1 : 0);
})();
