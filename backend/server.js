const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initDb } = require('./db/schema');

const app  = express();
const PORT = process.env.PORT || 3001;

initDb();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/api/items', require('./routes/items'));
app.use('/api/logs',  require('./routes/logs'));

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Service Warehouse API is running', time: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n🚀  Service Warehouse running at http://localhost:${PORT}`);
  console.log(`📦  API ready at http://localhost:${PORT}/api\n`);
});
