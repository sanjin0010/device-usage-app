const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

let db;
let server;
let baseUrl;
let tmpDir;
let adminToken;
let staffToken;
let staffId;
let deviceId;
let usageId;

async function req(method, url, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(baseUrl + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-app-test-'));
  db = openDb(path.join(tmpDir, 'test.db'));
  const app = createApp(db);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const admin = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin123' } });
  adminToken = admin.data.token;
  const staff = await req('POST', '/api/auth/login', { body: { username: 'staff', password: 'staff123' } });
  staffToken = staff.data.token;
  staffId = staff.data.user.id;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('未登录访问接口返回 401', async () => {
  const res = await req('GET', '/api/devices');
  assert.equal(res.status, 401);
});

test('注册员工并自动登录', async () => {
  const bad = await req('POST', '/api/auth/register', {
    body: { username: 'ab', password: '123456', displayName: '李四' },
  });
  assert.equal(bad.status, 400);

  const res = await req('POST', '/api/auth/register', {
    body: { username: 'lisi', password: '123456', displayName: '李四' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.user.role, 'employee');
  assert.ok(res.data.token);

  const dup = await req('POST', '/api/auth/register', {
    body: { username: 'lisi', password: '123456', displayName: '李四' },
  });
  assert.equal(dup.status, 409);
});

test('设备列表支持搜索', async () => {
  const res = await req('GET', '/api/devices?search=示波器', { token: staffToken });
  assert.equal(res.status, 200);
  assert.ok(res.data.devices.some((d) => d.code === 'DEV-1003'));
});

test('仅管理员可新增设备', async () => {
  const forbidden = await req('POST', '/api/devices', {
    token: staffToken,
    body: { name: '测试台架' },
  });
  assert.equal(forbidden.status, 403);

  const created = await req('POST', '/api/devices', {
    token: adminToken,
    body: { name: '测试台架', model: 'T-01', location: '三号厂房' },
  });
  assert.equal(created.status, 201);
  assert.match(created.data.device.code, /^DEV-/);
  deviceId = created.data.device.id;

  const dup = await req('POST', '/api/devices', {
    token: adminToken,
    body: { name: '重复编号', code: created.data.device.code },
  });
  assert.equal(dup.status, 409);
});

test('登记使用后设备变为使用中且重复登记被阻止', async () => {
  const plannedEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const res = await req('POST', `/api/devices/${deviceId}/start-use`, {
    token: staffToken,
    body: { plannedEndTime: plannedEnd, note: '压力测试' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.usage.status, 'active');
  usageId = res.data.usage.id;

  const detail = await req('GET', `/api/devices/${deviceId}`, { token: staffToken });
  assert.equal(detail.data.device.status, 'in_use');
  assert.equal(detail.data.device.activeUsage.userId, staffId);

  const conflict = await req('POST', `/api/devices/${deviceId}/start-use`, {
    token: staffToken,
    body: { plannedEndTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() },
  });
  assert.equal(conflict.status, 409);
});

test('管理员不能删除使用中的设备', async () => {
  const res = await req('DELETE', `/api/devices/${deviceId}`, { token: adminToken });
  assert.equal(res.status, 409);
});

test('其他员工不能结束别人的使用记录', async () => {
  const other = await req('POST', '/api/auth/register', {
    body: { username: 'wangwu', password: '123456', displayName: '王五' },
  });
  const res = await req('POST', `/api/usage/${usageId}/end`, { token: other.data.token });
  assert.equal(res.status, 403);
});

test('使用者本人结束使用后设备恢复空闲', async () => {
  const res = await req('POST', `/api/usage/${usageId}/end`, { token: staffToken });
  assert.equal(res.status, 200);
  assert.equal(res.data.usage.status, 'ended');

  const detail = await req('GET', `/api/devices/${deviceId}`, { token: staffToken });
  assert.equal(detail.data.device.status, 'idle');
  assert.equal(detail.data.device.activeUsage, null);

  const again = await req('POST', `/api/usage/${usageId}/end`, { token: staffToken });
  assert.equal(again.status, 409);
});

test('管理员可编辑设备信息且其他角色无权编辑', async () => {
  const forbidden = await req('PUT', `/api/devices/${deviceId}`, {
    token: staffToken,
    body: { name: '越权修改', model: 'T-02', location: '四号厂房', code: 'DEV-TEST-EDITED' },
  });
  assert.equal(forbidden.status, 403);

  const bad = await req('PUT', `/api/devices/${deviceId}`, {
    token: adminToken,
    body: { name: '', model: 'T-02', location: '四号厂房', code: 'DEV-TEST-EDITED' },
  });
  assert.equal(bad.status, 400);

  const res = await req('PUT', `/api/devices/${deviceId}`, {
    token: adminToken,
    body: { name: '测试台架-改', model: 'T-02', location: '四号厂房', code: 'DEV-TEST-EDITED' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.device.name, '测试台架-改');
  assert.equal(res.data.device.code, 'DEV-TEST-EDITED');

  const dup = await req('PUT', `/api/devices/${deviceId}`, {
    token: adminToken,
    body: { name: '测试台架-改', model: 'T-02', location: '四号厂房', code: 'DEV-1001' },
  });
  assert.equal(dup.status, 409);
});

test('管理员可删除设备，删除后从列表隐藏', async () => {
  const created = await req('POST', '/api/devices', {
    token: adminToken,
    body: { name: '待删除设备', model: 'X', location: '仓库' },
  });
  const id = created.data.device.id;
  const res = await req('DELETE', `/api/devices/${id}`, { token: adminToken });
  assert.equal(res.status, 200);

  const list = await req('GET', '/api/devices', { token: staffToken });
  assert.ok(!list.data.devices.some((d) => d.id === id));
  const detail = await req('GET', `/api/devices/${id}`, { token: staffToken });
  assert.equal(detail.status, 404);
  const again = await req('DELETE', `/api/devices/${id}`, { token: adminToken });
  assert.equal(again.status, 404);
});

test('管理员可以结束员工的使用记录', async () => {
  const list = await req('GET', '/api/devices?search=示波器', { token: adminToken });
  const scopeId = list.data.devices.find((d) => d.code === 'DEV-1003').id;
  const detail = await req('GET', `/api/devices/${scopeId}`, { token: adminToken });
  const activeUsageId = detail.data.device.activeUsage.id;
  const res = await req('POST', `/api/usage/${activeUsageId}/end`, { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.data.usage.status, 'ended');
});

test('我的使用记录包含已完成记录', async () => {
  const res = await req('GET', '/api/me/usage', { token: staffToken });
  assert.equal(res.status, 200);
  assert.ok(res.data.usage.some((u) => u.id === usageId && u.status === 'ended'));
});
