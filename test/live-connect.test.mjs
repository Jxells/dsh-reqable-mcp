/**
 * 真机连通性测试：把 `entryFor()` 生成的条目直接交给宿主的 dsh-mcp-client，
 * 断言 Reqable 的 mcp-server 真的连上、工具以 `mcp__reqable__*` 注册进来。
 *
 *   DSH_INSTALL_DIR=~/.nvm/versions/node/v24.22.3/lib/node_modules/@deepseek-ai/dsh \
 *     REQABLE_TOKEN=<token> node --test test/live-connect.test.mjs
 * 没设置 DSH_INSTALL_DIR 时整个测试跳过。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Config, DEFAULTS, entryFor } from '../index.js'

const installDir = process.env.DSH_INSTALL_DIR
const at = (specifier) => pathToFileURL(join(installDir, 'node_modules', ...specifier.split('/'), 'lib', 'index.js')).href

test('真机：注册条目后能连上 Reqable 并列出工具', {
  skip: installDir === undefined
    ? '未设置 DSH_INSTALL_DIR'
    : existsSync(DEFAULTS.command) ? false : `找不到 Reqable mcp-server: ${DEFAULTS.command}`,
}, async (t) => {
  const { Context } = await import(at('@deepseek-ai/cordis'))
  const McpClient = await import(at('@deepseek-ai/dsh-mcp-client'))

  const names = []
  const ctx = new Context()
  ctx.provide('tools')
  ctx.set('tools', {
    register(definition) {
      names.push(definition.name)
      return () => {}
    },
  })

  const entry = entryFor(Config({
    host: process.env.REQABLE_HOST ?? '127.0.0.1',
    port: Number(process.env.REQABLE_PORT ?? 9000),
    token: process.env.REQABLE_TOKEN ?? '',
  }))
  const fiber = ctx.plugin(McpClient, { ...entry, serverName: 'reqable', failOnStartupError: true, expandTemplates: false })

  t.after(async () => { await fiber.dispose?.() })

  const deadline = Date.now() + 20_000
  while (names.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))

  assert.ok(names.length > 0, '没有从 Reqable MCP 服务器收到任何工具')
  assert.ok(names.every((name) => name.startsWith('mcp__reqable__')), `工具名不符合预期: ${names.slice(0, 3).join(', ')}`)
})
