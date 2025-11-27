// Purchase Management JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Check if we're on the purchase page
    if (!window.location.pathname.includes('purchase.html')) return;
    
    // Initialize purchase page
    initPurchasePage();
    bindPurchaseUI();
    loadPurchaseHistory();
    loadInventory();
    
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('purchaseDate').value = today;
    
    // Update summary cards
    updatePurchaseSummaryCards();
});

// Purchase Management Variables
let purchaseItems = [];
let purchaseHistory = [];
let inventory = [];

// Initialize the purchase page
function initPurchasePage() {
    // Load purchase history from localStorage or API
    const savedHistory = localStorage.getItem('purchaseHistory');
    if (savedHistory) {
        purchaseHistory = JSON.parse(savedHistory);
    }
    
    // Load inventory from localStorage or API
    const savedInventory = localStorage.getItem('inventory');
    if (savedInventory) {
        inventory = JSON.parse(savedInventory);
    } else {
        // If no inventory in localStorage, try to get from the main inventory
        try {
            if (window.inventory && Array.isArray(window.inventory)) {
                inventory = window.inventory;
            }
        } catch (e) {
            console.log('Could not load inventory from main app');
        }
    }
    
    // Set admin name if available
    const adminName = sessionStorage.getItem('adminName') || 'Guest';
    if (document.getElementById('adminName')) {
        document.getElementById('adminName').textContent = adminName;
    }
}

// Load inventory data
function loadInventory() {
    // In a real app, this would be an API call
    // For now, we'll use mock data or load from localStorage
    const productSelect = document.getElementById('productSelect');
    if (!productSelect) return;
    
    productSelect.innerHTML = '<option value="">-- Select a product --</option>';
    
    // If we have inventory data, populate the dropdown
    if (inventory && inventory.length > 0) {
        inventory.forEach(product => {
            const option = document.createElement('option');
            option.value = product.id || product._id;
            option.textContent = `${product.name} (${product.sku}) - RM ${product.unitCost?.toFixed(2) || '0.00'}`;
            option.dataset.price = product.unitCost || 0;
            productSelect.appendChild(option);
        });
    } else {
        // Add some sample products if no inventory exists
        const sampleProducts = [
            { id: '1', name: 'Product A', sku: 'PROD-A', unitCost: 10.50 },
            { id: '2', name: 'Product B', sku: 'PROD-B', unitCost: 15.75 },
            { id: '3', name: 'Product C', sku: 'PROD-C', unitCost: 8.25 }
        ];
        
        sampleProducts.forEach(product => {
            const option = document.createElement('option');
            option.value = product.id;
            option.textContent = `${product.name} (${product.sku}) - RM ${product.unitCost.toFixed(2)}`;
            option.dataset.price = product.unitCost;
            productSelect.appendChild(option);
        });
    }
}

// Bind UI events
function bindPurchaseUI() {
    // Add item button
    const addItemBtn = document.getElementById('addItemBtn');
    if (addItemBtn) {
        addItemBtn.addEventListener('click', addPurchaseItem);
    }
    
    // Save purchase button
    const savePurchaseBtn = document.getElementById('savePurchaseBtn');
    if (savePurchaseBtn) {
        savePurchaseBtn.addEventListener('click', savePurchase);
    }
    
    // Clear purchase button
    const clearPurchaseBtn = document.getElementById('clearPurchaseBtn');
    if (clearPurchaseBtn) {
        clearPurchaseBtn.addEventListener('click', clearPurchaseForm);
    }
    
    // Product selection change
    const productSelect = document.getElementById('productSelect');
    if (productSelect) {
        productSelect.addEventListener('change', function() {
            const selectedOption = this.options[this.selectedIndex];
            if (selectedOption && selectedOption.dataset.price) {
                document.getElementById('purchasePrice').value = selectedOption.dataset.price;
            }
        });
    }
    
    // PDF report button
    const pdfReportBtn = document.getElementById('pdfReportBtn');
    if (pdfReportBtn) {
        pdfReportBtn.addEventListener('click', generatePurchasePDF);
    }
    
    // History filter buttons
    const applyHistoryFilter = document.getElementById('applyHistoryFilter');
    if (applyHistoryFilter) {
        applyHistoryFilter.addEventListener('click', applyHistoryFilter);
    }
    
    const clearHistoryFilter = document.getElementById('clearHistoryFilter');
    if (clearHistoryFilter) {
        clearHistoryFilter.addEventListener('click', clearHistoryFilter);
    }
}

// Add item to purchase list
function addPurchaseItem() {
    const productSelect = document.getElementById('productSelect');
    const quantityInput = document.getElementById('purchaseQuantity');
    const priceInput = document.getElementById('purchasePrice');
    
    if (!productSelect || !quantityInput || !priceInput) return;
    
    const productId = productSelect.value;
    const productText = productSelect.options[productSelect.selectedIndex].text;
    const quantity = parseInt(quantityInput.value);
    const price = parseFloat(priceInput.value);
    
    if (!productId || quantity <= 0 || price <= 0) {
        alert('Please select a product and enter valid quantity and price');
        return;
    }
    
    // Check if product already in purchase items
    const existingItemIndex = purchaseItems.findIndex(item => item.productId === productId);
    
    if (existingItemIndex >= 0) {
        // Update existing item
        purchaseItems[existingItemIndex].quantity += quantity;
        purchaseItems[existingItemIndex].total = purchaseItems[existingItemIndex].quantity * purchaseItems[existingItemIndex].price;
    } else {
        // Add new item
        const newItem = {
            productId,
            productName: productText.split(' - ')[0],
            quantity,
            price,
            total: quantity * price
        };
        purchaseItems.push(newItem);
    }
    
    // Update UI
    renderPurchaseItems();
    
    // Clear form inputs
    quantityInput.value = 1;
    priceInput.value = '';
    productSelect.selectedIndex = 0;
}

// Render purchase items in the list
function renderPurchaseItems() {
    const itemsList = document.getElementById('purchaseItemsList');
    if (!itemsList) return;
    
    itemsList.innerHTML = '';
    
    let totalQuantity = 0;
    let grandTotal = 0;
    
    purchaseItems.forEach((item, index) => {
        totalQuantity += item.quantity;
        grandTotal += item.total;
        
        const itemElement = document.createElement('div');
        itemElement.className = 'purchase-item';
        itemElement.innerHTML = `
            <div>${item.productName}</div>
            <div>${item.quantity}</div>
            <div>RM ${item.price.toFixed(2)}</div>
            <div>RM ${item.total.toFixed(2)}</div>
            <div>
                <button class="danger-btn small-btn" onclick="removePurchaseItem(${index})">🗑️</button>
            </div>
        `;
        itemsList.appendChild(itemElement);
    });
    
    // Update totals
    const totalQuantityEl = document.getElementById('totalQuantity');
    const grandTotalEl = document.getElementById('grandTotal');
    
    if (totalQuantityEl) totalQuantityEl.textContent = totalQuantity;
    if (grandTotalEl) grandTotalEl.textContent = `RM ${grandTotal.toFixed(2)}`;
}

// Remove item from purchase list
function removePurchaseItem(index) {
    purchaseItems.splice(index, 1);
    renderPurchaseItems();
}

// Save purchase
function savePurchase() {
    const purchaseDate = document.getElementById('purchaseDate');
    const supplierName = document.getElementById('supplierName');
    
    if (!purchaseDate || !supplierName || purchaseItems.length === 0) {
        alert('Please fill in all fields and add at least one item');
        return;
    }
    
    const dateValue = purchaseDate.value;
    const supplierValue = supplierName.value;
    
    if (!dateValue || !supplierValue) {
        alert('Please fill in all fields');
        return;
    }
    
    const grandTotal = purchaseItems.reduce((sum, item) => sum + item.total, 0);
    const totalQuantity = purchaseItems.reduce((sum, item) => sum + item.quantity, 0);
    
    const newPurchase = {
        id: 'PUR-' + Date.now(),
        date: dateValue,
        supplier: supplierValue,
        items: [...purchaseItems],
        total: grandTotal,
        totalQuantity: totalQuantity,
        createdAt: new Date().toISOString()
    };
    
    // Add to purchase history
    purchaseHistory.unshift(newPurchase);
    
    // Save to localStorage
    localStorage.setItem('purchaseHistory', JSON.stringify(purchaseHistory));
    
    // Update inventory (in a real app, this would be an API call)
    updateInventoryAfterPurchase(newPurchase);
    
    // Log activity
    logPurchaseActivity(newPurchase);
    
    // Show success message
    alert(`Purchase saved successfully!\nTotal: RM ${grandTotal.toFixed(2)}`);
    
    // Clear form and update UI
    clearPurchaseForm();
    loadPurchaseHistory();
    updatePurchaseSummaryCards();
}

// Update inventory after purchase
function updateInventoryAfterPurchase(purchase) {
    purchase.items.forEach(item => {
        const productIndex = inventory.findIndex(p => (p.id === item.productId) || (p._id === item.productId));
        if (productIndex >= 0) {
            // Update product quantity and cost
            inventory[productIndex].quantity = (inventory[productIndex].quantity || 0) + item.quantity;
            // In a real app, you might want to recalculate average cost
            // For simplicity, we're just updating quantity here
        }
    });
    
    // Save updated inventory
    localStorage.setItem('inventory', JSON.stringify(inventory));
    
    // Also update the main inventory if it exists
    if (window.inventory && Array.isArray(window.inventory)) {
        window.inventory = inventory;
    }
}

// Log purchase activity
function logPurchaseActivity(purchase) {
    const activity = {
        user: sessionStorage.getItem('adminName') || 'System',
        action: `Added purchase: ${purchase.id} from ${purchase.supplier} (RM ${purchase.total.toFixed(2)})`,
        time: new Date().toISOString()
    };
    
    // Save to activity log
    let activityLog = JSON.parse(localStorage.getItem('activityLog') || '[]');
    activityLog.unshift(activity);
    localStorage.setItem('activityLog', JSON.stringify(activityLog));
    
    // Also update the main activity log if it exists
    if (window.activityLog && Array.isArray(window.activityLog)) {
        window.activityLog.unshift(activity);
    }
}

// Clear purchase form
function clearPurchaseForm() {
    purchaseItems = [];
    const purchaseDate = document.getElementById('purchaseDate');
    const supplierName = document.getElementById('supplierName');
    const productSelect = document.getElementById('productSelect');
    const quantityInput = document.getElementById('purchaseQuantity');
    const priceInput = document.getElementById('purchasePrice');
    
    if (purchaseDate) purchaseDate.value = new Date().toISOString().split('T')[0];
    if (supplierName) supplierName.value = '';
    if (productSelect) productSelect.selectedIndex = 0;
    if (quantityInput) quantityInput.value = 1;
    if (priceInput) priceInput.value = '';
    
    renderPurchaseItems();
}

// Load purchase history
function loadPurchaseHistory() {
    const historyList = document.getElementById('purchaseHistoryList');
    if (!historyList) return;
    
    if (purchaseHistory.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🛒</div>
                <h3>No purchases yet</h3>
                <p>Start by adding your first purchase using the form on the left.</p>
            </div>
        `;
        return;
    }
    
    historyList.innerHTML = '';
    
    purchaseHistory.forEach(purchase => {
        const purchaseCard = document.createElement('div');
        purchaseCard.className = 'purchase-card fade-in';
        purchaseCard.innerHTML = `
            <div class="purchase-header">
                <div class="purchase-id">${purchase.id}</div>
                <div class="purchase-date">${new Date(purchase.date).toLocaleDateString()}</div>
            </div>
            <div class="purchase-details">
                <div><strong>Supplier:</strong> ${purchase.supplier}</div>
                <div><strong>Items:</strong> ${purchase.items.length}</div>
                <div><strong>Total Quantity:</strong> ${purchase.totalQuantity}</div>
                <div class="purchase-total">RM ${purchase.total.toFixed(2)}</div>
            </div>
            <div style="margin-top: 10px;">
                <button class="primary-btn small-btn" onclick="viewPurchaseDetails('${purchase.id}')">👁️ View Details</button>
                <button class="secondary-btn small-btn" onclick="generatePurchaseInvoice('${purchase.id}')">🧾 Generate Invoice</button>
            </div>
        `;
        historyList.appendChild(purchaseCard);
    });
}

// View purchase details
function viewPurchaseDetails(purchaseId) {
    const purchase = purchaseHistory.find(p => p.id === purchaseId);
    if (!purchase) return;
    
    let detailsHtml = `
        <h3>Purchase Details: ${purchase.id}</h3>
        <p><strong>Date:</strong> ${new Date(purchase.date).toLocaleDateString()}</p>
        <p><strong>Supplier:</strong> ${purchase.supplier}</p>
        <table style="width: 100%; margin: 15px 0; border-collapse: collapse;">
            <thead>
                <tr style="background: var(--primary-color); color: white;">
                    <th style="padding: 10px; text-align: left;">Product</th>
                    <th style="padding: 10px; text-align: center;">Quantity</th>
                    <th style="padding: 10px; text-align: right;">Unit Price</th>
                    <th style="padding: 10px; text-align: right;">Total</th>
                </tr>
            </thead>
            <tbody>
        `;
    
    purchase.items.forEach(item => {
        detailsHtml += `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${item.productName}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color); text-align: center;">${item.quantity}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color); text-align: right;">RM ${item.price.toFixed(2)}</td>
                <td style="padding: 8px; border-bottom: 1px solid var(--border-color); text-align: right;">RM ${item.total.toFixed(2)}</td>
            </tr>
        `;
    });
    
    detailsHtml += `
            </tbody>
            <tfoot>
                <tr>
                    <td colspan="3" style="padding: 8px; text-align: right; font-weight: bold;">Grand Total:</td>
                    <td style="padding: 8px; text-align: right; font-weight: bold;">RM ${purchase.total.toFixed(2)}</td>
                </tr>
            </tfoot>
        </table>
    `;
    
    // Create a modal for better display
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 1000;
    `;
    
    const modalContent = document.createElement('div');
    modalContent.style.cssText = `
        background: white;
        padding: 20px;
        border-radius: 10px;
        max-width: 90%;
        max-height: 90%;
        overflow: auto;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
    `;
    
    modalContent.innerHTML = detailsHtml + `
        <div style="text-align: center; margin-top: 20px;">
            <button onclick="this.closest('div').parentElement.remove()" class="primary-btn">Close</button>
        </div>
    `;
    
    modal.appendChild(modalContent);
    document.body.appendChild(modal);
    
    // Close modal when clicking outside
    modal.addEventListener('click', function(e) {
        if (e.target === modal) {
            modal.remove();
        }
    });
}

// Apply history filter
function applyHistoryFilter() {
    const startDate = document.getElementById('historyStartDate');
    const endDate = document.getElementById('historyEndDate');
    
    if (!startDate || !endDate) return;
    
    const startDateValue = startDate.value;
    const endDateValue = endDate.value;
    
    let filteredHistory = purchaseHistory;
    
    if (startDateValue) {
        filteredHistory = filteredHistory.filter(p => p.date >= startDateValue);
    }
    
    if (endDateValue) {
        filteredHistory = filteredHistory.filter(p => p.date <= endDateValue);
    }
    
    // Update UI with filtered history
    const historyList = document.getElementById('purchaseHistoryList');
    if (!historyList) return;
    
    historyList.innerHTML = '';
    
    if (filteredHistory.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <h3>No purchases found</h3>
                <p>No purchases match your filter criteria.</p>
            </div>
        `;
        return;
    }
    
    filteredHistory.forEach(purchase => {
        const purchaseCard = document.createElement('div');
        purchaseCard.className = 'purchase-card fade-in';
        purchaseCard.innerHTML = `
            <div class="purchase-header">
                <div class="purchase-id">${purchase.id}</div>
                <div class="purchase-date">${new Date(purchase.date).toLocaleDateString()}</div>
            </div>
            <div class="purchase-details">
                <div><strong>Supplier:</strong> ${purchase.supplier}</div>
                <div><strong>Items:</strong> ${purchase.items.length}</div>
                <div><strong>Total Quantity:</strong> ${purchase.totalQuantity}</div>
                <div class="purchase-total">RM ${purchase.total.toFixed(2)}</div>
            </div>
            <div style="margin-top: 10px;">
                <button class="primary-btn small-btn" onclick="viewPurchaseDetails('${purchase.id}')">👁️ View Details</button>
                <button class="secondary-btn small-btn" onclick="generatePurchaseInvoice('${purchase.id}')">🧾 Generate Invoice</button>
            </div>
        `;
        historyList.appendChild(purchaseCard);
    });
}

// Clear history filter
function clearHistoryFilter() {
    const startDate = document.getElementById('historyStartDate');
    const endDate = document.getElementById('historyEndDate');
    
    if (startDate) startDate.value = '';
    if (endDate) endDate.value = '';
    
    loadPurchaseHistory();
}

// Update purchase summary cards
function updatePurchaseSummaryCards() {
    const totalPurchase = purchaseHistory.reduce((sum, purchase) => sum + purchase.total, 0);
    const totalItems = purchaseHistory.reduce((sum, purchase) => sum + purchase.totalQuantity, 0);
    
    // Calculate monthly purchases
    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const monthlyPurchases = purchaseHistory.filter(p => {
        const purchaseDate = new Date(p.date);
        return purchaseDate.getMonth() === currentMonth && purchaseDate.getFullYear() === currentYear;
    }).length;
    
    // Calculate average purchase
    const avgPurchase = purchaseHistory.length > 0 ? totalPurchase / purchaseHistory.length : 0;
    
    // Update cards
    const cardTotalPurchase = document.getElementById('cardTotalPurchase');
    const cardMonthlyPurchases = document.getElementById('cardMonthlyPurchases');
    const cardAvgPurchase = document.getElementById('cardAvgPurchase');
    const cardTotalItems = document.getElementById('cardTotalItems');
    
    if (cardTotalPurchase) cardTotalPurchase.textContent = `RM ${totalPurchase.toFixed(2)}`;
    if (cardMonthlyPurchases) cardMonthlyPurchases.textContent = monthlyPurchases;
    if (cardAvgPurchase) cardAvgPurchase.textContent = `RM ${avgPurchase.toFixed(2)}`;
    if (cardTotalItems) cardTotalItems.textContent = totalItems;
}

// Generate PDF purchase report
function generatePurchasePDF() {
    if (purchaseHistory.length === 0) {
        alert('No purchase data available to generate report');
        return;
    }
    
    // In a real app, this would connect to a backend service to generate the PDF
    // For now, we'll create a simple PDF using jsPDF (if available) or show a message
    
    if (typeof jsPDF !== 'undefined') {
        // Use jsPDF to generate a simple PDF
        const doc = new jsPDF();
        
        // Add title
        doc.setFontSize(20);
        doc.text('Purchase Report', 105, 15, { align: 'center' });
        
        // Add date
        doc.setFontSize(12);
        doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 105, 25, { align: 'center' });
        
        // Add table headers
        doc.setFontSize(10);
        doc.text('Purchase ID', 20, 40);
        doc.text('Date', 60, 40);
        doc.text('Supplier', 90, 40);
        doc.text('Total (RM)', 140, 40);
        
        let yPosition = 50;
        
        // Add purchase data
        purchaseHistory.forEach(purchase => {
            if (yPosition > 270) {
                doc.addPage();
                yPosition = 20;
            }
            
            doc.text(purchase.id, 20, yPosition);
            doc.text(new Date(purchase.date).toLocaleDateString(), 60, yPosition);
            doc.text(purchase.supplier, 90, yPosition);
            doc.text(purchase.total.toFixed(2), 140, yPosition);
            
            yPosition += 7;
        });
        
        // Add summary
        yPosition += 10;
        doc.setFontSize(12);
        doc.text(`Total Purchases: ${purchaseHistory.length}`, 20, yPosition);
        doc.text(`Total Amount: RM ${purchaseHistory.reduce((sum, p) => sum + p.total, 0).toFixed(2)}`, 20, yPosition + 7);
        
        // Save the PDF
        doc.save('purchase_report.pdf');
    } else {
        // If jsPDF is not available, show a message
        alert('PDF Purchase Report generation would be implemented here.\nIn a real application, this would connect to a backend service to generate the PDF.');
        
        // Simulate API call
        setTimeout(() => {
            alert('PDF Purchase Report generated successfully!');
        }, 1000);
    }
}

// Generate purchase invoice for a specific purchase
function generatePurchaseInvoice(purchaseId) {
    const purchase = purchaseHistory.find(p => p.id === purchaseId);
    if (!purchase) return;
    
    // In a real app, this would be an API call to generate an invoice PDF
    // For now, we'll use jsPDF if available or show a message
    
    if (typeof jsPDF !== 'undefined') {
        const doc = new jsPDF();
        
        // Add company header
        doc.setFontSize(20);
        doc.text('L&B Company', 105, 20, { align: 'center' });
        
        doc.setFontSize(12);
        doc.text('Jalan Mawar 8, Taman Bukit Beruang Permai, Melaka', 105, 30, { align: 'center' });
        doc.text('Phone: 01133127622 | Email: lbcompany@gmail.com', 105, 37, { align: 'center' });
        
        // Add invoice title
        doc.setFontSize(16);
        doc.text('PURCHASE INVOICE', 105, 50, { align: 'center' });
        
        // Add invoice details
        doc.setFontSize(10);
        doc.text(`Invoice Number: ${purchase.id}`, 20, 65);
        doc.text(`Date: ${new Date(purchase.date).toLocaleDateString()}`, 20, 72);
        doc.text(`Supplier: ${purchase.supplier}`, 20, 79);
        
        // Add table headers
        doc.text('Product', 20, 95);
        doc.text('Quantity', 100, 95);
        doc.text('Unit Price', 130, 95);
        doc.text('Total', 170, 95);
        
        // Add line
        doc.line(20, 97, 190, 97);
        
        let yPosition = 105;
        
        // Add items
        purchase.items.forEach(item => {
            doc.text(item.productName, 20, yPosition);
            doc.text(item.quantity.toString(), 100, yPosition);
            doc.text(`RM ${item.price.toFixed(2)}`, 130, yPosition);
            doc.text(`RM ${item.total.toFixed(2)}`, 170, yPosition);
            yPosition += 7;
        });
        
        // Add total
        yPosition += 10;
        doc.setFontSize(12);
        doc.text('Grand Total:', 130, yPosition);
        doc.text(`RM ${purchase.total.toFixed(2)}`, 170, yPosition);
        
        // Add footer
        yPosition += 20;
        doc.setFontSize(10);
        doc.text('Thank you for your business!', 105, yPosition, { align: 'center' });
        
        // Save the PDF
        doc.save(`invoice_${purchase.id}.pdf`);
    } else {
        alert(`Generating invoice for purchase ${purchaseId}...\n\nIn a real application, this would generate a professional invoice PDF.`);
        
        // Simulate API call
        setTimeout(() => {
            alert(`Invoice for ${purchaseId} generated successfully!`);
        }, 1000);
    }
}

// Tooltip function for cards
function showCardTooltip(message) {
    // Simple alert for now, can be enhanced with a proper tooltip library
    // alert(message);
}

// Expose functions to global scope for onclick handlers
window.removePurchaseItem = removePurchaseItem;
window.viewPurchaseDetails = viewPurchaseDetails;
window.generatePurchaseInvoice = generatePurchaseInvoice;
window.showCardTooltip = showCardTooltip;
