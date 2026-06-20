const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/schema');

router.get('/', (req, res) => {
  const db = getDb();
  try {
    const { type, date_from, date_to, limit = 100, offset = 0 } = req.query;

    let sql = `SELECT l.*, GROUP_CONCAT(us.serial,'||') AS serials_raw
               FROM usage_logs l
               LEFT JOIN usage_serials us ON us.log_id = l.id
               WHERE 1=1`;
    const params = [];

    if (type && type !== 'all') { sql += ` AND l.item_type = ?`; params.push(type); }
    if (date_from) { sql += ` AND date(l.used_at) >= ?`; params.push(date_from); }
    if (date_to)   { sql += ` AND date(l.used_at) <= ?`; params.push(date_to); }

    sql += ` GROUP BY l.id ORDER BY l.used_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const rows = db.prepare(sql).all(...params);
    const logs = rows.map(r => ({
      ...r,
      serials: r.serials_raw ? r.serials_raw.split('||') : [],
      serials_raw: undefined,
    }));

    const total = db.prepare(`SELECT COUNT(*) AS c FROM usage_logs`).get().c;

    res.json({ success: true, data: logs, total });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

router.get('/summary', (req, res) => {
  const db = getDb();
  try {
    const daily  = db.prepare(`SELECT date(used_at) AS d, SUM(qty) AS q FROM usage_logs GROUP BY d ORDER BY d DESC LIMIT 30`).all();
    const byType = db.prepare(`SELECT item_type, COUNT(*) AS c, SUM(qty) AS q FROM usage_logs GROUP BY item_type`).all();
    const top    = db.prepare(`SELECT item_name, item_type, SUM(qty) AS q FROM usage_logs GROUP BY item_id ORDER BY q DESC LIMIT 10`).all();
    res.json({ success: true, data: { daily, by_type: byType, top_items: top } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

module.exports = router;
