import { api, getToken, clearToken } from './api.js';
import { icon } from './ui.js';
import * as views from './views.js';

const headerEl = document.getElementById('app-header');
const navEl = document.getElementById('bottom-nav');
let currentUser = null;

function setHeader({ title = '', back = false, actions = '' } = {}) {
  headerEl.innerHTML = `
    ${back ? `<button type="button" class="icon-btn" id="back-btn" aria-label="返回">${icon('arrowLeft')}</button>` : ''}
    <h1 class="header-title">${escape(title)}</h1>
    <div class="header-actions">${actions}</div>`;
  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      if (history.length > 1) {
        history.back();
      } else {
        location.hash = '#/';
      }
    });
  }
}

function escape(value) {
  return String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function setNav(active) {
  const items = [
    { key: 'home', href: '#/', icon: 'home', label: '首页' },
    { key: 'usage', href: '#/usage', icon: 'clipboard', label: '我的使用' },
    { key: 'me', href: '#/me', icon: 'user', label: '我的' },
  ];
  navEl.innerHTML = items
    .map((item) => `<a class="nav-item ${item.key === active ? 'active' : ''}" href="${item.href}">${icon(item.icon)}<span>${item.label}</span></a>`)
    .join('');
}

function renderChrome() {
  headerEl.hidden = !currentUser;
  navEl.hidden = !currentUser;
}

async function route() {
  const hash = location.hash.slice(1) || '/';
  if (!currentUser) {
    if (hash !== '/login' && hash !== '/register') {
      location.hash = '#/login';
      return;
    }
    renderChrome();
    if (hash === '/login') return views.loginView();
    return views.registerView();
  }

  renderChrome();
  views.setCurrentRefresh(null);

  if (hash === '/') {
    setHeader({
      title: '设备列表',
      actions: currentUser.role === 'admin'
        ? `<button type="button" class="btn btn-primary btn-sm" id="header-add-device">${icon('plus')} 新增设备</button>`
        : '',
    });
    setNav('home');
    await views.homeView();
    document.getElementById('header-add-device')?.addEventListener('click', views.openAddDeviceSheet);
    return;
  }

  if (hash.startsWith('/devices/')) {
    const id = decodeURIComponent(hash.slice('/devices/'.length));
    setHeader({ title: '设备详情', back: true });
    setNav('home');
    return views.deviceDetailView(id);
  }

  if (hash === '/usage') {
    setHeader({ title: '我的使用' });
    setNav('usage');
    return views.usageView();
  }

  if (hash === '/me') {
    setHeader({ title: '我的' });
    setNav('me');
    return views.profileView();
  }

  location.hash = '#/';
}

window.addEventListener('app:user', (event) => {
  currentUser = event.detail;
  views.setUser(event.detail);
});

async function boot() {
  if (getToken()) {
    try {
      const { user } = await api.me();
      currentUser = user;
      views.setUser(user);
    } catch {
      clearToken();
    }
  }
  window.addEventListener('hashchange', route);
  await route();
  setInterval(() => {
    if (currentUser) views.refreshCurrentView();
  }, 15000);
}

boot();
