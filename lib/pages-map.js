// 青史 H5 的页面能力地图：AI 靠它知道「哪个功能在哪一页」。
// 路由都来自项目 pages.json（主包 10 + 分包 7），标题取自各自的 navigationBarTitleText。

export const PAGES = [
  // ---- 主包 ----
  { route: '/pages/career/career', title: '生涯', group: '生涯', desc: '首页。顶部是头像、昵称、标签、生卒年；下面是生涯时间轴，可按全部/记录/旅行/工作等标签筛选；右下角「添加」进入写记录。' },
  { route: '/pages/familytree/familytree', title: '族谱', group: '族谱', desc: '族谱图，看家族成员与代际关系。' },
  { route: '/pages/ai/ai', title: 'AI 助手', group: 'AI', desc: '跟青灵对话，可以问自己的经历、让它分析生涯、帮你整理记录。' },
  { route: '/pages/discover/discover', title: '发现', group: '发现', desc: '探索页，用筛选项挑不同人物的故事看，入口包括无限画布、我的组织、时光胶囊、AI 分身、个人主页。' },
  { route: '/pages/profile/profile', title: '个人中心', group: '个人中心', desc: '头像昵称、UID、云端存储空间（已用/剩余/总额与占用比例）、消息中心、资料设置、存储相册、在线充值、邀请好友、兑换码等入口。' },
  { route: '/pages/profile/login/login', title: '登录', group: '个人中心', desc: '手机号 + 短信验证码登录；H5 打开就是这个页面。' },
  { route: '/pages/profile/register/register', title: '注册', group: '个人中心', desc: '手机号注册新账号。' },
  { route: '/pages/profile/completeProfile/completeProfile', title: '完善资料', group: '个人中心', desc: '新账号首次登录后补昵称、生日、头像等。' },
  { route: '/pages/profile/inviteAccept/inviteAccept', title: '接受邀请', group: '个人中心', desc: '通过邀请链接加入某个家族/组织。' },
  { route: '/pages/career/shareView', title: '分享查看', group: '生涯', desc: '别人分享过来的一段生涯/事件。' },
  // ---- 分包：发现 ----
  { route: '/pages/discover/engraving/engraving', title: '无限画布', group: '发现', desc: '把照片和文字铺在一块可拖动的画布上，拼成一面记忆墙。' },
  { route: '/organization/list', title: '我的组织', group: '组织', desc: '我加入的组织列表（公司、家族、兴趣团体）。' },
  { route: '/organization/orgtree/orgtree', title: '组织关系树', group: '组织', desc: '组织内的人与人关系图。' },
  { route: '/aiAvatar/create', title: '创建分身', group: 'AI', desc: '用资料与语料创建一个 AI 分身。' },
  { route: '/aiAvatar/list', title: 'AI 分身', group: 'AI', desc: '我创建过的 AI 分身列表。' },
  { route: '/aiAvatar/detail', title: '分身配置', group: 'AI', desc: '调整分身的设定、语气、可用范围。' },
  { route: '/timeCapsule/index', title: '时光胶囊', group: '时光胶囊', desc: '写给未来的一封信，设定开启时间。' },
  { route: '/timeCapsule/list', title: '我的胶囊', group: '时光胶囊', desc: '我封存/收到过的时光胶囊。' },
  { route: '/timeCapsule/create', title: '新增胶囊', group: '时光胶囊', desc: '写一颗新胶囊：内容、接收人、开启时间。' },
  { route: '/timeCapsule/detail', title: '胶囊详情', group: '时光胶囊', desc: '看一颗胶囊的内容与倒计时。' },
  // ---- 分包：个人主页 ----
  { route: '/mySpace/index', title: '个人主页', group: '个人主页', desc: '自己的对外主页（作品式展示）。' },
  { route: '/mySpace/create', title: '新建主页', group: '个人主页', desc: '建一个对外展示的个人主页。' },
  { route: '/mySpace/detail', title: '主页详情', group: '个人主页', desc: '看别人的个人主页。' },
  { route: '/mySpace/webview', title: '个人主页（网页）', group: '个人主页', desc: '主页的网页浏览态。' },
  { route: '/mySpace/admin', title: '主页审核', group: '个人主页', desc: '管理员审核别人提交的主页。' },
  { route: '/mySpace/adminDetail', title: '审核详情', group: '个人主页', desc: '单条审核的处理页。' },
  // ---- 分包：消息 ----
  { route: '/message/message', title: '消息中心', group: '消息', desc: '互动通知、系统消息。' },
  { route: '/message/messageDetail', title: '消息详情', group: '消息', desc: '单条消息内容。' },
  // ---- 分包：个人设置 ----
  { route: '/profile/sub/viewUserinfo', title: '资料设置', group: '个人中心', desc: '改昵称、头像、性别、生日、简介。' },
  { route: '/profile/sub/storageGallery', title: '存储相册', group: '个人中心', desc: '云端已上传的图片/附件，占的正是云空间额度。' },
  { route: '/profile/sub/miniProgramGuide', title: '使用说明', group: '个人中心', desc: '功能说明。' },
  { route: '/profile/sub/agreement', title: '协议', group: '个人中心', desc: '用户协议与隐私政策。' },
  // ---- 分包：生涯子页 ----
  { route: '/pages/career/sub/eventEdit', title: '生涯事件', group: '生涯', desc: '写/改一条事件：标题、正文、开始结束时间、是否阶段、标签、地点、图片。' },
  { route: '/pages/career/sub/careerView', title: '生涯', group: '生涯', desc: '某个人的生涯总览。' },
  { route: '/pages/career/sub/eventDetail', title: '事件详情', group: '生涯', desc: '单条事件的完整内容、图片、地点。' },
  { route: '/pages/career/sub/careerDetail', title: '生涯详情', group: '生涯', desc: '带头像栏、标签、时间轴、日历模式的完整生涯页。' },
  { route: '/pages/career/sub/shareCreate', title: '新建分享', group: '生涯', desc: '把一段生涯或某条事件做成分享链接。' },
  { route: '/pages/career/sub/interview', title: 'AI 访谈', group: 'AI', desc: 'AI 一问一答把你的人生故事聊出来，再整理成记录。' },
]

export function pageUrl(base, route) {
  const host = String(base || '').replace(/\/+$/, '')
  const path = '/' + String(route || '').replace(/^\/+/, '')
  return host + '/#' + path
}

export function findPages(keyword) {
  const key = String(keyword || '').trim().toLowerCase()
  if (!key) return PAGES
  return PAGES.filter((page) => {
    const hay = (page.route + ' ' + page.title + ' ' + page.group + ' ' + page.desc).toLowerCase()
    return hay.includes(key)
  })
}

export function pageBrief() {
  const groups = new Map()
  for (const page of PAGES) {
    if (!groups.has(page.group)) groups.set(page.group, [])
    groups.get(page.group).push(page)
  }
  const lines = []
  for (const [group, list] of groups) {
    lines.push('【' + group + '】')
    for (const page of list) lines.push('- ' + page.title + '（' + page.route + '）：' + page.desc)
  }
  return lines.join('\n')
}
