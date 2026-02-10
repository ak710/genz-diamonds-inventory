const Airtable = require('airtable');

if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID || !process.env.AIRTABLE_TABLE_NAME) {
  console.warn('Airtable environment variables are not fully set. Set AIRTABLE_API_KEY, AIRTABLE_BASE_ID, AIRTABLE_TABLE_NAME in .env');
}

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const tableName = process.env.AIRTABLE_TABLE_NAME;

function findByJobNo(jobNo) {
  return new Promise((resolve, reject) => {
    base(tableName)
      .select({
        filterByFormula: `{Job No.} = "${jobNo}"`,
        maxRecords: 1,
      })
      .firstPage((err, records) => {
        if (err) return reject(err);
        resolve(records && records.length ? records[0] : null);
      });
  });
}

function updateRecord(recordId, fields) {
  return new Promise((resolve, reject) => {
    base(tableName).update([
      { id: recordId, fields: fields }
    ], (err, records) => {
      if (err) return reject(err);
      resolve(records[0]);
    });
  });
}

function getAllRecords() {
  return new Promise((resolve, reject) => {
    base(tableName).select({}).all((err, records) => {
      if (err) return reject(err);
      resolve(records);
    });
  });
}

module.exports = { findByJobNo, updateRecord, getAllRecords };