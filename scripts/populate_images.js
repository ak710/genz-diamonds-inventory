require('dotenv').config();
const Airtable = require('airtable');

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const CDN_BASE = 'https://res.cloudinary.com/dg6sicjri/image/upload/v1770609947/';
const HD_CDN_BASE = 'https://res.cloudinary.com/dg6sicjri/image/upload/v1770790437/';

if (!API_KEY || !BASE_ID || !TABLE_NAME) {
  console.error('Missing AIRTABLE_API_KEY, AIRTABLE_BASE_ID or AIRTABLE_TABLE_NAME in .env');
  process.exit(1);
}

const base = new Airtable({ apiKey: API_KEY }).base(BASE_ID);

function chunkArray(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
  return res;
}

(async () => {
  try {
    console.log('Fetching all records from', TABLE_NAME);
    const records = await base(TABLE_NAME).select({}).all();
    console.log('Total records:', records.length);

    const updates = [];
    const skipped = [];

    for (const rec of records) {
      const jobNo = (rec.get('Job No.') || '').toString().trim();
      const design = (rec.get('Design') || '').toString().trim();
      if (!jobNo) {
        skipped.push({ id: rec.id, reason: 'No Job No.' });
        continue;
      }
      const url = `${CDN_BASE}${encodeURIComponent(jobNo)}.jpg`;
      // Extract first 9 characters of Design field for HD image
      const designPrefix = design.substring(0, 9);
      const hdUrl = designPrefix ? `${HD_CDN_BASE}${encodeURIComponent(designPrefix)}.jpg` : '';
      // Store both CDN links
      updates.push({ id: rec.id, fields: { 'Image': url, 'HD Image': hdUrl } });
    }

    console.log(`Prepared ${updates.length} updates, ${skipped.length} skipped`);

    const batches = chunkArray(updates, 10);
    let updatedCount = 0;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      console.log(`Sending batch ${i + 1}/${batches.length} (${batch.length} records)`);
      // Wrap callback style update into Promise
      await new Promise((resolve, reject) => {
        base(TABLE_NAME).update(batch, (err, records) => {
          if (err) return reject(err);
          updatedCount += records.length;
          resolve(records);
        });
      });
      // small pause to be polite to the API
      await new Promise((r) => setTimeout(r, 300));
    }

    console.log('Done. Updated records:', updatedCount);
    if (skipped.length) {
      console.log('Skipped records:', skipped.length);
      // print a few skipped examples
      console.log(skipped.slice(0, 10));
    }

    process.exit(0);
  } catch (err) {
    console.error('Error populating images:', err);
    process.exit(2);
  }
})();
