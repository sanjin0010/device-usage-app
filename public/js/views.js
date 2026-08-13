import { api, setToken, clearToken } from './api.js';
import { escapeHtml, icon, toast, formatDateTime, toLocalInputValue, localValueToIso, statusMeta, openSheet } from './ui.js';

let currentUser = null;
let currentRefresh = null;

export function setUser(user) {
  currentUser = user;
}

export function setCurrentRefresh(fn) {
  currentRefresh = fn;
}

export function refreshCurrentView() {
  if (typeof currentRefresh === 'function') currentRefresh();
}

function setView(html) {
  document.getElementById('view').innerHTML = html;
}

function notifyUser(user) {
  window.dispatchEvent(new CustomEvent('app:user', { detail: user }));
}

function spinner(text = '加载中…') {
  return `<div class="empty-state">${icon('loader')}<span>${escapeHtml(text)}</span></div>`;
}

function emptyState(text) {
  return `<div class="empty-state">${icon('search')}<span>${escapeHtml(text)}</span></div>`;
}

export function loginView() {
  setView(`
    <div class="auth-screen">
      <div class="auth-logo">${icon('wrench')}</div>
      <div>
        <h1 class="auth-title">设备使用登记</h1>
        <p class="auth-sub">厂房设备台账 · 使用登记</p>
      </div>
      <form id="login-form" class="auth-card">
        <label class="field"><span>用户名</span><input name="username" autocomplete="username" required></label>
        <label class="field"><span>密码</span><input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit" class="btn btn-primary btn-block">${icon('logIn')} 登录</button>
        <div class="demo-row">
          <button type="button" class="demo-btn" data-username="admin" data-password="admin123">${icon('shield')} 管理员演示</button>
          <button type="button" class="demo-btn" data-username="staff" data-password="staff123">${icon('user')} 员工演示</button>
        </div>
      </form>
      <button id="goto-register" class="link-btn">注册新账号</button>
    </div>`);

  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const data = await api.login({
        username: form.username.value.trim(),
        password: form.password.value,
      });
      setToken(data.token);
      notifyUser(data.user);
      location.hash = '#/';
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
    }
  });

  form.querySelectorAll('.demo-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      form.username.value = btn.dataset.username;
      form.password.value = btn.dataset.password;
    });
  });

  document.getElementById('goto-register').addEventListener('click', () => {
    location.hash = '#/register';
  });
}

export function registerView() {
  setView(`
    <div class="auth-screen">
      <div class="auth-logo">${icon('user')}</div>
      <div>
        <h1 class="auth-title">注册账号</h1>
        <p class="auth-sub">新注册账号默认员工角色</p>
      </div>
      <form id="register-form" class="auth-card">
        <label class="field"><span>用户名</span><input name="username" autocomplete="username" minlength="3" maxlength="20" required></label>
        <label class="field"><span>姓名</span><input name="displayName" maxlength="30" required></label>
        <label class="field"><span>密码</span><input name="password" type="password" minlength="6" autocomplete="new-password" required></label>
        <button type="submit" class="btn btn-primary btn-block">${icon('check')} 注册并登录</button>
      </form>
      <button id="goto-login" class="link-btn">已有账号，返回登录</button>
    </div>`);

  const form = document.getElementById('register-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const data = await api.register({
        username: form.username.value.trim(),
        displayName: form.displayName.value.trim(),
        password: form.password.value,
      });
      setToken(data.token);
      notifyUser(data.user);
      location.hash = '#/';
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
    }
  });

  document.getElementById('goto-login').addEventListener('click', () => {
    location.hash = '#/login';
  });
}

function deviceCard(device) {
  const st = statusMeta(device.status);
  const meta = [device.location, device.model, device.code].filter(Boolean).join(' · ');
  return `
    <button type="button" class="device-card" data-id="${escapeHtml(device.id)}">
      <span class="device-icon">${icon('wrench')}</span>
      <span class="device-main">
        <span class="device-name">${escapeHtml(device.name)}</span>
        <span class="device-meta">${escapeHtml(meta || '未填写位置')}</span>
      </span>
      <span class="status-badge ${st.badge}"><span class="status-dot ${st.dot}"></span>${st.label}</span>
    </button>`;
}

export function homeView() {
  setView(`
    <div class="search-box">${icon('search')}<input id="device-search" type="search" placeholder="搜索设备名称、编号、型号、位置" autocomplete="off"></div>
    <div id="device-list"></div>`);

  const input = document.getElementById('device-search');
  const listEl = document.getElementById('device-list');
  let timer = null;

  async function load(silent = false) {
    if (!silent) listEl.innerHTML = spinner();
    try {
      const { devices } = await api.devices(input.value.trim());
      listEl.innerHTML = devices.length
        ? devices.map(deviceCard).join('')
        : emptyState('未找到匹配设备');
      listEl.querySelectorAll('.device-card').forEach((card) => {
        card.addEventListener('click', () => {
          location.hash = `#/devices/${encodeURIComponent(card.dataset.id)}`;
        });
      });
    } catch (err) {
      if (!silent) toast(err.message, 'error');
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => load(), 250);
  });

  load();
  setCurrentRefresh(() => load(true));
}

function usagePanel(active, isMine) {
  return `
    <section class="usage-panel">
      <div class="sheet-label">当前使用中</div>
      <ul class="period-list">
        <li class="period-item">${icon('user')}
          <div>
            <strong>${escapeHtml(active.userName)}${isMine ? '（我）' : ''}</strong>
            <span>${formatDateTime(active.startTime)} → ${formatDateTime(active.plannedEndTime)}（预计）</span>
            ${active.note ? `<span>${escapeHtml(active.note)}</span>` : ''}
          </div>
        </li>
      </ul>
    </section>`;
}

function idlePanel() {
  return `
    <section class="usage-panel usage-idle">
      ${icon('check')}
      <div><strong>设备空闲</strong><span>当前没有进行中的使用</span></div>
    </section>`;
}

export async function deviceDetailView(id) {
  setView(spinner());
  try {
    const { device } = await api.device(id);
    const st = statusMeta(device.status);
    const active = device.activeUsage;
    const isMine = active && currentUser && active.userId === currentUser.id;
    setView(`
      <section class="detail-hero">
        <div class="detail-head">
          <div class="device-icon large">${icon('wrench')}</div>
          <div>
            <h2 class="detail-name">${escapeHtml(device.name)}</h2>
            <span class="status-badge ${st.badge}"><span class="status-dot ${st.dot}"></span>${st.label}</span>
          </div>
        </div>
        <dl class="detail-rows">
          <div class="detail-row"><dt>设备编号</dt><dd>${escapeHtml(device.code)}</dd></div>
          ${device.model ? `<div class="detail-row"><dt>型号</dt><dd>${escapeHtml(device.model)}</dd></div>` : ''}
          ${device.location ? `<div class="detail-row"><dt>位置</dt><dd>${escapeHtml(device.location)}</dd></div>` : ''}
        </dl>
      </section>
      ${active ? usagePanel(active, isMine) : idlePanel()}
      <div class="action-bar ${isMine ? '' : 'single'}">
        <button type="button" id="register-btn" class="btn btn-primary">${icon('play')} 登记使用</button>
        ${isMine ? `<button type="button" id="end-btn" class="btn btn-danger">${icon('stop')} 结束使用</button>` : ''}
      </div>
      ${currentUser && currentUser.role === 'admin' ? `
        <div class="admin-actions">
          <button type="button" id="edit-device-btn" class="btn btn-ghost">${icon('edit')} 编辑设备</button>
          <button type="button" id="delete-device-btn" class="btn btn-ghost danger">${icon('trash')} 删除设备</button>
        </div>` : ''}`);

    document.getElementById('register-btn').addEventListener('click', () => openRegisterSheet(device));
    const endBtn = document.getElementById('end-btn');
    if (endBtn) {
      endBtn.addEventListener('click', async () => {
        if (!window.confirm('确认结束本次使用？')) return;
        try {
          await api.endUse(active.id);
          toast('使用已结束');
          deviceDetailView(id);
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
    const editBtn = document.getElementById('edit-device-btn');
    if (editBtn) {
      editBtn.addEventListener('click', () => openEditDeviceSheet(device));
    }
    const deleteBtn = document.getElementById('delete-device-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (!window.confirm(`确认删除设备“${device.name}”？设备将从列表隐藏，历史记录仍会保留。`)) return;
        try {
          await api.deleteDevice(device.id);
          toast('设备已删除');
          location.hash = '#/';
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
    setCurrentRefresh(() => deviceDetailView(id));
  } catch (err) {
    setView(emptyState(err.message));
    toast(err.message, 'error');
  }
}

function openRegisterSheet(device) {
  const active = device.activeUsage;
  const startVal = toLocalInputValue();
  const endVal = toLocalInputValue(new Date(Date.now() + 60 * 60 * 1000));
  const periods = active
    ? `<li class="period-item">${icon('user')}<div><strong>${escapeHtml(active.userName)}</strong><span>${formatDateTime(active.startTime)} → ${formatDateTime(active.plannedEndTime)}（预计）</span></div></li>`
    : `<li class="period-item period-empty">${icon('check')}<div><strong>暂无占用</strong><span>未来 24 小时内没有已有使用记录</span></div></li>`;

  const sheet = openSheet({
    title: `登记使用 · ${device.name}`,
    content: `
      <div class="sheet-section">
        <div class="sheet-label">已有使用时间段（未来 24 小时）</div>
        <ul class="period-list">${periods}</ul>
      </div>
      <form id="register-form" class="form">
        <label class="field"><span>开始时间</span><input type="datetime-local" name="startTime" value="${startVal}" required></label>
        <label class="field"><span>计划结束时间</span><input type="datetime-local" name="plannedEndTime" value="${endVal}" required></label>
        <label class="field"><span>使用事由 / 备注</span><textarea name="note" rows="3" maxlength="200" placeholder="选填"></textarea></label>
        <button type="submit" class="btn btn-primary btn-block" ${active ? 'disabled' : ''}>${icon('check')} 提交登记</button>
        ${active ? '<p class="form-note">设备使用中，暂不能重复登记</p>' : ''}
      </form>`,
  });

  const form = document.getElementById('register-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const start = localValueToIso(form.startTime.value);
    const end = localValueToIso(form.plannedEndTime.value);
    if (!start || !end || new Date(end) <= new Date(start)) {
      toast('结束时间必须晚于开始时间', 'error');
      return;
    }
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api.startUse(device.id, {
        startTime: start,
        plannedEndTime: end,
        note: form.note.value.trim(),
      });
      sheet.close();
      toast('登记成功，设备已标记为使用中');
      refreshCurrentView();
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
    }
  });
}

function openEditDeviceSheet(device) {
  const sheet = openSheet({
    title: `编辑设备 · ${device.name}`,
    content: `
      <form id="edit-device-form" class="form">
        <label class="field"><span>设备名称</span><input name="name" maxlength="60" value="${escapeHtml(device.name)}" required></label>
        <label class="field"><span>设备型号</span><input name="model" maxlength="60" value="${escapeHtml(device.model || '')}"></label>
        <label class="field"><span>所在厂房 / 位置</span><input name="location" maxlength="60" value="${escapeHtml(device.location || '')}"></label>
        <label class="field"><span>设备编号</span><input name="code" maxlength="40" value="${escapeHtml(device.code)}" required></label>
        <button type="submit" class="btn btn-primary btn-block">${icon('check')} 保存修改</button>
      </form>`,
  });

  const form = document.getElementById('edit-device-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api.updateDevice(device.id, {
        name: form.name.value.trim(),
        model: form.model.value.trim(),
        location: form.location.value.trim(),
        code: form.code.value.trim(),
      });
      sheet.close();
      toast('设备信息已更新');
      deviceDetailView(device.id);
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
    }
  });
}

export function openAddDeviceSheet() {
  const sheet = openSheet({
    title: '新增设备',
    content: `
      <form id="add-device-form" class="form">
        <label class="field"><span>设备名称</span><input name="name" maxlength="60" placeholder="必填" required></label>
        <label class="field"><span>设备型号</span><input name="model" maxlength="60"></label>
        <label class="field"><span>所在厂房 / 位置</span><input name="location" maxlength="60"></label>
        <label class="field"><span>设备编号</span><input name="code" maxlength="40" placeholder="留空自动生成"></label>
        <button type="submit" class="btn btn-primary btn-block">${icon('plus')} 保存设备</button>
      </form>`,
  });

  const form = document.getElementById('add-device-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      await api.createDevice({
        name: form.name.value.trim(),
        model: form.model.value.trim(),
        location: form.location.value.trim(),
        code: form.code.value.trim(),
      });
      sheet.close();
      toast('设备已新增');
      if (typeof currentRefresh === 'function') {
        currentRefresh();
      } else {
        location.hash = '#/';
      }
    } catch (err) {
      toast(err.message, 'error');
      submit.disabled = false;
    }
  });
}

function usageCard(usage) {
  const endLabel = usage.status === 'active'
    ? `${formatDateTime(usage.plannedEndTime)}（预计）`
    : formatDateTime(usage.endTime || usage.plannedEndTime);
  return `
    <div class="usage-card">
      <div class="usage-head">
        <strong>${escapeHtml(usage.deviceName)}</strong>
        <span class="usage-status status-${escapeHtml(usage.status)}">${usage.status === 'active' ? '进行中' : '已结束'}</span>
      </div>
      <div class="usage-meta">${escapeHtml(usage.deviceCode)}${usage.deviceLocation ? ` · ${escapeHtml(usage.deviceLocation)}` : ''}</div>
      <div class="usage-time">${icon('clock')} ${formatDateTime(usage.startTime)} → ${endLabel}</div>
      ${usage.note ? `<div class="usage-note">${escapeHtml(usage.note)}</div>` : ''}
      ${usage.status === 'active' ? `<button type="button" class="btn btn-danger btn-block end-btn" data-id="${escapeHtml(usage.id)}">${icon('stop')} 结束使用</button>` : ''}
    </div>`;
}

export function usageView() {
  setView(`
    <div class="segmented">
      <button type="button" class="active" data-tab="active">使用中</button>
      <button type="button" data-tab="history">历史记录</button>
    </div>
    <div id="usage-list"></div>`);

  const listEl = document.getElementById('usage-list');
  const segEl = document.querySelector('.segmented');
  let tab = 'active';

  async function load(silent = false) {
    if (!silent) listEl.innerHTML = spinner();
    try {
      const { usage } = await api.myUsage();
      const rows = usage.filter((u) => (tab === 'active' ? u.status === 'active' : u.status !== 'active'));
      listEl.innerHTML = rows.length
        ? rows.map(usageCard).join('')
        : emptyState(tab === 'active' ? '当前没有使用中的设备' : '暂无历史记录');
      listEl.querySelectorAll('.end-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          if (!window.confirm('确认结束本次使用？')) return;
          try {
            await api.endUse(btn.dataset.id);
            toast('使用已结束');
            load();
          } catch (err) {
            toast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      if (!silent) toast(err.message, 'error');
    }
  }

  segEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      segEl.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === btn));
      load();
    });
  });

  load();
  setCurrentRefresh(() => load(true));
}

export function profileView() {
  const user = currentUser;
  if (!user) return;
  setView(`
    <section class="profile-card">
      <span class="avatar">${escapeHtml((user.displayName || '?').slice(0, 1))}</span>
      <div>
        <div class="profile-name">${escapeHtml(user.displayName)}</div>
        <div class="profile-sub">${escapeHtml(user.username)} · ${user.role === 'admin' ? '管理员' : '员工'}</div>
      </div>
    </section>
    <ul class="menu-list">
      <li><a class="menu-item" href="#/usage">${icon('clipboard')} 我的使用记录</a></li>
      ${user.role === 'admin' ? `<li><button type="button" class="menu-item" id="menu-add-device">${icon('plus')} 新增设备</button></li>` : ''}
      <li><button type="button" class="menu-item danger" id="logout-btn">${icon('logOut')} 退出登录</button></li>
    </ul>`);

  document.getElementById('menu-add-device')?.addEventListener('click', openAddDeviceSheet);
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api.logout();
    } catch {
      // 本地会话已失效时也正常退出
    }
    clearToken();
    notifyUser(null);
    location.hash = '#/login';
  });
}
