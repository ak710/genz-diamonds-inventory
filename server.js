require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const OAuthClient = require('intuit-oauth');

const PDFDocument = require('pdfkit');
const axios = require('axios');
const app = express();

app.use(express.json());

const airtable = require('./lib/airtableClient');
const Airtable = require('airtable');

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'genz2026';

// QuickBooks Online config
const QBO_CLIENT_ID = process.env.INTUIT_CLIENT_ID;
const QBO_CLIENT_SECRET = process.env.INTUIT_CLIENT_SECRET;
const QBO_REDIRECT_URI = process.env.QBO_REDIRECT_URI || 'http://localhost:3000/api/qbo/callback';
const QBO_ENVIRONMENT = process.env.QBO_ENVIRONMENT || 'sandbox'; // 'sandbox' or 'production'
const AIRTABLE_SETTINGS_TABLE = process.env.AIRTABLE_SETTINGS_TABLE || 'Settings';
const AIRTABLE_REST = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_SETTINGS_TABLE)}`;
const AIRTABLE_HEADERS = { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`, 'Content-Type': 'application/json' };

function getQboClient() {
  return new OAuthClient({
    clientId: QBO_CLIENT_ID,
    clientSecret: QBO_CLIENT_SECRET,
    environment: QBO_ENVIRONMENT,
    redirectUri: QBO_REDIRECT_URI,
    logging: false
  });
}

async function loadQboTokens() {
  try {
    const res = await axios.get(AIRTABLE_REST, {
      headers: AIRTABLE_HEADERS,
      params: { filterByFormula: `{Key} = "qbo_tokens"`, maxRecords: 1 }
    });
    const records = res.data.records;
    if (records && records.length > 0) {
      return JSON.parse(records[0].fields.Value);
    }
  } catch (e) { console.error('loadQboTokens error:', e.message); }
  return null;
}

async function saveQboTokens(tokenData) {
  const value = JSON.stringify(tokenData);
  // Check if record already exists
  const res = await axios.get(AIRTABLE_REST, {
    headers: AIRTABLE_HEADERS,
    params: { filterByFormula: `{Key} = "qbo_tokens"`, maxRecords: 1 }
  });
  const records = res.data.records;
  if (records && records.length > 0) {
    await axios.patch(AIRTABLE_REST, {
      records: [{ id: records[0].id, fields: { Key: 'qbo_tokens', Value: value } }]
    }, { headers: AIRTABLE_HEADERS });
  } else {
    await axios.post(AIRTABLE_REST, {
      records: [{ fields: { Key: 'qbo_tokens', Value: value } }]
    }, { headers: AIRTABLE_HEADERS });
  }
}

async function getValidQboToken() {
  const saved = await loadQboTokens();
  if (!saved || !saved.realmId) throw new Error('QuickBooks not connected. Please connect first.');

  const oauthClient = getQboClient();
  oauthClient.setToken(saved);

  if (!oauthClient.isAccessTokenValid()) {
    await oauthClient.refresh();
    await saveQboTokens({ ...oauthClient.getToken(), realmId: saved.realmId });
  }

  return { accessToken: oauthClient.getToken().access_token, realmId: saved.realmId };
}

async function getOrCreateCustomer(baseUrl, accessToken, customerName) {
  const safeName = customerName.replace(/'/g, "\\'");
  const queryRes = await axios.get(
    `${baseUrl}/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${safeName}' MAXRESULTS 1`)}`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }
  );
  const customers = queryRes.data.QueryResponse.Customer || [];
  if (customers.length > 0) return customers[0].Id;

  const createRes = await axios.post(
    `${baseUrl}/customer`,
    { DisplayName: customerName },
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' } }
  );
  return createRes.data.Customer.Id;
}

async function getOrCreateJewelryItem(baseUrl, accessToken) {
  const queryRes = await axios.get(
    `${baseUrl}/query?query=${encodeURIComponent("SELECT * FROM Item WHERE Name = 'Jewelry' MAXRESULTS 1")}`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }
  );
  const items = queryRes.data.QueryResponse.Item || [];
  if (items.length > 0) return items[0].Id;

  // Find an income account to assign to the new item
  const acctRes = await axios.get(
    `${baseUrl}/query?query=${encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 1")}`,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } }
  );
  const accounts = acctRes.data.QueryResponse.Account || [];
  if (accounts.length === 0) throw new Error('No income accounts found in QuickBooks. Please create one first.');

  const createRes = await axios.post(
    `${baseUrl}/item`,
    { Name: 'Jewelry', Type: 'Service', IncomeAccountRef: { value: accounts[0].Id } },
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' } }
  );
  return createRes.data.Item.Id;
}
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;

// Initialize OpenRouter client
const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/ak710/genz-diamonds-inventory',
    'X-Title': 'GenZ Diamonds Inventory'
  }
});

const base = new Airtable({ apiKey: API_KEY }).base(BASE_ID);

// Auth middleware - checks for token in Authorization header
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
  
  if (token === ACCESS_PASSWORD) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

// Login endpoint
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === ACCESS_PASSWORD) {
    res.json({ success: true, token: ACCESS_PASSWORD });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  res.json({ success: true });
});

// Serve static files (no auth needed for HTML/CSS/JS files)
app.use(express.static(path.join(__dirname, 'public')));

// Serve login page
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Default route - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Search by Job No. (barcode)
app.get('/api/search/:jobNo', requireAuth, async (req, res) => {
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

// Get stock count for a design (remaining / total)
app.get('/api/design-stock/:design', requireAuth, async (req, res) => {
  try {
    const design = req.params.design;
    const records = await airtable.findByDesign(design);
    const total = records.length;
    const remaining = records.filter(r => !r.fields['Sold']).length;
    res.json({ remaining, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Update a record by record ID
app.post('/api/update/:recordId', requireAuth, async (req, res) => {
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
app.get('/api/items', requireAuth, async (req, res) => {
  try {
    const records = await airtable.getAllRecords();
    res.json({ records });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// AI Search endpoint
app.post('/api/ai-search', requireAuth, async (req, res) => {
  try {
    const { query } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    if (!OPENROUTER_KEY) {
      return res.status(500).json({ error: 'OpenRouter API key not configured' });
    }
    
    // AI prompt to convert natural language to Airtable formula
    const prompt = `You are an intelligent jewelry inventory search assistant. Convert natural language queries into Airtable filterByFormula syntax. Be SMART about understanding jewelry terminology and user intent.

IMPORTANT: Field names are CASE-SENSITIVE. Use these EXACT field names:
- Design (capital D): Item design code - contains product type codes: RN=ring, ER=earring, NT=necklace/pendant
- Purity (capital P): Metal purity (10K, 14K, 18K, etc.)
- Set Cts. (exact spacing): Total carat weight of stones (numeric field)
- AI Description (capitals, one space): Concise AI-generated descriptions with keywords (metal type, stone shapes, setting style, design features, finish)
- Job No. (exact with period and space): Item reference number

CRITICAL AIRTABLE FORMULA RULES:
**Valid Functions ONLY:**
- FIND(searchText, whereToSearch) - case-sensitive text search
- LOWER(text) - convert to lowercase
- UPPER(text) - convert to uppercase
- AND(...conditions) - all must be true
- OR(...conditions) - at least one must be true
- NOT(condition) - negation
- IF(condition, valueIfTrue, valueIfFalse)
- LEN(text) - text length
- Comparison: =, !=, <, >, <=, >=

**NEVER USE THESE (they don't exist in Airtable):**
- ISNUMBER() ❌
- ISTEXT() ❌
- SEARCH() ❌ (use FIND instead)
- CONTAINS() ❌ (use FIND instead)

**For numeric comparisons:**
- Use direct comparisons: {Set Cts.} > 1
- Do NOT wrap in ISNUMBER: ❌ AND(ISNUMBER({Set Cts.}), {Set Cts.} > 1)
- Just use: ✅ {Set Cts.} > 1

CRITICAL PRODUCT TYPE CODES:
- rings → "rn" in Design field (LOWERCASE)
- earrings → "er" in Design field (LOWERCASE)
- necklaces/pendants → "nt" in Design field (LOWERCASE)

INTELLIGENT QUERY UNDERSTANDING:
The AI Description uses CONCISE keywords, so be smart about variations:

**Stone Shapes** - AI descriptions use short forms:
- "emerald cut" or "emerald" → FIND("emerald", LOWER({AI Description}))
- "round cut" or "round" → FIND("round", LOWER({AI Description}))
- "princess cut" or "princess" → FIND("princess", LOWER({AI Description}))
- "oval", "cushion", "pear", "marquise" → search for shape name only

**Metal Colors** - Use OR for variations:
- "white gold" → OR(FIND("white gold", LOWER({AI Description})), FIND("white", LOWER({AI Description})))
- "yellow gold" or "gold" → OR(FIND("yellow gold", LOWER({AI Description})), FIND("yellow", LOWER({AI Description})))
- "rose gold" → OR(FIND("rose gold", LOWER({AI Description})), FIND("rose", LOWER({AI Description})))

**Settings & Styles**:
- "solitaire", "halo", "pave", "prong", "bezel", "channel" → search exact keyword
- For style keywords like "vintage", "modern", "classic" → can use OR for synonyms

Query: "${query}"

SMART FORMULA GENERATION RULES:
1. ONLY use valid Airtable functions (FIND, LOWER, AND, OR, NOT, IF, comparisons)
2. Use OR logic when multiple keywords could match the same intent
3. For shape queries, search ONLY the shape name (emerald, round, oval, etc.)
4. For metal queries, include variations (white gold / white)
5. For numeric fields like {Set Cts.}, use direct comparison operators (>, <, >=, <=, =)
6. Use AND to combine different criteria (product type + shape + metal)

Return ONLY the filterByFormula expression with CORRECT casing. Use FIND with LOWER for text searches. No explanation or markdown.

Examples:
- "emerald cut rings" → AND(FIND("rn", LOWER({Design})), FIND("emerald", LOWER({AI Description})))
- "white gold rings" → AND(FIND("rn", LOWER({Design})), OR(FIND("white gold", LOWER({AI Description})), FIND("white", LOWER({AI Description}))))
- "round diamond rings" → AND(FIND("rn", LOWER({Design})), FIND("round", LOWER({AI Description})))
- "rings over 1 carat" → AND(FIND("rn", LOWER({Design})), {Set Cts.} > 1)
- "large oval rings" → AND(FIND("rn", LOWER({Design})), FIND("oval", LOWER({AI Description})), {Set Cts.} > 1)
- "yellow gold halo rings" → AND(FIND("rn", LOWER({Design})), OR(FIND("yellow gold", LOWER({AI Description})), FIND("yellow", LOWER({AI Description}))), FIND("halo", LOWER({AI Description})))
- "rings between 1 and 2 carats" → AND(FIND("rn", LOWER({Design})), {Set Cts.} >= 1, {Set Cts.} <= 2)

Formula:`;

    // Get formula from AI
    const response = await openai.chat.completions.create({
      model: 'nvidia/nemotron-3-nano-30b-a3b:free',
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: 750,
      temperature: 0.3
    });
    
    let formula = response.choices[0].message.content.trim();
    
    // Clean up the response
    formula = formula.replace(/```.*?\n/g, '').replace(/```/g, '').trim();
    
    // Validate and fix common issues
    const openParens = (formula.match(/\(/g) || []).length;
    const closeParens = (formula.match(/\)/g) || []).length;
    const openBraces = (formula.match(/\{/g) || []).length;
    const closeBraces = (formula.match(/\}/g) || []).length;
    
    // Fix unbalanced parentheses
    if (openParens !== closeParens) {
      formula = formula + ')'.repeat(openParens - closeParens);
    }
    
    // Fix unbalanced braces
    if (openBraces !== closeBraces) {
      formula = formula + '}'.repeat(openBraces - closeBraces);
    }
    
    // Fix case sensitivity
    formula = formula.replace(/FIND\("RN",/g, 'FIND("rn",');
    formula = formula.replace(/FIND\("ER",/g, 'FIND("er",');
    formula = formula.replace(/FIND\("NT",/g, 'FIND("nt",');
    
    console.log('🔍 AI Search query:', query);
    console.log('📝 Generated formula:', formula);
    
    // Execute search on Airtable
    const records = await base(TABLE_NAME)
      .select({ filterByFormula: formula })
      .all();
    
    console.log(`✅ Found ${records.length} results`);
    
    // Return records in the same format as getAllRecords (with fields property)
    // Airtable records have an id and fields property which serialize properly
    res.json({ 
      query,
      formula,
      results: records,
      count: records.length
    });
    
  } catch (err) {
    console.error('❌ AI Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Generate Line Sheet
app.post('/api/generate-linesheet', requireAuth, async (req, res) => {
  try {
    const { items, format, discountPercent } = req.body;
    
    console.log(`📄 Generating line sheet: ${items.length} items, format: ${format}, discount: ${discountPercent}%`);
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }
    
    // Sanitize items to ensure prices are valid numbers
    const sanitizedItems = items.map(item => ({
      ...item,
      wholesalePrice: parseFloat(item.wholesalePrice) || 0,
      retailPrice: parseFloat(item.retailPrice) || 0
    }));
    
    // Helper function to fetch image as buffer
    async function fetchImage(url) {
      if (!url) {
        console.log('⊘ No image URL provided');
        return null;
      }
      try {
        console.log(`📥 Fetching image: ${url.substring(0, 80)}...`);
        const response = await axios.get(url, { 
          responseType: 'arraybuffer',
          timeout: 15000, // 15 second timeout
          maxRedirects: 5
        });
        console.log(`✓ Image fetched successfully (${response.data.length} bytes)`);
        return Buffer.from(response.data);
      } catch (error) {
        console.error(`✗ Failed to fetch image:`, error.message);
        return null;
      }
    }
    
    // Helper function to try multiple image URLs with fallback
    async function fetchImageWithFallback(hdImageUrl, regularImageUrl) {
      // Try HD Image first
      if (hdImageUrl) {
        console.log(`🔍 Trying HD Image URL...`);
        const buffer = await fetchImage(hdImageUrl);
        if (buffer) {
          console.log(`✓ Successfully loaded HD Image`);
          return buffer;
        }
      }
      
      // Try regular Image as fallback
      if (regularImageUrl) {
        console.log(`🔍 Trying regular Image URL...`);
        const buffer = await fetchImage(regularImageUrl);
        if (buffer) {
          console.log(`✓ Successfully loaded regular Image`);
          return buffer;
        }
      }
      
      console.log(`✗ No valid image available, using placeholder`);
      return null;
    }
    
    if (format === 'pdf') {
      console.log('📝 Generating PDF document...');
      // Generate PDF document
      const doc = new PDFDocument({ margin: 50 });
      const logoPath = path.join(__dirname, 'public', 'assets', 'logo.png');
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=linesheet_${new Date().toISOString().slice(0, 10)}.pdf`);
      
      doc.pipe(res);
      
      // Add date in top left
      doc.fontSize(10).fillColor('#8B7355').font('Times-Roman').text(`Date: ${new Date().toLocaleDateString()}`, 40, 40, { align: 'left' });
      
      // Add logo if it exists (centered)
      if (fs.existsSync(logoPath)) {
        const logoWidth = 150;
        const logoHeight = 75;
        const xPosition = (doc.page.width - logoWidth) / 2;
        doc.image(logoPath, xPosition, 40, { width: logoWidth, height: logoHeight });
        doc.moveDown(4);
      }
      
      doc.moveDown(2);
      
      // Fetch all images with progress logging and fallback
      console.log(`📥 Fetching images for ${sanitizedItems.length} items...`);
      const imagePromises = sanitizedItems.map(async (item) => {
        const imageBuffer = await fetchImageWithFallback(item.hdImageUrl, item.imageUrl);
        return { ...item, imageBuffer };
      });
      const itemsWithImages = await Promise.all(imagePromises);
      console.log(`✓ Images fetched, ready to generate PDF`);
      
      console.log('📋 Building PDF layout...');
      
      // Layout items in 3 columns with borders
      const imageWidth = 150;
      const imageHeight = 150;
      const columnGap = 15;
      const leftMargin = 40;
      const boxWidth = (doc.page.width - leftMargin * 2 - columnGap * 2) / 3;
      
      let currentX = leftMargin;
      let currentY = doc.y;
      let itemsInCurrentRow = 0;
      const boxHeight = 260;
      const rowSpacing = 15;
      
      for (let i = 0; i < itemsWithImages.length; i++) {
        const item = itemsWithImages[i];
        
        // Check if we need a new page - ensure entire box fits on current page
        if (currentY + boxHeight > doc.page.height - 80) {
          doc.addPage();
          currentY = 50;
          currentX = leftMargin;
          itemsInCurrentRow = 0;
        }
        
        // Prevent PDFKit auto-pagination by setting y position
        doc.y = currentY;
        
        // Draw border box with gold color
        doc.rect(currentX, currentY, boxWidth, boxHeight).stroke('#bd9e5e');
        
        // Draw image or placeholder
        const imagePadding = 10;
        const imageX = currentX + (boxWidth - imageWidth) / 2;
        const imageY = currentY + imagePadding;
        
        if (item.imageBuffer) {
          try {
            doc.image(item.imageBuffer, imageX, imageY, { 
              width: imageWidth, 
              height: imageHeight,
              fit: [imageWidth, imageHeight],
              align: 'center',
              valign: 'center'
            });
          } catch (err) {
            // Draw placeholder if image fails
            doc.rect(imageX, imageY, imageWidth, imageHeight).fillAndStroke('#f0f0f0', '#bd9e5e');
            doc.fillColor('#8B7355').fontSize(9).font('Times-Italic').text('No Image', imageX, imageY + imageHeight / 2 - 5, {
              width: imageWidth,
              align: 'center'
            });
          }
        } else {
          // Draw gray placeholder box with gold border
          doc.rect(imageX, imageY, imageWidth, imageHeight).fillAndStroke('#f0f0f0', '#bd9e5e');
          doc.fillColor('#8B7355').fontSize(9).font('Times-Italic').text('No Image', imageX, imageY + imageHeight / 2 - 5, {
            width: imageWidth,
            align: 'center'
          });
        }
        
        // Add item details below image - left aligned with light brown text
        const detailsX = currentX + 10;
        const detailsY = imageY + imageHeight + 10;
        const textWidth = boxWidth - 20;
        
        doc.fillColor('#8B7355').fontSize(10).font('Times-Bold').text(`SKU: ${item.design}`, detailsX, detailsY, {
          width: textWidth,
          align: 'left'
        });
        doc.fontSize(9).font('Times-Roman').text(`Purity: ${item.purity || 'N/A'}`, detailsX, detailsY + 14, {
          width: textWidth,
          align: 'left'
        });
        doc.text(`Set Cts.: ${item.setCts || 'N/A'}`, detailsX, detailsY + 28, {
          width: textWidth,
          align: 'left'
        });
        doc.font('Times-Roman').text(`Wholesale: $${item.wholesalePrice.toFixed(2)}`, detailsX, detailsY + 42, {
          width: textWidth,
          align: 'left'
        });
        doc.font('Times-Bold').text(`Suggested Retail: $${item.retailPrice.toFixed(2)}`, detailsX, detailsY + 56, {
          width: textWidth,
          align: 'left'
        });
        
        // Move to next column
        itemsInCurrentRow++;
        if (itemsInCurrentRow >= 3) {
          // Move to next row
          currentX = leftMargin;
          currentY += boxHeight + rowSpacing;
          itemsInCurrentRow = 0;
        } else {
          // Move to next column
          currentX += boxWidth + columnGap;
        }
      }
      
      // Set doc.y for footer
      doc.y = currentY + (itemsInCurrentRow > 0 ? boxHeight + 20 : 20);
      
      // Footer
      doc.fontSize(9).font('Helvetica-Oblique');
      doc.text('All prices are in Canadian Dollars (CAD)', leftMargin, doc.y, { align: 'center', width: doc.page.width - leftMargin * 2 });
      doc.text('Suggested retail price is calculated at 2.5x wholesale price', leftMargin, doc.y + 12, { align: 'center', width: doc.page.width - leftMargin * 2 });
      
      doc.end();
      console.log('✓ PDF document sent to client');
    }
    
  } catch (err) {
    console.error('❌ Line sheet generation error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ── QuickBooks Online Routes ──────────────────────────────────────────────────

// Check connection status
app.get('/api/qbo/status', requireAuth, async (req, res) => {
  const tokens = await loadQboTokens();
  res.json({ connected: !!(tokens && tokens.realmId) });
});

// Start OAuth flow - redirect browser to QBO login
// Uses query param auth since this is a browser redirect (no headers)
app.get('/api/qbo/connect', (req, res) => {
  if (req.query.token !== ACCESS_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  if (!QBO_CLIENT_ID || !QBO_CLIENT_SECRET) {
    return res.status(500).send('QBO_CLIENT_ID and QBO_CLIENT_SECRET must be set in .env');
  }
  const oauthClient = getQboClient();
  const authUri = oauthClient.authorizeUri({
    scope: [OAuthClient.scopes.Accounting],
    state: 'qbo-connect'
  });
  res.redirect(authUri);
});

// OAuth callback - QBO redirects here after user approves
app.get('/api/qbo/callback', async (req, res) => {
  try {
    const oauthClient = getQboClient();
    const tokenResponse = await oauthClient.createToken(req.url);
    const realmId = req.query.realmId;
    await saveQboTokens({ ...tokenResponse.getJson(), realmId });
    res.send('<h2>QuickBooks connected successfully! You can close this tab.</h2>');
  } catch (err) {
    console.error('QBO callback error:', err);
    res.status(500).send('Failed to connect QuickBooks: ' + err.message);
  }
});

// Disconnect QBO
app.post('/api/qbo/disconnect', requireAuth, async (req, res) => {
  try {
    const saved = await loadQboTokens();
    if (saved) {
      const findRes = await axios.get(AIRTABLE_REST, {
        headers: AIRTABLE_HEADERS,
        params: { filterByFormula: `{Key} = "qbo_tokens"`, maxRecords: 1 }
      });
      const records = findRes.data.records;
      if (records && records.length > 0) {
        await axios.delete(`${AIRTABLE_REST}/${records[0].id}`, { headers: AIRTABLE_HEADERS });
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Push invoice to QuickBooks
app.post('/api/qbo/invoice', requireAuth, async (req, res) => {
  try {
    const { customerName, invoiceDate, invoiceNumber, gstPercent, items } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    const { accessToken, realmId } = await getValidQboToken();
    const baseUrl = QBO_ENVIRONMENT === 'production'
      ? `https://quickbooks.api.intuit.com/v3/company/${realmId}`
      : `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}`;

    const customerId = await getOrCreateCustomer(baseUrl, accessToken, customerName || 'Customer');
    const itemId = await getOrCreateJewelryItem(baseUrl, accessToken);

    const lineItems = items.map((item) => ({
      Amount: parseFloat((item.price * item.qty).toFixed(2)),
      DetailType: 'SalesItemLineDetail',
      Description: `${item.design}${item.purity ? ' | ' + item.purity : ''}${item.setCts ? ' | ' + item.setCts + ' ct' : ''}`,
      SalesItemLineDetail: {
        ItemRef: { value: itemId },
        Qty: item.qty,
        UnitPrice: parseFloat(item.price.toFixed(2)),
        TaxCodeRef: { value: 'NON' }
      }
    }));

    const invoicePayload = {
      TxnDate: invoiceDate || new Date().toISOString().slice(0, 10),
      CustomerRef: { value: customerId },
      Line: lineItems,
      GlobalTaxCalculation: 'NotApplicable'
    };
    if (invoiceNumber) invoicePayload.DocNumber = invoiceNumber;

    const createRes = await axios.post(
      `${baseUrl}/invoice`,
      invoicePayload,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'Content-Type': 'application/json' } }
    );

    const created = createRes.data.Invoice;
    console.log(`✅ QBO invoice created: ${created.Id} for ${customerName}`);
    res.json({ success: true, invoiceId: created.Id, docNumber: created.DocNumber });

  } catch (err) {
    const qboErrors = err.response?.data?.Fault?.Error;
    console.error('❌ QBO invoice error:', JSON.stringify(err.response?.data || err.message, null, 2));
    const detail = qboErrors
      ? qboErrors.map(e => `${e.Message} (code ${e.code})`).join('; ')
      : err.message;
    res.status(500).json({ error: detail });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
