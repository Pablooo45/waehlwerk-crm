// Gleicht alle Datenbank-Abfragen im Code mit dem echten Datenbank-Aufbau ab:
// Tabellen, Spalten, verknüpfte Tabellen in select(), Filter, insert/update-Felder,
// RPC-Funktionen mit ihren Parametern, Speicher-Buckets und Realtime-Tabellen.
// So fallen Tippfehler und vergessene Migrationen auf, bevor jemand im echten Betrieb klickt.
//
// Nutzung (nach den Migrationen, siehe scripts/test-db.sh):
//   PGHOST=/tmp PGPORT=54329 PGUSER=postgres node scripts/check-queries.mjs <datenbank>

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const db = process.argv[2];
if (!db) {
  console.error('Datenbankname fehlt');
  process.exit(2);
}

const SCHEMA_SQL = `
select json_build_object(
  'relations', (
    select json_object_agg(c.relname, json_build_object(
      'kind', c.relkind,
      'columns', (select json_agg(a.attname order by a.attnum) from pg_attribute a
                  where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')),
  'fks', coalesce((
    select json_agg(json_build_object('name', con.conname, 'from', cf.relname, 'to', ct.relname,
      'cols', (select json_agg(a.attname) from unnest(con.conkey) k join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k)))
    from pg_constraint con
    join pg_class cf on cf.oid = con.conrelid
    join pg_class ct on ct.oid = con.confrelid
    join pg_namespace n on n.oid = cf.relnamespace
    where con.contype = 'f' and n.nspname = 'public'), '[]'::json),
  'functions', coalesce((
    select json_agg(json_build_object('name', p.proname, 'args', case when p.proargnames is null then '[]'::json else coalesce((
      select json_agg(x.nm) from unnest(p.proargnames, coalesce(p.proargmodes::text[], array_fill('i'::text, array[cardinality(p.proargnames)]))) as x(nm, md)
      where x.md in ('i', 'b', 'v')), '[]'::json) end))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'), '[]'::json),
  'buckets', coalesce((select json_agg(id) from storage.buckets), '[]'::json),
  'realtime', coalesce((select json_agg(tablename) from pg_publication_tables where pubname = 'supabase_realtime'), '[]'::json)
)`;

const schema = JSON.parse(execFileSync('psql', ['-At', '-d', db, '-c', SCHEMA_SQL], { encoding: 'utf8' }));
const relations = schema.relations ?? {};
const fks = schema.fks;
const functions = new Map();
for (const f of schema.functions) functions.set(f.name, [...(functions.get(f.name) ?? []), f.args ?? []]);
const buckets = new Set(schema.buckets);
const realtime = new Set(schema.realtime);

const ROOT = new URL('..', import.meta.url).pathname;
const FILES = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name.startsWith('.') || name === '_tests') continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) FILES.push(p);
  }
}
walk(join(ROOT, 'src'));
walk(join(ROOT, 'supabase/functions'));

// Programm mit Typinformationen: so lassen sich auch Felder prüfen, die per Objekt/Spread übergeben werden
const cfgPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json');
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, ROOT);
const program = ts.createProgram({ rootNames: FILES, options: { ...cfg.options, noEmit: true, skipLibCheck: true } });
const checker = program.getTypeChecker();

const problems = [];
let checked = 0;

function report(sf, node, msg) {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  problems.push(`${relative(ROOT, sf.fileName)}:${line + 1}  ${msg}`);
}

const hasColumn = (table, col) => (relations[table]?.columns ?? []).includes(col);
const isView = (table) => ['v', 'm'].includes(relations[table]?.kind);

/** Text eines String-Literals oder einer Template-Zeichenkette ohne Platzhalter */
function literal(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/** Verknüpfung zwischen zwei Tabellen (in beide Richtungen), ggf. über einen Hinweis */
function related(from, to, hint) {
  return fks.filter(
    (fk) =>
      ((fk.from === from && fk.to === to) || (fk.from === to && fk.to === from)) &&
      (!hint || hint === 'inner' || hint === 'left' || fk.name === hint || fk.cols.includes(hint)),
  );
}

/** Alle möglichen Texte: Literal oder Bedingung mit Literalen (a ? 'x' : 'y') */
function literalsOf(node) {
  if (!node) return [];
  if (ts.isParenthesizedExpression(node)) return literalsOf(node.expression);
  if (ts.isConditionalExpression(node)) return [...literalsOf(node.whenTrue), ...literalsOf(node.whenFalse)];
  const s = literal(node);
  return s == null ? [] : [s];
}

/** PostgREST-select-Ausdruck an einer Tabelle prüfen; gibt Aliasse → Tabellen zurück */
function checkSelect(sf, node, table, text, embeds = new Map()) {
  for (const raw of splitTop(text)) {
    let item = raw.trim();
    if (!item || item === '*' || item === 'count') continue;
    if (item.startsWith('...')) item = item.slice(3);
    let alias = null;
    const m = /^([\w]+)\s*:\s*(.+)$/s.exec(item);
    if (m && !m[2].startsWith(':')) {
      alias = m[1];
      item = m[2].trim();
    }
    const emb = /^([\w]+)(?:!([\w]+))?(?:!([\w]+))?\s*\((.*)\)$/s.exec(item);
    if (emb) {
      const [, target, hint1, hint2, inner] = emb;
      if (/^(count|sum|avg|min|max)$/.test(target)) continue;
      let targetTable = target;
      if (!relations[targetTable]) {
        // Name kann auch eine Fremdschlüssel-Spalte sein (z. B. owner:owner_id(...))
        const viaCol = fks.find((fk) => fk.from === table && fk.cols.includes(target));
        if (viaCol) targetTable = viaCol.to;
      }
      if (!relations[targetTable]) {
        report(sf, node, `select an „${table}“: Tabelle „${target}“ gibt es nicht`);
        continue;
      }
      const hint = [hint1, hint2].find((h) => h && h !== 'inner' && h !== 'left');
      if (!isView(table) && !isView(targetTable) && !related(table, targetTable, hint).length) {
        report(sf, node, `select an „${table}“: keine Verknüpfung zu „${targetTable}“${hint ? ` (Hinweis ${hint})` : ''}`);
      }
      embeds.set(alias ?? target, targetTable);
      checkSelect(sf, node, targetTable, inner, new Map());
      continue;
    }
    // Spalte, ggf. mit JSON-Pfad, Typumwandlung oder Aggregat
    const col = item.split('::')[0].split('->')[0].split('.')[0].trim();
    if (!/^[\w]+$/.test(col)) continue;
    if (!hasColumn(table, col)) report(sf, node, `select an „${table}“: Spalte „${col}“ gibt es nicht`);
  }
  return embeds;
}

/** An der obersten Ebene an Kommas trennen (Klammern beachten) */
function splitTop(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function checkColumnRef(sf, node, table, ref, embeds, what) {
  if (!ref) return;
  let col = ref.split('->')[0].trim();
  let t = table;
  if (col.includes('.')) {
    const [a, b] = col.split('.');
    t = embeds.get(a) ?? (relations[a] ? a : null);
    col = b;
    if (!t) {
      report(sf, node, `${what} an „${table}“: unbekannte Verknüpfung „${a}“`);
      return;
    }
  }
  if (!/^[\w]+$/.test(col)) return;
  if (!hasColumn(t, col)) report(sf, node, `${what} an „${t}“: Spalte „${col}“ gibt es nicht`);
}

/** Filter-Zeichenkette für .or()/.filter(): a.eq.1,and(b.is.null,c.gt.2) */
function checkOrString(sf, node, table, text, embeds) {
  for (const part of splitTop(text)) {
    const p = part.trim();
    const nested = /^(and|or|not\.and|not\.or)\((.*)\)$/s.exec(p);
    if (nested) {
      checkOrString(sf, node, table, nested[2], embeds);
      continue;
    }
    const col = p.split('.')[0];
    if (col && /^[\w]+(->>?[\w]+)*$/.test(col)) checkColumnRef(sf, node, table, col, embeds, 'Filter');
  }
}

/** Feldnamen aus dem Typ eines Ausdrucks (Objekt oder Array von Objekten); null = nicht prüfbar */
function typeKeys(node) {
  if (!node) return null;
  let type = checker.getTypeAtLocation(node);
  if (!type || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
  if (checker.isArrayType(type)) type = checker.getTypeArguments(type)[0];
  if (!type || type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
  const parts = type.isUnion() ? type.types : [type];
  const keys = new Set();
  for (const t of parts) {
    if (t.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return null;
    if (checker.getIndexInfosOfType(t).length) return null; // Record<string, …>: Inhalt erst zur Laufzeit bekannt
    for (const prop of checker.getPropertiesOfType(t)) keys.add(prop.getName());
  }
  return [...keys];
}

function objectKeys(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const keys = [];
  for (const p of node.properties) {
    if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
      keys.push(p.name.text);
    }
  }
  return keys;
}

const FILTERS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'contains', 'containedBy', 'overlaps', 'textSearch', 'not', 'filter', 'likeAllOf', 'likeAnyOf', 'ilikeAllOf', 'ilikeAnyOf']);

/** Alle Methodenaufrufe einer Kette ab einem Knoten nach oben einsammeln */
function chainAbove(node) {
  const calls = [];
  let cur = node;
  while (cur.parent && ts.isPropertyAccessExpression(cur.parent) && cur.parent.expression === cur && cur.parent.parent && ts.isCallExpression(cur.parent.parent)) {
    calls.push({ name: cur.parent.name.text, call: cur.parent.parent });
    cur = cur.parent.parent;
  }
  return { calls, top: cur };
}

/** Weitere Aufrufe auf einer Variablen (let q = …from('x'); q = q.eq(…)) im selben Funktionsrumpf */
function laterCallsOnVariable(top) {
  let decl = top.parent;
  while (decl && (ts.isAwaitExpression(decl) || ts.isParenthesizedExpression(decl) || ts.isAsExpression(decl))) decl = decl.parent;
  if (!decl || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) return [];
  const name = decl.name.text;
  let scope = decl.parent;
  while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  const out = [];
  const visit = (n) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name && ts.isCallExpression(n.parent) && n.parent.expression === n) {
      out.push({ name: n.name.text, call: n.parent });
      // q.eq(…).order(…) – auch die Fortsetzung mitnehmen
      out.push(...chainAbove(n.parent).calls);
    }
    ts.forEachChild(n, visit);
  };
  if (scope) visit(scope);
  return out;
}

function checkTableChain(sf, fromCall, table) {
  if (!relations[table]) {
    report(sf, fromCall, `Tabelle „${table}“ gibt es nicht`);
    return;
  }
  checked++;
  const { calls, top } = chainAbove(fromCall);
  const all = [...calls, ...laterCallsOnVariable(top)];
  let embeds = new Map();
  for (const { name, call } of all) {
    const a0 = call.arguments[0];
    if (name === 'select') {
      for (const s of literalsOf(a0)) embeds = new Map([...embeds, ...checkSelect(sf, call, table, s)]);
    } else if (FILTERS.has(name)) {
      for (const s of literalsOf(a0)) checkColumnRef(sf, call, table, s, embeds, 'Filter');
    } else if (name === 'order') {
      const opts = call.arguments[1];
      let t = table;
      if (opts && ts.isObjectLiteralExpression(opts)) {
        for (const p of opts.properties) {
          if (ts.isPropertyAssignment(p) && ['foreignTable', 'referencedTable'].includes(p.name.getText(sf))) {
            const ft = literal(p.initializer);
            if (ft) t = embeds.get(ft) ?? ft;
          }
        }
      }
      checkColumnRef(sf, call, t, literal(a0), embeds, 'Sortierung');
    } else if (name === 'or') {
      const s = literal(a0);
      if (s != null) checkOrString(sf, call, table, s, embeds);
    } else if (name === 'match') {
      for (const k of objectKeys(a0) ?? []) checkColumnRef(sf, call, table, k, embeds, 'Filter');
    } else if (name === 'insert' || name === 'update' || name === 'upsert') {
      const fromType = typeKeys(a0);
      const rows = a0 && ts.isArrayLiteralExpression(a0) ? a0.elements : [a0];
      const keys = fromType ?? rows.flatMap((r) => objectKeys(r) ?? []);
      for (const k of new Set(keys)) if (!hasColumn(table, k)) report(sf, call, `${name} in „${table}“: Spalte „${k}“ gibt es nicht${fromType ? ' (aus dem Typ des übergebenen Objekts)' : ''}`);
      const opts = call.arguments[1];
      if (opts && ts.isObjectLiteralExpression(opts)) {
        for (const p of opts.properties) {
          if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'onConflict') {
            for (const c of (literal(p.initializer) ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
              if (!hasColumn(table, c)) report(sf, call, `upsert in „${table}“: onConflict-Spalte „${c}“ gibt es nicht`);
            }
          }
        }
      }
    }
  }
}

function checkRpc(sf, call) {
  const name = literal(call.arguments[0]);
  if (!name) return;
  checked++;
  const variants = functions.get(name);
  if (!variants) {
    report(sf, call, `Funktion „${name}“ gibt es nicht`);
    return;
  }
  const keys = objectKeys(call.arguments[1]);
  if (!keys) return;
  const fits = variants.some((args) => keys.every((k) => args.includes(k)));
  if (!fits) report(sf, call, `Funktion „${name}“: Parameter ${keys.join(', ')} passen nicht (erwartet: ${variants.map((v) => v.join(', ')).join(' | ')})`);
}

for (const file of FILES) {
  const text = readFileSync(file, 'utf8');
  if (!/\.(from|rpc|channel)\(/.test(text)) continue;
  const sf = program.getSourceFile(file) ?? ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const obj = node.expression.expression;
      const objText = obj.getText(sf);
      if (method === 'from') {
        const arg = literal(node.arguments[0]);
        if (arg && !/^(Array|Buffer|Uint8Array|Object)$/.test(objText)) {
          if (/\.storage$/.test(objText) || /^storage$/.test(objText)) {
            checked++;
            if (!buckets.has(arg)) report(sf, node, `Speicher-Bucket „${arg}“ wird in keiner Migration angelegt`);
          } else if (/(^|\.)(sb|db|supabase|admin|client|service|this\.sb|svc)$/i.test(objText) || /createClient|serviceClient|userClient|adminClient/i.test(objText)) {
            checkTableChain(sf, node, arg);
          }
        }
      } else if (method === 'rpc') {
        checkRpc(sf, node);
      } else if (method === 'on' && literal(node.arguments[0]) === 'postgres_changes') {
        const opts = node.arguments[1];
        if (opts && ts.isObjectLiteralExpression(opts)) {
          for (const p of opts.properties) {
            if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'table') {
              const t = literal(p.initializer);
              if (t) {
                checked++;
                if (!realtime.has(t)) report(sf, node, `Realtime: Tabelle „${t}“ ist nicht in der Veröffentlichung supabase_realtime`);
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// Realtime-Tabellen, die der Code abonnieren kann (Typ RealtimeTable)
const storeTypes = readFileSync(join(ROOT, 'src/lib/store/types.ts'), 'utf8');
const rt = /export type RealtimeTable\s*=([^;]+);/.exec(storeTypes);
if (rt) {
  for (const m of rt[1].matchAll(/'([\w]+)'/g)) {
    checked++;
    if (!realtime.has(m[1])) problems.push(`src/lib/store/types.ts  Realtime: Tabelle „${m[1]}“ ist nicht in der Veröffentlichung supabase_realtime`);
  }
}

if (problems.length) {
  console.log(`Abfragen geprüft: ${checked}, Probleme: ${problems.length}`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log(`Abfragen geprüft: ${checked} – alle passen zur Datenbank`);
