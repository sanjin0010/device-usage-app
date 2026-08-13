import { nowIso, uuid, isIsoDate, json, error } from './util.js';
import { hashPassword, verifyPassword, createSession, getSessionUser, deleteSession } from './auth.js';
import { ensureSchemaAndSeed } from './schema.js';

let ready = null;

function toDevice(row) {
  let photos = [];
  try {
    photos = JSON.parse(row.photos || '[]');
  } catch {
    photos = [];
  }
  return {
    id: row.id,
    name: row.name,
    model: row.model,
    code: row.code,
    location: row.location,
    photos,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toUsage(row) {
  return {
    id: row.id,
    deviceId: row.device_id,
    deviceName: row.device_name || '',
    deviceCode: row.device_code || '',
    deviceLocation: row.device_location || '',
    userId: row.user_id,
    userName: row.user_name || '',
    startTime: row.start_time,
    endTime: row.end_time,
    plannedEndTime: row.planned_end_time,
    note: row.note,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function recomputeDeviceStatus(env, deviceId) {
  const activeUse = await env.DB.prepare(
    "SELECT id FROM usage_records WHERE device_id = ? AND type = 'use' AND status = 'active'"
  ).bind(deviceId).first();
  let status = 'idle';
  if (activeUse) {
    status = 'in_use';
  } else {
    const futureReservation = await env.DB.prepare(
      "SELECT id FROM usage_records WHERE device_id = ? AND type = 'reservation' AND status = 'pending' AND start_time > ?"
    ).bind(deviceId, nowIso()).first();
    if (futureReservation) status = 'reserved';
  }
  await env.DB.prepare('UPDATE devices SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, nowIso(), deviceId).run();
  return status;
}

async function generateDeviceCode(env) {
  for (let i = 0; i < 20; i += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(3));
    const code = `DEV-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    const exists = await env.DB.prepare('SELECT id FROM devices WHERE code = ?').bind(code).first();
    if (!exists) return code;
  }
  throw new Error('无法生成唯一设备编号');
}

async function getAuth(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = await getSessionUser(env, token);
  return user ? { user, token } : null;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env) {
    if (!ready) {
      ready = ensureSchemaAndSeed(env);
    }
    await ready;

    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    const method = request.method;
    const path = url.pathname;

    try {
      if (method === 'POST' && path === '/api/auth/register') {
        const body = await readBody(request);
        const username = String(body.username || '').trim().toLowerCase();
        const password = String(body.password || '');
        const displayName = String(body.displayName || '').trim();
        if (!/^[a-z0-9_.-]{3,20}$/.test(username)) return error('用户名需为 3-20 位字母、数字或 _.-');
        if (password.length < 6) return error('密码至少 6 位');
        if (!displayName) return error('请填写姓名');
        const exists = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
        if (exists) return error('用户名已存在', 409);
        const id = uuid();
        const ts = nowIso();
        await env.DB.prepare(
          'INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(id, username, await hashPassword(password), displayName, 'employee', ts).run();
        const token = await createSession(env, id);
        return json({ token, user: { id, username, displayName, role: 'employee' } }, 201);
      }

      if (method === 'POST' && path === '/api/auth/login') {
        const body = await readBody(request);
        const username = String(body.username || '').trim().toLowerCase();
        const password = String(body.password || '');
        const user = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
        if (!user || !(await verifyPassword(password, user.password_hash))) {
          return error('用户名或密码错误', 401);
        }
        const token = await createSession(env, user.id);
        return json({
          token,
          user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
        });
      }

      const auth = await getAuth(request, env);
      if (!auth) return error('未登录或登录已过期', 401);
      const { user, token } = auth;

      if (method === 'POST' && path === '/api/auth/logout') {
        await deleteSession(env, token);
        return json({ ok: true });
      }

      if (method === 'GET' && path === '/api/auth/me') {
        return json({ user });
      }

      if (method === 'GET' && path === '/api/devices') {
        const search = String(url.searchParams.get('search') || '').trim();
        let results;
        if (search) {
          const like = `%${search}%`;
          results = await env.DB.prepare(
            'SELECT * FROM devices WHERE deleted_at IS NULL AND (name LIKE ? OR code LIKE ? OR model LIKE ? OR location LIKE ?) ORDER BY created_at DESC'
          ).bind(like, like, like, like).all();
        } else {
          results = await env.DB.prepare('SELECT * FROM devices WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
        }
        return json({ devices: results.results.map(toDevice) });
      }

      if (method === 'GET' && path.startsWith('/api/devices/')) {
        const id = decodeURIComponent(path.slice('/api/devices/'.length));
        const row = await env.DB.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').bind(id).first();
        if (!row) return error('设备不存在', 404);
        const active = await env.DB.prepare(`
          SELECT u.id, u.user_id, u.start_time, u.planned_end_time, u.note, usr.display_name AS user_name
          FROM usage_records u
          JOIN users usr ON usr.id = u.user_id
          WHERE u.device_id = ? AND u.type = 'use' AND u.status = 'active'
          ORDER BY u.start_time DESC
          LIMIT 1
        `).bind(id).first();
        return json({
          device: {
            ...toDevice(row),
            activeUsage: active
              ? {
                  id: active.id,
                  userId: active.user_id,
                  userName: active.user_name,
                  startTime: active.start_time,
                  plannedEndTime: active.planned_end_time,
                  note: active.note,
                }
              : null,
          },
        });
      }

      if (method === 'POST' && path === '/api/devices') {
        if (user.role !== 'admin') return error('仅管理员可执行此操作', 403);
        const body = await readBody(request);
        const name = String(body.name || '').trim();
        const model = String(body.model || '').trim();
        const location = String(body.location || '').trim();
        let code = String(body.code || '').trim();
        if (!name) return error('设备名称必填');
        if (!code) {
          code = await generateDeviceCode(env);
        } else if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) {
          return error('设备编号格式不正确');
        }
        const dup = await env.DB.prepare('SELECT id FROM devices WHERE code = ?').bind(code).first();
        if (dup) return error('设备编号已存在', 409);
        const id = uuid();
        const ts = nowIso();
        await env.DB.prepare(
          'INSERT INTO devices (id, name, model, code, location, photos, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(id, name, model, code, location, '[]', 'idle', ts, ts).run();
        const row = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first();
        return json({ device: toDevice(row) }, 201);
      }

      if (method === 'PUT' && path.startsWith('/api/devices/')) {
        if (user.role !== 'admin') return error('仅管理员可执行此操作', 403);
        const id = decodeURIComponent(path.slice('/api/devices/'.length));
        const row = await env.DB.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').bind(id).first();
        if (!row) return error('设备不存在', 404);
        const body = await readBody(request);
        const name = String(body.name || '').trim();
        const model = String(body.model || '').trim();
        const location = String(body.location || '').trim();
        const code = String(body.code || '').trim();
        if (!name) return error('设备名称必填');
        if (!code) return error('设备编号必填');
        if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) return error('设备编号格式不正确');
        const dup = await env.DB.prepare('SELECT id FROM devices WHERE code = ? AND id != ?').bind(code, id).first();
        if (dup) return error('设备编号已存在', 409);
        await env.DB.prepare(
          'UPDATE devices SET name = ?, model = ?, location = ?, code = ?, updated_at = ? WHERE id = ?'
        ).bind(name, model, location, code, nowIso(), id).run();
        const updated = await env.DB.prepare('SELECT * FROM devices WHERE id = ?').bind(id).first();
        return json({ device: toDevice(updated) });
      }

      if (method === 'DELETE' && path.startsWith('/api/devices/')) {
        if (user.role !== 'admin') return error('仅管理员可执行此操作', 403);
        const id = decodeURIComponent(path.slice('/api/devices/'.length));
        const row = await env.DB.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').bind(id).first();
        if (!row) return error('设备不存在', 404);
        const active = await env.DB.prepare(
          "SELECT id FROM usage_records WHERE device_id = ? AND type = 'use' AND status = 'active'"
        ).bind(id).first();
        if (active) return error('设备使用中，不能删除', 409);
        await env.DB.prepare('UPDATE devices SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .bind(nowIso(), nowIso(), id).run();
        return json({ ok: true });
      }

      if (method === 'POST' && path.startsWith('/api/devices/') && path.endsWith('/start-use')) {
        const id = decodeURIComponent(path.slice('/api/devices/'.length, -'/start-use'.length));
        const device = await env.DB.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').bind(id).first();
        if (!device) return error('设备不存在', 404);
        const body = await readBody(request);
        const startTime = body.startTime ? String(body.startTime) : nowIso();
        const plannedEndTime = String(body.plannedEndTime || '');
        if (!isIsoDate(startTime)) return error('开始时间无效');
        if (!isIsoDate(plannedEndTime)) return error('计划结束时间必填');
        if (new Date(plannedEndTime) <= new Date(startTime)) return error('计划结束时间必须晚于开始时间');
        const note = String(body.note || '').trim().slice(0, 200);
        const conflict = await env.DB.prepare(`
          SELECT id FROM usage_records
          WHERE device_id = ? AND status IN ('active', 'pending')
            AND ? < COALESCE(end_time, planned_end_time)
            AND ? > start_time
        `).bind(id, startTime, plannedEndTime).first();
        if (conflict) return error('该时间段与已有使用记录冲突', 409);

        const usageId = uuid();
        const ts = nowIso();
        await env.DB.prepare(
          'INSERT INTO usage_records (id, device_id, user_id, start_time, end_time, planned_end_time, note, type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(usageId, id, user.id, startTime, null, plannedEndTime, note, 'use', 'active', ts).run();
        await recomputeDeviceStatus(env, id);
        return json({
          usage: {
            id: usageId,
            deviceId: id,
            deviceName: device.name,
            deviceCode: device.code,
            deviceLocation: device.location,
            userId: user.id,
            userName: user.displayName,
            startTime,
            endTime: null,
            plannedEndTime,
            note,
            type: 'use',
            status: 'active',
            createdAt: ts,
          },
        }, 201);
      }

      if (method === 'POST' && path.startsWith('/api/usage/') && path.endsWith('/end')) {
        const id = decodeURIComponent(path.slice('/api/usage/'.length, -'/end'.length));
        const record = await env.DB.prepare('SELECT * FROM usage_records WHERE id = ?').bind(id).first();
        if (!record) return error('使用记录不存在', 404);
        if (record.type !== 'use' || record.status !== 'active') {
          return error('该记录不是进行中的使用记录', 409);
        }
        if (record.user_id !== user.id && user.role !== 'admin') {
          return error('只能结束自己的使用记录', 403);
        }
        const endTime = nowIso();
        await env.DB.prepare("UPDATE usage_records SET end_time = ?, status = 'ended' WHERE id = ?")
          .bind(endTime, id).run();
        await recomputeDeviceStatus(env, record.device_id);
        const row = await env.DB.prepare(`
          SELECT u.*, d.name AS device_name, d.code AS device_code, d.location AS device_location, usr.display_name AS user_name
          FROM usage_records u
          JOIN devices d ON d.id = u.device_id
          JOIN users usr ON usr.id = u.user_id
          WHERE u.id = ?
        `).bind(id).first();
        return json({ usage: toUsage(row) });
      }

      if (method === 'GET' && path === '/api/me/usage') {
        const results = await env.DB.prepare(`
          SELECT u.*, d.name AS device_name, d.code AS device_code, d.location AS device_location, usr.display_name AS user_name
          FROM usage_records u
          JOIN devices d ON d.id = u.device_id
          JOIN users usr ON usr.id = u.user_id
          WHERE u.user_id = ?
          ORDER BY u.start_time DESC
        `).bind(user.id).all();
        return json({ usage: results.results.map(toUsage) });
      }

      return error('接口不存在', 404);
    } catch (err) {
      console.error(err);
      return error('服务器内部错误', 500);
    }
  },
};
