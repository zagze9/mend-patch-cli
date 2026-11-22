// mend: one patch tool for every AI edit format (SPEC.md version 1).
// Node 22 standard library alone. Run: node main.ts [--format=NAME] [--check] [--strict] [PATCH]
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';
const FORMATS = ['auto', 'unified', 'search-replace', 'v4a', 'json'];
class Exit2 { readonly line: string; constructor(line: string) { this.line = line; } }
class Fail { readonly code: string; readonly path: string; constructor(code: string, path: string) { this.code = code; this.path = path; } }
const blank = (s: string): boolean => s.trim() === '';
function patchLines(s: string): string[] {
  if (s === '') return [];
  const a = s.split('\n'); if (s.endsWith('\n')) a.pop();
  return a.map((x) => x.endsWith('\r') ? x.slice(0, -1) : x);
}
function safe(p: string): boolean { return p !== '' && !p.startsWith('/') && !p.includes('\\') && p.split('/').every((x) => x !== '' && x !== '.' && x !== '..'); }
interface SplitFile { lines: string[]; br: string; ends: boolean }
function splitFile(s: string): SplitFile {
  if (!s) return { lines: [], br: '\n', ends: false };
  const n = s.indexOf('\n'), br = n > 0 && s[n - 1] === '\r' ? '\r\n' : '\n';
  const lines = s.split(br), ends = s.endsWith(br); if (ends) lines.pop(); return { lines, br, ends };
}
function joinFile(lines: string[], br: string, ends: boolean): string { return lines.length ? lines.join(br) + (ends ? br : '') : ''; }
class Tree {
  private readonly orig = new Map<string, string | null>(); readonly now = new Map<string, string | null>();
  readonly moves: Array<[string, string]> = [];
  original(p: string): string | null {
    if (!this.orig.has(p)) { let v: string | null = null; try { if (statSync(p).isFile()) v = readFileSync(p, 'utf8'); } catch { /* absent */ } this.orig.set(p, v); }
    return this.orig.get(p)!;
  }
  get(p: string): string | null { return this.now.has(p) ? this.now.get(p)! : this.original(p); }
}
type Edit = (tree: Tree) => void;
function detect(lines: string[]): string | null {
  const i = lines.findIndex((l) => !blank(l)); if (i < 0) return null;
  if (lines[i]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[i]!.trimStart()[0]; if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  if (lines.some((l, n) => l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[n + 1] ?? '').startsWith('+++ ')))) return 'unified';
  return null;
}
const tr = (s: string): string => s.replace(/[ \t]+$/, '');
const tb = (s: string): string => s.replace(/^[ \t]+|[ \t]+$/g, '');
const lead = (s: string): string => /^[ \t]*/.exec(s)![0];
function occurrences(file: string[], old: string[], strict: boolean): { tier: number; at: number[] } {
  if (!old.length) return { tier: 0, at: [] };
  for (let tier = 0; tier <= (strict ? 0 : 2); tier++) {
    const norm = (x: string) => tier === 0 ? x : tier === 1 ? tr(x) : tb(x); const at: number[] = [];
    for (let i = 0; i + old.length <= file.length; i++) if (old.every((x, k) => norm(file[i + k]!) === norm(x))) at.push(i);
    if (at.length) return { tier, at };
  }
  return { tier: -1, at: [] };
}
function tierReplace(lines: string[], old: string[], fresh: string[], kinds: string[], contextAt: number[], at: number, tier: number): string[] {
  const f = lead(lines[at] ?? ''), p = lead(old[0] ?? ''); const out: string[] = [];
  for (let j = 0; j < fresh.length; j++) {
    if (kinds[j] === ' ') out.push(lines[at + contextAt[j]!]!);
    else { let x = fresh[j]!; if (tier === 2 && x.trim() && p && x.startsWith(p)) x = f + x.slice(p.length); out.push(x); }
  }
  return out;
}
interface Hunk { a: number; o: string[]; n: string[]; kinds: string[]; contextAt: number[]; noNl: boolean }
interface USection { old: string | null; neu: string | null; create: boolean; del: boolean; hunks: Hunk[] }
function stripPath(s: string): string | null {
  let p = s.split('\t')[0]!.trim(); if (p === '/dev/null') return null;
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2); return p;
}
function parseUnified(lines: string[]): USection[] {
  const secs: USection[] = []; let cur: USection | null = null; let h: Hunk | null = null;
  const start = (old: string | null, neu: string | null): USection => { const s = { old, neu, create: false, del: false, hunks: [] }; secs.push(s); return s; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!; const ln = i + 1;
    if (l.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.+) b\/(.+)$/.exec(l); if (!m) throw new Exit2(`error: parse ${ln}`);
      if (h) while (h.o.length && h.o.at(-1) === '' && h.n.at(-1) === '' && h.kinds.at(-1) === ' ') { h.o.pop(); h.n.pop(); h.kinds.pop(); h.contextAt.pop(); }
      cur = start(m[1]!, m[2]!); h = null; continue;
    }
    if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      if (h) while (h.o.length && h.o.at(-1) === '' && h.n.at(-1) === '' && h.kinds.at(-1) === ' ') { h.o.pop(); h.n.pop(); h.kinds.pop(); h.contextAt.pop(); }
      const old = stripPath(l.slice(4)), neu = stripPath(lines[++i]!.slice(4));
      if (!cur || cur.hunks.length) cur = start(old, neu); else { cur.old = old; cur.neu = neu; }
      h = null; continue;
    }
    if (l.startsWith('--- ') && cur && !cur.hunks.length) throw new Exit2(`error: parse ${ln + 1}`);
    if (l.startsWith('@@')) {
      if (h) while (h.o.length && h.o.at(-1) === '' && h.n.at(-1) === '' && h.kinds.at(-1) === ' ') { h.o.pop(); h.n.pop(); h.kinds.pop(); h.contextAt.pop(); }
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
      if (!cur || !m) throw new Exit2(`error: parse ${ln}`);
      h = { a: Number(m[1]), o: [], n: [], kinds: [], contextAt: [], noNl: false }; cur.hunks.push(h); continue;
    }
    if (cur && h) {
      if (l.startsWith('\\ No newline at end of file')) { h.noNl = true; continue; }
      if (l.startsWith('diff --git ') || (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ '))) { h = null; i--; continue; }
      if (l === '' || /^[ +\\-]/.test(l)) {
        const mark = l === '' ? ' ' : l[0]!, text = l === '' ? '' : l.slice(1);
        if (mark === ' ' || mark === '-') h.o.push(text);
        if (mark === ' ' || mark === '+') { h.n.push(text); h.kinds.push(mark); h.contextAt.push(mark === ' ' ? h.o.length - 1 : -1); }
        if (mark === '\\') h.noNl = true; continue;
      }
      h = null;
      if (l.startsWith('rename from ')) cur.old = l.slice(12);
      else if (l.startsWith('rename to ')) cur.neu = l.slice(10);
      else if (l.startsWith('new file mode')) cur.create = true;
      else if (l.startsWith('deleted file mode')) cur.del = true;
      continue;
    }
    if (l.startsWith('rename from ') || l.startsWith('rename to ') || l.startsWith('new file mode') || l.startsWith('deleted file mode')) {
      if (!cur) cur = start(null, null);
      if (l.startsWith('rename from ')) cur.old = l.slice(12);
      else if (l.startsWith('rename to ')) cur.neu = l.slice(10);
      else if (l.startsWith('new file mode')) cur.create = true; else cur.del = true;
    }
  }
  return secs;
}
function unifiedEdit(s: USection, strict: boolean): Edit {
  return (tree) => {
    let old = s.old, neu = s.neu; if (old === null && neu === null) throw new Exit2('error: parse 1');
    if (old === null) old = neu; if (neu === null) neu = old;
    for (const p of [old!, neu!]) if (!safe(p)) throw new Fail('unsafe', p);
    const create = s.create || s.old === null, del = s.del || s.neu === null;
    if (create && !del) {
      if (tree.get(neu!) !== null) throw new Fail('exists', neu!);
      const adds = s.hunks.flatMap((x) => x.n), last = s.hunks.at(-1);
      tree.now.set(neu!, joinFile(adds, '\n', !!last && last.n.length > 0 && !last.noNl)); return;
    }
    const src = tree.get(old!); if (src === null) throw new Fail('missing', old!);
    if (del) { tree.now.set(old!, null); return; }
    if (neu !== old! && tree.get(neu!) !== null) throw new Fail('exists', neu!);
    const f = splitFile(src), lines = [...f.lines]; let delta = 0, ends = f.ends;
    for (const h of s.hunks) {
      let at: number, tier = 0;
      if (h.o.length) {
        const found = occurrences(lines, h.o, strict); if (found.tier < 0) throw new Fail('no-match', old!);
        tier = found.tier; const target = h.a - 1 + delta;
        at = found.at.reduce((best, x) => Math.abs(x - target) < Math.abs(best - target) ? x : best);
      } else at = Math.min(Math.max(0, h.a + delta), lines.length);
      const atEnd = at + h.o.length === lines.length || (!h.o.length && at === lines.length);
      const rep = tierReplace(lines, h.o, h.n, h.kinds, h.contextAt, at, tier);
      lines.splice(at, h.o.length, ...rep); delta += h.n.length - h.o.length; if (atEnd) ends = !h.noNl;
    }
    const out = joinFile(lines, f.br, ends);
    if (neu !== old!) { tree.now.set(neu!, out); tree.now.set(old!, null); tree.moves.push([old!, neu!]); } else tree.now.set(old!, out);
  };
}
function unifiedEdits(lines: string[], strict: boolean): Edit[] {
  const s = parseUnified(lines); if (!s.length || s.some((x) => x.old === null && x.neu === null)) throw new Exit2('error: parse 1');
  return s.map((x) => unifiedEdit(x, strict));
}
interface SearchBlock { path: string; old: string[]; neu: string[] }
function searchEdits(lines: string[], strict: boolean): Edit[] {
  const blocks: SearchBlock[] = []; let lastPath: string | null = null, prevEnd = 0;
  for (let i = 0; i < lines.length;) {
    if (lines[i]!.trimEnd() !== '<<<<<<< SEARCH') { i++; continue; }
    const start = i; let path: string | null = null;
    for (let k = i - 1; k >= prevEnd; k--) { const x = lines[k]!.trim(); if (x && !x.startsWith('```')) { path = x; break; } }
    path ??= lastPath; if (path === null) throw new Exit2(`error: parse ${start + 1}`);
    let sep = i + 1; while (sep < lines.length && lines[sep]!.trimEnd() !== '=======') sep++;
    if (sep === lines.length) throw new Exit2(`error: parse ${start + 1}`);
    let end = sep + 1; while (end < lines.length && lines[end]!.trimEnd() !== '>>>>>>> REPLACE') end++;
    if (end === lines.length) throw new Exit2(`error: parse ${start + 1}`);
    blocks.push({ path, old: lines.slice(i + 1, sep), neu: lines.slice(sep + 1, end) });
    lastPath = path; prevEnd = end + 1; i = end + 1;
  }
  if (!blocks.length) throw new Exit2('error: parse 1');
  return blocks.map((b) => (tree) => {
    if (!safe(b.path)) throw new Fail('unsafe', b.path);
    if (!b.old.length) { if (tree.get(b.path) !== null) throw new Fail('exists', b.path); tree.now.set(b.path, joinFile(b.neu, '\n', b.neu.length > 0)); return; }
    const src = tree.get(b.path); if (src === null) throw new Fail('missing', b.path);
    const f = splitFile(src), found = occurrences(f.lines, b.old, strict);
    if (!found.at.length) throw new Fail('no-match', b.path); if (found.at.length > 1) throw new Fail('ambiguous', b.path);
    const at = found.at[0]!, rep = tierReplace(f.lines, b.old, b.neu, b.neu.map(() => '+'), [], at, found.tier);
    f.lines.splice(at, b.old.length, ...rep); tree.now.set(b.path, joinFile(f.lines, f.br, f.ends));
  });
}
interface VChunk { anchor: string | null; end: boolean; old: string[]; neu: string[]; kinds: string[]; contextAt: number[] }
interface VSection { op: 'add'|'delete'|'update'; path: string; move: string | null; add: string[]; chunks: VChunk[]; line: number }
function parseV4a(lines: string[]): VSection[] {
  const first = lines.findIndex((x) => !blank(x)); let last = lines.length - 1; while (last >= 0 && blank(lines[last]!)) last--;
  if (first < 0 || lines[first]!.trim() !== '*** Begin Patch') throw new Exit2(`error: parse ${first < 0 ? 1 : first + 1}`);
  if (last <= first || lines[last]!.trim() !== '*** End Patch') throw new Exit2(`error: parse ${lines.length + 1}`);
  const out: VSection[] = []; let sec: VSection | null = null, chunk: VChunk | null = null;
  const finish = () => { if (sec && chunk) sec.chunks.push(chunk); chunk = null; };
  for (let i = first + 1; i < last; i++) {
    const l = lines[i]!, ln = i + 1; const m = /^\*\*\* (Add File|Delete File|Update File):\s*(.*?)\s*$/.exec(l);
    if (m) { finish(); sec = { op: m[1] === 'Add File' ? 'add' : m[1] === 'Delete File' ? 'delete' : 'update', path: m[2]!, move: null, add: [], chunks: [], line: ln }; out.push(sec); continue; }
    if (blank(l) && !chunk) continue; if (!sec) throw new Exit2(`error: parse ${ln}`);
    if (sec.op === 'add') { if (l === '') continue; if (l.startsWith('+')) sec.add.push(l.slice(1)); else throw new Exit2(`error: parse ${ln}`); continue; }
    if (sec.op === 'delete') throw new Exit2(`error: parse ${ln}`);
    if (!chunk && l.startsWith('*** Move to: ')) { sec.move = l.slice(13).trim(); continue; }
    if (l === '*** End of File') { if (!chunk) chunk = { anchor: null, end: true, old: [], neu: [], kinds: [], contextAt: [] }; chunk.end = true; finish(); continue; }
    if (l.startsWith('@@')) { finish(); chunk = { anchor: l.slice(2).trim() || null, end: false, old: [], neu: [], kinds: [], contextAt: [] }; continue; }
    if (!chunk) chunk = { anchor: null, end: false, old: [], neu: [], kinds: [], contextAt: [] };
    if (l === '') { chunk.old.push(''); chunk.neu.push(''); chunk.kinds.push(' '); chunk.contextAt.push(chunk.old.length - 1); }
    else if (l[0] === ' ') { chunk.old.push(l.slice(1)); chunk.neu.push(l.slice(1)); chunk.kinds.push(' '); chunk.contextAt.push(chunk.old.length - 1); }
    else if (l[0] === '-') chunk.old.push(l.slice(1));
    else if (l[0] === '+') { chunk.neu.push(l.slice(1)); chunk.kinds.push('+'); chunk.contextAt.push(-1); }
    else throw new Exit2(`error: parse ${ln}`);
  }
  finish(); for (const s of out) if (s.op === 'update' && !s.chunks.length && s.move === null) throw new Exit2(`error: parse ${s.line}`);
  if (!out.length) throw new Exit2(`error: parse ${first + 1}`); return out;
}
function v4aEdit(s: VSection, strict: boolean): Edit {
  return (tree) => {
    if (!safe(s.path)) throw new Fail('unsafe', s.path);
    if (s.op === 'add') { if (tree.get(s.path) !== null) throw new Fail('exists', s.path); tree.now.set(s.path, joinFile(s.add, '\n', true)); return; }
    const src = tree.get(s.path); if (src === null) throw new Fail('missing', s.path);
    if (s.op === 'delete') { tree.now.set(s.path, null); return; }
    if (s.move !== null && !safe(s.move)) throw new Fail('unsafe', s.move);
    if (s.move !== null && tree.get(s.move) !== null) throw new Fail('exists', s.move);
    const f = splitFile(src), a = [...f.lines]; let cursor = 0;
    for (const c of s.chunks) {
      let at = cursor, tier = 0;
      if (c.anchor !== null) {
        let hit = -1;
        for (let t = 0; t <= (strict ? 0 : 2); t++) {
          const one = occurrences(a.slice(cursor), [c.anchor], t === 0);
          if (one.at.length) { hit = one.at[0]!; break; }
        }
        if (hit < 0) throw new Fail('no-match', s.path);
        cursor += hit + 1;
      }
      if (c.old.length) {
        const found = occurrences(a, c.old, strict), valid = found.at.filter((x) => x >= cursor && (!c.end || x + c.old.length === a.length));
        if (!valid.length) throw new Fail('no-match', s.path);
        at = valid[0]!; tier = found.tier;
      }
      if (c.end) at = a.length;
      const rep = tierReplace(a, c.old, c.neu, c.kinds, c.contextAt, at, tier); a.splice(at, c.old.length, ...rep); cursor = at + rep.length;
    }
    const result = joinFile(a, f.br, f.ends);
    if (s.move !== null) { tree.now.set(s.move, result); tree.now.set(s.path, null); tree.moves.push([s.path, s.move]); } else tree.now.set(s.path, result);
  };
}
function run(args: string[]): { code: number; out: string[] } {
  let format: string | null = null, check = false, strict = false, ended = false; const pos: string[] = [];
  for (const a of args) {
    if (!ended && a === '--') { ended = true; continue; }
    if (!ended && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMATS.includes(a.slice(9))) format = a.slice(9);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
    } else pos.push(a);
  }
  if (pos.length > 1) return { code: 2, out: ['error: usage'] };
  const file = pos.length === 0 || pos[0] === '-' ? null : pos[0]!; let text = '';
  try { text = readFileSync(file ?? 0, 'utf8'); } catch { if (file !== null) return { code: 2, out: ['error: no-patch'] }; }
  const lines = patchLines(text), kind = format === null || format === 'auto' ? detect(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };
  let edits: Edit[];
  try {
    edits = kind === 'json' ? jsonEdits(text, lines) : kind === 'unified' ? unifiedEdits(lines, strict) : kind === 'search-replace' ? searchEdits(lines, strict) : parseV4a(lines).map((s) => v4aEdit(s, strict));
    if (!edits.length) throw new Exit2('error: parse 1');
  } catch (e) { if (e instanceof Exit2) return { code: 2, out: [e.line] }; throw e; }
  const tree = new Tree(), failures: Fail[] = [];
  for (const edit of edits) {
    const before = new Map(tree.now), moveCount = tree.moves.length;
    try { edit(tree); } catch (e) { if (!(e instanceof Fail)) throw e; tree.now.clear(); for (const [p, v] of before) tree.now.set(p, v); tree.moves.length = moveCount; failures.push(e); }
  }
  if (failures.length) return { code: 1, out: [...failures.map((f) => `error: ${f.code} ${f.path}`), `failed: ${failures.length} of ${edits.length} edits`] };
  const changed: Array<{ p: string; old: string | null; value: string | null }> = [];
  for (const p of tree.now.keys()) { const old = tree.original(p), value = tree.now.get(p)!; if (old !== value) changed.push({ p, old, value }); }
  const moved = new Map<string, string>(), movedFrom = new Set<string>();
  for (const [from, to] of tree.moves) if (changed.some((x) => x.p === from && x.old !== null && x.value === null) && changed.some((x) => x.p === to && x.old === null && x.value !== null)) { moved.set(to, from); movedFrom.add(from); }
  const rows = changed.filter((x) => !movedFrom.has(x.p)).map((x) => ({ sort: x.p, line: moved.has(x.p) ? `R ${moved.get(x.p)} -> ${x.p}` : `${x.old === null ? 'A' : x.value === null ? 'D' : 'M'} ${x.p}` }));
  rows.sort((a, b) => Buffer.compare(Buffer.from(a.sort), Buffer.from(b.sort)));
  if (!check) for (const x of changed) { if (x.value === null) rmSync(x.p, { force: true }); else { mkdirSync(dirname(x.p), { recursive: true }); writeFileSync(x.p, x.value); } }
  return { code: 0, out: [...rows.map((x) => x.line), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}
const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  const { runTrial } = await import('./runner.ts'); await runTrial(trialEnv);
} else { const r = run(process.argv.slice(2)); writeSync(1, r.out.map((l) => `${l}\n`).join('')); process.exitCode = r.code; }

function jsonEdit(v: unknown): Edit | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>, p = o.path; if (typeof p !== 'string') return null;
  if (o.command === 'create' && typeof o.file_text === 'string') return (t) => {
    if (!safe(p)) throw new Fail('unsafe', p); if (t.get(p) !== null) throw new Fail('exists', p); t.now.set(p, o.file_text as string);
  };
  if (o.command === 'str_replace' && typeof o.old_str === 'string' && o.old_str !== '' && (o.new_str === undefined || typeof o.new_str === 'string')) return (t) => {
    if (!safe(p)) throw new Fail('unsafe', p); const before = t.get(p); if (before === null) throw new Fail('missing', p);
    const crlf = before.includes('\r\n'), norm = (s: string) => crlf ? s.replaceAll('\r\n', '\n') : s;
    const src = norm(before), old = norm(o.old_str as string), neu = norm((o.new_str as string | undefined) ?? ''); let count = 0;
    for (let i = src.indexOf(old); i >= 0; i = src.indexOf(old, i + 1)) count++;
    if (!count) throw new Fail('no-match', p); if (count > 1) throw new Fail('ambiguous', p);
    const i = src.indexOf(old), out = src.slice(0, i) + neu + src.slice(i + old.length); t.now.set(p, crlf ? out.replaceAll('\n', '\r\n') : out);
  };
  if (o.command === 'insert' && Number.isInteger(o.insert_line) && typeof o.new_str === 'string') return (t) => {
    if (!safe(p)) throw new Fail('unsafe', p); const before = t.get(p); if (before === null) throw new Fail('missing', p);
    const f = splitFile(before), n = o.insert_line as number; if (n < 0 || n > f.lines.length) throw new Fail('no-match', p);
    f.lines.splice(n, 0, ...patchLines(o.new_str as string)); t.now.set(p, joinFile(f.lines, f.br, f.ends));
  };
  return null;
}
function jsonEdits(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !blank(l)); if (first < 0) throw new Exit2('error: parse 1'); const out: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let a: unknown; try { a = JSON.parse(text); } catch { throw new Exit2(`error: parse ${first + 1}`); }
    if (!Array.isArray(a)) throw new Exit2(`error: parse ${first + 1}`);
    for (const x of a) { const e = jsonEdit(x); if (!e) throw new Exit2(`error: parse ${first + 1}`); out.push(e); } return out;
  }
  lines.forEach((l, i) => { if (blank(l)) return; let e: Edit | null = null; try { e = jsonEdit(JSON.parse(l)); } catch { /* invalid line */ }
    if (!e) throw new Exit2(`error: parse ${i + 1}`); out.push(e); }); return out;
}
