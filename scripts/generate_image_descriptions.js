require('dotenv').config();
const Airtable = require('airtable');
const OpenAI = require('openai');
const https = require('https');

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_KEY) {
  console.error('Missing OPENROUTER_API_KEY in .env');
  process.exit(1);
}

const base = new Airtable({ apiKey: API_KEY }).base(BASE_ID);
const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/ak710/genz-diamonds-inventory',
    'X-Title': 'GenZ Diamonds Inventory'
  }
});

async function fetchImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Check for HTTP errors (404, 403, etc.)
      if (res.statusCode === 404) {
        return reject(new Error('Image not found (404)'));
      }
      if (res.statusCode === 403) {
        return reject(new Error('Image forbidden (403)'));
      }
      if (res.statusCode >= 400) {
        return reject(new Error(`Image fetch failed (${res.statusCode})`));
      }
      
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        return https.get(res.headers.location, (redirectRes) => {
          if (redirectRes.statusCode >= 400) {
            return reject(new Error(`Image not found after redirect (${redirectRes.statusCode})`));
          }
          const chunks = [];
          redirectRes.on('data', (chunk) => chunks.push(chunk));
          redirectRes.on('end', () => {
            const buffer = Buffer.concat(chunks);
            resolve({ buffer: buffer.toString('base64'), contentType: redirectRes.headers['content-type'] });
          });
          redirectRes.on('error', reject);
        }).on('error', reject);
      }
      
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          return reject(new Error('Empty image data'));
        }
        resolve({ buffer: buffer.toString('base64'), contentType: res.headers['content-type'] });
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function getMimeType(contentType, url) {
  // Try to get from content-type header first
  if (contentType && contentType.includes('image/')) {
    if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'image/jpeg';
    if (contentType.includes('png')) return 'image/png';
    if (contentType.includes('webp')) return 'image/webp';
    if (contentType.includes('gif')) return 'image/gif';
  }
  
  // Fallback to URL extension
  const ext = url.toLowerCase().split('.').pop().split('?')[0];
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  
  // Default to jpeg
  return 'image/jpeg';
}

function parseDesignCodes(design) {
  if (!design) return { color: null, productType: null };
  
  const designUpper = design.toUpperCase();
  
  // Color codes
  let color = null;
  if (designUpper.includes('W')) color = 'White Gold';
  if (designUpper.includes('Y')) color = 'Yellow Gold';
  if (designUpper.includes('P')) color = 'Rose Gold/Pink Gold';
  
  // Product type codes
  let productType = null;
  if (designUpper.includes('RN')) productType = 'Ring';
  if (designUpper.includes('ER')) productType = 'Earring';
  if (designUpper.includes('NT')) productType = 'Necklace/Pendant';
  
  return { color, productType };
}

function buildTextDescription(fields) {
  const parts = [];
  const { color, productType } = parseDesignCodes(fields.design);
  
  if (productType) parts.push(productType);
  if (color) parts.push(color);
  if (fields.purity) parts.push(`${fields.purity} purity`);
  if (fields.shape) parts.push(`${fields.shape} cut`);
  if (fields.carat) parts.push(`${fields.carat} carat`);
  if (fields.colorGrade) parts.push(`${fields.colorGrade} color`);
  if (fields.clarity) parts.push(`${fields.clarity} clarity`);
  
  return parts.join(', ');
}

async function tryImageAnalysis(imageUrl, textDesc, jobNo, imageType) {
  console.log(`  Fetching ${imageType} for ${jobNo}...`);
  const { buffer, contentType } = await fetchImageAsBase64(imageUrl);
  const mimeType = getMimeType(contentType, imageUrl);
  
  // Skip GIF images as they cause API errors
  if (mimeType === 'image/gif') {
    throw new Error('GIF format not supported');
  }
  
  console.log(`  ${imageType} type: ${mimeType}`);
  
  const prompt = `Analyze this jewelry image. Given: ${textDesc}

List ONLY physical properties as comma-separated keywords:
- Metal type/color (white gold, yellow gold, rose gold, platinum, silver)
- Stone shapes (round, emerald, princess, oval, cushion, pear, marquise)
- Setting style (solitaire, halo, three-stone, pave, channel, bezel, prong)
- Design features (twisted band, split shank, vintage, modern, eternity, infinity, bypass, stackable)
- Surface detail (polished, matte, brushed, hammered, engraved, filigree, milgrain)

Output format: keyword, keyword, keyword
No sentences. No descriptions. Only searchable properties.`;

  const response = await openai.chat.completions.create({
    model: 'google/gemini-2.0-flash-001',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${buffer}`
            }
          }
        ]
      }
    ],
    max_tokens: 300
  });
  
  return response.choices[0].message.content.trim();
}

async function generateTextOnlyDescription(textDesc) {
  const prompt = `Given jewelry specs: ${textDesc}

List typical physical properties as comma-separated keywords:
- Metal type/color
- Common setting style for this type
- Typical design features
- Standard finish

Output format: keyword, keyword, keyword
No sentences. Only searchable properties.`;

  const response = await openai.chat.completions.create({
    model: 'google/gemini-2.0-flash-001',
    messages: [
      { role: 'user', content: prompt }
    ],
    max_tokens: 150
  });
  
  return response.choices[0].message.content.trim();
}

async function analyzeImage(hdImageUrl, imageUrl, jobNo, fields) {
  const textDesc = buildTextDescription(fields);
  
  // Priority 1: Try HD Image
  if (hdImageUrl) {
    try {
      return await tryImageAnalysis(hdImageUrl, textDesc, jobNo, 'HD Image');
    } catch (err) {
      console.log(`  HD Image failed (${err.message}), trying regular image...`);
    }
  }
  
  // Priority 2: Try regular Image
  if (imageUrl) {
    try {
      return await tryImageAnalysis(imageUrl, textDesc, jobNo, 'Image');
    } catch (err) {
      console.log(`  Image failed (${err.message}), falling back to text only...`);
    }
  }
  
  // Priority 3: Text-only description
  console.log(`  No valid images, using text description only`);
  try {
    return await generateTextOnlyDescription(textDesc);
  } catch (err) {
    console.error(`  Error generating description for ${jobNo}:`, err.message);
    return null;
  }
}

(async () => {
  try {
    console.log('🔍 Fetching records without AI descriptions...');
    
    const records = await base(TABLE_NAME).select({
      filterByFormula: "OR(NOT({AI Description}), {AI Description} = '')"
    }).all();
    
    console.log(`📦 Found ${records.length} items to process\n`);
    
    if (records.length === 0) {
      console.log('✅ All images already have AI descriptions!');
      process.exit(0);
    }
    
    let processed = 0;
    let failed = 0;
    
    for (const rec of records) {
      const jobNo = rec.get('Job No.') || 'Unknown';
      const hdImageUrl = rec.get('HD Image');
      const imageUrl = rec.get('Image');
      
      // Gather all available fields
      const fields = {
        design: rec.get('Design'),
        purity: rec.get('Purity'),
        shape: rec.get('Shape'),
        carat: rec.get('Carat'),
        colorGrade: rec.get('Color'),
        clarity: rec.get('Clarity')
      };
      
      console.log(`\n[${processed + failed + 1}/${records.length}] Analyzing ${jobNo}...`);
      
      const description = await analyzeImage(hdImageUrl, imageUrl, jobNo, fields);
      
      if (description) {
        await base(TABLE_NAME).update(rec.id, {
          'AI Description': description
        });
        console.log(`✅ Updated: ${description.substring(0, 80)}...`);
        processed++;
      } else {
        failed++;
      }
      
      // Rate limit: 2 seconds between requests
      if (processed + failed < records.length) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    console.log(`\n✨ Done! Processed: ${processed}, Failed: ${failed}`);
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(2);
  }
})();
