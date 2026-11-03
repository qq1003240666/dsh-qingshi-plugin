// 插件自带的登录页（方案 B）：跑在 127.0.0.1 上，由插件自己的 http 服务端出。
// 好处：登录请求由插件发出（可以带 X-Client-Platform: plugin），登完直接把凭证落盘，
// 不需要用户回到对话里再点一次「我已登录」。

export function renderLoginPage({ port = 0 } = {}) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>登录青史</title>
<style>
  :root{
    --cream:#f7f1e6; --cream-2:#fffdf8; --brown:#8a5a2b; --brown-deep:#6f4520;
    --line:#e6dbc7; --muted:#9b8b76; --ink:#3c2f22; --danger:#b3261e; --ok:#2f6f43;
  }
  *{box-sizing:border-box}
  html,body{height:100%;margin:0;overflow-x:hidden}
  body{
    background:radial-gradient(1200px 600px at 50% -10%, #fdf8ee 0%, var(--cream) 55%, #f2e9da 100%);
    color:var(--ink); font:15px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;
    display:flex; align-items:center; justify-content:center; padding:16px 14px;
  }
  .card{
    width:min(380px,100%); background:var(--cream-2); border:1px solid var(--line);
    border-radius:18px; padding:22px 20px 18px; box-shadow:0 14px 32px rgba(111,69,32,.09);
    max-width:100%;
  }
  .card > *{max-width:100%}
  .logo{
    width:70px; height:70px; margin:0 auto 10px; border-radius:50%;
    background:linear-gradient(180deg,#fdf7ea,#f3e7d2); display:flex; align-items:center; justify-content:center;
    box-shadow:inset 0 0 0 1px #eadfc9, 0 6px 14px rgba(111,69,32,.10);
  }
  .logo svg{width:46px; height:46px}
  .brand{text-align:center; letter-spacing:.34em; font-size:11px; color:var(--muted); margin-bottom:4px}
  h1{font-size:19px; margin:0 0 10px; text-align:center; color:var(--brown-deep); font-weight:700}
  .notice{
    margin:0 0 12px; padding:9px 11px; border-radius:10px;
    background:#fdf6ea; border:1px solid #e8d9c2; color:#6b5844;
    font-size:12px; line-height:1.65; text-align:left;
  }
  .notice b{color:var(--brown-deep); font-weight:700}
  .notice ol{margin:4px 0 0; padding-left:16px}
  .notice li{margin:1px 0}
  label{display:block; font-size:12px; color:var(--muted); margin:9px 0 5px}
  input{
    width:100%; height:42px; padding:0 12px; border-radius:11px; border:1px solid var(--line);
    background:#fff; color:var(--ink); font-size:15px; outline:none;
  }
  input:focus{border-color:#c9b08b; box-shadow:0 0 0 3px rgba(138,90,43,.10)}
  .code-row{display:flex; gap:8px}
  .code-row input{flex:1; min-width:0}
  .code-row button{flex:0 0 auto; white-space:nowrap; padding:0 12px; height:42px; font-size:14px}
  button{
    font:inherit; cursor:pointer; border-radius:12px; border:1px solid var(--line);
    background:#fff; color:var(--brown); padding:0 16px;
  }
  button:disabled{opacity:.55; cursor:not-allowed}
  .primary{
    width:100%; height:44px; margin-top:14px; border:none; color:#fff; font-weight:600; font-size:15px;
    background:linear-gradient(180deg,#9a6531,var(--brown)); box-shadow:0 8px 18px rgba(138,90,43,.28);
  }
  .hint{font-size:12px; color:var(--muted); line-height:1.7; margin-top:14px}
  .agree{display:flex; gap:8px; align-items:flex-start; font-size:12px; color:var(--muted); margin-top:10px}
  .agree input{width:15px; height:15px; margin-top:2px}
  .msg{min-height:20px; font-size:13px; margin-top:10px; text-align:center; word-break:break-word}
  .msg.err{color:var(--danger)}
  .msg.ok{color:var(--ok)}
  .done{text-align:center; padding:10px 0 4px}
  .done .tick{
    width:56px; height:56px; margin:0 auto 12px; border-radius:50%; background:#eaf3ec;
    color:var(--ok); font-size:28px; line-height:56px;
  }
  .done h2{font-size:18px; margin:0 0 8px; color:var(--brown-deep)}
  .done p{font-size:13px; color:var(--muted); margin:0}
  .hidden{display:none !important}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g stroke="#8a5a2b" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M60 76c-6-4-13-6-20-6-4 0-7 0-9 1v32c2-1 5-1 9-1 7 0 14 2 20 6 6-4 13-6 20-6 4 0 7 0 9 1V71c-2-1-5-1-9-1-7 0-14 2-20 6z" fill="#fdf7ea"/>
        <path d="M60 76v32"/>
      </g>
      <text x="60" y="56" text-anchor="middle" font-size="46" font-weight="700" fill="#6f4520"
            font-family="PingFang SC, Microsoft YaHei, STHeiti, sans-serif">史</text>
    </svg>
  </div>
  <div class="brand">QING SHI</div>

  <div id="formPane">
    <h1>登录青史</h1>

    <div class="notice">
      <b>第一次用？</b>微信搜小程序「<b>青史永存</b>」→ 注册时绑定手机号 →
      回到这里用同一个手机号 + 验证码登录。<br />
      已经绑过手机号的，直接登就行。
    </div>

    <label for="phone">手机号</label>
    <input id="phone" type="tel" inputmode="numeric" maxlength="11" placeholder="请输入手机号" autocomplete="tel" />
    <label for="code">验证码</label>
    <div class="code-row">
      <input id="code" type="tel" inputmode="numeric" maxlength="6" placeholder="请输入验证码" autocomplete="one-time-code" />
      <button id="sendCode" type="button">获取验证码</button>
    </div>
    <button id="submit" class="primary" type="button">登 录</button>
    <div class="agree">
      <input id="agree" type="checkbox" checked />
      <span>登录即表示同意《用户协议》和《隐私政策》</span>
    </div>
    <div id="msg" class="msg"></div>
  </div>

  <div id="donePane" class="done hidden">
    <div class="tick">✓</div>
    <h2>登录成功</h2>
    <p>凭证已经保存到本机，可以关掉这个窗口了。</p>
    <p id="doneUid"></p>
  </div>
</div>

<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var msg = $('msg');
  var btnSend = $('sendCode');
  var btnSubmit = $('submit');
  var timer = null;

  function say(text, kind) {
    msg.className = 'msg' + (kind ? ' ' + kind : '');
    msg.textContent = text || '';
  }

  function post(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return { code: 500, message: '返回内容无法解析' }; });
    });
  }

  function countdown(seconds) {
    btnSend.disabled = true;
    var left = seconds;
    btnSend.textContent = left + 's';
    timer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        btnSend.disabled = false;
        btnSend.textContent = '获取验证码';
      } else {
        btnSend.textContent = left + 's';
      }
    }, 1000);
  }

  btnSend.addEventListener('click', function () {
    var phone = String($('phone').value || '').trim();
    if (!/^1[3-9]\\d{9}$/.test(phone)) { say('手机号看起来不太对', 'err'); return; }
    say('正在发送…');
    btnSend.disabled = true;
    post('/api/sms_send', { phone: phone }).then(function (res) {
      if (res && res.code === 200) { say('验证码已发送', 'ok'); countdown(60); }
      else { btnSend.disabled = false; say((res && res.message) || '发送失败', 'err'); }
    }).catch(function (err) {
      btnSend.disabled = false;
      say('发送失败：' + (err && err.message ? err.message : err), 'err');
    });
  });

  btnSubmit.addEventListener('click', function () {
    var phone = String($('phone').value || '').trim();
    var code = String($('code').value || '').trim();
    if (!/^1[3-9]\\d{9}$/.test(phone)) { say('手机号看起来不太对', 'err'); return; }
    if (!/^\\d{4,6}$/.test(code)) { say('验证码是 4~6 位数字', 'err'); return; }
    if (!$('agree').checked) { say('要先同意协议才能登录', 'err'); return; }
    say('正在登录…');
    btnSubmit.disabled = true;
    post('/api/sms_login', { phone: phone, code: code }).then(function (res) {
      if (res && res.code === 200) {
        $('formPane').classList.add('hidden');
        $('donePane').classList.remove('hidden');
        if (res.uid) $('doneUid').textContent = '账号 ' + String(res.uid).slice(0, 6) + '…';
        say('');
        // 结果露一眼就关窗：1500 是给外壳的暗号，window.close 兜底（Chrome 应用窗可关）
        setTimeout(function () {
          document.title = 'QINGSHI_LOGIN_DONE';
          try { window.close(); } catch (e) { /* 关不掉就靠外壳 */ }
        }, 1000);
      } else {
        btnSubmit.disabled = false;
        say((res && res.message) || '登录失败', 'err');
      }
    }).catch(function (err) {
      btnSubmit.disabled = false;
      say('登录失败：' + (err && err.message ? err.message : err), 'err');
    });
  });

  fetch('/api/state').then(function (r) { return r.json(); }).then(function (state) {
    if (state && state.loggedIn) {
      $('formPane').classList.add('hidden');
      $('donePane').classList.remove('hidden');
    }
  }).catch(function () {});
})();
</script>
</body>
</html>`
}
