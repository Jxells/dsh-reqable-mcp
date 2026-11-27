/**
 * dsh-reqable-mcp 客户端半身：在「Settings → 插件 → Reqable 抓包连接」里渲染配置卡片。
 *
 * 交给浏览器模块加载器的手写 bundle（`window.__ModuleLoader__.load` 包装，与生态里其它插件同一种格式）。
 * 表单不自己管状态：读 `ctx.configForms.get('<配置命名空间>')` 的快照，保存时调 `mutate()`，
 * 写回 profile 的补丁层；宿主半身监听 loader/volatile-update 重建 MCP 实例。
 */

window.__ModuleLoader__.load({
  id: 'dsh-reqable-mcp',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const h = React.createElement

    /** 文案命名空间。 */
    const NS = 'reqableMcp'
    /** 宿主半身 cordis.patch.yml 里声明的条目 id，也是设置命名空间。 */
    const ENTRY_ID = 'reqable-mcp'
    /** 本包的包名——Plugins 页按它把卡片挂到对应 bundle 上。 */
    const BUNDLE = 'dsh-reqable-mcp'

    const zh = {
      hint: '改完点保存即生效，不用重启。密钥留空表示不修改。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      failed: '保存失败：{message}',
      conflict: '设置已在别处改动，表单已刷新，请再试一次',
      loading: '正在读取配置…',
      unavailable: '这个条目当前没有可编辑的配置',
      readOnly: '当前部署的设置为只读',
      empty: '未设置',
      secretHint: '已设置；留空表示不修改',
      field_enabled: '启用',
      field_serverName: '工具命名空间',
      field_command: 'Reqable mcp-server 路径',
      field_host: 'Reqable 主机',
      field_port: 'API 端口',
      field_scope: '能力范围（--scope）',
      field_token: '访问 token',
      field_startupTimeoutMs: '启动超时（毫秒）',
      field_toolCallTimeoutMs: '单次调用超时（毫秒）',
    }

    const en = {
      hint: 'Saved values apply immediately; no restart needed. Leave a secret empty to keep it.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      failed: 'Save failed: {message}',
      conflict: 'Settings changed elsewhere; the form was refreshed, try again',
      loading: 'Loading configuration…',
      unavailable: 'This entry has no editable configuration right now',
      readOnly: 'Settings are read-only in this deployment',
      empty: 'not set',
      secretHint: 'set; leave empty to keep',
      field_enabled: 'Enabled',
      field_serverName: 'Tool namespace',
      field_url: 'Qinglong URL',
      field_clientId: 'Client ID',
      field_clientSecret: 'Client secret',
      field_envName: 'Account-pool env var',
      field_nodePath: 'Node path (empty = built-in)',
      field_startupTimeoutMs: 'Startup timeout (ms)',
      field_toolCallTimeoutMs: 'Tool call timeout (ms)',
    }

    /** 字段顺序与类型；secret 字段永远不回填明文。 */
    const FIELDS = [
      { key: 'enabled', kind: 'boolean' },
      { key: 'serverName', kind: 'text' },
      { key: 'command', kind: 'text' },
      { key: 'host', kind: 'text' },
      { key: 'port', kind: 'number' },
      { key: 'scope', kind: 'text' },
      { key: 'token', kind: 'secret' },
      { key: 'startupTimeoutMs', kind: 'number' },
      { key: 'toolCallTimeoutMs', kind: 'number' },
    ]

    /** 把已接受的配置投影成表单草稿（数字转字符串便于编辑，secret 留空）。 */
    function draftFrom(value) {
      const source = value ?? {}
      const draft = {}
      for (const field of FIELDS) {
        const current = source[field.key]
        if (field.kind === 'boolean') draft[field.key] = current === true
        else if (field.kind === 'secret') draft[field.key] = ''
        else if (field.kind === 'number') draft[field.key] = current === undefined ? '' : String(current)
        else draft[field.key] = current === undefined ? '' : String(current)
      }
      return draft
    }

    /** 只提交真正改动的字段；空 secret 与非数字数字框被跳过。 */
    function buildOps(draft, value) {
      const source = value ?? {}
      const ops = []
      for (const field of FIELDS) {
        const next = draft[field.key]
        if (field.kind === 'boolean') {
          if (Boolean(next) !== Boolean(source[field.key])) ops.push({ op: 'set', path: [field.key], value: Boolean(next) })
          continue
        }
        const text = String(next ?? '')
        if (field.kind === 'number') {
          if (text.trim() === '') continue
          const parsed = Number(text)
          if (!Number.isFinite(parsed) || parsed === source[field.key]) continue
          ops.push({ op: 'set', path: [field.key], value: parsed })
          continue
        }
        if (field.kind === 'secret') {
          if (text === '') continue
          ops.push({ op: 'set', path: [field.key], value: text })
          continue
        }
        if (text !== (source[field.key] ?? '')) ops.push({ op: 'set', path: [field.key], value: text })
      }
      return ops
    }

    const rowStyle = { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px' }
    const labelStyle = { flex: '0 0 200px', fontSize: '13px', opacity: 0.85 }
    const inputStyle = {
      flex: '1 1 auto', minWidth: 0, padding: '6px 8px', fontSize: '13px', borderRadius: '6px',
      border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit',
    }

    /** 配置卡片：读快照 → 编辑草稿 → 一次 mutate 提交。 */
    function ConfigCard(props) {
      const t = props.t
      const form = props.form
      const subscribe = React.useCallback((listener) => form.subscribe(listener), [form])
      const getSnapshot = React.useCallback(() => form.getSnapshot(), [form])
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
      const [draft, setDraft] = React.useState(() => draftFrom(snapshot.value))
      const [phase, setPhase] = React.useState('idle')
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        setDraft(draftFrom(snapshot.value))
        setPhase('idle')
        setError('')
      }, [snapshot.revision, snapshot.status])

      if (snapshot.status === 'loading') return h('p', { style: { opacity: 0.7 } }, t('loading'))
      if (snapshot.status === 'unavailable') return h('p', { style: { opacity: 0.7 } }, t('unavailable'))

      const writable = snapshot.writable !== false
      const submit = async () => {
        const ops = buildOps(draft, snapshot.value)
        if (ops.length === 0) { setPhase('saved'); return }
        setPhase('saving')
        setError('')
        try {
          const accepted = await form.mutate(ops, snapshot.revision)
          setPhase(accepted ? 'saved' : 'conflict')
          if (!accepted) setError(t('conflict'))
        } catch (failure) {
          setPhase('failed')
          setError(String((failure && failure.message) || failure))
        }
      }

      const fields = FIELDS.map((field) => {
        const id = 'reqable-' + field.key
        const control = field.kind === 'boolean'
          ? h('input', {
            id,
            type: 'checkbox',
            checked: Boolean(draft[field.key]),
            disabled: !writable,
            onChange: (event) => setDraft({ ...draft, [field.key]: event.target.checked }),
          })
          : h('input', {
            id,
            type: field.kind === 'number' ? 'number' : 'text',
            value: draft[field.key] ?? '',
            disabled: !writable,
            autoComplete: field.kind === 'secret' ? 'new-password' : 'off',
            placeholder: field.kind === 'secret'
              ? (snapshot.value && snapshot.value[field.key] ? t('secretHint') : t('empty'))
              : '',
            onChange: (event) => setDraft({ ...draft, [field.key]: event.target.value }),
            style: inputStyle,
          })
        return h('label', { key: field.key, style: rowStyle, htmlFor: id }, h('span', { style: labelStyle }, t('field_' + field.key)), control)
      })

      return h('div', null,
        h('p', { style: { fontSize: '12px', opacity: 0.65, margin: '0 0 12px' } }, writable ? t('hint') : t('readOnly')),
        fields,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' } },
          h('button', {
            type: 'button',
            disabled: !writable || phase === 'saving',
            onClick: submit,
            style: { padding: '6px 14px', borderRadius: '6px', border: '1px solid rgba(127,127,127,0.35)', cursor: writable ? 'pointer' : 'default', background: 'transparent', color: 'inherit' },
          }, phase === 'saving' ? t('saving') : t('save')),
          phase === 'saved' ? h('span', { style: { fontSize: '12px', opacity: 0.8 } }, t('saved')) : null,
          phase === 'failed' || phase === 'conflict' ? h('span', { role: 'status', style: { fontSize: '12px', color: '#d4380d' } }, t('failed', { message: error })) : null,
        ),
      )
    }

    /** 需要的客户端服务。 */
    const inject = ['slots', 'locale', 'configForms']

    /** 注册文案与卡片。 */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-reqable-mcp: locale')
      const form = ctx.configForms.get(ENTRY_ID)
      ctx.effect(() => () => { void form.dispose() }, 'dsh-reqable-mcp: config form')
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
        name: 'plugins.bundle.config',
        key: BUNDLE,
        locale: NS,
        inject: () => ({ form }),
      }, ConfigCard))
    }

    module.exports = { apply, inject, ConfigCard, draftFrom, buildOps, FIELDS, ENTRY_ID, BUNDLE }
    return module.exports
  },
})