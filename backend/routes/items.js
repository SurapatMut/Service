const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/schema');

router.get('/', (req, res) => {
  const db = getDb();
  try {
    const { type, search, sort } = req.query;

    let sql = `SELECT i.*, GROUP_CONCAT(s.serial,'||') AS serials_raw
               FROM items i
               LEFT JOIN serials s ON s.item_id = i.id AND s.status = 'in_stock'
               WHERE 1=1`;
    const params = [];

    if (type && type !== 'all') {
      if (type === 'low') {
        sql += ` AND i.qty <= 2`;
      } else {
        sql += ` AND i.type = ?`;
        params.push(type);
      }
    }

    if (search) {
      sql += ` AND (i.name LIKE ? OR i.sku LIKE ? OR s.serial LIKE ?)`;
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    sql += ` GROUP BY i.id`;

    if (sort === 'qty_asc')  sql += ` ORDER BY i.qty ASC`;
    else if (sort === 'qty_desc') sql += ` ORDER BY i.qty DESC`;
    else sql += ` ORDER BY i.name COLLATE NOCASE ASC`;

    const rows = db.prepare(sql).all(...params);

    const items = rows.map(r => ({
      ...r,
      serials: r.serials_raw ? r.serials_raw.split('||') : [],
      serials_raw: undefined,
    }));

    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

router.get('/stats', (req, res) => {
  const db = getDb();
  try {
    const total     = db.prepare(`SELECT COUNT(*) AS c, SUM(qty) AS q FROM items`).get();
    const byType    = db.prepare(`SELECT type, COUNT(*) AS c, SUM(qty) AS q FROM items GROUP BY type`).all();
    const low       = db.prepare(`SELECT COUNT(*) AS c FROM items WHERE qty <= 2`).get();
    const usedToday = db.prepare(`SELECT COUNT(*) AS c FROM usage_logs WHERE date(used_at) = date('now','localtime')`).get();

    const stats = {
      total_items: total.c,
      total_qty:   total.q || 0,
      by_type:     Object.fromEntries(byType.map(r => [r.type, { count: r.c, qty: r.q || 0 }])),
      low_stock:   low.c,
      used_today:  usedToday.c,
    };
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

router.get('/:id', (req, res) => {
  const db = getDb();
  try {
    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    const serials = db.prepare(`SELECT * FROM serials WHERE item_id = ? ORDER BY id`).all(item.id);
    res.json({ success: true, data: { ...item, serials } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

router.post('/', (req, res) => {
  const db = getDb();
  try {
    const { name, sku, type, category, qty, unit, serials = [] } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, error: 'name and type are required' });

    const result = db.prepare(`
      INSERT INTO items (name, sku, type, category, qty, unit)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, sku||null, type, category||null, parseInt(qty)||0, unit||null);

    const itemId = result.lastInsertRowid;

    if (type !== 'free' && serials.length > 0) {
      const ins = db.prepare(`INSERT INTO serials (item_id, serial) VALUES (?, ?)`);
      for (const s of serials) if (s.trim()) ins.run(itemId, s.trim());
    }

    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(itemId);
    const sn   = db.prepare(`SELECT * FROM serials WHERE item_id = ?`).all(itemId);
    res.status(201).json({ success: true, data: { ...item, serials: sn } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

router.put('/:id', (req, res) => {
  const db = getDb();
  try {
    const { name, sku, type, category, qty, unit } = req.body;
    const existing = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Item not found' });

    db.prepare(`
      UPDATE items SET name=?, sku=?, type=?, category=?, qty=?, unit=?,
      updated_at=datetime('now','localtime') WHERE id=?
    `).run(
      name ?? existing.name,
      sku  ?? existing.sku,
      type ?? existing.type,
      category ?? existing.category,
      qty  !== undefined ? parseInt(qty) : existing.qty,
      unit ?? existing.unit,
      req.params.id
    );

    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
    const sn   = db.prepare(`SELECT * FROM serials WHERE item_id = ? AND status='in_stock'`).all(item.id);
    res.json({ success: true, data: { ...item, serials: sn } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

router.patch('/:id/qty', (req, res) => {
  const db = getDb();
  try {
    const { delta } = req.body;
    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    const newQty = Math.max(0, item.qty + (parseInt(delta) || 0));
    db.prepare(`UPDATE items SET qty=?, updated_at=datetime('now','localtime') WHERE id=?`).run(newQty, req.params.id);
    res.json({ success: true, data: { qty: newQty } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  try {
    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    db.prepare(`DELETE FROM items WHERE id = ?`).run(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

router.post('/:id/serials', (req, res) => {
  const db = getDb();
  try {
    const { serial } = req.body;
    if (!serial) return res.status(400).json({ success: false, error: 'serial is required' });
    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    if (item.type === 'free') return res.status(400).json({ success: false, error: 'Free items do not use serial numbers' });
    const result = db.prepare(`INSERT INTO serials (item_id, serial) VALUES (?, ?)`).run(req.params.id, serial.trim());
    res.status(201).json({ success: true, data: { id: result.lastInsertRowid, serial: serial.trim(), status: 'in_stock' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

router.delete('/:id/serials/:snId', (req, res) => {
  const db = getDb();
  try {
    db.prepare(`DELETE FROM serials WHERE id = ? AND item_id = ?`).run(req.params.snId, req.params.id);
    res.json({ success: true, message: 'Serial deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

router.post('/:id/use', (req, res) => {
  const db = getDb();
  try {
    const { qty = 1, serial_ids = [], note = '' } = req.body;
    const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(req.params.id);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });
    if (item.qty < qty) return res.status(400).json({ success: false, error: 'Insufficient quantity' });

    const logResult = db.prepare(`
      INSERT INTO usage_logs (item_id, item_name, item_type, qty, note)
      VALUES (?, ?, ?, ?, ?)
    `).run(item.id, item.name, item.type, parseInt(qty), note);

    const logId = logResult.lastInsertRowid;
    const usedSerials = [];

    if (serial_ids.length > 0) {
      const insSn = db.prepare(`INSERT INTO usage_serials (log_id, serial) VALUES (?, ?)`);
      const updSn = db.prepare(`UPDATE serials SET status='used' WHERE id=? AND item_id=?`);
      for (const snId of serial_ids) {
        const sn = db.prepare(`SELECT * FROM serials WHERE id=? AND item_id=?`).get(snId, item.id);
        if (sn) {
          insSn.run(logId, sn.serial);
          updSn.run(snId, item.id);
          usedSerials.push(sn.serial);
        }
      }
    }

    db.prepare(`UPDATE items SET qty=qty-?, updated_at=datetime('now','localtime') WHERE id=?`).run(parseInt(qty), item.id);

    res.json({ success: true, data: { log_id: logId, qty_used: qty, serials_used: usedSerials } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    db.close();
  }
});

module.exports = router;
