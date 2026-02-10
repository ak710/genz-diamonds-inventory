require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const airtable = require('./lib/airtableClient');

// Search by Job No. (barcode)
app.get('/api/search/:jobNo', async (req, res) => {
  try {
    const jobNo = req.params.jobNo;
    const record = await airtable.findByJobNo(jobNo);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    res.json({ record });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Update a record by record ID
app.post('/api/update/:recordId', async (req, res) => {
  try {
    const recordId = req.params.recordId;
    const fields = req.body; // Expecting an object of fields to update
    const updated = await airtable.updateRecord(recordId, fields);
    res.json({ record: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Get all records
app.get('/api/items', async (req, res) => {
  try {
    const records = await airtable.getAllRecords();
    res.json({ records });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
