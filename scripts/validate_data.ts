// Checks Scam Shield synthetic JSON: parse, .example domains, ground-truth coverage.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const SCAN = ["data", "input_examples", "tests", "demo"];
const CASE_DIR = path.join(root, "input_examples");
const TRUTH_PATH = path.join(root, "tests", "ground_truth.json");

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const URL_RE = /https?:\/\/([^/\s"'<>]+)/gi;
const DOMAIN_KEY = /^(official_)?domain$/i;
const SKIP_DIR = new Set(["node_modules"]);

type Issue = string;
const issues: Issue[] = [];
const notes: string[] = [];

function walk(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith(".json")) acc.push(p);
  }
  return acc;
}

function hostLooksLikeDomain(host: string): boolean {
  const h = host.replace(/\.$/, "").toLowerCase();
  if (!h.includes(".")) return false;
  if (/^\d+(\.\d+)+$/.test(h)) return false;
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h);
}

function tld(domain: string): string {
  const parts = domain.toLowerCase().split(".");
  return parts[parts.length - 1] ?? "";
}

function checkDomain(domain: string, file: string, where: string): void {
  const d = domain.replace(/\.$/, "").toLowerCase();
  if (tld(d) !== "example") {
    issues.push(`${path.relative(root, file)}: domain "${d}" at ${where} does not end in .example`);
  }
}

function harvest(value: unknown, file: string, trail: string): void {
  if (typeof value === "string") {
    let m: RegExpExecArray | null;
    const emailRe = new RegExp(EMAIL_RE.source, "g");
    while ((m = emailRe.exec(value))) checkDomain(m[1], file, `${trail} email`);
    const urlRe = new RegExp(URL_RE.source, "gi");
    while ((m = urlRe.exec(value))) {
      const host = m[1].split(":")[0];
      if (hostLooksLikeDomain(host)) checkDomain(host, file, `${trail} url`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => harvest(item, file, `${trail}[${i}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const next = `${trail}.${k}`;
      if (hostLooksLikeDomain(k)) checkDomain(k, file, `${trail} key`);
      if (DOMAIN_KEY.test(k) && typeof v === "string" && hostLooksLikeDomain(v)) {
        checkDomain(v, file, next);
      }
      harvest(v, file, next);
    }
  }
}

function main(): void {
  const jsonFiles: string[] = [];
  for (const folder of SCAN) walk(path.join(root, folder), jsonFiles);
  notes.push(`json files scanned: ${jsonFiles.length}`);

  const parsed: Record<string, unknown> = {};
  for (const file of jsonFiles) {
    const rel = path.relative(root, file);
    try {
      parsed[file] = JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (err) {
      issues.push(`${rel}: JSON parse failed (${(err as Error).message})`);
    }
  }

  for (const file of jsonFiles) {
    if (!(file in parsed)) continue;
    harvest(parsed[file], file, "$");
  }

  if (!fs.existsSync(TRUTH_PATH)) {
    issues.push("tests/ground_truth.json is missing");
  } else {
    const truth = parsed[TRUTH_PATH] as Record<string, unknown> | undefined;
    if (!truth || typeof truth !== "object" || Array.isArray(truth)) {
      issues.push("tests/ground_truth.json must be an object keyed by case id");
    } else {
      const caseFiles = fs
        .readdirSync(CASE_DIR)
        .filter((n) => /^case\d+\.json$/i.test(n))
        .sort();
      notes.push(`input cases: ${caseFiles.length}`);
      for (const name of caseFiles) {
        const id = name.replace(/\.json$/i, "");
        if (!(id in truth)) issues.push(`${id} has no entry in tests/ground_truth.json`);
      }
      for (const key of Object.keys(truth)) {
        const expected = path.join(CASE_DIR, `${key}.json`);
        if (!fs.existsSync(expected)) issues.push(`ground_truth has ${key} but ${path.relative(root, expected)} is missing`);
      }
    }
  }

  if (issues.length === 0) {
    console.log("PASS");
    for (const n of notes) console.log(`  ${n}`);
    process.exit(0);
  }

  console.log("FAIL");
  for (const n of notes) console.log(`  ${n}`);
  for (const issue of issues) console.log(`  - ${issue}`);
  process.exit(1);
}

main();
