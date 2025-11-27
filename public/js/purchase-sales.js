// public/js/purchase-sales.js
// Purchase and Sales functionality for Inventory System

let purchases = [];
let sales = [];
let inventory = [];

// Initialize purchase and sales pages
document.addEventListener('DOMContentLoaded', async () => {
    const currentPage = window.location.pathname.split('/').pop();
    
    if (currentPage.includes('purchase')) {
        await fetchInventory();
        await fetchPurchases();
        bindPurchaseUI();
    }
    
    if (currentPage.includes('sales')) {
        await fetchInventory();
        await fetchSales();
        bindSalesUI();
    }
});

// =========================================
// PURCHASE FUNCTIONS
// =========================================

async function fetchPurchases() {
    try {
        const res = await apiFetch(`${API_BASE}/purchases`);
        if (!res.ok) throw new Error('Failed to fetch purchases');
        purchases = await res.json();
        renderPurchases(purchases);
    } catch (err) {
        console.error('Purchase fetch error:', err);
    }
}

function renderPurchases(purchaseList) {
    const list = qs('#purchaseList');
    if (!list) return;
    list.innerHTML = '';
    
    let totalQty = 0;
    let totalAmount = 0;
    
    purchaseList.forEach(purchase => {
        const id = purchase.id || purchase._id;
        const qty = Number(purchase.quantity || 0);
        const unitCost = Number(purchase.unitCost || 0);
        const totalCost = qty * unitCost;
        
        totalQty += qty;
        totalAmount += totalCost;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(purchase.date).toLocaleDateString()}</td>
            <td>${escapeHtml(purchase.invoiceNo || '')}</td>
            <td>${escapeHtml(purchase.supplier || '')}</td>
            <td>${escapeHtml(purchase.sku || '')}</td>
            <td>${escapeHtml(purchase.productName || '')}</td>
            <td>${escapeHtml(purchase.category || '')}</td>
            <td>${qty}</td>
            <td class="money">RM ${unitCost.toFixed(2)}</td>
            <td class="money">RM ${totalCost.toFixed(2)}</td>
            <td class="actions">
                <button class="danger-btn small-btn" onclick="deletePurchase('${id}')">🗑️ Delete</button>
            </td>
        `;
        list.appendChild(tr);
    });
    
    if (qs('#totalPurchaseQty')) qs('#totalPurchaseQty').textContent = totalQty;
    if (qs('#totalPurchaseAmount')) qs('#totalPurchaseAmount').textContent = totalAmount.toFixed(2);
    if (qs('#totalPurchaseTransactions')) qs('#totalPurchaseTransactions').textContent = purchaseList.length;
}

async function addPurchase() {
    const sku = qs('#purchase_sku')?.value?.trim();
    const productName = qs('#purchase_name')?.value?.trim();
    const category = qs('#purchase_category')?.value?.trim();
    const quantity = Number(qs('#purchase_quantity')?.value || 0);
    const unitCost = Number(qs('#purchase_unitCost')?.value || 0);
    const supplier = qs('#purchase_supplier')?.value?.trim();
    const invoiceNo = qs('#purchase_invoiceNo')?.value?.trim();
    
    if (!sku || !productName || !quantity || !unitCost || !supplier) {
        return alert('⚠️ Please fill in all required fields (SKU, Product, Quantity, Unit Cost, Supplier).');
    }
    
    if (!confirm(`Confirm Purchase: ${quantity} x ${productName} from ${supplier} for RM ${(quantity * unitCost).toFixed(2)}?`)) return;
    
    const purchaseData = {
        sku,
        productName,
        category,
        quantity,
        unitCost,
        supplier,
        invoiceNo,
        date: new Date().toISOString()
    };
    
    try {
        const res = await apiFetch(`${API_BASE}/purchases`, {
            method: 'POST',
            body: JSON.stringify(purchaseData)
        });
        
        if (res.ok) {
            // Clear form
            ['#purchase_sku','#purchase_name','#purchase_category','#purchase_quantity',
             '#purchase_unitCost','#purchase_totalCost','#purchase_supplier','#purchase_invoiceNo'].forEach(id => {
                if (qs(id)) qs(id).value = '';
            });
            await fetchPurchases();
            await fetchInventory(); // Refresh inventory to update quantities
            alert('✅ Purchase added successfully!');
        } else {
            const error = await res.json();
            alert('❌ Failed to add purchase: ' + (error.message || 'Unknown error'));
        }
    } catch (e) {
        console.error('Purchase error:', e);
        alert('❌ Server connection error while adding purchase.');
    }
}

async function deletePurchase(id) {
    const purchase = purchases.find(p => String(p.id) === String(id));
    if (!purchase) return;
    
    if (!confirm(`Confirm Delete Purchase: ${purchase.productName} from ${purchase.supplier}?`)) return;
    
    try {
        const res = await apiFetch(`${API_BASE}/purchases/${id}`, { method: 'DELETE' });
        if (res.ok) {
            await fetchPurchases();
            await fetchInventory(); // Refresh inventory
            alert('🗑️ Purchase deleted!');
        } else {
            alert('❌ Failed to delete purchase.');
        }
    } catch (e) {
        console.error('Delete purchase error:', e);
        alert('❌ Server connection error while deleting purchase.');
    }
}

function bindPurchaseUI() {
    qs('#addPurchaseBtn')?.addEventListener('click', addPurchase);
    qs('#purchaseReportBtn')?.addEventListener('click', generatePurchaseReport);
    qs('#purchaseInvoiceBtn')?.addEventListener('click', generatePurchaseInvoice);
    qs('#purchaseHistoryBtn')?.addEventListener('click', showPurchaseHistoryModal);
    
    // Search product functionality
    qs('#purchase_search')?.addEventListener('input', searchProductsForPurchase);
    qs('#purchase_quantity')?.addEventListener('input', calculatePurchaseTotal);
    qs('#purchase_unitCost')?.addEventListener('input', calculatePurchaseTotal);
    
    // Date range and search
    qs('#applyPurchaseDateRangeBtn')?.addEventListener('click', applyPurchaseDateFilter);
    qs('#clearPurchaseDateRangeBtn')?.addEventListener('click', clearPurchaseDateFilter);
    qs('#purchaseSearchInput')?.addEventListener('input', searchPurchases);
    qs('#clearPurchaseSearchBtn')?.addEventListener('click', clearPurchaseSearch);
}

function searchProductsForPurchase() {
    const query = qs('#purchase_search')?.value?.toLowerCase().trim();
    const resultsDiv = qs('#product_search_results');
    if (!resultsDiv) return;
    
    resultsDiv.innerHTML = '';
    resultsDiv.style.display = 'none';
    
    if (!query || query.length < 2) return;
    
    const filtered = inventory.filter(item => 
        (item.name?.toLowerCase().includes(query) || 
         item.sku?.toLowerCase().includes(query)) &&
        item.quantity !== undefined
    );
    
    if (filtered.length > 0) {
        resultsDiv.style.display = 'block';
        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.textContent = `${item.sku} - ${item.name} (Stock: ${item.quantity})`;
            div.onclick = () => selectProductForPurchase(item);
            resultsDiv.appendChild(div);
        });
    }
}

function selectProductForPurchase(item) {
    qs('#purchase_sku').value = item.sku || '';
    qs('#purchase_name').value = item.name || '';
    qs('#purchase_category').value = item.category || '';
    qs('#purchase_unitCost').value = item.unitCost || '0';
    qs('#purchase_search').value = '';
    qs('#product_search_results').innerHTML = '';
    qs('#product_search_results').style.display = 'none';
    qs('#purchase_quantity').focus();
}

function calculatePurchaseTotal() {
    const quantity = Number(qs('#purchase_quantity')?.value || 0);
    const unitCost = Number(qs('#purchase_unitCost')?.value || 0);
    const totalCost = quantity * unitCost;
    if (qs('#purchase_totalCost')) {
        qs('#purchase_totalCost').value = totalCost.toFixed(2);
    }
}

// =========================================
// SALES FUNCTIONS
// =========================================

async function fetchSales() {
    try {
        const res = await apiFetch(`${API_BASE}/sales`);
        if (!res.ok) throw new Error('Failed to fetch sales');
        sales = await res.json();
        renderSales(sales);
    } catch (err) {
        console.error('Sales fetch error:', err);
    }
}

function renderSales(salesList) {
    const list = qs('#salesList');
    if (!list) return;
    list.innerHTML = '';
    
    let totalQty = 0;
    let totalRevenue = 0;
    let totalProfit = 0;
    
    salesList.forEach(sale => {
        const id = sale.id || sale._id;
        const qty = Number(sale.quantity || 0);
        const unitPrice = Number(sale.unitPrice || 0);
        const unitCost = Number(sale.unitCost || 0);
        const totalPrice = qty * unitPrice;
        const profit = (unitPrice - unitCost) * qty;
        
        totalQty += qty;
        totalRevenue += totalPrice;
        totalProfit += profit;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(sale.date).toLocaleDateString()}</td>
            <td>${escapeHtml(sale.invoiceNo || '')}</td>
            <td>${escapeHtml(sale.customer || '')}</td>
            <td>${escapeHtml(sale.sku || '')}</td>
            <td>${escapeHtml(sale.productName || '')}</td>
            <td>${escapeHtml(sale.category || '')}</td>
            <td>${qty}</td>
            <td class="money">RM ${unitPrice.toFixed(2)}</td>
            <td class="money">RM ${totalPrice.toFixed(2)}</td>
            <td class="money">RM ${profit.toFixed(2)}</td>
            <td class="actions">
                <button class="danger-btn small-btn" onclick="deleteSale('${id}')">🗑️ Delete</button>
            </td>
        `;
        list.appendChild(tr);
    });
    
    if (qs('#totalSalesQty')) qs('#totalSalesQty').textContent = totalQty;
    if (qs('#totalSalesRevenue')) qs('#totalSalesRevenue').textContent = totalRevenue.toFixed(2);
    if (qs('#totalSalesProfit')) qs('#totalSalesProfit').textContent = totalProfit.toFixed(2);
    if (qs('#totalSalesTransactions')) qs('#totalSalesTransactions').textContent = salesList.length;
}

async function addSale() {
    const sku = qs('#sales_sku')?.value?.trim();
    const productName = qs('#sales_name')?.value?.trim();
    const category = qs('#sales_category')?.value?.trim();
    const availableQty = Number(qs('#sales_availableQty')?.value || 0);
    const quantity = Number(qs('#sales_quantity')?.value || 0);
    const unitPrice = Number(qs('#sales_unitPrice')?.value || 0);
    const customer = qs('#sales_customer')?.value?.trim();
    const invoiceNo = qs('#sales_invoiceNo')?.value?.trim();
    
    if (!sku || !productName || !quantity || !unitPrice || !customer) {
        return alert('⚠️ Please fill in all required fields (SKU, Product, Quantity, Unit Price, Customer).');
    }
    
    if (quantity > availableQty) {
        return alert(`❌ Insufficient stock! Available: ${availableQty}, Requested: ${quantity}`);
    }
    
    if (!confirm(`Confirm Sale: ${quantity} x ${productName} to ${customer} for RM ${(quantity * unitPrice).toFixed(2)}?`)) return;
    
    const saleData = {
        sku,
        productName,
        category,
        quantity,
        unitPrice,
        customer,
        invoiceNo,
        date: new Date().toISOString()
    };
    
    try {
        const res = await apiFetch(`${API_BASE}/sales`, {
            method: 'POST',
            body: JSON.stringify(saleData)
        });
        
        if (res.ok) {
            // Clear form
            ['#sales_sku','#sales_name','#sales_category','#sales_availableQty','#sales_quantity',
             '#sales_unitPrice','#sales_totalPrice','#sales_customer','#sales_invoiceNo'].forEach(id => {
                if (qs(id)) qs(id).value = '';
            });
            await fetchSales();
            await fetchInventory(); // Refresh inventory to update quantities
            alert('✅ Sale added successfully!');
        } else {
            const error = await res.json();
            alert('❌ Failed to add sale: ' + (error.message || 'Unknown error'));
        }
    } catch (e) {
        console.error('Sale error:', e);
        alert('❌ Server connection error while adding sale.');
    }
}

async function deleteSale(id) {
    const sale = sales.find(s => String(s.id) === String(id));
    if (!sale) return;
    
    if (!confirm(`Confirm Delete Sale: ${sale.productName} to ${sale.customer}?`)) return;
    
    try {
        const res = await apiFetch(`${API_BASE}/sales/${id}`, { method: 'DELETE' });
        if (res.ok) {
            await fetchSales();
            await fetchInventory(); // Refresh inventory
            alert('🗑️ Sale deleted!');
        } else {
            alert('❌ Failed to delete sale.');
        }
    } catch (e) {
        console.error('Delete sale error:', e);
        alert('❌ Server connection error while deleting sale.');
    }
}

function bindSalesUI() {
    qs('#addSalesBtn')?.addEventListener('click', addSale);
    qs('#salesReportBtn')?.addEventListener('click', generateSalesReport);
    qs('#salesInvoiceBtn')?.addEventListener('click', generateSalesInvoice);
    qs('#salesHistoryBtn')?.addEventListener('click', showSalesHistoryModal);
    
    // Search product functionality
    qs('#sales_search')?.addEventListener('input', searchProductsForSales);
    qs('#sales_quantity')?.addEventListener('input', calculateSalesTotal);
    qs('#sales_unitPrice')?.addEventListener('input', calculateSalesTotal);
    
    // Date range and search
    qs('#applySalesDateRangeBtn')?.addEventListener('click', applySalesDateFilter);
    qs('#clearSalesDateRangeBtn')?.addEventListener('click', clearSalesDateFilter);
    qs('#salesSearchInput')?.addEventListener('input', searchSales);
    qs('#clearSalesSearchBtn')?.addEventListener('click', clearSalesSearch);
}

function searchProductsForSales() {
    const query = qs('#sales_search')?.value?.toLowerCase().trim();
    const resultsDiv = qs('#sales_search_results');
    if (!resultsDiv) return;
    
    resultsDiv.innerHTML = '';
    resultsDiv.style.display = 'none';
    
    if (!query || query.length < 2) return;
    
    const filtered = inventory.filter(item => 
        (item.name?.toLowerCase().includes(query) || 
         item.sku?.toLowerCase().includes(query)) &&
        item.quantity !== undefined &&
        item.quantity > 0 // Only show products with stock
    );
    
    if (filtered.length > 0) {
        resultsDiv.style.display = 'block';
        filtered.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.textContent = `${item.sku} - ${item.name} (Stock: ${item.quantity})`;
            div.onclick = () => selectProductForSale(item);
            resultsDiv.appendChild(div);
        });
    }
}

function selectProductForSale(item) {
    qs('#sales_sku').value = item.sku || '';
    qs('#sales_name').value = item.name || '';
    qs('#sales_category').value = item.category || '';
    qs('#sales_availableQty').value = item.quantity || '0';
    qs('#sales_unitPrice').value = item.unitPrice || '0';
    qs('#sales_search').value = '';
    qs('#sales_search_results').innerHTML = '';
    qs('#sales_search_results').style.display = 'none';
    qs('#sales_quantity').focus();
}

function calculateSalesTotal() {
    const quantity = Number(qs('#sales_quantity')?.value || 0);
    const unitPrice = Number(qs('#sales_unitPrice')?.value || 0);
    const totalPrice = quantity * unitPrice;
    if (qs('#sales_totalPrice')) {
        qs('#sales_totalPrice').value = totalPrice.toFixed(2);
    }
}

// =========================================
// COMMON FUNCTIONS
// =========================================

// Filter functions for purchase and sales
function applyPurchaseDateFilter() {
    const startDate = qs('#purchaseStartDate')?.value;
    const endDate = qs('#purchaseEndDate')?.value;
    filterPurchasesByDate(startDate, endDate);
}

function clearPurchaseDateFilter() {
    if (qs('#purchaseStartDate')) qs('#purchaseStartDate').value = '';
    if (qs('#purchaseEndDate')) qs('#purchaseEndDate').value = '';
    renderPurchases(purchases);
}

function applySalesDateFilter() {
    const startDate = qs('#salesStartDate')?.value;
    const endDate = qs('#salesEndDate')?.value;
    filterSalesByDate(startDate, endDate);
}

function clearSalesDateFilter() {
    if (qs('#salesStartDate')) qs('#salesStartDate').value = '';
    if (qs('#salesEndDate')) qs('#salesEndDate').value = '';
    renderSales(sales);
}

function filterPurchasesByDate(startDate, endDate) {
    if (!startDate && !endDate) {
        renderPurchases(purchases);
        return;
    }
    
    const filtered = purchases.filter(purchase => {
        const purchaseDate = new Date(purchase.date);
        
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            return purchaseDate >= start && purchaseDate <= end;
        } else if (startDate) {
            const start = new Date(startDate);
            return purchaseDate >= start;
        } else if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            return purchaseDate <= end;
        }
        return true;
    });
    
    renderPurchases(filtered);
}

function filterSalesByDate(startDate, endDate) {
    if (!startDate && !endDate) {
        renderSales(sales);
        return;
    }
    
    const filtered = sales.filter(sale => {
        const saleDate = new Date(sale.date);
        
        if (startDate && endDate) {
            const start = new Date(startDate);
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            return saleDate >= start && saleDate <= end;
        } else if (startDate) {
            const start = new Date(startDate);
            return saleDate >= start;
        } else if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            return saleDate <= end;
        }
        return true;
    });
    
    renderSales(filtered);
}

function searchPurchases() {
    const query = (qs('#purchaseSearchInput')?.value || '').toLowerCase().trim();
    const filtered = purchases.filter(purchase => 
        (purchase.supplier?.toLowerCase().includes(query) ||
         purchase.invoiceNo?.toLowerCase().includes(query) ||
         purchase.productName?.toLowerCase().includes(query) ||
         purchase.sku?.toLowerCase().includes(query))
    );
    renderPurchases(filtered);
}

function searchSales() {
    const query = (qs('#salesSearchInput')?.value || '').toLowerCase().trim();
    const filtered = sales.filter(sale => 
        (sale.customer?.toLowerCase().includes(query) ||
         sale.invoiceNo?.toLowerCase().includes(query) ||
         sale.productName?.toLowerCase().includes(query) ||
         sale.sku?.toLowerCase().includes(query))
    );
    renderSales(filtered);
}

function clearPurchaseSearch() {
    if (qs('#purchaseSearchInput')) qs('#purchaseSearchInput').value = '';
    renderPurchases(purchases);
}

function clearSalesSearch() {
    if (qs('#salesSearchInput')) qs('#salesSearchInput').value = '';
    renderSales(sales);
}

// Modal functions
function showPurchaseHistoryModal() {
    const modal = qs('#purchaseHistoryModal');
    if (modal) {
        modal.style.display = 'block';
        loadPurchaseTransactionHistory();
    }
}

function showSalesHistoryModal() {
    const modal = qs('#salesHistoryModal');
    if (modal) {
        modal.style.display = 'block';
        loadSalesTransactionHistory();
    }
}

// Close modals when clicking X
document.addEventListener('DOMContentLoaded', () => {
    // Purchase modal close
    qs('#purchaseHistoryModal .close')?.addEventListener('click', () => {
        qs('#purchaseHistoryModal').style.display = 'none';
    });
    
    // Sales modal close
    qs('#salesHistoryModal .close')?.addEventListener('click', () => {
        qs('#salesHistoryModal').style.display = 'none';
    });
    
    // Close modals when clicking outside
    window.addEventListener('click', (event) => {
        const purchaseModal = qs('#purchaseHistoryModal');
        const salesModal = qs('#salesHistoryModal');
        
        if (event.target === purchaseModal) {
            purchaseModal.style.display = 'none';
        }
        if (event.target === salesModal) {
            salesModal.style.display = 'none';
        }
    });
});

async function loadPurchaseTransactionHistory() {
    // This would typically fetch aggregated purchase data by month
    // For now, we'll simulate with existing data
    const monthFilter = qs('#purchaseMonthFilter')?.value;
    let filteredPurchases = purchases;
    
    if (monthFilter) {
        const [year, month] = monthFilter.split('-');
        filteredPurchases = purchases.filter(p => {
            const purchaseDate = new Date(p.date);
            return purchaseDate.getFullYear() == year && 
                   purchaseDate.getMonth() + 1 == month;
        });
    }
    
    // Group by date and supplier
    const transactions = {};
    filteredPurchases.forEach(purchase => {
        const date = new Date(purchase.date).toDateString();
        const key = `${date}_${purchase.supplier}`;
        if (!transactions[key]) {
            transactions[key] = {
                date: date,
                supplier: purchase.supplier,
                totalAmount: 0,
                itemsCount: 0
            };
        }
        transactions[key].totalAmount += purchase.quantity * purchase.unitCost;
        transactions[key].itemsCount += 1;
    });
    
    const transactionList = Object.values(transactions);
    renderPurchaseTransactions(transactionList);
}

function renderPurchaseTransactions(transactions) {
    const list = qs('#purchaseTransactionList');
    if (!list) return;
    list.innerHTML = '';
    
    let monthlyTotal = 0;
    
    transactions.forEach(transaction => {
        monthlyTotal += transaction.totalAmount;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${transaction.date}</td>
            <td>${escapeHtml(transaction.supplier)}</td>
            <td class="money">RM ${transaction.totalAmount.toFixed(2)}</td>
            <td>${transaction.itemsCount}</td>
        `;
        list.appendChild(tr);
    });
    
    if (qs('#monthlyPurchaseTotal')) {
        qs('#monthlyPurchaseTotal').textContent = monthlyTotal.toFixed(2);
    }
}

async function loadSalesTransactionHistory() {
    const monthFilter = qs('#salesMonthFilter')?.value;
    let filteredSales = sales;
    
    if (monthFilter) {
        const [year, month] = monthFilter.split('-');
        filteredSales = sales.filter(s => {
            const saleDate = new Date(s.date);
            return saleDate.getFullYear() == year && 
                   saleDate.getMonth() + 1 == month;
        });
    }
    
    // Group by date and customer
    const transactions = {};
    filteredSales.forEach(sale => {
        const date = new Date(sale.date).toDateString();
        const key = `${date}_${sale.customer}`;
        const unitCost = Number(sale.unitCost || 0);
        const unitPrice = Number(sale.unitPrice || 0);
        const profit = (unitPrice - unitCost) * sale.quantity;
        
        if (!transactions[key]) {
            transactions[key] = {
                date: date,
                customer: sale.customer,
                totalRevenue: 0,
                totalProfit: 0,
                itemsCount: 0
            };
        }
        transactions[key].totalRevenue += sale.quantity * unitPrice;
        transactions[key].totalProfit += profit;
        transactions[key].itemsCount += 1;
    });
    
    const transactionList = Object.values(transactions);
    renderSalesTransactions(transactionList);
}

function renderSalesTransactions(transactions) {
    const list = qs('#salesTransactionList');
    if (!list) return;
    list.innerHTML = '';
    
    let monthlyRevenue = 0;
    let monthlyProfit = 0;
    
    transactions.forEach(transaction => {
        monthlyRevenue += transaction.totalRevenue;
        monthlyProfit += transaction.totalProfit;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${transaction.date}</td>
            <td>${escapeHtml(transaction.customer)}</td>
            <td class="money">RM ${transaction.totalRevenue.toFixed(2)}</td>
            <td class="money">RM ${transaction.totalProfit.toFixed(2)}</td>
            <td>${transaction.itemsCount}</td>
        `;
        list.appendChild(tr);
    });
    
    if (qs('#monthlySalesRevenue')) {
        qs('#monthlySalesRevenue').textContent = monthlyRevenue.toFixed(2);
    }
    if (qs('#monthlySalesProfit')) {
        qs('#monthlySalesProfit').textContent = monthlyProfit.toFixed(2);
    }
}

// Report generation functions (to be implemented with server endpoints)
async function generatePurchaseReport() {
    alert('Purchase report generation will be implemented with server endpoints');
    // This would call API endpoint to generate purchase report
}

async function generatePurchaseInvoice() {
    alert('Purchase invoice generation will be implemented with server endpoints');
    // This would call API endpoint to generate purchase invoice
}

async function generateSalesReport() {
    alert('Sales report generation will be implemented with server endpoints');
    // This would call API endpoint to generate sales report
}

async function generateSalesInvoice() {
    alert('Sales invoice generation will be implemented with server endpoints');
    // This would call API endpoint to generate sales invoice
}

// Company information functions
async function loadCompanyInformation() {
    try {
        const res = await apiFetch(`${API_BASE}/company`);
        if (res.ok) {
            const companyInfo = await res.json();
            if (companyInfo) {
                qs('#companyName').value = companyInfo.name || '';
                qs('#companyAddress').value = companyInfo.address || '';
                qs('#companyPhone').value = companyInfo.phone || '';
                qs('#companyEmail').value = companyInfo.email || '';
                qs('#companyTaxId').value = companyInfo.taxId || '';
            }
        }
    } catch (err) {
        console.error('Failed to load company information:', err);
    }
}

async function saveCompanyInformation() {
    const companyData = {
        name: qs('#companyName')?.value?.trim(),
        address: qs('#companyAddress')?.value?.trim(),
        phone: qs('#companyPhone')?.value?.trim(),
        email: qs('#companyEmail')?.value?.trim(),
        taxId: qs('#companyTaxId')?.value?.trim()
    };
    
    if (!companyData.name) {
        return alert('⚠️ Company name is required.');
    }
    
    try {
        const res = await apiFetch(`${API_BASE}/company`, {
            method: 'PUT',
            body: JSON.stringify(companyData)
        });
        
        const msgEl = qs('#companyInfoMessage');
        if (res.ok) {
            showMsg(msgEl, '✅ Company information saved successfully!', 'green');
        } else {
            const error = await res.json();
            showMsg(msgEl, `❌ Failed to save: ${error.message}`, 'red');
        }
    } catch (e) {
        console.error('Save company info error:', e);
        showMsg(qs('#companyInfoMessage'), '❌ Server connection failed.', 'red');
    }
}

// Expose functions to global scope
window.addPurchase = addPurchase;
window.deletePurchase = deletePurchase;
window.addSale = addSale;
window.deleteSale = deleteSale;
window.loadPurchaseTransactionHistory = loadPurchaseTransactionHistory;
window.loadSalesTransactionHistory = loadSalesTransactionHistory;
window.showPurchaseHistoryModal = showPurchaseHistoryModal;
window.showSalesHistoryModal = showSalesHistoryModal;
window.saveCompanyInformation = saveCompanyInformation;
window.loadCompanyInformation = loadCompanyInformation;
