#!/usr/bin/env node
/**
 * 把本插件装进一个 dsh profile，并顺手把旧版 @local/reqable-mcp 的连接参数迁移成新插件的设置项。
 *
 * 做的事：
 *   1. profile 的 package.json：依赖换成 dsh-reqable-mcp，删掉 @local/reqable-mcp
 *   2. profile 的 dsh.profile.bundles：换成 dsh-reqable-mcp
 *   3. 旧插件的 --host/--port/--scope 与 REQABLE_TOKEN → 写进 profile 补丁层 id 为 reqable-mcp 的 config 段（只写一次）
 *   4. 跑 pnpm install
 *
 * 用法：
 *   node scripts/install.mjs                      # 默认 web profile，从当前目录安装
 *   node scripts/install.mjs --profile tui
 *   node scripts/install.mjs --from git+https://github.com/USER/dsh-reqable-mcp.git
 *   node scripts/install.mjs --dry-run
 *   DSH_HOME=/tmp/dsh-home node scripts/install.mjs
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** 本插件的包名，同时也是 profile bundles 里的一层。 */
const PACKAGE = 'dsh-reqable-mcp'
/** 本插件在 profile 补丁层里的条目 id，也是设置页面的命名空间。 */
const ENTRY_ID = 'reqable-mcp'
/** 旧版插件包名，安装时移除。 */
const LEGACY = '@local/reqable-mcp'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage(code = 0) {
  process.stdout.write(`用法: node scripts/install.mjs [选项]

  --profile <name>   目标 profile（默认 web）
  --from <spec>      安装来源，默认 file:<本仓库路径>；可传 git+https://... 或 npm 版本
  --dsh-home <dir>   dsh 主目录（默认 $DSH_HOME 或 ~/.dsh）
  --dry-run          只打印将要做的事，不落盘、不安装
  --no-install       改完 package.json 后不执行 pnpm install
  -h, --help         显示帮助
`)
  process.exit(code)
}

const options = { profile: 'web', from: undefined, dshHome: undefined, dryRun: false, install: true }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i]
  if (arg === '--profile') options.profile = argv[++i]
  else if (arg === '--from') options.from = argv[++i]
  else if (arg === '--dsh-home') options.dshHome = argv[++i]
  else if (arg === '--dry-run') options.dryRun = true
  else if (arg === '--no-install') options.install = false
  else if (arg === '-h' || arg === '--help') usage(0)
  else usage(2)
}

const dshHome = resolve(options.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
const profileDir = join(dshHome, 'profiles', options.profile)
const profileFile = join(profileDir, 'package.json')
const patchFile = join(profileDir, 'cordis.patch.yml')
const source = options.from ?? `file:${REPO_ROOT}`

if (!existsSync(profileFile)) {
  process.stderr.write(`找不到 profile：${profileFile}\n先用 dsh --profile ${options.profile} 启动一次生成它，或检查 --dsh-home。\n`)
  process.exit(1)
}

const log = (message) => process.stdout.write(`${options.dryRun ? '[dry-run] ' : ''}${message}\n`)

/** 单引号包裹 YAML 标量，内部单引号写成两个。 */
function yamlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

/** 数字原样写，其余加引号。 */
function yamlScalar(value) {
  return typeof value === 'number' ? String(value) : yamlString(value)
}

// ---- 1/2. profile 的 package.json ----
const pkg = JSON.parse(readFileSync(profileFile, 'utf8'))
pkg.dependencies ??= {}
if (pkg.dependencies[PACKAGE] !== source) log(`依赖 ${PACKAGE} → ${source}`)
pkg.dependencies[PACKAGE] = source
if (LEGACY in pkg.dependencies) {
  delete pkg.dependencies[LEGACY]
  log(`移除旧依赖 ${LEGACY}`)
}
const bundles = pkg.dsh?.profile?.bundles
if (Array.isArray(bundles)) {
  const next = bundles.filter((name) => name !== LEGACY)
  if (!next.includes(PACKAGE)) next.push(PACKAGE)
  pkg.dsh.profile.bundles = next
  log(`bundles → ${next.join(', ')}`)
} else {
  process.stderr.write('警告：profile package.json 里没有 dsh.profile.bundles，插件不会被组合，请手动加上。\n')
}

// ---- 3. 旧配置迁移 ----
/** 从旧插件的 cordis.patch.yml 抓 --host/--port/--scope 与 REQABLE_TOKEN（不引入 YAML 依赖）。 */
function readLegacyConfig() {
  const legacyPatch = join(profileDir, 'node_modules', ...LEGACY.split('/'), 'cordis.patch.yml')
  if (!existsSync(legacyPatch)) return undefined
  const text = readFileSync(legacyPatch, 'utf8')
  const config = {}

  const tokenMatch = text.match(/^[ \t]*REQABLE_TOKEN:[ \t]*'?([^'\n]*)'?[ \t]*$/m)
  if (tokenMatch !== null && tokenMatch[1].trim() !== '') config.token = tokenMatch[1].trim()

  const argsBlock = text.match(/args:[ \t]*\n((?:[ \t]*-[ \t]*[^\n]+\n)+)/)
  if (argsBlock !== null) {
    const items = argsBlock[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => line.replace(/^-\s*/, '').replace(/^'/, '').replace(/'$/, ''))
    for (let i = 0; i < items.length; i += 1) {
      const flag = items[i]
      const value = items[i + 1]
      if (value === undefined) break
      if (flag === '--host') { config.host = value; i += 1 }
      else if (flag === '--port' && Number.isFinite(Number(value))) { config.port = Number(value); i += 1 }
      else if (flag === '--scope') { config.scope = value; i += 1 }
    }
  }
  return Object.keys(config).length === 0 ? undefined : config
}

const patchText = existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : ''
const alreadyConfigured = new RegExp(`^[ \\t]*-[ \\t]*id:[ \\t]*${ENTRY_ID}[ \\t]*$`, 'm').test(patchText)
const legacy = readLegacyConfig()

if (alreadyConfigured) {
  log(`profile 补丁层已有 ${ENTRY_ID} 的配置，跳过迁移`)
} else if (legacy === undefined) {
  log('没有发现旧版配置，新插件会用内置默认值；装好后到设置里补 token')
} else {
  const block = [
    '',
    `# 由 ${PACKAGE} 安装脚本迁移自 ${LEGACY}，之后请在插件设置里维护`,
    `- id: ${ENTRY_ID}`,
    `  name: ${PACKAGE}`,
    '  config:',
    ...Object.entries(legacy).map(([field, value]) => `    ${field}: ${yamlScalar(value)}`),
    '',
  ].join('\n')
  log(`迁移旧配置字段：${Object.keys(legacy).join(', ')}`)
  if (!options.dryRun) {
    // 空的补丁层文档写的是 `[]`，直接追加会变成两份文档，先把它摘掉。
    writeFileSync(patchFile, `${patchText.replace(/^[ \t]*\[\][ \t]*$/m, '')}${block}`)
  }
}

// ---- 落盘 ----
if (!options.dryRun) writeFileSync(profileFile, `${JSON.stringify(pkg, null, 2)}\n`)

// ---- 4. pnpm install ----
if (options.install && !options.dryRun) {
  log(`在 ${profileDir} 执行 pnpm install`)
  execFileSync('pnpm', ['install'], { cwd: profileDir, stdio: 'inherit' })
}

process.stdout.write(`
完成。接下来：
  1. 重启一次 dsh：~/dsh.sh          （首次安装需要，让新插件被组合进来）
  2. 打开 Settings → 插件 → Reqable 抓包连接，改 host/port/token；改完即时生效，不用再重启
  3. Settings → MCP 服务器 里应能看到 serverName（默认 reqable）及其连接状态
`)