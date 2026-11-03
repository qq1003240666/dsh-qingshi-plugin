// 自绘标题栏：40px 高的奶油色条，左边「史」圆标 + 青史 + 当前页标题，右边只有一个关闭按钮。
// 用 -webkit-app-region: drag 让整条可拖动窗口（按钮区 no-drag）。
const { ipcRenderer } = require('electron')

const BAR_ID = 'qingshi-shell-bar'
const HEIGHT = 40

function buildBar() {
  if (document.getElementById(BAR_ID)) return true
  if (!document.body) return false

  const bar = document.createElement('div')
  bar.id = BAR_ID
  bar.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'height:' + HEIGHT + 'px',
    'z-index:2147483647',
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'padding:0 0 0 10px',
    'box-sizing:border-box',
    'background:linear-gradient(180deg,#fbf6ea 0%,#f4ecdb 100%)',
    'border-bottom:1px solid #e4d8c0',
    'box-shadow:0 1px 2px rgba(120,96,64,.06)',
    'font:13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
    'color:#5a4a38',
    'user-select:none',
    '-webkit-app-region:drag',
  ].join(';')

  const left = document.createElement('div')
  left.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0'

  const mark = document.createElement('div')
  mark.style.cssText = [
    'width:22px',
    'height:22px',
    'border-radius:50%',
    'background:radial-gradient(circle at 30% 25%,#fffaf0,#f0e6d2 70%,#e6d8bd)',
    'border:1px solid #e1d3b8',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:12px',
    'font-weight:700',
    'color:#8a5a2b',
    'line-height:1',
    'flex:0 0 auto',
  ].join(';')
  mark.textContent = '史'

  const name = document.createElement('span')
  name.textContent = '青史'
  name.style.cssText = 'font-weight:700;letter-spacing:.5px;font-size:13px;flex:0 0 auto'

  const dot = document.createElement('span')
  dot.textContent = '·'
  dot.style.cssText = 'color:#c9b99c;flex:0 0 auto'

  const page = document.createElement('span')
  page.id = 'qingshi-shell-page'
  page.textContent = document.title || ''
  page.style.cssText = [
    'color:#8a7a63',
    'font-size:12px',
    'overflow:hidden',
    'text-overflow:ellipsis',
    'white-space:nowrap',
    'max-width:52vw',
  ].join(';')

  left.appendChild(mark)
  left.appendChild(name)
  left.appendChild(dot)
  left.appendChild(page)

  const right = document.createElement('div')
  right.style.cssText = 'display:flex;align-items:center;height:100%;-webkit-app-region:no-drag'

  const close = document.createElement('button')
  close.id = 'qingshi-shell-close'
  close.title = '关闭'
  close.setAttribute('aria-label', '关闭')
  close.textContent = '✕'
  close.style.cssText = [
    'width:46px',
    'height:100%',
    'border:0',
    'background:transparent',
    'color:#7a6a52',
    'font-size:14px',
    'line-height:1',
    'cursor:pointer',
    'transition:background .15s,color .15s',
  ].join(';')
  close.addEventListener('mouseenter', () => {
    close.style.background = '#d9534f'
    close.style.color = '#fff'
  })
  close.addEventListener('mouseleave', () => {
    close.style.background = 'transparent'
    close.style.color = '#7a6a52'
  })
  close.addEventListener('click', () => ipcRenderer.send('shell:close'))

  right.appendChild(close)
  bar.appendChild(left)
  bar.appendChild(right)
  document.body.appendChild(bar)

  // 给页面腾出标题栏高度。
  // 坑：早先给 #app 加 padding-top，但 #app 本身是 100vh，多出来的 40px 让文档变成 920 高
  // → 出现一条竖向滚动条，而且 uni-tabbar 是 position:fixed 按 100vh 算的，被顶到视口外。
  // 正确做法是走 uni-app 自己的 --window-top：它会把这个高度从 windowHeight 里减掉，
  // 页面与 tabbar 的布局都跟着变（H5 包里 `Cc()` 就是读这个变量）。
  document.documentElement.style.setProperty('--window-top', HEIGHT + 'px')
  document.documentElement.style.setProperty('--qingshi-shell-bar', HEIGHT + 'px')
  if (!document.getElementById('qingshi-shell-style')) {
    const st = document.createElement('style')
    st.id = 'qingshi-shell-style'
    st.textContent = [
      'html,body{height:100%;overflow:hidden}',
      'body{margin:0}',
      // 页面容器整体让出标题栏，避免 100vh 元素被压在标题栏下面
      '#app{padding-top:0 !important}',
      'uni-tabbar{bottom:0 !important}',
    ].join('')
    document.head.appendChild(st)
  }

  syncTitle()
  return true
}

function syncTitle() {
  const el = document.getElementById('qingshi-shell-page')
  if (!el) return
  const t = (document.title || '').trim()
  if (t && t !== '青史') el.textContent = t
  ipcRenderer.send('shell:title', t)
}

function watchTitle() {
  const title = document.querySelector('title')
  if (!title) return
  const observer = new MutationObserver(() => syncTitle())
  observer.observe(title, { childList: true, subtree: true, characterData: true })
  // SPA 改 hash 也刷新一次
  window.addEventListener('hashchange', () => setTimeout(syncTitle, 120))
}

function boot() {
  if (!buildBar()) {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
    return
  }
  watchTitle()
}

ipcRenderer.on('shell:sync-title', () => syncTitle())

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true })
} else {
  boot()
}
