import { hashPassword } from './auth.js';
import { nowIso, uuid } from './util.js';

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    code TEXT NOT NULL UNIQUE,
    location TEXT NOT NULL DEFAULT '',
    photos TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'in_use', 'reserved')),
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    planned_end_time TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT 'use' CHECK (type IN ('use', 'reservation')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended', 'cancelled', 'pending')),
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_usage_device ON usage_records(device_id, status);
  CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id, status);
`;

export async function ensureSchemaAndSeed(env) {
  await env.DB.exec(SCHEMA);
  const row = await env.DB.prepare('SELECT COUNT(*) AS c FROM users').first();
  if (row && row.c > 0) return;

  const ts = nowIso();
  const adminId = uuid();
  const staffId = uuid();
  const insertUser = env.DB.prepare(
    'INSERT INTO users (id, username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  await insertUser.bind(adminId, 'admin', await hashPassword('admin123'), '系统管理员', 'admin', ts).run();
  await insertUser.bind(staffId, 'staff', await hashPassword('staff123'), '张三', 'employee', ts).run();

  const deviceRows = [
    ['数控车床', 'CK6136', 'DEV-1001', '一号厂房'],
    ['激光切割机', 'XL-1530', 'DEV-1002', '二号厂房'],
    ['示波器', 'DSOX1102G', 'DEV-1003', '实验室A'],
    ['注塑机', 'HTF120X', 'DEV-1004', '一号厂房'],
    ['3D打印机', 'Bambu X1', 'DEV-1005', '实验室B'],
    ['空压机', 'GA30', 'DEV-1006', '动力车间'],
    ['三坐标测量仪', 'CMM-8106', 'DEV-1007', '质量中心'],
    ['工业机器人', 'ER20-1700', 'DEV-1008', '二号厂房'],
  ];

  const insertDevice = env.DB.prepare(
    'INSERT INTO devices (id, name, model, code, location, photos, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const deviceIds = {};
  for (const [name, model, code, location] of deviceRows) {
    const id = uuid();
    await insertDevice.bind(id, name, model, code, location, '[]', 'idle', ts, ts).run();
    deviceIds[code] = id;
  }

  const start = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const plannedEnd = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  await env.DB.prepare(
    'INSERT INTO usage_records (id, device_id, user_id, start_time, end_time, planned_end_time, note, type, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(uuid(), deviceIds['DEV-1003'], staffId, start, null, plannedEnd, '电路调试', 'use', 'active', ts).run();
  await env.DB.prepare("UPDATE devices SET status = 'in_use', updated_at = ? WHERE id = ?").bind(ts, deviceIds['DEV-1003']).run();
}
