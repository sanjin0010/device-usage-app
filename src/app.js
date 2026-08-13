const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { nowIso, uuid, isIsoDate } = require('./util');
const { hashPassword, verifyPassword, createSession, getSessionUser, deleteSession } = require('./auth');

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

function recomputeDeviceStatus(db, deviceId) {
  const activeUse = db.prepare(
    "SELECT id FROM usage_records WHERE device_id = ? AND type = 'use' AND status = 'active'"
  ).get(deviceId);
  let status = 'idle';
  if (activeUse) {
    status = 'in_use';
  } else {
    const futureReservation = db.prepare(
      "SELECT id FROM usage_records WHERE device_id = ? AND type = 'reservation' AND status = 'pending' AND start_time > ?"
    ).get(deviceId, nowIso());
    if (futureReservation) status = 'reserved';
  }
  db.prepare('UPDATE devices SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), deviceId);
  return status;
}

function generateDeviceCode(db) {
  for (let i = 0; i < 20; i += 1) {
    const code = `DEV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const exists = db.prepare('SELECT id FROM devices WHERE code = ?').get(code);
    if (!exists) return code;
  }
  throw new Error('无法生成唯一设备编号');
}

function createApp(db) {
  const app = express();
  app.use(express.json());

  function authenticate(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = getSessionUser(db, token);
    if (!user) {
      return res.status(401).json({ error: '未登录或登录已过期' });
    }
    req.user = user;
    req.authToken = token;
    next();
  }

  function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: '仅管理员可执行此操作' });
    }
    next();
  }

  app.post('/api/auth/register', (req, res) => {
    const body = req.body || {};
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = String(body.displayName || '').trim();
    if (!/^[a-z0-9_.-]{3,20}$/.test(username)) {
      return res.status(400).json({ error: '用户名需为 3-20 位字母、数字或 _.-' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 位' });
    }
    if (!displayName) {
      return res.status(400).json({ error: '请填写姓名' });
    }
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      return res.status(409).json({ error: '用户名已存在' });
    }
    const id = uuid();
    const ts = nowIso();
    db.prepare(
      'INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, username, hashPassword(password), displayName, 'employee', ts);
    const token = createSession(db, id);
    res.status(201).json({ token, user: { id, username, displayName, role: 'employee' } });
  });

  app.post('/api/auth/login', (req, res) => {
    const body = req.body || {};
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = createSession(db, user.id);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
      },
    });
  });

  app.post('/api/auth/logout', authenticate, (req, res) => {
    deleteSession(db, req.authToken);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', authenticate, (req, res) => {
    res.json({ user: req.user });
  });

  app.get('/api/devices', authenticate, (req, res) => {
    const search = String(req.query.search || '').trim();
    let rows;
    if (search) {
      const like = `%${search}%`;
      rows = db.prepare(
        'SELECT * FROM devices WHERE deleted_at IS NULL AND (name LIKE ? OR code LIKE ? OR model LIKE ? OR location LIKE ?) ORDER BY created_at DESC'
      ).all(like, like, like, like);
    } else {
      rows = db.prepare('SELECT * FROM devices WHERE deleted_at IS NULL ORDER BY created_at DESC').all();
    }
    res.json({ devices: rows.map(toDevice) });
  });

  app.get('/api/devices/:id', authenticate, (req, res) => {
    const row = db.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!row) return res.status(404).json({ error: '设备不存在' });
    const active = db.prepare(`
      SELECT u.id, u.user_id, u.start_time, u.planned_end_time, u.note, usr.display_name AS user_name
      FROM usage_records u
      JOIN users usr ON usr.id = u.user_id
      WHERE u.device_id = ? AND u.type = 'use' AND u.status = 'active'
      ORDER BY u.start_time DESC
      LIMIT 1
    `).get(row.id);
    res.json({
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
  });

  app.post('/api/devices', authenticate, requireAdmin, (req, res) => {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const model = String(body.model || '').trim();
    const location = String(body.location || '').trim();
    let code = String(body.code || '').trim();
    if (!name) return res.status(400).json({ error: '设备名称必填' });
    if (!code) {
      code = generateDeviceCode(db);
    } else if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) {
      return res.status(400).json({ error: '设备编号格式不正确' });
    }
    if (db.prepare('SELECT id FROM devices WHERE code = ?').get(code)) {
      return res.status(409).json({ error: '设备编号已存在' });
    }
    const id = uuid();
    const ts = nowIso();
    db.prepare(
      'INSERT INTO devices (id, name, model, code, location, photos, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, name, model, code, location, '[]', 'idle', ts, ts);
    const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
    res.status(201).json({ device: toDevice(row) });
  });

  app.put('/api/devices/:id', authenticate, requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!row) return res.status(404).json({ error: '设备不存在' });
    const body = req.body || {};
    const name = String(body.name || '').trim();
    const model = String(body.model || '').trim();
    const location = String(body.location || '').trim();
    const code = String(body.code || '').trim();
    if (!name) return res.status(400).json({ error: '设备名称必填' });
    if (!code) return res.status(400).json({ error: '设备编号必填' });
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(code)) {
      return res.status(400).json({ error: '设备编号格式不正确' });
    }
    const dup = db.prepare('SELECT id FROM devices WHERE code = ? AND id != ?').get(code, row.id);
    if (dup) return res.status(409).json({ error: '设备编号已存在' });
    db.prepare(
      'UPDATE devices SET name = ?, model = ?, location = ?, code = ?, updated_at = ? WHERE id = ?'
    ).run(name, model, location, code, nowIso(), row.id);
    const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(row.id);
    res.json({ device: toDevice(updated) });
  });

  app.delete('/api/devices/:id', authenticate, requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!row) return res.status(404).json({ error: '设备不存在' });
    const active = db.prepare(
      "SELECT id FROM usage_records WHERE device_id = ? AND type = 'use' AND status = 'active'"
    ).get(row.id);
    if (active) return res.status(409).json({ error: '设备使用中，不能删除' });
    db.prepare('UPDATE devices SET deleted_at = ?, updated_at = ? WHERE id = ?').run(nowIso(), nowIso(), row.id);
    res.json({ ok: true });
  });

  app.post('/api/devices/:id/start-use', authenticate, (req, res) => {
    const body = req.body || {};
    const device = db.prepare('SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!device) return res.status(404).json({ error: '设备不存在' });

    const startTime = body.startTime ? String(body.startTime) : nowIso();
    const plannedEndTime = String(body.plannedEndTime || '');
    if (!isIsoDate(startTime)) return res.status(400).json({ error: '开始时间无效' });
    if (!isIsoDate(plannedEndTime)) return res.status(400).json({ error: '计划结束时间必填' });
    if (new Date(plannedEndTime) <= new Date(startTime)) {
      return res.status(400).json({ error: '计划结束时间必须晚于开始时间' });
    }
    const note = String(body.note || '').trim().slice(0, 200);

    const conflict = db.prepare(`
      SELECT id FROM usage_records
      WHERE device_id = ? AND status IN ('active', 'pending')
        AND ? < COALESCE(end_time, planned_end_time)
        AND ? > start_time
    `).get(device.id, startTime, plannedEndTime);
    if (conflict) return res.status(409).json({ error: '该时间段与已有使用记录冲突' });

    const id = uuid();
    const ts = nowIso();
    db.exec('BEGIN');
    try {
      db.prepare(
        'INSERT INTO usage_records (id, device_id, user_id, start_time, end_time, planned_end_time, note, type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(id, device.id, req.user.id, startTime, null, plannedEndTime, note, 'use', 'active', ts);
      recomputeDeviceStatus(db, device.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.status(201).json({
      usage: {
        id,
        deviceId: device.id,
        deviceName: device.name,
        deviceCode: device.code,
        deviceLocation: device.location,
        userId: req.user.id,
        userName: req.user.displayName,
        startTime,
        endTime: null,
        plannedEndTime,
        note,
        type: 'use',
        status: 'active',
        createdAt: ts,
      },
    });
  });

  app.post('/api/usage/:id/end', authenticate, (req, res) => {
    const record = db.prepare('SELECT * FROM usage_records WHERE id = ?').get(req.params.id);
    if (!record) return res.status(404).json({ error: '使用记录不存在' });
    if (record.type !== 'use' || record.status !== 'active') {
      return res.status(409).json({ error: '该记录不是进行中的使用记录' });
    }
    if (record.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '只能结束自己的使用记录' });
    }
    const endTime = nowIso();
    db.exec('BEGIN');
    try {
      db.prepare("UPDATE usage_records SET end_time = ?, status = 'ended' WHERE id = ?").run(endTime, record.id);
      recomputeDeviceStatus(db, record.device_id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    const row = db.prepare(`
      SELECT u.*, d.name AS device_name, d.code AS device_code, d.location AS device_location, usr.display_name AS user_name
      FROM usage_records u
      JOIN devices d ON d.id = u.device_id
      JOIN users usr ON usr.id = u.user_id
      WHERE u.id = ?
    `).get(record.id);
    res.json({ usage: toUsage(row) });
  });

  app.get('/api/me/usage', authenticate, (req, res) => {
    const rows = db.prepare(`
      SELECT u.*, d.name AS device_name, d.code AS device_code, d.location AS device_location, usr.display_name AS user_name
      FROM usage_records u
      JOIN devices d ON d.id = u.device_id
      JOIN users usr ON usr.id = u.user_id
      WHERE u.user_id = ?
      ORDER BY u.start_time DESC
    `).all(req.user.id);
    res.json({ usage: rows.map(toUsage) });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  return app;
}

module.exports = { createApp };
