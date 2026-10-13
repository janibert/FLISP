// Hover text for mnemonics and directives, without the VS Code API (unit-testable).
// The variant used on the hovered line is shown first, then all variants of the instruction.

const { INSTRUCTIONS, MODES, DIRECTIVES, LAB } = require('./instructions');
const { parseLine } = require('./symbols');
const { modeOf, checkOperand } = require('./addressing');

function variantSyntax(mn, v) {
  if (v.mode === 'reg') return `${mn} ${v.operand}`;
  const s = MODES[v.mode].syntax;
  return s ? `${mn} ${s}` : mn;
}

// Operation of one variant, e.g. "M(X) → A; X + 1 → X".
function operationOf(d, v) {
  const mode = MODES[v.mode];
  if (v.mode === 'reg') {
    const [r1, r2] = v.operand.split(',');
    return d.op.replace('{r1}', r1).replace('{r2}', r2);
  }
  const ea = mode.ea || '';
  let op = d.op
    .replace(/\{opr\}/g, mode.opr || `M(${ea})`)
    .replace(/\{m\}/g, v.mode === 'inh' ? 'A' : `M(${ea})`)
    .replace(/\{ea\}/g, ea);
  if (mode.pre) op = `${mode.pre}; ${op}`;
  if (mode.post) op = `${op}; ${mode.post}`;
  return op;
}

// Operation in general form, e.g. "Opr → A".
const generalOperation = (d) => d.op
  .replace(/\{opr\}/g, 'Opr').replace(/\{m\}/g, 'M').replace(/\{ea\}/g, 'EA')
  .replace('{r1}', 'R1').replace('{r2}', 'R2');

function flagsTable(flags) {
  const names = flags.length === 5 ? ['I', 'N', 'Z', 'V', 'C'] : ['N', 'Z', 'V', 'C'];
  const cell = (c) => (c === '-' ? '–' : c);
  return [
    `| ${names.join(' | ')} |`,
    `|${names.map(() => ':-:').join('|')}|`,
    `| ${[...flags].map(cell).join(' | ')} |`,
  ].join('\n');
}

// Legend for the flag symbols that actually occur, e.g. "Δ changed, – unchanged".
const LEGEND = [['Δ', 'Δ changed'], ['0', '0 cleared'], ['1', '1 set'], ['-', '– unchanged']];
const flagsLegend = (flags) => LEGEND.filter(([c]) => flags.includes(c)).map(([, text]) => text).join(', ');

// "M(X) → A; X + 1 → X · opcode F5 · 1 byte · 4 cycles"
const variantFacts = (d, v) =>
  `\`${operationOf(d, v)}\` · opcode \`${v.opcode}\` · ${v.bytes} byte${v.bytes === 1 ? '' : 's'} · ${v.cycles} cycles`;

function instructionMarkdown(mnemonic, operand) {
  const mn = mnemonic.toUpperCase();
  const d = INSTRUCTIONS[mn];
  const out = [];
  out.push(`**${mn}** — ${d.title}${d.alias ? ` (same as \`${d.alias}\`)` : ''}`);
  out.push('');

  const used = modeOf(mn, operand);
  const v = d.variants.find((x) => x.mode === used.mode && (used.mode !== 'reg' || x.operand === used.operand));
  const problem = !v && checkOperand(mn, operand);
  const wrongMode = problem && problem.message;

  if (d.variants.length === 1) {
    // Only one addressing mode: no "this line" section, just the facts.
    const only = d.variants[0];
    const mode = only.mode === 'inh' ? '' : ` · ${MODES[only.mode].name} \`${variantSyntax(mn, only)}\``;
    if (wrongMode) out.push(`**This line:** ${wrongMode}`, '');
    out.push(`${variantFacts(d, only)}${mode}`);
  } else {
    out.push(`\`${generalOperation(d)}\``, '');
    if (v) {
      const mode = MODES[v.mode];
      out.push(`**This line:** \`${variantSyntax(mn, v)}\` — ${mode.name}${v.mode === 'reg' ? '' : `: ${mode.text}`}`);
      out.push('', variantFacts(d, v));
    } else {
      out.push(`**This line:** ${wrongMode}`);
    }
  }

  out.push('');
  out.push(`**Flags** (${flagsLegend(d.flags)})`);
  out.push('');
  out.push(flagsTable(d.flags));
  if (d.note) out.push('', d.note);

  if (d.variants.length > 1) {
    out.push('', '**All variants**', '', '| Variant | Mode | Opcode | Bytes | Cycles |', '|---|---|:-:|:-:|:-:|');
    for (const x of d.variants) {
      const mark = x === v ? '**' : '';
      out.push(`| ${mark}\`${variantSyntax(mn, x)}\`${mark} | ${MODES[x.mode].name} | ${x.opcode} | ${x.bytes} | ${x.cycles} |`);
    }
  }
  return out.join('\n');
}

function directiveMarkdown(mnemonic) {
  const mn = mnemonic.toUpperCase();
  const d = DIRECTIVES[mn];
  return `**${mn}** — ${d.title} (assembler directive)\n\n\`${d.syntax}\`\n\n${d.text}\n\nA directive is an instruction for the assembler; it creates no processor instruction.`;
}

function labMarkdown(mnemonic) {
  const mn = mnemonic.toUpperCase();
  return `**${mn}** — ${LAB[mn].title}\n\n${LAB[mn].text}`;
}

// Hover for the mnemonic at `character` in `lineText`, or undefined.
function hoverAt(lineText, character) {
  const p = parseLine(lineText);
  const m = p.mnemonic;
  if (!m || character < m.start || character > m.end) return undefined;
  const mn = m.text.toUpperCase();
  let markdown;
  if (INSTRUCTIONS[mn]) markdown = instructionMarkdown(m.text, p.operand ? p.operand.text : undefined);
  else if (DIRECTIVES[mn]) markdown = directiveMarkdown(m.text);
  else if (LAB[mn]) markdown = labMarkdown(m.text);
  else return undefined;
  return { markdown, start: m.start, end: m.end };
}

module.exports = { hoverAt, modeOf, operationOf, instructionMarkdown };
