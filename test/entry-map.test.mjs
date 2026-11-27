/**
 * 插件逻辑测试：配置 → mcp-manager 条目映射，以及注册/撤回时序。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, DEFAULTS, apply, entryFor, resolvedOf } from '../index.js'

function stubHost() {
  const effects = []
  const handlers = new Map()
  const registered = []
  return {
    registered,
    ctx: {
      logger: { warn() {}, info() {}, debug() {} },
      effect(fn) {
        effects.push(fn())
        return () => {}
      },
      on(event, fn) {
        const list = handlers.get(event) ?? []
        list.push(fn)
        handlers.set(event, list)
      },
      mcpManager: {
        register(name, entry) {
          const record = { name, entry, active: true }
          registered.push(record)
          return () => { record.active = false }
        },
      },
    },
    fire(event) {
      for (const fn of handlers.get(event) ?? []) fn()
    },
    disposeAll() {
      for (const dispose of effects) dispose?.()
    },
  }
}

function configRef(values = {}) {
  const state = { ...DEFAULTS, ...values }
  return {
    get: () => ({ ...state }),
    set(patch) { Object.assign(state, patch) },
  }
}

test('schema 默认值齐全', () => {
  const resolved = resolvedOf(Config({}))
  for (const key of Object.keys(DEFAULTS)) assert.ok(key in resolved, `缺少默认值: ${key}`)
  assert.equal(resolved.serverName, 'reqable')
  assert.equal(resolved.host, '127.0.0.1')
  assert.equal(resolved.port, 9000)
  assert.equal(resolved.scope, 'all')
})

test('默认条目拼出 --host/--port/--scope，空 token 不下发', () => {
  const entry = entryFor(Config({}))
  assert.equal(entry.transport, 'stdio')
  assert.equal(entry.command, DEFAULTS.command)
  assert.deepEqual(entry.args, ['--host', '127.0.0.1', '--port', '9000', '--scope', 'all'])
  assert.equal(entry.env, undefined)
})

test('自定义配置：端口转成字符串、token 进 env、路径生效', () => {
  const entry = entryFor(Config({
    command: '/opt/reqable/mcp-server',
    host: '192.168.0.20',
    port: 9100,
    scope: 'capture',
    token: 'tok123',
    startupTimeoutMs: 8000,
  }))
  assert.equal(entry.command, '/opt/reqable/mcp-server')
  assert.deepEqual(entry.args, ['--host', '192.168.0.20', '--port', '9100', '--scope', 'capture'])
  assert.deepEqual(entry.env, { REQABLE_TOKEN: 'tok123' })
  assert.equal(entry.startupTimeoutMs, 8000)
})

test('apply 注册一台服务器，撤回后消失', () => {
  const host = stubHost()
  apply(host.ctx, configRef())
  assert.equal(host.registered.length, 1)
  assert.equal(host.registered[0].name, 'reqable')
  host.disposeAll()
  assert.equal(host.registered[0].active, false)
})

test('enabled=false 时不注册', () => {
  const host = stubHost()
  apply(host.ctx, configRef({ enabled: false }))
  assert.equal(host.registered.length, 0)
})

test('volatile 更新后重建注册', () => {
  const host = stubHost()
  const config = configRef()
  apply(host.ctx, config)
  config.set({ port: 9200 })
  host.fire('loader/volatile-update')
  assert.equal(host.registered.length, 2)
  assert.equal(host.registered[0].active, false)
  assert.equal(host.registered[1].entry.args[3], '9200')
})

test('注册失败只告警，不抛给宿主', () => {
  const host = stubHost()
  host.ctx.mcpManager.register = () => { throw new Error('名字被占用') }
  assert.doesNotThrow(() => apply(host.ctx, configRef()))
})
