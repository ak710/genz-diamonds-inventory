require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, VerticalAlign, WidthType, AlignmentType, HeadingLevel, ImageRun, BorderStyle } = require('docx');
const PDFDocument = require('pdfkit');
const axios = require('axios');
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
      if (!url) return null;
      try {
        console.log(`Fetching image: ${url}`);
        const response = await axios.get(url, { 
          responseType: 'arraybuffer',
          timeout: 10000 // 10 second timeout
        });
        console.log(`✓ Image fetched successfully`);
        return Buffer.from(response.data);
      } catch (error) {
        console.error(`✗ Failed to fetch image ${url}:`, error.message);
        return null;
      }
    }
    
    if (format === 'docx') {
      console.log('📝 Generating Word document...');
      // Generate Word document
      const logoPath = path.join(__dirname, 'public', 'assets', 'logo.png');
      let logoChildren = [];
      
      // Add logo if it exists
      if (fs.existsSync(logoPath)) {
        const logoBuffer = fs.readFileSync(logoPath);
        logoChildren = [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 300 },
            children: [
              new ImageRun({
                data: logoBuffer,
                transformation: {
                  width: 200,
                  height: 100
                }
              })
            ]
          })
        ];
      }
      
      // Fetch all images with progress logging
      console.log(`📥 Skipping image fetching for faster generation (${sanitizedItems.length} items)...`);
      const itemsWithImages = sanitizedItems.map(item => ({
        ...item,
        imageBuffer: null // Skip fetching to speed up generation
      }));
      console.log(`✓ Ready to generate document`);
      
      console.log('📋 Building document structure...');
      
      // Create 3-column table with borders
      const itemsPerRow = 3;
      const tableRows = [];
      
      for (let i = 0; i < itemsWithImages.length; i += itemsPerRow) {
        const rowItems = itemsWithImages.slice(i, i + itemsPerRow);
        
        // Create a row with bordered cells
        const tableCells = rowItems.map(item => {
          const cellChildren = [];
          
          // Add image or placeholder
          if (item.imageBuffer) {
            cellChildren.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
                children: [
                  new ImageRun({
                    data: item.imageBuffer,
                    transformation: {
                      width: 150,
                      height: 150
                    }
                  })
                ]
              })
            );
          } else {
            cellChildren.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 200 },
                children: [
                  new TextRun({
                    text: '[No Image]',
                    color: '999999',
                    italics: true,
                    size: 20
                  })
                ]
              })
            );
          }
          
          // Add item details - left aligned
          cellChildren.push(
            new Paragraph({
              spacing: { after: 100 },
              children: [
                new TextRun({
                  text: `SKU: ${item.design}`,
                  bold: true,
                  size: 20
                })
              ]
            }),
            new Paragraph({
              spacing: { after: 100 },
              children: [
                new TextRun({
                  text: `Purity: ${item.purity || 'N/A'}`,
                  size: 20
                })
              ]
            }),
            new Paragraph({
              spacing: { after: 100 },
              children: [
                new TextRun({
                  text: `Set Cts.: ${item.setCts || 'N/A'}`,
                  size: 20
                })
              ]
            }),
            new Paragraph({
              spacing: { after: 100 },
              children: [
                new TextRun({
                  text: `Wholesale: $${item.wholesalePrice.toFixed(2)}`,
                  size: 20
                })
              ]
            }),
            new Paragraph({
              spacing: { after: 100 },
              children: [
                new TextRun({
                  text: `Suggested Retail: $${item.retailPrice.toFixed(2)}`,
                  bold: true,
                  size: 20
                })
              ]
            })
          );
          
          return new TableCell({
            children: cellChildren,
            width: { size: 33, type: WidthType.PERCENTAGE },
            margins: {
              top: 100,
              bottom: 100,
              left: 100,
              right: 100
            },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
              left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
              right: { style: BorderStyle.SINGLE, size: 1, color: '000000' }
            }
          });
        });
        
        // Fill empty cells if needed
        while (tableCells.length < itemsPerRow) {
          tableCells.push(
            new TableCell({
              children: [new Paragraph('')],
              width: { size: 33, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
                left: { style: BorderStyle.SINGLE, size: 1, color: '000000' },
                right: { style: BorderStyle.SINGLE, size: 1, color: '000000' }
              }
            })
          );
        }
        
        tableRows.push(new TableRow({ children: tableCells }));
      }
      
      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            ...logoChildren,
            new Paragraph({
              text: `Date: ${new Date().toLocaleDateString()}`,
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 }
            }),
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: tableRows
            }),
            new Paragraph({
              text: "",
              spacing: { before: 200 }
            }),
            new Paragraph({
              children: [new TextRun({ text: "All prices are in Canadian Dollars (CAD)", italics: true })],
              alignment: AlignmentType.CENTER
            }),
            new Paragraph({
              children: [new TextRun({ text: "Suggested retail price is calculated at 2.5x wholesale price", italics: true })],
              alignment: AlignmentType.CENTER
            })
          ]
        }]
      });
      
      console.log('📦 Packing document...');
      const buffer = await Packer.toBuffer(doc);
      console.log(`✓ Word document generated (${buffer.length} bytes)`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename=linesheet_${new Date().toISOString().slice(0, 10)}.docx`);
      res.send(buffer);
      console.log('✓ Document sent to client');
      
    } else if (format === 'pdf') {
      console.log('📝 Generating PDF document...');
      // Generate PDF document
      const doc = new PDFDocument({ margin: 50 });
      const logoPath = path.join(__dirname, 'public', 'assets', 'logo.png');
      
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=linesheet_${new Date().toISOString().slice(0, 10)}.pdf`);
      
      doc.pipe(res);
      
      // Add logo if it exists
      if (fs.existsSync(logoPath)) {
        const logoWidth = 150;
        const logoHeight = 75;
        const xPosition = (doc.page.width - logoWidth) / 2;
        doc.image(logoPath, xPosition, 40, { width: logoWidth, height: logoHeight });
        doc.moveDown(4);
      }
      
      // Title
      doc.fontSize(12).text(`Date: ${new Date().toLocaleDateString()}`, { align: 'center' });
      doc.moveDown(2);
      
      // Fetch all images with progress logging
      console.log(`📥 Skipping image fetching for faster PDF generation (${sanitizedItems.length} items)...`);
      const itemsWithImages = sanitizedItems.map(item => ({
        ...item,
        imageBuffer: null // Skip fetching to speed up generation
      }));
      console.log(`✓ Ready to generate PDF`);
      
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
      const boxHeight = 320;
      const rowSpacing = 15;
      
      for (let i = 0; i < itemsWithImages.length; i++) {
        const item = itemsWithImages[i];
        
        // Check if we need a new page - ensure entire box fits on current page
        if (currentY + boxHeight > doc.page.height - 100) {
          doc.addPage();
          currentY = 50;
          currentX = leftMargin;
          itemsInCurrentRow = 0;
        }
        
        // Prevent PDFKit auto-pagination by setting y position
        doc.y = currentY;
        
        // Draw border box
        doc.rect(currentX, currentY, boxWidth, boxHeight).stroke('#000000');
        
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
            doc.rect(imageX, imageY, imageWidth, imageHeight).fillAndStroke('#f0f0f0', '#cccccc');
            doc.fillColor('#999999').fontSize(9).text('No Image', imageX, imageY + imageHeight / 2 - 5, {
              width: imageWidth,
              align: 'center'
            });
            doc.fillColor('#000000');
          }
        } else {
          // Draw gray placeholder box
          doc.rect(imageX, imageY, imageWidth, imageHeight).fillAndStroke('#f0f0f0', '#cccccc');
          doc.fillColor('#999999').fontSize(9).text('No Image', imageX, imageY + imageHeight / 2 - 5, {
            width: imageWidth,
            align: 'center'
          });
          doc.fillColor('#000000');
        }
        
        // Add item details below image - left aligned
        const detailsX = currentX + 10;
        const detailsY = imageY + imageHeight + 15;
        const textWidth = boxWidth - 20;
        
        doc.fontSize(10).font('Helvetica-Bold').text(`SKU: ${item.design}`, detailsX, detailsY, {
          width: textWidth,
          align: 'left'
        });
        doc.fontSize(9).font('Helvetica').text(`Purity: ${item.purity || 'N/A'}`, detailsX, detailsY + 14, {
          width: textWidth,
          align: 'left'
        });
        doc.text(`Set Cts.: ${item.setCts || 'N/A'}`, detailsX, detailsY + 28, {
          width: textWidth,
          align: 'left'
        });
        doc.font('Helvetica').text(`Wholesale: $${item.wholesalePrice.toFixed(2)}`, detailsX, detailsY + 42, {
          width: textWidth,
          align: 'left'
        });
        doc.font('Helvetica-Bold').text(`Suggested Retail: $${item.retailPrice.toFixed(2)}`, detailsX, detailsY + 56, {
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
    } else {
      return res.status(400).json({ error: 'Invalid format. Use "docx" or "pdf"' });
    }
    
  } catch (err) {
    console.error('❌ Line sheet generation error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
