require('dotenv').config();
const Airtable = require('airtable');
const OpenAI = require('openai');

const API_KEY = process.env.AIRTABLE_API_KEY;
const BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NAME = process.env.AIRTABLE_TABLE_NAME;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const base = new Airtable({ apiKey: API_KEY }).base(BASE_ID);
const openai = new OpenAI({
  apiKey: OPENROUTER_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': 'https://github.com/ak710/genz-diamonds-inventory',
    'X-Title': 'GenZ Diamonds Inventory'
  }
});

async function aiSearch(naturalQuery) {
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

Query: "${naturalQuery}"

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

  try {
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
    
    // Check for incomplete FIND statements
    if (formula.includes('FIND(') && openParens !== closeParens) {
      console.log('⚠️  Formula has unbalanced parentheses, attempting to fix...');
      formula = formula + ')'.repeat(openParens - closeParens);
    }
    
    // Check for incomplete field references
    if (openBraces !== closeBraces) {
      console.log('⚠️  Formula has unbalanced braces, attempting to fix...');
      formula = formula + '}'.repeat(openBraces - closeBraces);
    }
    
    // Fix case sensitivity - Design field uses lowercase codes
    formula = formula.replace(/FIND\("RN",/g, 'FIND("rn",');
    formula = formula.replace(/FIND\("ER",/g, 'FIND("er",');
    formula = formula.replace(/FIND\("NT",/g, 'FIND("nt",');
    
    console.log('🔍 Generated formula:', formula);
    
    const records = await base(TABLE_NAME)
      .select({ filterByFormula: formula })
      .all();
    
    return records.map(rec => ({
      id: rec.id,
      jobNo: rec.get('Job No.'),
      design: rec.get('Design'),
      purity: rec.get('Purity'),
      setCts: rec.get('Set Cts.'),
      image: rec.get('HD Image') || rec.get('Image'),
      aiDescription: rec.get('AI Description'),
      tagPrice: rec.get('Tag Price (CAD)')
    }));
    
  } catch (err) {
    console.error('❌ Search error:', err.message);
    throw err;
  }
}

// CLI interface
if (require.main === module) {
  const query = process.argv.slice(2).join(' ');
  
  if (!query) {
    console.log('Usage: node ai_search.js <your search query>');
    console.log('\nExamples:');
    console.log('  node ai_search.js show me all emerald cut rings');
    console.log('  node ai_search.js vintage yellow gold earrings');
    console.log('  node ai_search.js rings with halo setting over 1 carat');
    process.exit(1);
  }
  
  (async () => {
    try {
      console.log(`\n🔎 Searching for: "${query}"\n`);
      const results = await aiSearch(query);
      
      if (results.length === 0) {
        console.log('No results found.');
      } else {
        console.log(`Found ${results.length} items:\n`);
        results.forEach((item, i) => {
          console.log(`${i + 1}. ${item.jobNo} - ${item.design}`);
          console.log(`   Purity: ${item.purity}, Carats: ${item.setCts}, Price: $${item.tagPrice} CAD`);
          if (item.aiDescription) {
            console.log(`   Details: ${item.aiDescription}`);
          }
          console.log(`   Image: ${item.image}\n`);
        });
      }
    } catch (err) {
      console.error('Error:', err);
      process.exit(1);
    }
  })();
}

module.exports = { aiSearch };
