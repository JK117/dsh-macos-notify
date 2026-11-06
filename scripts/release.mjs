#!/usr/bin/env node
/**
 * Release check for dsh-macos-notify.
 *
 * The plugin version lives in `package.json`. The product doc repeats it in
 * the header and the changelog, and git tags name it as `v<version>`. This
 * script verifies those places agree before a release, and can create the
 * annotated tag.
 *
 *   node scripts/release.mjs         # check only
 *   node scripts/release.mjs --tag   # check, then tag v<version> at HEAD
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const doc = readFileSync(join(root, 'docs/产品文档.md'), 'utf8');
const version = pkg.version;
const tag = `v${version}`;
const wantTag = process.argv.includes('--tag');
const errors = [];
const notes = [];

/** npm-compatible semver: no leading zeroes, optional prerelease/build. */
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
if (typeof version !== 'string' || !SEMVER.test(version)) {
  errors.push(`package.json 的 version "${version}" 不是合法 semver`);
}

const header = /^>\s*版本：(\S+)/m.exec(doc);
if (header === null) {
  errors.push('docs/产品文档.md 缺少 "> 版本：X.Y.Z" 头部');
} else if (header[1] !== version) {
  errors.push(`产品文档头部版本 ${header[1]} 与 package.json ${version} 不一致`);
}

const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const changelog = new RegExp(`^\\|\\s*${escaped}\\s*\\|`, 'm');
if (!changelog.test(doc)) {
  errors.push(`产品文档「版本记录」缺少 ${version} 一行`);
}

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

let tagSha = null;
try {
  tagSha = git('rev-parse', '-q', '--verify', `refs/tags/${tag}^{commit}`);
} catch {
  /* tag does not exist yet */
}

const headSha = git('rev-parse', 'HEAD');
if (tagSha !== null && tagSha !== headSha) {
  notes.push(`tag ${tag} 已存在，指向 ${tagSha.slice(0, 7)}（不是当前 HEAD）`);
}

if (wantTag) {
  if (tagSha !== null) errors.push(`tag ${tag} 已存在，不能重复创建`);
  if (git('status', '--porcelain') !== '') errors.push('工作区不干净，先提交再打 tag');
}

console.log(`release check  ${pkg.name}@${version}`);
console.log(`  package.json     ${version}`);
console.log(`  product doc      ${header?.[1] ?? '<missing>'}`);
console.log(`  changelog        ${changelog.test(doc) ? 'ok' : '<missing>'}`);
console.log(`  tag ${tag.padEnd(9)} ${tagSha === null ? 'missing' : tagSha.slice(0, 7)}`);

if (errors.length > 0) {
  console.error('\n✖ 发版检查失败：');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

for (const note of notes) console.log(`  note: ${note}`);
console.log('✔ 版本一致');

if (wantTag) {
  execFileSync('git', ['tag', '-a', tag, '-m', tag], { cwd: root, stdio: 'inherit' });
  console.log(`\n已创建 tag ${tag}。推送：`);
  console.log('  git push origin main --follow-tags');
} else {
  console.log('\n创建 tag：node scripts/release.mjs --tag');
}
