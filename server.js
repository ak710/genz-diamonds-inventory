require('dotenv').config();
const express = require('express');
const path = require('path');
const OpenAI = require('openai');
const app = express();

app.use(express.json());

const airtable = require('./lib/airtableClient');
const Airtable = require('airtable');

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || 'genz2026';
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
- Set Cts. (exact spacing): Total carat weight of stones
- AI Description (capitals, one space): Concise AI-generated descriptions with keywords (metal type, stone shapes, setting style, design features, finish)
- Job No. (exact with period and space): Item reference number

CRITICAL PRODUCT TYPE CODES:
- rings → "RN" in Design field
- earrings → "ER" in Design field  
- necklaces/pendants → "NT" in Design field

INTELLIGENT QUERY UNDERSTANDING:
The AI Description uses CONCISE keywords, so be smart about variations:

**Stone Shapes** - AI descriptions use short forms, so:
- "emerald cut" or "emerald" → FIND("emerald", ...)
- "round cut" or "round" → FIND("round", ...)
- "princess cut" or "princess" → FIND("princess", ...)
- "oval", "cushion", "pear", "marquise" → search for shape name only

**Metal Colors** - Use OR for variations:
- "white gold" → OR(FIND("white gold", ...), FIND("white", ...))
- "yellow gold" or "gold" → OR(FIND("yellow gold", ...), FIND("yellow", ...))
- "rose gold" → OR(FIND("rose gold", ...), FIND("rose", ...))

**Settings & Styles**:
- "solitaire", "halo", "pave", "prong", "bezel", "channel" → search exact keyword
- For style keywords like "vintage", "modern", "classic" → can use OR for synonyms

Query: "${query}"

SMART FORMULA GENERATION RULES:
1. Use OR logic when multiple keywords could match the same intent
2. For shape queries, search ONLY the shape name (emerald, round, oval, etc.) - descriptions don't say "cut"
3. For metal queries, include variations (white gold / white)
4. For style queries, think about synonyms the user might mean
5. Use AND to combine different criteria (product type + shape + metal)

Return ONLY the filterByFormula expression with CORRECT casing. Use FIND with LOWER for text searches. No explanation or markdown.

Examples:
- "emerald cut rings" → AND(FIND("rn", LOWER({Design})), FIND("emerald", LOWER({AI Description})))
- "emerald rings" → AND(FIND("rn", LOWER({Design})), FIND("emerald", LOWER({AI Description})))
- "white gold rings" → AND(FIND("rn", LOWER({Design})), OR(FIND("white gold", LOWER({AI Description})), FIND("white", LOWER({AI Description}))))
- "round diamond rings" → AND(FIND("rn", LOWER({Design})), FIND("round", LOWER({AI Description})))
- "yellow gold halo rings" → AND(FIND("rn", LOWER({Design})), OR(FIND("yellow gold", LOWER({AI Description})), FIND("yellow", LOWER({AI Description}))), FIND("halo", LOWER({AI Description})))
- "vintage solitaire rings" → AND(FIND("rn", LOWER({Design})), FIND("solitaire", LOWER({AI Description})), OR(FIND("vintage", LOWER({AI Description})), FIND("classic", LOWER({AI Description}))))
- "princess cut earrings" → AND(FIND("er", LOWER({Design})), FIND("princess", LOWER({AI Description})))
- "rings over 1 carat" → AND(FIND("rn", LOWER({Design})), {Set Cts.} > 1)
- "large oval rings" → AND(FIND("rn", LOWER({Design})), FIND("oval", LOWER({AI Description})), {Set Cts.} > 1)

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
    
    // Transform records to match expected format
    const results = records.map(rec => ({
      id: rec.id,
      jobNo: rec.get('Job No.'),
      design: rec.get('Design'),
      purity: rec.get('Purity'),
      setCts: rec.get('Set Cts.'),
      image: rec.get('HD Image') || rec.get('Image'),
      aiDescription: rec.get('AI Description'),
      tagPrice: rec.get('Tag Price (CAD)'),
      inInventory: rec.get('In Inventory')
    }));
    
    console.log(`✅ Found ${results.length} results`);
    
    res.json({ 
      query,
      formula,
      results,
      count: results.length
    });
    
  } catch (err) {
    console.error('❌ AI Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
