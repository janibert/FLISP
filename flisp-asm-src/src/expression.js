// Expressions in operands, read like qaflisp 1.3 (no VS Code API; see CONTRIBUTING.md):
//   numbers   $1F hex, %0101 binary, 42 decimal, 'A' character; a number runs to the end of the word
//   operators * / %  bind stronger than  + - & | ^ << >> && ||  (two levels, both left to right);
//             unary - ~ ! bind strongest; parentheses. After an operand '%' is modulo.
//   values    32-bit integers, truncated only when the byte is generated

// Splits an operand into tokens: number, symbol, char, string, op, other.
function tokenize(text) {
  const tokens = [];
  let afterOperand = false; // decides whether '%' is modulo or the binary prefix
  let i = 0;
  const push = (type, start, end) => {
    tokens.push({ type, text: text.slice(start, end), start, end });
    afterOperand = type === 'number' || type === 'symbol' || type === 'char' || (type === 'op' && text[start] === ')');
  };
  while (i < text.length) {
    const c = text[i];
    const start = i;
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      i = Math.min(i + 1, text.length);
      push('string', start, i);
    } else if (c === "'") {
      i = Math.min(i + 3, text.length);
      push('char', start, i);
    } else if (/[A-Za-z_]/.test(c)) {
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
      push('symbol', start, i);
    } else if (/[0-9$]/.test(c) || (c === '%' && !afterOperand)) {
      i++;
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
      push('number', start, i);
    } else if ((c === '<' || c === '>' || c === '&' || c === '|') && text[i + 1] === c) {
      i += 2;
      push('op', start, i);
    } else if (/[-+*/%&|^~!()]/.test(c)) {
      i++;
      push('op', start, i);
    } else {
      i++;
      push('other', start, i); // ',', '#', blanks, ...
    }
  }
  return tokens;
}

// Value of a number token, or undefined if its digits do not fit the base.
function numberValue(word) {
  if (/^\$[0-9A-Fa-f]+$/.test(word)) return parseInt(word.slice(1), 16) | 0;
  if (/^%[01]+$/.test(word)) return parseInt(word.slice(1), 2) | 0;
  if (/^[0-9]+$/.test(word)) return parseInt(word, 10) | 0;
  return undefined;
}

const MULTIPLICATIVE = new Set(['*', '/', '%']);
const ADDITIVE = new Set(['+', '-', '&', '|', '^', '<<', '>>', '&&', '||']);
const UNARY = new Set(['-', '~', '!']);
// Register names are reserved in expressions; PC is not (qaflisp: "Undefined symbol 'PC'").
const RESERVED = new Set(['A', 'X', 'Y', 'SP', 'CC']);

function apply(op, a, b) {
  switch (op) {
    case '*': return Math.imul(a, b);
    case '/': return Math.trunc(a / b) | 0; // b === 0 is reported before
    case '%': return b === 0 ? 0 : (a % b) | 0; // qaflisp: x%0 is 0
    case '+': return (a + b) | 0;
    case '-': return (a - b) | 0;
    case '&': return a & b;
    case '|': return a | b;
    case '^': return a ^ b;
    case '<<': return a << b;
    case '>>': return a >> b;
    case '&&': return a !== 0 && b !== 0 ? 1 : 0;
    case '||': return a !== 0 || b !== 0 ? 1 : 0;
    default: return undefined;
  }
}

class ExpressionError extends Error {
  constructor(start, end, message) {
    super(message);
    this.problem = { start, end, severity: 'error', message };
  }
}

// Parses an expression (text without '#' or index part) like qaflisp. Returns
//   { value, problem }  value: undefined if not known without assembling (labels) or invalid;
//                       problem: undefined or { start, end, severity, message } (offsets in text).
// `valueOf(name)` gives the value of a symbol or undefined.
function parse(text, valueOf = () => undefined) {
  const tokens = tokenize(text);
  let pos = 0;
  let warning;
  const peek = () => tokens[pos];
  const isOp = (t, set) => t && t.type === 'op' && set.has(t.text);
  const fail = (t, message) => {
    throw t ? new ExpressionError(t.start, t.end, message) : new ExpressionError(text.length, text.length, message);
  };
  const describe = (t) => (t.type === 'char' ? t.text : `'${t.text}'`);

  function unexpected(t, depth) {
    if (t.type === 'other' || t.type === 'string') {
      if (t.text === '<' || t.text === '>') fail(t, `Unexpected character '${t.text}' — there are no comparisons; for a shift write ${t.text}${t.text}`);
      if (t.text === ',') fail(t, depth ? "Missing Parenthesis: ',' inside parentheses — a value cannot contain a list" : "Unterminated expression: ',' where a value is expected");
      fail(t, `Unexpected character ${describe(t)} in the expression`);
    }
    return undefined;
  }

  // An operand: number, character, symbol, (expression) or unary operator with its operand.
  function operand(depth) {
    const t = peek();
    if (!t) fail(undefined, depth ? "Missing Parenthesis: '(' is not closed" : 'Unterminated expression: a value is missing at the end');
    if (t.type === 'op' && t.text === ')') {
      if (!depth) fail(t, "Unexpected Parenthesis: ')' without '('");
      // qaflisp reads a missing operand before ')' as 0: "(2+)" is 2, "()" is 0
      if (!warning) warning = { start: t.start, end: t.end, severity: 'warning', message: "Missing value before ')' — qaflisp silently uses 0 here" };
      return 0;
    }
    pos++;
    if (t.type === 'number') return numberValue(t.text);
    if (t.type === 'char') {
      if (t.text.length !== 3 || t.text[2] !== "'") fail(t, "Character constant without closing quote — write 'A'");
      return t.text.charCodeAt(1);
    }
    if (t.type === 'symbol') {
      if (RESERVED.has(t.text.toUpperCase())) fail(t, `Illegal use of reserved word '${t.text}' — register names cannot be used in expressions`);
      return valueOf(t.text);
    }
    if (t.type === 'op' && t.text === '(') {
      const v = additive(depth + 1);
      const close = peek();
      if (!close || close.text !== ')') {
        if (close) unexpected(close, depth + 1);
        fail(close, close ? `Missing operator before ${describe(close)}` : "Missing Parenthesis: '(' is not closed");
      }
      pos++;
      return v;
    }
    if (isOp(t, UNARY)) {
      const v = operand(depth);
      if (v === undefined) return undefined;
      if (t.text === '-') return -v | 0;
      if (t.text === '~') return ~v;
      return v === 0 ? 1 : 0;
    }
    if (t.type === 'op' && t.text === '*' && pos === 1) fail(t, "Operand expected: there is no location counter '*' — put a label on the line and use it");
    if (t.type === 'op') fail(t, `Operand expected: '${t.text}' needs a value before it`);
    return unexpected(t, depth);
  }

  function multiplicative(depth) {
    let v = operand(depth);
    while (isOp(peek(), MULTIPLICATIVE)) {
      const op = tokens[pos++];
      const w = operand(depth);
      if (op.text === '/' && w === 0) throw new ExpressionError(op.start, op.end, 'Integer divide by zero');
      v = v === undefined || w === undefined ? undefined : apply(op.text, v, w);
    }
    return v;
  }

  function additive(depth) {
    let v = multiplicative(depth);
    for (;;) {
      const t = peek();
      if (isOp(t, ADDITIVE)) {
        pos++;
        const w = multiplicative(depth);
        v = v === undefined || w === undefined ? undefined : apply(t.text, v, w);
      } else if (isOp(t, new Set(['~', '!']))) {
        // qaflisp silently drops everything before a '~' or '!' that follows a value: 1~2 is ~2
        if (!warning) warning = { start: t.start, end: t.end, severity: 'warning', message: `Missing operator before '${t.text}' — qaflisp silently drops the value before it (1${t.text}2 is ${t.text}2)` };
        multiplicative(depth);
        v = undefined;
      } else {
        return v;
      }
    }
  }

  try {
    const value = additive(0);
    const rest = peek();
    if (rest) {
      if (rest.text === ')') fail(rest, "Unexpected Parenthesis: ')' without '('");
      unexpected(rest, 0);
      fail(rest, rest.text === '(' ? "Missing operator before '('" : `Missing operator before ${describe(rest)}`);
    }
    return { value: warning ? undefined : value, problem: warning };
  } catch (e) {
    if (e instanceof ExpressionError) return { value: undefined, problem: e.problem };
    throw e;
  }
}

// Value of an expression, or undefined if it is not known without assembling or has a problem.
function evaluate(text, valueOf) {
  const r = parse(text, valueOf);
  return r.problem ? undefined : r.value;
}

// Values of the EQU constants of an analysis (symbols.analyze), as far as they are known
// without assembling. Labels of code and data have no value here.
function constantValues(definitions) {
  const operands = new Map();
  for (const d of definitions) {
    if (d.kind !== 'constant' || d.operand === undefined) continue;
    operands.set(d.name, operands.has(d.name) ? undefined : d.operand); // defined twice: unknown
  }
  const values = new Map();
  const busy = new Set();
  const valueOf = (name) => {
    if (values.has(name)) return values.get(name);
    const operand = operands.get(name);
    if (operand === undefined || busy.has(name)) return undefined;
    busy.add(name);
    const v = evaluate(operand, valueOf);
    busy.delete(name);
    values.set(name, v);
    return v;
  };
  return valueOf;
}

module.exports = { tokenize, numberValue, parse, evaluate, constantValues, RESERVED };
