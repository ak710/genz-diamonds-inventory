let allItems = [];
let filteredItems = [];
let scannedItems = [];
let scanAudio = null;
let authToken = localStorage.getItem('authToken') || null;
let customerMode = localStorage.getItem('customerMode') === 'true' || false;
let combineMode = false;

// Check if user is authenticated
if (!authToken && window.location.pathname !== '/login.html' && !window.location.pathname.endsWith('login.html')) {
  // Redirect to login if no token and not already on login page
  window.location.href = '/login.html';
}

// Helper function to get auth headers
function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`
  };
}

// Logout function
function logout() {
  localStorage.removeItem('authToken');
  authToken = null;
  window.location.href = '/login.html';
}

// Toggle customer mode
function toggleCustomerMode() {
  customerMode = !customerMode;
  localStorage.setItem('customerMode', customerMode);
  
  // Hide/show Line Sheet tab (3rd tab) and Take Inventory tab (4th tab)
  const linesheetTabButton = document.querySelector('.tab:nth-child(3)');
  const inventoryTabButton = document.querySelector('.tab:nth-child(4)');
  
  if (linesheetTabButton) {
    linesheetTabButton.style.display = customerMode ? 'none' : 'block';
  }
  if (inventoryTabButton) {
    inventoryTabButton.style.display = customerMode ? 'none' : 'block';
  }
  
  // If currently on line sheet or inventory tab and switching to customer mode, switch to browse
  if (customerMode) {
    if (document.getElementById('linesheetTab').classList.contains('active') || 
        document.getElementById('inventoryTab').classList.contains('active')) {
      switchTab('browse');
    }
  }
  
  // Refresh current view based on active tab
  if (document.getElementById('browseTab').classList.contains('active')) {
    applyFilters(); // Re-render browse with updated customer mode
  } else if (document.getElementById('searchTab').classList.contains('active')) {
    // If viewing search results, refresh them
    const barcode = document.getElementById('barcode').value.trim();
    if (barcode) {
      document.getElementById('searchForm').dispatchEvent(new Event('submit'));
    }
  }
}

// Initialize mode on page load
document.addEventListener('DOMContentLoaded', function() {
  const toggle = document.getElementById('customerModeToggle');
  if (toggle) {
    toggle.checked = customerMode;
  }
  
  // Hide Line Sheet and Take Inventory tabs on initial load if in customer mode
  if (customerMode) {
    const linesheetTabButton = document.querySelector('.tab:nth-child(3)');
    const inventoryTabButton = document.querySelector('.tab:nth-child(4)');
    if (linesheetTabButton) {
      linesheetTabButton.style.display = 'none';
    }
    if (inventoryTabButton) {
      inventoryTabButton.style.display = 'none';
    }
  }
});

// AI Search functions
let isAISearchActive = false;

async function performAISearch() {
  const query = document.getElementById('aiSearchInput').value.trim();
  const statusEl = document.getElementById('aiSearchStatus');
  
  if (!query) {
    statusEl.textContent = '⚠️ Please enter a search query';
    statusEl.style.color = '#856404';
    return;
  }
  
  statusEl.textContent = '🔍 Searching...';
  statusEl.style.color = '#6c757d';
  
  try {
    const response = await fetch('/api/ai-search', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ query })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Search failed');
    }
    
    // Mark that AI search is active
    isAISearchActive = true;
    
    // Display results
    filteredItems = data.results || [];
    
    if (filteredItems.length === 0) {
      statusEl.textContent = '❌ No items found for your search';
      statusEl.style.color = '#856404';
    } else {
      statusEl.textContent = `✅ Found ${filteredItems.length} item${filteredItems.length !== 1 ? 's' : ''}`;
      statusEl.style.color = '#28a745';
    }
    
    displayItems(filteredItems);
    
  } catch (err) {
    console.error('AI Search error:', err);
    statusEl.textContent = `❌ Error: ${err.message}`;
    statusEl.style.color = '#dc3545';
  }
}

function clearAISearch() {
  document.getElementById('aiSearchInput').value = '';
  document.getElementById('aiSearchStatus').textContent = '';
  isAISearchActive = false;
  
  // Restore normal filtered view
  applyFilters();
}

// Image Modal functions
function openImageModal(imageUrl) {
  const modal = document.getElementById('imageModal');
  const modalImage = document.getElementById('modalImage');
  modalImage.src = imageUrl;
  modal.classList.add('show');
}

function closeImageModal() {
  const modal = document.getElementById('imageModal');
  modal.classList.remove('show');
}

// Close modal when clicking outside the image
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('imageModal');
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) {
        closeImageModal();
      }
    });
  }
  
  // Close modal with Escape key
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      closeImageModal();
    }
  });
});

// Initialize audio
function initAudio() {
  scanAudio = {
    success: new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE='),
    error: new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm1dIBAAAAAABABAAB8AAEAfAAABAAgAZGF0YQoGAAD/+P38/f3+/f39/f7+/v7+/v3+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/g==')
  };
}

// Tab switching
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  
  if (tab === 'browse') {
    document.querySelector('.tab:nth-child(1)').classList.add('active');
    document.getElementById('browseTab').classList.add('active');
    if (allItems.length === 0) loadAllItems();
  } else if (tab === 'search') {
    document.querySelector('.tab:nth-child(2)').classList.add('active');
    document.getElementById('searchTab').classList.add('active');
  } else if (tab === 'linesheet') {
    document.querySelector('.tab:nth-child(3)').classList.add('active');
    document.getElementById('linesheetTab').classList.add('active');
    if (allItems.length === 0) {
      loadAllItems().then(() => loadLineSheetItems());
    } else {
      loadLineSheetItems();
    }
  } else if (tab === 'inventory') {
    document.querySelector('.tab:nth-child(4)').classList.add('active');
    document.getElementById('inventoryTab').classList.add('active');
    document.getElementById('inventoryScan').focus();
  }
}

// Load all items for browse view
async function loadAllItems() {
  const resultDiv = document.getElementById('browseResult');
  resultDiv.innerHTML = '<div class="loading">Loading inventory...</div>';
  
  try {
    const res = await fetch('/api/items', {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allItems = data.records || [];
    filteredItems = [...allItems];
    
    // Populate filter dropdowns
    populateFilters();
    
    // Display items
    displayItems(filteredItems);
  } catch (err) {
    resultDiv.innerHTML = '<p style="color: red;">Error loading items.</p>';
    console.error('Error:', err);
  }
}

// Populate filter dropdowns with unique values
function populateFilters() {
  const prefixes = new Set();
  const purities = new Set();
  
  allItems.forEach(item => {
    const f = item.fields;
    if (f['Design Prefix']) prefixes.add(f['Design Prefix']);
    if (f['Purity']) purities.add(f['Purity']);
  });
  
  const prefixSelect = document.getElementById('filterPrefix');
  prefixSelect.innerHTML = '<option value="">All</option>';
  Array.from(prefixes).sort().forEach(p => {
    prefixSelect.innerHTML += `<option value="${p}">${p}</option>`;
  });
  
  const puritySelect = document.getElementById('filterPurity');
  puritySelect.innerHTML = '<option value="">All</option>';
  Array.from(purities).sort().forEach(p => {
    puritySelect.innerHTML += `<option value="${p}">${p}</option>`;
  });
}

// Apply filters
function applyFilters() {
  combineMode = document.getElementById('combineToggle').checked;
  
  const prefix = document.getElementById('filterPrefix').value;
  const minPrice = parseFloat(document.getElementById('filterMinPrice').value) || 0;
  const maxPrice = parseFloat(document.getElementById('filterMaxPrice').value) || Infinity;
  const purity = document.getElementById('filterPurity').value;
  const sortBy = document.getElementById('sortBy').value;
  
  let items = allItems.filter(item => {
    const f = item.fields;
    const price = f['Tag Price Rounded (CAD)'] || 0;
    
    if (prefix && f['Design Prefix'] !== prefix) return false;
    if (price < minPrice || price > maxPrice) return false;
    if (purity && f['Purity'] !== purity) return false;
    
    return true;
  });
  
  // Apply combining if enabled
  if (combineMode) {
    const combinedMap = {};
    items.forEach(item => {
      const design = item.fields['Design'] || 'Unknown';
      if (!combinedMap[design]) {
        combinedMap[design] = {
          ...item,
          _combinedItems: [item]
        };
      } else {
        combinedMap[design]._combinedItems.push(item);
      }
    });
    items = Object.values(combinedMap);
  }
  
  // Apply sorting
  if (sortBy === 'price-low') {
    items.sort((a, b) => {
      const priceA = a.fields['Tag Price Rounded (CAD)'] || 0;
      const priceB = b.fields['Tag Price Rounded (CAD)'] || 0;
      return priceA - priceB;
    });
  } else if (sortBy === 'price-high') {
    items.sort((a, b) => {
      const priceA = a.fields['Tag Price Rounded (CAD)'] || 0;
      const priceB = b.fields['Tag Price Rounded (CAD)'] || 0;
      return priceB - priceA;
    });
  }
  
  filteredItems = items;
  displayItems(filteredItems);
}

// Helper function to get placeholder image
function getPlaceholder() {
  return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22280%22 height=%22200%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22280%22 height=%22200%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 font-family=%22Arial%22 font-size=%2214%22 fill=%22%23999%22 text-anchor=%22middle%22 dy=%22.3em%22%3ENo Image%3C/text%3E%3C/svg%3E';
}

// Display items in grid
function displayItems(items) {
  const resultDiv = document.getElementById('browseResult');
  
  if (items.length === 0) {
    resultDiv.innerHTML = '<p>No items found.</p>';
    return;
  }
  
  // Calculate stats (only for staff mode)
  let statsHtml = '';
  if (!customerMode) {
    let totalPieces = 0;
    let piecesInStock = 0;
    const uniqueDesigns = new Set();
    
    items.forEach(item => {
      const f = item.fields;
      const isSold = f['Sold'] === true;
      
      if (combineMode && item._combinedItems) {
        // For combined items, count stock
        totalPieces += item._combinedItems.length;
        if (!isSold) {
          piecesInStock += item._combinedItems.length;
        }
        uniqueDesigns.add(f['Design']);
      } else {
        // For regular items, count 1 per item
        totalPieces += 1;
        if (!isSold) {
          piecesInStock += 1;
        }
        uniqueDesigns.add(f['Design']);
      }
    });
    
    statsHtml = `
      <div style="background: #f0f8ff; padding: 1.5em; border-radius: 5px; margin-bottom: 2em; display: flex; gap: 3em;">
        <div style="flex: 1; text-align: center;">
          <div style="font-size: 1.8em; font-weight: bold; color: #007bff;">${piecesInStock}/${totalPieces}</div>
          <div style="color: #666; font-size: 0.9em; margin-top: 0.5em;">Pieces in Stock / Total</div>
        </div>
        <div style="flex: 1; text-align: center; border-left: 1px solid #ddd; padding-left: 3em;">
          <div style="font-size: 1.8em; font-weight: bold; color: #007bff;">${uniqueDesigns.size}</div>
          <div style="color: #666; font-size: 0.9em; margin-top: 0.5em;">Unique Designs</div>
        </div>
      </div>
    `;
  }
  
  let html = statsHtml + `<div class="items-grid">`;
  
  items.forEach(item => {
    const f = item.fields;
    const hdImage = f['HD Image'] || '';
    const image = f['Image'] || '';
    const jobNo = f['Job No.'] || 'N/A';
    const design = f['Design'] || 'N/A';
    const price = f['Tag Price Rounded (CAD)'] || f['Tag Price (CAD)'] || 'N/A';
    const purity = f['Purity'] || '';
    const weight = f['Gross Weight (Gr. Wt.)'] || '';
    
    // For combined items, check if ALL are sold (only then show sold out)
    let isSold = f['Sold'] === true;
    if (combineMode && item._combinedItems) {
      isSold = item._combinedItems.every(i => i.fields['Sold'] === true);
    }
    
    // Use HD image first, fallback to regular image, then placeholder
    const imageUrl = hdImage || image || getPlaceholder();
    const fallbackUrl = image || getPlaceholder();
    
    // Check if this is a combined item
    const stock = item._combinedItems ? item._combinedItems.length : 1;
    const stockDisplay = combineMode ? `<p><strong>Stock:</strong> ${stock}</p>` : '';
    
    html += `
      <div class="item-card" onclick="showItemDetail('${item.id}')">
        <img src="${imageUrl}" alt="${design}" class="item-image" onerror="if(this.src !== '${fallbackUrl}') { this.src = '${fallbackUrl}'; } else if(this.src !== '${getPlaceholder()}') { this.src = '${getPlaceholder()}'; }">
        <div class="item-details">
          <h3>${design}</h3>
          <p><strong>Job No:</strong> ${jobNo}</p>
          <p><strong>Purity:</strong> ${purity} | <strong>Weight:</strong> ${weight}g</p>
          ${stockDisplay}
          <p class="item-price">$${price} CAD</p>
          <div class="item-status ${isSold ? 'sold-out' : 'in-stock'}">
            ${isSold ? '❌ Sold Out' : '✓ In Stock'}
          </div>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  resultDiv.innerHTML = html;
}

// Show item detail when clicked
function showItemDetail(recordId) {
  // If combine mode is enabled, search filteredItems first to find combined items
  let item = null;
  if (combineMode) {
    item = filteredItems.find(i => i.id === recordId);
  }
  if (!item) {
    item = allItems.find(i => i.id === recordId);
  }
  if (!item) return;
  
  const combinedItems = item._combinedItems || null;
  
  const resultDiv = document.getElementById('browseResult');
  resultDiv.innerHTML = `
    <button onclick="loadAllItems()" style="margin-bottom: 1em;">← Back to Browse</button>
    <div class="detail-view">
      ${renderRecord(item, combinedItems)}
    </div>
  `;
  window.scrollTo(0, 0);
}

// Search form handler (existing functionality)
document.getElementById('searchForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const barcode = document.getElementById('barcode').value.trim();
  const resultDiv = document.getElementById('result');
  resultDiv.innerHTML = 'Searching...';
  const res = await fetch(`/api/search/${encodeURIComponent(barcode)}`, {
    headers: getAuthHeaders()
  });
  if (res.ok) {
    const data = await res.json();
    if (data && data.record) {
      resultDiv.innerHTML = renderRecord(data.record);
    } else {
      resultDiv.innerHTML = 'No record found.';
    }
  } else {
    resultDiv.innerHTML = 'Error searching for record.';
  }
});

function renderRecord(record, combinedItems = null) {
  const f = record.fields;
  let html = '<h2>Piece Details</h2>';
  
  // Add tabs for combined items at the top
  if (combinedItems && combinedItems.length > 1) {
    html += `
      <div style="margin-bottom: 1.5em;">
        <div style="display: flex; border-bottom: 2px solid #ddd; gap: 0.25em; flex-wrap: wrap;">
    `;
    combinedItems.forEach((item, index) => {
      const itemJobNo = item.fields['Job No.'] || 'N/A';
      const isSold = item.fields['Sold'] === true;
      const isActive = item.id === record.id;
      const activeStyle = isActive ? 'border-bottom: 3px solid #007bff; font-weight: bold; background: #f8f9fa;' : 'border-bottom: 3px solid transparent;';
      const soldBadge = isSold ? '<span style="color: #dc3545; font-size: 0.8em; margin-left: 0.25em;">●</span>' : '';
      html += `
        <button 
          class="item-tab" 
          data-item-id="${item.id}"
          style="padding: 0.75em 1.25em; cursor: pointer; border: none; background: none; font-size: 0.95em; ${activeStyle} transition: all 0.2s;"
          onmouseover="if(!this.style.fontWeight) this.style.background='#f8f9fa'"
          onmouseout="if(!this.style.fontWeight) this.style.background='none'"
        >
          ${itemJobNo}${soldBadge}
        </button>
      `;
    });
    html += `
        </div>
      </div>
    `;
  }
  
  // Display image if available (HD first, then regular)
  const hdImage = f['HD Image'];
  const regularImage = f['Image'];
  if (hdImage || regularImage) {
    const imageUrl = hdImage || regularImage;
    const onErrorFallback = `this.src='${regularImage || getPlaceholder()}';`;
    html += `<div style="text-align: left; margin-bottom: 1em;">
      <img src="${imageUrl}" 
           alt="Jewellery Image" 
           class="detail-image" 
           onclick="openImageModal('${imageUrl}')"
           onerror="if(this.src !== '${regularImage || ''}') { this.src = '${regularImage || getPlaceholder()}'; } else if(this.src !== '${getPlaceholder()}') { this.src = '${getPlaceholder()}'; }" 
      />
      <p style="font-size: 0.85em; color: #666; margin: 0.5em 0 0 0;">Click to enlarge</p>
    </div>`;
  }
  
  // Display key details in a table
  html += '<table style="border-collapse: collapse; margin-bottom: 1em;">';
  
  // Show single job number (current item's)
  html += '<tr><td><b>Job No.</b></td><td>' + (f['Job No.'] || '') + '</td></tr>';
  
  html += '<tr><td><b>Design</b></td><td>' + (f['Design'] || '') + '</td></tr>';
  html += '<tr><td><b>Purity</b></td><td>' + (f['Purity'] || '') + '</td></tr>';
  html += '<tr><td><b>Gr. Wt.</b></td><td>' + (f['Gross Weight (Gr. Wt.)'] || '') + '</td></tr>';
  html += '<tr><td><b>Set Pcs.</b></td><td>' + (f['Set Pcs.'] || '') + '</td></tr>';
  html += '<tr><td><b>Set Cts.</b></td><td>' + (f['Set Cts.'] || '') + '</td></tr>';
  
  // Only show these fields in staff mode (not customer mode)
  if (!customerMode) {
    html += '<tr><td><b>Tag Price (USD)</b></td><td>' + (f['Tag Price (USD)'] || '') + '</td></tr>';
    html += '<tr><td><b>Tag Price (CAD)</b></td><td>' + (f['Tag Price (CAD)'] || '') + '</td></tr>';
    html += '<tr><td><b>Tag Price Rounded (CAD)</b></td><td>' + (f['Tag Price Rounded (CAD)'] || '') + '</td></tr>';
    html += '<tr><td><b>15% Discount</b></td><td>' + (f['15% Discount Price (CAD)'] || '') + '</td></tr>';
    html += '<tr><td><b>20% Discount</b></td><td>' + (f['20% Discount Price (CAD)'] || '') + '</td></tr>';
    html += '<tr><td><b>25% Discount</b></td><td>' + (f['25% Discount Price (CAD)'] || '') + '</td></tr>';
    html += '<tr><td><b>33% Discount</b></td><td>' + (f['33% Discount Price (CAD)'] || '') + '</td></tr>';
    html += '<tr><td><b>DIA Cts</b></td><td>' + (f['DIA Cts'] || '') + '</td></tr>';
    html += '<tr><td><b>LGD Cts</b></td><td>' + (f['LGD Cts'] || '') + '</td></tr>';
  } else {
    // Customer mode - show only Tag Price Rounded (CAD) renamed
    html += '<tr><td><b>Tag Price (CAD)</b></td><td>' + (f['Tag Price Rounded (CAD)'] || '') + '</td></tr>';
  }
  
  html += '</table>';
  
  // Only show edit form in staff mode
  if (!customerMode) {
    html += `
      <h3>Update Sale Information</h3>
      <form id="editForm" style="margin-top: 1em;">
        <label style="display: block; margin-top: 0.5em;"><input type="checkbox" name="Sold" ${f['Sold'] ? 'checked' : ''}> Sold</label>
        <label style="display: block; margin-top: 0.5em;">Buyer Name: <input type="text" name="Buyer Name" value="${f['Buyer Name'] || ''}" style="margin-left: 0.5em;"></label>
        <label style="display: block; margin-top: 0.5em;">Sale Date: <input type="date" name="Sale Date" value="${f['Sale Date'] || ''}" style="margin-left: 0.5em;"></label>
        <label style="display: block; margin-top: 0.5em;">Sale Price (CAD): <input type="number" name="Sale Price" value="${f['Sale Price'] || ''}" style="margin-left: 0.5em;"></label>
        <button type="submit" style="margin-top: 1em;">Update</button>
      </form>
      <div id="updateMsg" style="margin-top: 1em; font-weight: bold;"></div>
    `;
  }
  
  if (!customerMode) {
    setTimeout(() => attachEditHandler(record.id, combinedItems), 0);
  }
  
  // Attach handler for the item tabs if they exist
  if (combinedItems && combinedItems.length > 1) {
    setTimeout(() => {
      const itemTabs = document.querySelectorAll('.item-tab');
      itemTabs.forEach(tab => {
        tab.addEventListener('click', function() {
          const selectedId = this.getAttribute('data-item-id');
          const selectedItem = combinedItems.find(item => item.id === selectedId);
          if (selectedItem) {
            const resultDiv = document.getElementById('browseResult');
            resultDiv.innerHTML = `
              <button onclick="loadAllItems()" style="margin-bottom: 1em;">← Back to Browse</button>
              <div class="detail-view">
                ${renderRecord(selectedItem, combinedItems)}
              </div>
            `;
            window.scrollTo(0, 0);
          }
        });
      });
    }, 0);
  }
  
  return html;
}

function attachEditHandler(recordId, combinedItems) {
  const form = document.getElementById('editForm');
  if (!form) return;
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    // Always use the current record ID (the one being displayed)
    const selectedRecordId = recordId;
    
    const formData = new FormData(form);
    const payload = {
      Sold: formData.get('Sold') === 'on'
    };
    
    // Only add non-empty fields
    const buyerName = formData.get('Buyer Name');
    const saleDate = formData.get('Sale Date');
    const salePrice = formData.get('Sale Price');
    
    if (buyerName) payload['Buyer Name'] = buyerName;
    if (saleDate) payload['Sale Date'] = saleDate;
    if (salePrice) payload['Sale Price'] = parseFloat(salePrice);
    
    const res = await fetch(`/api/update/${selectedRecordId}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(payload)
    });
    const msgDiv = document.getElementById('updateMsg');
    if (res.ok) {
      msgDiv.textContent = 'Update successful!';
      msgDiv.style.color = 'green';
    } else {
      msgDiv.textContent = 'Update failed.';
      msgDiv.style.color = 'red';
    }
  });
}

// Initialize on load
window.addEventListener('DOMContentLoaded', () => {
  loadAllItems();
  initAudio();
  setupInventoryScanning();
});

// Inventory scanning setup
function setupInventoryScanning() {
  const form = document.getElementById('inventoryForm');
  const input = document.getElementById('inventoryScan');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const jobNo = input.value.trim();
    if (!jobNo) return;
    
    input.value = '';
    await processInventoryScan(jobNo);
    input.focus();
  });
}

// Process inventory scan
async function processInventoryScan(jobNo) {
  const feedbackDiv = document.getElementById('scanFeedback');
  
  try {
    // Check for duplicate
    const existing = scannedItems.find(item => item.fields['Job No.'] === jobNo);
    if (existing) {
      feedbackDiv.className = 'scan-feedback scan-duplicate';
      feedbackDiv.textContent = `⚠️ Already scanned: ${jobNo}`;
      if (scanAudio.error) scanAudio.error.play().catch(() => {});
      setTimeout(() => feedbackDiv.className = 'scan-feedback', 2000);
      return;
    }
    
    // Fetch item
    const res = await fetch(`/api/search/${encodeURIComponent(jobNo)}`, {
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error('Not found');
    
    const data = await res.json();
    if (!data || !data.record) throw new Error('Not found');
    
    // Add to scanned items
    const item = data.record;
    scannedItems.unshift({ ...item, scannedAt: new Date() });
    
    // Update Airtable with inventory status (with timestamp)
    const now = new Date();
    const timestamp = now.toISOString(); // ISO 8601 format: 2026-02-09T19:45:30.123Z
    updateInventoryStatus(item.id, timestamp);
    
    // Show success feedback
    feedbackDiv.className = 'scan-feedback scan-success';
    feedbackDiv.textContent = `✓ Scanned: ${item.fields['Design'] || jobNo}`;
    if (scanAudio.success) scanAudio.success.play().catch(() => {});
    
    // Update UI
    updateInventoryStats();
    displayScannedItems();
    
    setTimeout(() => feedbackDiv.className = 'scan-feedback', 1500);
    
  } catch (err) {
    feedbackDiv.className = 'scan-feedback scan-error';
    feedbackDiv.textContent = `✗ Not found: ${jobNo}`;
    if (scanAudio.error) scanAudio.error.play().catch(() => {});
    setTimeout(() => feedbackDiv.className = 'scan-feedback', 2000);
  }
}

// Update inventory status in Airtable
async function updateInventoryStatus(recordId, date) {
  try {
    await fetch(`/api/update/${recordId}`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        'In Inventory': true,
        'Last Inventory Date': date
      })
    });
  } catch (err) {
    console.error('Failed to update Airtable:', err);
    // Don't show error to user - scanning experience should continue smoothly
  }
}

// Update inventory stats
function updateInventoryStats() {
  document.getElementById('scanCount').textContent = scannedItems.length;
  
  const totalValue = scannedItems.reduce((sum, item) => {
    const price = item.fields['Tag Price Rounded (CAD)'] || item.fields['Tag Price (CAD)'] || 0;
    return sum + price;
  }, 0);
  
  document.getElementById('totalValue').textContent = `$${totalValue.toLocaleString()}`;
}

// Display scanned items
function displayScannedItems() {
  const container = document.getElementById('scannedItems');
  
  if (scannedItems.length === 0) {
    container.innerHTML = '<p style="text-align: center; color: #999;">No items scanned yet. Start scanning barcodes above.</p>';
    return;
  }
  
  let html = '<h3>Scanned Items</h3>';
  
  scannedItems.forEach((item, index) => {
    const f = item.fields;
    const time = item.scannedAt.toLocaleTimeString();
    const image = f['Image'] || '';
    const design = f['Design'] || 'N/A';
    const jobNo = f['Job No.'] || 'N/A';
    const price = f['Tag Price Rounded (CAD)'] || f['Tag Price (CAD)'] || 'N/A';
    
    html += `
      <div class="scanned-item">
        <img src="${image}" alt="${design}" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect fill=%22%23f0f0f0%22 width=%2260%22 height=%2260%22/%3E%3C/svg%3E'">
        <div class="scanned-item-details">
          <div><strong>${design}</strong></div>
          <div>Job No: ${jobNo} | $${price} CAD</div>
          <div class="scanned-item-time">Scanned at ${time}</div>
        </div>
        <button onclick="removeScannedItem(${index})" style="padding: 0.5em; background: #dc3545; color: white; border: none; border-radius: 3px; cursor: pointer;">Remove</button>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

// Remove scanned item
function removeScannedItem(index) {
  scannedItems.splice(index, 1);
  updateInventoryStats();
  displayScannedItems();
}

// Clear inventory
function clearInventory() {
  if (scannedItems.length === 0) return;
  if (!confirm(`Clear all ${scannedItems.length} scanned items?`)) return;
  
  scannedItems = [];
  updateInventoryStats();
  displayScannedItems();
  document.getElementById('inventoryScan').focus();
}

// Export inventory to CSV
function exportInventory() {
  if (scannedItems.length === 0) {
    alert('No items to export.');
    return;
  }
  
  const headers = ['Job No.', 'Design', 'Purity', 'Weight (g)', 'Price (CAD)', 'Scanned At'];
  const rows = scannedItems.map(item => {
    const f = item.fields;
    return [
      f['Job No.'] || '',
      f['Design'] || '',
      f['Purity'] || '',
      f['Gross Weight (Gr. Wt.)'] || '',
      f['Tag Price Rounded (CAD)'] || f['Tag Price (CAD)'] || '',
      item.scannedAt.toLocaleString()
    ];
  });
  
  const csv = [headers, ...rows].map(row => 
    row.map(cell => `\"${cell}\"`).join(',')
  ).join('\\n');
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Line Sheet Generator Functions
let lineSheetItems = [];
let selectedLineSheetItems = new Set();

async function loadLineSheetItems() {
  const container = document.getElementById('linesheetItemsList');
  
  try {
    // Use allItems if already loaded, otherwise fetch
    if (allItems.length > 0) {
      lineSheetItems = allItems.map(record => ({
        id: record.id,
        fields: record.fields
      }));
      renderLineSheetItems();
    } else {
      container.innerHTML = '<p style="color: #666; text-align: center;">Loading items...</p>';
      const token = localStorage.getItem('authToken');
      const response = await fetch('/api/items', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load items: ${response.status}`);
      }
      
      const records = await response.json();
      allItems = records;
      lineSheetItems = records.map(record => ({
        id: record.id,
        fields: record.fields
      }));
      
      renderLineSheetItems();
    }
  } catch (error) {
    console.error('Error loading items for line sheet:', error);
    container.innerHTML = `
      <div style="color: #dc3545; text-align: center; padding: 2em;">
        <p><strong>⚠️ Error loading items</strong></p>
        <p style="font-size: 0.9em;">${error.message}</p>
        <button onclick="loadLineSheetItems()" class="btn-secondary" style="margin-top: 1em;">Try Again</button>
      </div>
    `;
  }
}

function renderLineSheetItems() {
  const container = document.getElementById('linesheetItemsList');
  
  if (lineSheetItems.length === 0) {
    container.innerHTML = '<p style="color: #666; text-align: center;">No items available</p>';
    return;
  }
  
  container.innerHTML = '';
  
  lineSheetItems.forEach(item => {
    const f = item.fields;
    const div = document.createElement('div');
    div.className = 'form-check mb-2 p-2 border rounded';
    div.style.backgroundColor = selectedLineSheetItems.has(item.id) ? '#e7f3ff' : '#ffffff';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'form-check-input';
    checkbox.id = `item-${item.id}`;
    checkbox.checked = selectedLineSheetItems.has(item.id);
    checkbox.onchange = () => toggleLineSheetItem(item.id);
    
    const label = document.createElement('label');
    label.className = 'form-check-label w-100';
    label.htmlFor = `item-${item.id}`;
    label.style.cursor = 'pointer';
    
    const imageUrl = f['HD Image']?.[0]?.url || f['Image']?.[0]?.url || '';
    const imageHtml = imageUrl ? `<img src="${imageUrl}" style="width: 50px; height: 50px; object-fit: cover; margin-right: 10px; border-radius: 4px;">` : '';
    
    label.innerHTML = `
      <div class="d-flex align-items-center">
        ${imageHtml}
        <div>
          <strong>${f['Design'] || 'N/A'}</strong> - ${f['Purity'] || ''} 
          <br>
          <small>Tag Price: $${f['Tag Price Rounded (CAD)'] || f['Tag Price (CAD)'] || 'N/A'}</small>
        </div>
      </div>
    `;
    
    div.appendChild(checkbox);
    div.appendChild(label);
    container.appendChild(div);
  });
  
  updateSelectedCount();
}

function toggleLineSheetItem(itemId) {
  if (selectedLineSheetItems.has(itemId)) {
    selectedLineSheetItems.delete(itemId);
  } else {
    selectedLineSheetItems.add(itemId);
  }
  renderLineSheetItems();
}

function selectAllLineSheet() {
  lineSheetItems.forEach(item => selectedLineSheetItems.add(item.id));
  renderLineSheetItems();
}

function clearLineSheetSelection() {
  selectedLineSheetItems.clear();
  renderLineSheetItems();
}

function updateSelectedCount() {
  const count = selectedLineSheetItems.size;
  const element = document.getElementById('selectedCount');
  if (element) {
    element.textContent = count;
  }
}

function toggleCustomDiscount() {
  const discountType = document.querySelector('input[name="discount-type"]:checked').value;
  const presetDiscounts = document.getElementById('presetDiscounts');
  const customDiscount = document.getElementById('customDiscount');
  
  if (discountType === 'custom') {
    presetDiscounts.style.display = 'none';
    customDiscount.style.display = 'block';
  } else {
    presetDiscounts.style.display = 'flex';
    customDiscount.style.display = 'none';
  }
}

function roundToNearest5(price) {
  if (!price || isNaN(price)) return 0;
  return Math.round(price / 5) * 5;
}

async function generateLineSheet() {
  if (selectedLineSheetItems.size === 0) {
    alert('Please select at least one item for the line sheet.');
    return;
  }
  
  const discountType = document.querySelector('input[name="discount-type"]:checked').value;
  let discountPercent = 0;
  
  if (discountType === 'custom') {
    discountPercent = parseFloat(document.getElementById('customDiscountValue').value) || 0;
    if (discountPercent <= 0 || discountPercent >= 100) {
      alert('Please enter a valid discount percentage between 0 and 100.');
      return;
    }
  } else {
    discountPercent = parseInt(document.querySelector('input[name="discount"]:checked').value);
  }
  
  // Prepare selected items data
  const selectedItems = lineSheetItems
    .filter(item => selectedLineSheetItems.has(item.id))
    .map(item => {
      const f = item.fields;
      const tagPrice = parseFloat(f['Tag Price Rounded (CAD)'] || f['Tag Price (CAD)'] || 0);
      const discountedPrice = roundToNearest5(tagPrice * (1 - discountPercent / 100));
      const retailPrice = roundToNearest5(discountedPrice * 2.5);
      
      // Try multiple ways to get image URL
      let imageUrl = null;
      
      // Try HD Image first
      if (f['HD Image']) {
        if (Array.isArray(f['HD Image']) && f['HD Image'].length > 0) {
          imageUrl = f['HD Image'][0].url;
        } else if (typeof f['HD Image'] === 'string') {
          imageUrl = f['HD Image'];
        }
      }
      
      // Fallback to regular Image
      if (!imageUrl && f['Image']) {
        if (Array.isArray(f['Image']) && f['Image'].length > 0) {
          imageUrl = f['Image'][0].url;
        } else if (typeof f['Image'] === 'string') {
          imageUrl = f['Image'];
        }
      }
      
      console.log(`Item ${f['Design']}: image URL = ${imageUrl ? imageUrl.substring(0, 50) + '...' : 'null'}`);
      
      return {
        image: imageUrl,
        design: f['Design'] || 'N/A',
        purity: f['Purity'] || '',
        setCts: f['Set Cts.'] || '',
        wholesalePrice: discountedPrice,
        retailPrice: retailPrice
      };
    });
  
  try {
    const button = document.querySelector('#linesheetTab button.btn-primary');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Generating...';
    
    const token = localStorage.getItem('authToken');
    const response = await fetch('/api/generate-linesheet', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      method: 'POST',
      body: JSON.stringify({
        items: selectedItems,
        format: 'pdf',
        discountPercent: discountPercent
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Server error:', errorText);
      throw new Error(`Failed to generate line sheet: ${response.status}`);
    }
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linesheet_${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    
    button.disabled = false;
    button.textContent = originalText;
  } catch (error) {
    console.error('Error generating line sheet:', error);
    alert(`Failed to generate line sheet: ${error.message}`);
    const button = document.querySelector('#linesheetTab button.btn-primary');
    button.disabled = false;
    button.textContent = 'Generate Line Sheet';
  }
}
