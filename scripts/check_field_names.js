require('dotenv').config();
const Airtable = require('airtable');
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
(async () => {
  try {
    const recs = await base(TABLE_NAME).select({ filterByFormula: '{Job No.} = "4717547"', maxRecords: 1 }).firstPage();
    if (!recs || !recs.length) return console.log('No records found for Job No. 4717547');
    const f = recs[0].fields;
    console.log('Field keys for Job No. 4717547:');
    console.log(Object.keys(f).map(k => JSON.stringify(k)).join('\n'));
  } catch (e) {
    console.error(e);
  }
})();
