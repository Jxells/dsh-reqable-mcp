/**
 * 客户端卡片测试：用假的 __ModuleLoader__ / React / cordis ctx 跑真实的 client.js，
 * 覆盖槽位注册形状、草稿投影、diff 提交，以及点「保存」提交了哪些 ops。
 * 假 React 带一个极小的 hooks 引擎（useState / useEffect / useSyncExternalStore），
 * 这样才能测出「改了输入框再点保存」的真实交互。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// ---- 极小 hooks 引擎 ----
let activeHooks = null
let hookIndex = 0
let currentInstance = null

const React = {
  Component: class Component { constructor(props) { this.props = props; this.state = {} } },
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
  useCallback: (fn) => fn,
  useState(initial) {
    if (activeHooks === null) return [typeof initial === 'function' ? initial() : initial, () => {}]
    const index = hookIndex++
    if (activeHooks[index] === undefined) activeHooks[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
    const cell = activeHooks[index]
    return [cell.value, (next) => {
      cell.value = typeof next === 'function' ? next(cell.value) : next
      if (currentInstance !== null) currentInstance.rerender()
    }]
  },
  useEffect(fn, deps) {
    if (activeHooks === null) return
    const index = hookIndex++
    const previous = activeHooks[index]
    const changed = previous === undefined || deps === undefined || previous.deps === undefined
      || deps.length !== previous.deps.length || deps.some((dep, i) => dep !== previous.deps[i])
    if (changed) activeHooks[index] = { kind: 'effect', fn, deps, pending: true, cleanup: previous && previous.cleanup }
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    if (activeHooks !== null) hookIndex++
    return getSnapshot()
  },
}

/** 渲染一次组件并返回重渲染入口。 */
function mount(Component, props) {
  const hooks = []
  let tree
  let rendering = false
  const instance = {
    get tree() { return tree },
    rerender() {
      if (rendering) return
      rendering = true
      activeHooks = hooks
      hookIndex = 0
      try {
        tree = Component(props)
      } finally {
        activeHooks = null
        rendering = false
      }
      for (const hook of hooks) {
        if (hook !== undefined && hook.kind === 'effect' && hook.pending) {
          hook.pending = false
          if (typeof hook.cleanup === 'function') hook.cleanup()
          hook.cleanup = hook.fn()
        }
      }
    },
  }
  instance.rerender()
  return instance
}

/**
 * 假 describe 镜像。刻意写成「依赖 this 的类实例」：如果卡片把 getSnapshot/subscribe
 * 裸引用传给 React（丢 this），这里会直接抛错，测试能挡住这种回归。
 */
class DescribeMirror {
  constructor(namespaces) {
    this.snapshot = { status: 'ready', view: { writable: true, hasDocument: true, namespaces }, error: null }
  }

  getSnapshot() { return this.snapshot }

  subscribe() { return () => {} }

  ensure() { return Promise.resolve() }

  acceptView() {}
}

function stubDescribe(namespaces = []) {
  return new DescribeMirror(namespaces)
}

/** 一条命名空间视图，secrets 里带 path/set。 */
function namespaceView(ns, secrets) {
  return { autoGenerate: true, ns, schema: {}, value: {}, base: {}, user: {}, applies: 'live', secrets, revision: 7 }
}

/** 假 cordis 客户端上下文。 */
function stubCtx() {
  const registrations = []
  const effects = []
  let localeNs
  return {
    registrations,
    get localeNs() { return localeNs },
    ctx: {
      effect(fn) { effects.push(fn()) },
      locale: { register(ns, dictionaries) { localeNs = ns; assert.ok(dictionaries.zh, '缺少中文文案'); assert.ok(dictionaries.en, '缺少英文文案') } },
      configForms: { get(id) { return stubForm(id) }, describe() { return stubDescribe([]) } },
      slots: {
        inject(name, register) { register() },
        register(options, component) { registrations.push({ options, component }); return () => {} },
      },
    },
    disposeAll() { for (const dispose of effects) if (typeof dispose === 'function') dispose() },
  }
}

/** 假配置表单：记录 mutate 调用。 */
function stubForm(namespace) {
  const state = {
    status: 'ready',
    value: {
      enabled: true,
      serverName: 'reqable',
      command: '/usr/share/reqable/mcp-server',
      host: '127.0.0.1',
      port: 9000,
      scope: 'all',
      startupTimeoutMs: 30000,
      toolCallTimeoutMs: 60000,
    },
    revision: 7,
    writable: true,
  }
  const form = {
    namespace,
    calls: [],
    getSnapshot: () => state,
    subscribe: () => () => {},
    mutate(ops, revision) { form.calls.push({ ops, revision }); return Promise.resolve(true) },
    dispose() {},
  }
  return form
}

/** 载入 client.js（它顶层调用 window.__ModuleLoader__.load）。 */
async function loadClient() {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  let captured
  globalThis.window = { __ModuleLoader__: { load(entry) { captured = entry } } }
  const module = { exports: {} }
  const run = new Function('window', 'module', 'exports', source)
  run(globalThis.window, module, module.exports)
  assert.ok(captured, 'client.js 没有调用 __ModuleLoader__.load')
  const mod = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })
  return { id: captured.id, mod }
}

/** 遍历 createElement 产出的树。 */
function walk(node, visit) {
  if (node === null || typeof node !== 'object') return
  visit(node)
  const children = node.props?.children
  const list = Array.isArray(children) ? children.flat(Infinity) : children === undefined ? [] : [children]
  for (const child of list) walk(child, visit)
}
const collected = (tree) => { const nodes = []; walk(tree, (node) => nodes.push(node)); return nodes }

/** 渲染卡片，返回 { form, tree }。 */
function renderCard(mod, secrets = []) {
  const form = stubForm(mod.ENTRY_ID)
  const describe = stubDescribe([namespaceView(mod.ENTRY_ID, secrets)])
  currentInstance = mount(mod.ConfigCard, { t: (key) => key, form, describe })
  return { form, describe, get tree() { return currentInstance.tree } }
}

test('模块 id 与包名一致，槽位注册参数正确', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const { id, mod } = await loadClient()
  assert.equal(id, pkg.name, 'load() 的 id 必须是包名，Plugins 页靠它对上卡片')
  assert.deepEqual(mod.inject, ['slots', 'locale', 'configForms'])

  const host = stubCtx()
  mod.apply(host.ctx)
  assert.equal(host.registrations.length, 1)
  const [registration] = host.registrations
  assert.equal(registration.options.name, 'plugins.bundle.config')
  assert.equal(registration.options.key, pkg.name, '槽位 key 必须是包名')
  assert.equal(host.localeNs, registration.options.locale)
  assert.ok(pkg.dsh.client !== undefined, 'package.json 缺少 dsh.client 清单')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.exports['./client'], 'package.json 缺少 ./client 导出')
})

test('卡片为每个字段渲染控件，secret 不回填明文', async () => {
  const { mod } = await loadClient()
  const inputs = collected(renderCard(mod).tree).filter((node) => node.type === 'input')
  assert.equal(inputs.length, mod.FIELDS.length, '每个字段一个控件')
  const byId = new Map(inputs.map((node) => [node.props.id, node.props]))
  const secretId = Array.from(byId.keys()).find((id) => id.endsWith('token'))
  assert.equal(byId.get(secretId).value, '', 'secret 必须以空值渲染')
  assert.ok(String(byId.get(secretId).placeholder).includes('secretUnset'), 'secret 应提示未设置')
  assert.equal(byId.get('reqable-host').value, '127.0.0.1')
  assert.equal(byId.get('reqable-port').type, 'number')
  assert.equal(byId.get('reqable-startupTimeoutMs').type, 'number')
  assert.equal(byId.get('reqable-enabled').type, 'checkbox')
})

test('草稿投影：secret 置空、数字转字符串、布尔保留', async () => {
  const { mod } = await loadClient()
  const draft = mod.draftFrom({ enabled: false, host: 'h', token: 's', port: 9100, startupTimeoutMs: 5000 })
  assert.equal(draft.token, '')
  assert.equal(draft.host, 'h')
  assert.equal(draft.port, '9100')
  assert.equal(draft.startupTimeoutMs, '5000')
  assert.equal(draft.enabled, false)
  assert.equal(draft.scope, '', '缺字段补空串')
})

test('提交 diff：只发改动字段，空 secret 与非法数字跳过', async () => {
  const { mod } = await loadClient()
  const value = { enabled: true, host: 'old', port: 9000, startupTimeoutMs: 30000 }
  const draft = { ...mod.draftFrom(value), host: 'new', token: '', port: '9200', startupTimeoutMs: '45000', toolCallTimeoutMs: 'abc' }
  assert.deepEqual(mod.buildOps(draft, value), [
    { op: 'set', path: ['host'], value: 'new' },
    { op: 'set', path: ['port'], value: 9200 },
    { op: 'set', path: ['startupTimeoutMs'], value: 45000 },
  ])
  assert.deepEqual(mod.buildOps({ ...mod.draftFrom(value), token: 'sss' }, value), [{ op: 'set', path: ['token'], value: 'sss' }])
  assert.deepEqual(mod.buildOps({ ...mod.draftFrom(value), enabled: false }, value), [{ op: 'set', path: ['enabled'], value: false }])
})

test('改输入框再点保存，会带上 ops 与读取时的 revision', async () => {
  const { mod } = await loadClient()
  const card = renderCard(mod)
  const hostInput = collected(card.tree).find((node) => node.type === 'input' && String(node.props.id).endsWith('host'))
  hostInput.props.onChange({ target: { value: '192.168.0.20' } })
  const button = collected(card.tree).find((node) => node.type === 'button')
  await button.props.onClick()
  assert.equal(card.form.calls.length, 1)
  assert.deepEqual(card.form.calls[0].ops, [{ op: 'set', path: ['host'], value: '192.168.0.20' }])
  assert.equal(card.form.calls[0].revision, 7)
})

test('没有改动时不提交', async () => {
  const { mod } = await loadClient()
  const card = renderCard(mod)
  const button = collected(card.tree).find((node) => node.type === 'button')
  await button.props.onClick()
  assert.equal(card.form.calls.length, 0)
})

test('secret 未设置提示填入、已设置提示留空不改（且都不回填明文）', async () => {
  const { mod } = await loadClient()
  const secretField = mod.FIELDS.find((field) => field.kind === 'secret')
  assert.ok(secretField !== undefined, 'FIELDS 里必须有 secret 字段')
  const placeholderOf = (tree) => {
    const input = collected(tree).find((node) => node.type === 'input' && String(node.props.id).endsWith(secretField.key))
    return { placeholder: String(input.props.placeholder), value: input.props.value }
  }
  const unset = placeholderOf(renderCard(mod, [{ path: [secretField.key], set: false }]).tree)
  const set = placeholderOf(renderCard(mod, [{ path: [secretField.key], set: true }]).tree)
  assert.ok(unset.placeholder.includes('secretUnset'), '未设置时应提示填入，实际：' + unset.placeholder)
  assert.ok(set.placeholder.includes('secretHint'), '已设置时应提示留空不改，实际：' + set.placeholder)
  assert.notEqual(unset.placeholder, set.placeholder)
  assert.equal(unset.value, '', 'secret 永远不回填明文')
  assert.equal(set.value, '', 'secret 永远不回填明文')
})

test('错误边界兜底：渲染抛错时给一行报错而不是空白', async () => {
  const { mod } = await loadClient()
  assert.equal(typeof mod.CardBoundary, 'function', '必须导出 CardBoundary')
  const derived = mod.CardBoundary.getDerivedStateFromError(new Error('boom'))
  assert.equal(derived.error.message, 'boom')
  const boundary = new mod.CardBoundary({ t: (key) => key, form: stubForm(mod.ENTRY_ID), describe: stubDescribe([]) })
  boundary.state = derived
  const tree = boundary.render()
  const children = [].concat(tree.props.children).flat(Infinity).filter((child) => typeof child === 'string')
  const message = children.join('')
  assert.ok(message.includes('配置界面加载失败'), '兜底文案缺失：' + message)
})