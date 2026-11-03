// 自绘窗口标题条：清掉浏览器自带的标题栏后，在页面顶部放一条只有「标题 + 关闭」的细条。
// 注入方式：Page.addScriptToEvaluateOnNewDocument（每次新文档都执行一次）+ 首次 attach 后立即执行一次。
// 关闭按钮用 window.close()（Chrome --app 窗口允许脚本关闭自己，已实测）。

export const WINDOW_BAR_SOURCE = `(() => {
  if (window.__qingshiBarInstalled) return 'already'
  window.__qingshiBarInstalled = true
  const install = () => {
    if (!document.body) return false
    if (document.getElementById('qingshi-frame-bar')) return true
    const bar = document.createElement('div')
    bar.id = 'qingshi-frame-bar'
    bar.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'height:32px',
      'z-index:2147483647',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'padding:0 4px 0 14px',
      'background:#f6f0e4',
      'border-bottom:1px solid #e6dcc8',
      'font:13px/32px "PingFang SC","Microsoft YaHei",sans-serif',
      'color:#5a4a38',
      'user-select:none',
      'box-sizing:border-box',
    ].join(';')
    bar.innerHTML = '<span style="font-weight:600;letter-spacing:0.5px">青史</span>'
      + '<button id="qingshi-frame-close" title="关闭" aria-label="关闭" style="width:46px;height:32px;border:0;background:transparent;color:#5a4a38;font-size:15px;line-height:32px;cursor:pointer;border-radius:4px">✕</button>'
    document.body.appendChild(bar)
    const pushDown = () => {
      const app = document.getElementById('app') || document.body.firstElementChild
      if (app && app.style) app.style.paddingTop = '32px'
      if (document.body) document.body.style.paddingTop = ''
    }
    pushDown()
    const close = document.getElementById('qingshi-frame-close')
    if (close) {
      close.addEventListener('mouseenter', () => { close.style.background = '#e8dcc4' })
      close.addEventListener('mouseleave', () => { close.style.background = 'transparent' })
      close.addEventListener('click', () => {
        try { window.close() } catch (e) {}
        setTimeout(() => { try { window.close() } catch (e) {} }, 120)
      })
    }
    return true
  }
  if (!install()) {
    document.addEventListener('DOMContentLoaded', install, { once: true })
  }
})()`

/** 在已连接的会话上立刻装一次（addInitScript 只对后续文档生效）。 */
export async function installWindowBar(session) {
  try {
    await session.addInitScript(WINDOW_BAR_SOURCE)
  } catch {}
  try {
    await session.evaluate(WINDOW_BAR_SOURCE)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) }
  }
}
