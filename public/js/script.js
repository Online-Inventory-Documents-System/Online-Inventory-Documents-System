// public/js/script.js
// Complete client-side script for Online Inventory & Documents System

const API_BASE = window.location.hostname.includes('localhost')
  ? "http://localhost:3000/api"
  : "https://online-inventory-documents-system-olzt.onrender.com/api";

// Utilities
const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));
const showMsg = (el, text, color = 'red') => { if (!el) return; el.textContent = text; el.style.color = color; };
const escapeHtml = (s) => s ? String(s).replace(/[&<>\"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"\'":'&#39;' }[c])) : '';
const getUsername = () => sessionStorage.getItem('adminName') || 'Guest';

let inventory = [];
let activityLog = [];
let documents = [];
let purchases = [];
let sales = [];
let folders = [];
let currentFolder = 'root';
let companyInfo = {};
const currentPage = window.location.pathname.split('/').pop();

// Pagination variables
let currentPageNumber = 1;
let itemsPerPage = 10;
let totalPages = 1;
let filteredInventory = [];

// Total net profit - UPDATED: Changed from totalNetProfit to totalNetProfit
let totalNetProfit = 0;

// State management for user authentication
let isAuthenticated = false;

// Function to check login status
const checkLoginStatus = () => {
    const token = sessionStorage.getItem('authToken');
    const adminName = sessionStorage.getItem('adminName');
    isAuthenticated = !!token;

    const authArea = qs('#authArea');
    const userDisplay = qs('#userDisplay');

    if (isAuthenticated && authArea && userDisplay) {
        authArea.innerHTML = `<button class="btn btn-outline-light" onclick="logout()">Logout</button>`;
        userDisplay.textContent = `Logged in as: ${adminName || 'Admin'}`;
    } else if (authArea) {
        authArea.innerHTML = `<button class="btn btn-primary" onclick="openLoginModal()">Login</button>`;
        userDisplay.textContent = `Logged in as: Guest`;
    }

    // Redirect logic for non-login pages
    if (!isAuthenticated && currentPage !== 'login.html') {
        window.location.href = 'login.html';
    } else if (isAuthenticated && currentPage === 'login.html') {
        // Redirect logged-in users away from the login page
        window.location.href = 'index.html';
    }

    // Call fetchInitialData only if authenticated and not on login page
    if (isAuthenticated && currentPage !== 'login.html') {
        fetchInitialData();
    }
};

// Call checkLoginStatus on script load
checkLoginStatus();


// --- API Functions ---

const fetchData = async (endpoint, options = {}) => {
    const token = sessionStorage.getItem('authToken');
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers: headers,
        });

        if (response.status === 401) {
            // Token expired or invalid
            console.warn('Authentication failed. Redirecting to login.');
            logout();
            return null; // Stop further processing
        }

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status} - ${errorText}`);
        }

        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            return response.json();
        } else {
            // Handle non-JSON responses (like text or blob)
            return response;
        }

    } catch (error) {
        console.error("Fetch error:", error);
        showMsg(qs('#messageArea'), `API Error: ${error.message}`, 'red');
        return null;
    }
};

const fetchInitialData = async () => {
    await Promise.all([
        fetchInventory(),
        fetchActivityLog(),
        fetchDocuments(),
        fetchPurchases(),
        fetchSales(),
        fetchFolders(),
        fetchCompanyInfo()
    ]);
};

// --- Authentication ---

window.openLoginModal = () => {
    const loginModal = new bootstrap.Modal(qs('#loginModal'));
    loginModal.show();
    showMsg(qs('#loginMessage'), '', 'black');
};

window.closeLoginModal = () => {
    const loginModal = bootstrap.Modal.getInstance(qs('#loginModal'));
    if (loginModal) loginModal.hide();
};

window.login = async () => {
    const username = qs('#username').value.trim();
    const password = qs('#password').value.trim();
    const messageEl = qs('#loginMessage');

    if (!username || !password) {
        showMsg(messageEl, 'Please enter both username and password.', 'red');
        return;
    }

    const data = await fetchData('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });

    if (data && data.token && data.adminName) {
        sessionStorage.setItem('authToken', data.token);
        sessionStorage.setItem('adminName', data.adminName);
        isAuthenticated = true;
        closeLoginModal();
        // Redirect to index.html if login was successful
        if (currentPage === 'login.html') {
            window.location.href = 'index.html';
        } else {
            // If already on index, just refresh data and UI
            checkLoginStatus();
            fetchInitialData();
        }
    } else {
        const msg = data && data.message ? data.message : 'Invalid credentials or connection error.';
        showMsg(messageEl, msg, 'red');
    }
};

window.logout = () => {
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('adminName');
    isAuthenticated = false;
    // Clear local data if needed
    inventory = [];
    activityLog = [];
    documents = [];
    purchases = [];
    sales = [];
    folders = [];
    currentFolder = 'root';

    checkLoginStatus();
    // Redirect to login page
    window.location.href = 'login.html';
};


// --- Inventory Management ---

const fetchInventory = async (page = 1, limit = 10, search = '', sortField = 'productName', sortOrder = 'asc') => {
    if (!isAuthenticated) return;
    currentPageNumber = page;
    itemsPerPage = limit;

    const endpoint = `/inventory?page=${page}&limit=${limit}&search=${encodeURIComponent(search)}&sortField=${sortField}&sortOrder=${sortOrder}`;
    const data = await fetchData(endpoint);

    if (data && data.inventory) {
        inventory = data.inventory;
        totalPages = data.totalPages;
        renderInventoryTable();
        renderPagination();
    }
};

window.openNewProductModal = () => {
    qs('#newProductName').value = '';
    qs('#newProductDescription').value = '';
    qs('#newProductQuantity').value = '';
    qs('#newProductUnitCost').value = '';
    qs('#newProductUnitPrice').value = '';
    qs('#newProductMessage').textContent = '';
    qs('#newProductModalLabel').textContent = 'Add New Product';
    qs('#saveNewProductBtn').onclick = saveNewProduct;

    const modal = new bootstrap.Modal(qs('#newProductModal'));
    modal.show();
};

window.closeNewProductModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#newProductModal'));
    if (modal) modal.hide();
};

window.saveNewProduct = async () => {
    const productName = qs('#newProductName').value.trim();
    const productDescription = qs('#newProductDescription').value.trim();
    const quantity = Number(qs('#newProductQuantity').value) || 0;
    const unitCost = Number(qs('#newProductUnitCost').value) || 0;
    const unitPrice = Number(qs('#newProductUnitPrice').value) || 0;
    const messageEl = qs('#newProductMessage');

    if (!productName || quantity < 0 || unitCost < 0 || unitPrice < 0) {
        showMsg(messageEl, 'Please enter a valid product name and non-negative values for quantities/costs/prices.', 'red');
        return;
    }

    const newProduct = { productName, productDescription, quantity, unitCost, unitPrice };

    const data = await fetchData('/inventory', {
        method: 'POST',
        body: JSON.stringify(newProduct)
    });

    if (data && data.product) {
        showMsg(messageEl, 'Product added successfully!', 'green');
        closeNewProductModal();
        fetchInventory(currentPageNumber, itemsPerPage, qs('#inventorySearch').value);
        fetchActivityLog();
    } else {
        const msg = data && data.message ? data.message : 'Failed to add product.';
        showMsg(messageEl, msg, 'red');
    }
};

window.openEditProductModal = (id) => {
    const product = inventory.find(p => p.id === id);
    if (!product) return;

    qs('#editProductId').value = product.id;
    qs('#editProductName').value = product.productName;
    qs('#editProductDescription').value = product.productDescription;
    qs('#editProductQuantity').value = product.quantity;
    qs('#editProductUnitCost').value = product.unitCost;
    qs('#editProductUnitPrice').value = product.unitPrice;
    qs('#editProductMessage').textContent = '';

    const modal = new bootstrap.Modal(qs('#editProductModal'));
    modal.show();
};

window.closeEditProductModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#editProductModal'));
    if (modal) modal.hide();
};

window.saveEditProduct = async () => {
    const id = qs('#editProductId').value;
    const productName = qs('#editProductName').value.trim();
    const productDescription = qs('#editProductDescription').value.trim();
    const quantity = Number(qs('#editProductQuantity').value) || 0;
    const unitCost = Number(qs('#editProductUnitCost').value) || 0;
    const unitPrice = Number(qs('#editProductUnitPrice').value) || 0;
    const messageEl = qs('#editProductMessage');

    if (!productName || quantity < 0 || unitCost < 0 || unitPrice < 0) {
        showMsg(messageEl, 'Please enter a valid product name and non-negative values.', 'red');
        return;
    }

    const updatedProduct = { productName, productDescription, quantity, unitCost, unitPrice };

    const data = await fetchData(`/inventory/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updatedProduct)
    });

    if (data && data.product) {
        showMsg(messageEl, 'Product updated successfully!', 'green');
        closeEditProductModal();
        fetchInventory(currentPageNumber, itemsPerPage, qs('#inventorySearch').value);
        fetchActivityLog();
    } else {
        const msg = data && data.message ? data.message : 'Failed to update product.';
        showMsg(messageEl, msg, 'red');
    }
};

window.deleteProduct = async (id) => {
    if (!confirm('Are you sure you want to delete this product?')) return;

    const data = await fetchData(`/inventory/${id}`, {
        method: 'DELETE'
    });

    if (data && data.success) {
        showMsg(qs('#messageArea'), 'Product deleted successfully!', 'green');
        fetchInventory(currentPageNumber, itemsPerPage, qs('#inventorySearch').value);
        fetchActivityLog();
    } else {
        const msg = data && data.message ? data.message : 'Failed to delete product.';
        showMsg(qs('#messageArea'), msg, 'red');
    }
};

window.renderInventoryTable = () => {
    const tableBody = qs('#inventoryTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    inventory.forEach(product => {
        const row = tableBody.insertRow();
        row.innerHTML = `
            <td>${escapeHtml(product.productName)}</td>
            <td>${escapeHtml(product.productDescription)}</td>
            <td>${product.quantity}</td>
            <td>$${product.unitCost.toFixed(2)}</td>
            <td>$${product.unitPrice.toFixed(2)}</td>
            <td>
                <button class="btn btn-sm btn-info" onclick="openEditProductModal('${product.id}')">Edit</button>
                <button class="btn btn-sm btn-danger" onclick="deleteProduct('${product.id}')">Delete</button>
            </td>
        `;
    });

    // Update stats
    updateInventoryStats();
};

const updateInventoryStats = () => {
    const totalValue = inventory.reduce((sum, p) => sum + (p.quantity * p.unitCost), 0);
    const potentialRevenue = inventory.reduce((sum, p) => sum + (p.quantity * p.unitPrice), 0);

    const totalValueEl = qs('#totalInventoryValue');
    const potentialRevenueEl = qs('#potentialRevenue');

    if (totalValueEl) totalValueEl.textContent = `$${totalValue.toFixed(2)}`;
    if (potentialRevenueEl) potentialRevenueEl.textContent = `$${potentialRevenue.toFixed(2)}`;
};


// --- Pagination ---

window.searchInventory = () => {
    const search = qs('#inventorySearch').value.trim();
    fetchInventory(1, itemsPerPage, search);
};

window.changeItemsPerPage = () => {
    const newLimit = Number(qs('#itemsPerPage').value);
    itemsPerPage = newLimit;
    fetchInventory(1, itemsPerPage, qs('#inventorySearch').value);
};

window.sortInventory = (field) => {
    const currentSortField = qs('#inventoryTable th.active-sort')?.dataset.sort;
    let currentSortOrder = qs('#inventoryTable th.active-sort')?.dataset.order || 'asc';
    let newSortOrder = 'asc';

    // Clear previous sort classes
    qsa('#inventoryTable th').forEach(th => {
        th.classList.remove('active-sort', 'asc', 'desc');
    });

    if (currentSortField === field) {
        newSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
    }

    // Add new sort classes
    const th = qs(`th[data-sort="${field}"]`);
    if (th) {
        th.classList.add('active-sort', newSortOrder);
        th.dataset.order = newSortOrder;
    }

    fetchInventory(currentPageNumber, itemsPerPage, qs('#inventorySearch').value, field, newSortOrder);
};

window.renderPagination = () => {
    const paginationEl = qs('#inventoryPagination');
    if (!paginationEl) return;
    paginationEl.innerHTML = '';

    // Prev button
    paginationEl.innerHTML += `
        <li class="page-item ${currentPageNumber === 1 ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changePage(${currentPageNumber - 1})">Previous</a>
        </li>
    `;

    // Page buttons
    const maxVisiblePages = 5;
    let startPage = Math.max(1, currentPageNumber - Math.floor(maxVisiblePages / 2));
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

    if (endPage - startPage + 1 < maxVisiblePages) {
        startPage = Math.max(1, endPage - maxVisiblePages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
        paginationEl.innerHTML += `
            <li class="page-item ${i === currentPageNumber ? 'active' : ''}">
                <a class="page-link" href="#" onclick="changePage(${i})">${i}</a>
            </li>
        `;
    }

    if (endPage < totalPages) {
         if (endPage < totalPages - 1) {
            paginationEl.innerHTML += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
         }
         if (endPage < totalPages) {
             paginationEl.innerHTML += `
                <li class="page-item">
                    <a class="page-link" href="#" onclick="changePage(${totalPages})">${totalPages}</a>
                </li>
            `;
         }
    }


    // Next button
    paginationEl.innerHTML += `
        <li class="page-item ${currentPageNumber === totalPages ? 'disabled' : ''}">
            <a class="page-link" href="#" onclick="changePage(${currentPageNumber + 1})">Next</a>
        </li>
    `;

    // Page info
    const pageInfoEl = qs('#pageInfo');
    if (pageInfoEl) {
        pageInfoEl.textContent = `Page ${currentPageNumber} of ${totalPages} (Showing ${inventory.length} items)`;
    }
};

window.changePage = (page) => {
    if (page < 1 || page > totalPages || page === currentPageNumber) return;

    const search = qs('#inventorySearch').value.trim();
    const sortField = qs('#inventoryTable th.active-sort')?.dataset.sort || 'productName';
    const sortOrder = qs('#inventoryTable th.active-sort')?.dataset.order || 'asc';

    fetchInventory(page, itemsPerPage, search, sortField, sortOrder);
};


// --- Activity Log ---

const fetchActivityLog = async () => {
    if (!isAuthenticated) return;
    const data = await fetchData('/log');

    if (data && data.log) {
        activityLog = data.log;
        renderActivityLog();
    }
};

const renderActivityLog = () => {
    const logBody = qs('#activityLogBody');
    if (!logBody) return;
    logBody.innerHTML = '';

    activityLog.slice(0, 50).forEach(log => { // Limit to 50 for performance
        const row = logBody.insertRow();
        const date = new Date(log.timestamp).toLocaleString();
        row.innerHTML = `
            <td>${date}</td>
            <td>${escapeHtml(log.action)}</td>
            <td>${escapeHtml(log.user || 'System')}</td>
        `;
    });
};

window.openActivityLogModal = () => {
    // Re-render the full log in the modal if needed
    // Currently, the log is rendered on the main page.
    const modal = new bootstrap.Modal(qs('#activityLogModal'));
    modal.show();
};

window.closeActivityLogModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#activityLogModal'));
    if (modal) modal.hide();
};


// --- Documents Management (Folders/Files) ---

const fetchFolders = async () => {
    if (!isAuthenticated) return;
    const data = await fetchData('/documents/folders');
    if (data && data.folders) {
        folders = data.folders;
        renderFolderStructure();
        fetchDocuments(); // Fetch documents once folders are loaded
    }
};

const fetchDocuments = async () => {
    if (!isAuthenticated) return;
    const data = await fetchData(`/documents/files?folder=${currentFolder}`);

    if (data && data.documents) {
        documents = data.documents;
        renderDocumentsList();
    }
};

window.createFolder = async () => {
    const folderName = prompt('Enter new folder name:');
    if (!folderName || folderName.trim() === '') return;

    const data = await fetchData('/documents/folders', {
        method: 'POST',
        body: JSON.stringify({ folderName: folderName.trim(), parentFolder: currentFolder })
    });

    if (data && data.folder) {
        showMsg(qs('#documentsMessageArea'), 'Folder created successfully!', 'green');
        fetchFolders();
    } else {
        const msg = data && data.message ? data.message : 'Failed to create folder.';
        showMsg(qs('#documentsMessageArea'), msg, 'red');
    }
};

window.renameFolder = async (folderId) => {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;

    const newName = prompt(`Rename folder "${folder.folderName}":`, folder.folderName);
    if (!newName || newName.trim() === '' || newName.trim() === folder.folderName) return;

    const data = await fetchData(`/documents/folders/${folderId}`, {
        method: 'PUT',
        body: JSON.stringify({ folderName: newName.trim() })
    });

    if (data && data.folder) {
        showMsg(qs('#documentsMessageArea'), 'Folder renamed successfully!', 'green');
        fetchFolders();
    } else {
        const msg = data && data.message ? data.message : 'Failed to rename folder.';
        showMsg(qs('#documentsMessageArea'), msg, 'red');
    }
};

window.deleteFolder = async (folderId) => {
    if (!confirm('Are you sure you want to delete this folder and all its contents?')) return;

    const data = await fetchData(`/documents/folders/${folderId}`, {
        method: 'DELETE'
    });

    if (data && data.success) {
        showMsg(qs('#documentsMessageArea'), 'Folder deleted successfully!', 'green');
        fetchFolders();
        fetchActivityLog();
    } else {
        const msg = data && data.message ? data.message : 'Failed to delete folder.';
        showMsg(qs('#documentsMessageArea'), msg, 'red');
    }
};

window.navigateToFolder = (folderId = 'root') => {
    currentFolder = folderId;
    renderFolderStructure();
    fetchDocuments();
};

const renderFolderStructure = () => {
    const breadcrumbEl = qs('#documentsBreadcrumb');
    const folderListEl = qs('#folderList');
    if (!breadcrumbEl || !folderListEl) return;

    // Build breadcrumb
    let breadcrumbHtml = `<li class="breadcrumb-item"><a href="#" onclick="navigateToFolder('root')">Root</a></li>`;
    let current = folders.find(f => f.id === currentFolder);
    let path = [];

    // Simple implementation for immediate children of root
    if (currentFolder !== 'root' && current) {
         breadcrumbHtml += `<li class="breadcrumb-item active">${escapeHtml(current.folderName)}</li>`;
    }

    breadcrumbEl.innerHTML = breadcrumbHtml;

    // Render folders
    folderListEl.innerHTML = '';
    const currentFolderId = currentFolder; // Capture currentFolder for filtering
    
    // Add "Up" button if not in root
    if (currentFolderId !== 'root') {
        const parentFolderId = folders.find(f => f.id === currentFolderId)?.parentFolder || 'root';
         folderListEl.innerHTML += `
             <div class="col-6 col-md-4 col-lg-3 mb-3">
                 <div class="card h-100 folder-card text-center" onclick="navigateToFolder('${parentFolderId}')" style="cursor: pointer;">
                     <div class="card-body">
                         <i class="fas fa-level-up-alt fa-3x text-secondary"></i>
                         <h5 class="card-title mt-2">.. (Up)</h5>
                     </div>
                 </div>
             </div>
         `;
    }

    folders.filter(f => f.parentFolder === currentFolderId).forEach(folder => {
        folderListEl.innerHTML += `
            <div class="col-6 col-md-4 col-lg-3 mb-3">
                <div class="card h-100 folder-card">
                    <div class="card-body" onclick="navigateToFolder('${folder.id}')" style="cursor: pointer;">
                        <i class="fas fa-folder fa-3x text-warning"></i>
                        <h5 class="card-title mt-2">${escapeHtml(folder.folderName)}</h5>
                    </div>
                    <div class="card-footer text-center">
                        <button class="btn btn-sm btn-outline-info" onclick="renameFolder('${folder.id}')">Rename</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteFolder('${folder.id}')">Delete</button>
                    </div>
                </div>
            </div>
        `;
    });
};

window.uploadDocument = async () => {
    const fileInput = qs('#documentFile');
    const messageEl = qs('#documentsMessageArea');
    
    if (fileInput.files.length === 0) {
        showMsg(messageEl, 'Please select a file to upload.', 'red');
        return;
    }

    const file = fileInput.files[0];
    const formData = new FormData();
    formData.append('document', file);
    formData.append('folderId', currentFolder);

    // Manually handle fetch for file upload since it's multipart/form-data
    const token = sessionStorage.getItem('authToken');
    const headers = {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    showMsg(messageEl, 'Uploading file, please wait...', 'blue');

    try {
        const response = await fetch(`${API_BASE}/documents/upload`, {
            method: 'POST',
            body: formData, // FormData handles the content-type header
            headers: headers
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! Status: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        if (data && data.document) {
            showMsg(messageEl, `File "${data.document.fileName}" uploaded successfully!`, 'green');
            fileInput.value = ''; // Clear input
            fetchDocuments();
            fetchActivityLog();
        } else {
             showMsg(messageEl, 'File upload failed.', 'red');
        }

    } catch (error) {
        console.error("Upload error:", error);
        showMsg(messageEl, `Upload Error: ${error.message}`, 'red');
    }
};

window.downloadDocument = (docId) => {
    const token = sessionStorage.getItem('authToken');
    if (!token) {
        alert('You must be logged in to download files.');
        return;
    }
    window.open(`${API_BASE}/documents/download/${docId}?token=${token}`, '_blank');
};

window.deleteDocument = async (docId, fileName) => {
    if (!confirm(`Are you sure you want to delete the document "${fileName}"?`)) return;
    
    const data = await fetchData(`/documents/files/${docId}`, {
        method: 'DELETE'
    });

    if (data && data.success) {
        showMsg(qs('#documentsMessageArea'), 'Document deleted successfully!', 'green');
        fetchDocuments();
        fetchActivityLog();
    } else {
        const msg = data && data.message ? data.message : 'Failed to delete document.';
        showMsg(qs('#documentsMessageArea'), msg, 'red');
    }
};

const renderDocumentsList = () => {
    const documentListEl = qs('#documentList');
    if (!documentListEl) return;
    documentListEl.innerHTML = '';

    // Render files
    documents.forEach(doc => {
        const fileIcon = getFileIcon(doc.mimeType);
        documentListEl.innerHTML += `
            <div class="col-6 col-md-4 col-lg-3 mb-3">
                <div class="card h-100 document-card">
                    <div class="card-body text-center">
                        <i class="${fileIcon} fa-3x text-info"></i>
                        <h6 class="card-title mt-2">${escapeHtml(doc.fileName)}</h6>
                        <small class="text-muted">${(doc.fileSize / 1024 / 1024).toFixed(2)} MB</small>
                    </div>
                    <div class="card-footer text-center">
                        <button class="btn btn-sm btn-outline-success" onclick="downloadDocument('${doc.id}')">Download</button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteDocument('${doc.id}', '${escapeHtml(doc.fileName)}')">Delete</button>
                    </div>
                </div>
            </div>
        `;
    });
};

const getFileIcon = (mimeType) => {
    if (mimeType.includes('pdf')) return 'far fa-file-pdf';
    if (mimeType.includes('image')) return 'far fa-file-image';
    if (mimeType.includes('text') || mimeType.includes('javascript')) return 'far fa-file-alt';
    if (mimeType.includes('wordprocessingml')) return 'far fa-file-word';
    if (mimeType.includes('spreadsheetml')) return 'far fa-file-excel';
    if (mimeType.includes('presentationml')) return 'far fa-file-powerpoint';
    if (mimeType.includes('zip') || mimeType.includes('rar')) return 'far fa-file-archive';
    return 'far fa-file';
};

window.openDocumentsModal = () => {
    // This is handled by main document UI on index.html
    // If it were a dedicated modal, this would show it.
};


// --- Purchase Order Management ---

const fetchPurchases = async () => {
    if (!isAuthenticated) return;
    const data = await fetchData('/purchases');
    if (data && data.purchases) {
        purchases = data.purchases;
        renderPurchaseHistory();
    }
};

window.openPurchaseHistoryModal = () => {
    const modal = new bootstrap.Modal(qs('#purchaseHistoryModal'));
    modal.show();
};

window.closePurchaseHistoryModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#purchaseHistoryModal'));
    if (modal) modal.hide();
};

const renderPurchaseHistory = () => {
    const tableBody = qs('#purchaseHistoryTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    purchases.forEach(purchase => {
        const row = tableBody.insertRow();
        const total = purchase.products.reduce((sum, p) => sum + (p.quantity * p.unitCost), 0);
        row.innerHTML = `
            <td>${purchase.purchaseId}</td>
            <td>${new Date(purchase.purchaseDate).toLocaleDateString()}</td>
            <td>${escapeHtml(purchase.supplierName)}</td>
            <td>${purchase.products.length}</td>
            <td>$${total.toFixed(2)}</td>
            <td>
                <button class="btn btn-sm btn-info" onclick="viewPurchaseDetails('${purchase.purchaseId}')">View</button>
                <button class="btn btn-sm btn-secondary" onclick="printAndSavePurchaseInvoice('${purchase.purchaseId}')">Print/Save</button>
                <button class="btn btn-sm btn-danger" onclick="deletePurchase('${purchase.purchaseId}')">Delete</button>
            </td>
        `;
    });
};

window.openNewPurchaseModal = () => {
    qs('#newPurchaseModalLabel').textContent = 'Create New Purchase Order';
    qs('#purchaseSupplierName').value = '';
    qs('#purchaseDate').value = new Date().toISOString().substring(0, 10);
    qs('#purchaseTotalAmount').textContent = '$0.00';
    qs('#purchaseProductList').innerHTML = '';
    qs('#purchaseMessage').textContent = '';
    addPurchaseProductRow(); // Start with one row

    const modal = new bootstrap.Modal(qs('#newPurchaseModal'));
    modal.show();
};

window.closeNewPurchaseModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#newPurchaseModal'));
    if (modal) modal.hide();
};

window.addPurchaseProductRow = () => {
    const listEl = qs('#purchaseProductList');
    const newIndex = listEl.children.length + 1;
    
    const row = document.createElement('div');
    row.className = 'row g-3 mb-3 purchase-product-row';
    row.id = `purchaseRow_${newIndex}`;
    row.innerHTML = `
        <div class="col-md-3">
            <input type="text" class="form-control" id="productName_${newIndex}" placeholder="Product Name">
        </div>
        <div class="col-md-3">
            <input type="text" class="form-control" id="productDescription_${newIndex}" placeholder="Description (Optional)">
        </div>
        <div class="col-md-2">
            <input type="number" class="form-control purchase-calc" id="quantity_${newIndex}" placeholder="Qty" value="1" min="1" oninput="calculatePurchaseTotal()">
        </div>
        <div class="col-md-2">
            <input type="number" class="form-control purchase-calc" id="unitCost_${newIndex}" placeholder="Unit Cost" value="0.00" min="0" step="0.01" oninput="calculatePurchaseTotal()">
        </div>
        <div class="col-md-1 d-flex align-items-center">
            <span class="product-subtotal" id="subtotal_${newIndex}">$0.00</span>
        </div>
        <div class="col-md-1 d-flex align-items-center">
            <button class="btn btn-sm btn-danger" onclick="removePurchaseProductRow(${newIndex})"><i class="fas fa-trash"></i></button>
        </div>
    `;
    listEl.appendChild(row);
    calculatePurchaseTotal();
};

window.removePurchaseProductRow = (index) => {
    const row = qs(`#purchaseRow_${index}`);
    if (row) {
        row.remove();
        calculatePurchaseTotal();
    }
};

window.calculatePurchaseTotal = () => {
    let total = 0;
    qsa('.purchase-product-row').forEach((row, i) => {
        const index = i + 1; // Assuming indices are sequential
        const quantity = Number(qs(`#quantity_${index}`).value) || 0;
        const unitCost = Number(qs(`#unitCost_${index}`).value) || 0;
        const subtotal = quantity * unitCost;
        
        const subtotalEl = qs(`#subtotal_${index}`);
        if (subtotalEl) {
            subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
        }
        total += subtotal;
    });

    qs('#purchaseTotalAmount').textContent = `$${total.toFixed(2)}`;
};

window.savePurchaseOrder = async () => {
    const supplierName = qs('#purchaseSupplierName').value.trim();
    const purchaseDate = qs('#purchaseDate').value;
    const messageEl = qs('#purchaseMessage');
    const productRows = qsa('.purchase-product-row');

    if (!supplierName || !purchaseDate || productRows.length === 0) {
        showMsg(messageEl, 'Please fill in supplier name, date, and at least one product.', 'red');
        return;
    }

    const products = [];
    let isValid = true;
    productRows.forEach((row, i) => {
        const index = i + 1;
        const productName = qs(`#productName_${index}`).value.trim();
        const quantity = Number(qs(`#quantity_${index}`).value) || 0;
        const unitCost = Number(qs(`#unitCost_${index}`).value) || 0;

        if (!productName || quantity <= 0 || unitCost < 0) {
            isValid = false;
        }

        const productDetails = {
            productName: productName,
            productDescription: qs(`#productDescription_${index}`).value.trim(),
            quantity: quantity,
            unitCost: unitCost, // **FIXED SYNTAX ERROR HERE**
            totalCost: quantity * unitCost
        };
        products.push(productDetails);
    });

    if (!isValid) {
        showMsg(messageEl, 'Please ensure all product fields have valid data (Name, Qty > 0, Cost >= 0).', 'red');
        return;
    }

    const purchaseOrder = {
        supplierName,
        purchaseDate,
        products
    };

    const data = await fetchData('/purchases', {
        method: 'POST',
        body: JSON.stringify(purchaseOrder)
    });

    if (data && data.purchase) {
        showMsg(messageEl, `Purchase Order ${data.purchase.purchaseId} saved and inventory updated!`, 'green');
        closeNewPurchaseModal();
        fetchPurchases();
        fetchInventory(currentPageNumber, itemsPerPage, qs('#inventorySearch').value); // Refresh inventory
        fetchActivityLog();
    } else {
        const msg = data && data.message ? data.message : 'Failed to save purchase order.';
        showMsg(messageEl, msg, 'red');
    }
};

window.printAndSavePurchaseInvoice = (purchaseId) => {
    // Simple print function, modern systems would generate a PDF on the server.
    const purchase = purchases.find(p => p.purchaseId === purchaseId);
    if (!purchase) {
        alert('Purchase order not found.');
        return;
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<html><head><title>Purchase Invoice - ${purchase.purchaseId}</title>`);
    printWindow.document.write('<link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">');
    printWindow.document.write('</head><body>');
    
    printWindow.document.write('<div class="container mt-5">');
    printWindow.document.write(`<h1>Purchase Invoice #${purchase.purchaseId}</h1>`);
    printWindow.document.write(`<p><strong>Supplier:</strong> ${escapeHtml(purchase.supplierName)}</p>`);
    printWindow.document.write(`<p><strong>Date:</strong> ${new Date(purchase.purchaseDate).toLocaleDateString()}</p>`);
    
    let totalAmount = 0;
    printWindow.document.write('<table class="table table-bordered">');
    printWindow.document.write('<thead><tr><th>Product Name</th><th>Description</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead>');
    printWindow.document.write('<tbody>');
    purchase.products.forEach(p => {
        const subtotal = p.quantity * p.unitCost;
        totalAmount += subtotal;
        printWindow.document.write(`
            <tr>
                <td>${escapeHtml(p.productName)}</td>
                <td>${escapeHtml(p.productDescription)}</td>
                <td>${p.quantity}</td>
                <td>$${p.unitCost.toFixed(2)}</td>
                <td>$${subtotal.toFixed(2)}</td>
            </tr>
        `);
    });
    printWindow.document.write('</tbody>');
    printWindow.document.write(`<tfoot><tr><td colspan="4" class="text-right"><strong>Total Amount:</strong></td><td><strong>$${totalAmount.toFixed(2)}</strong></td></tr></tfoot>`);
    printWindow.document.write('</table>');
    
    printWindow.document.write('</div>');
    printWindow.document.write('<script>window.onload = function() { window.print(); };</script>');
    printWindow.document.write('</body></html>');
    printWindow.document.close();
};

window.deletePurchase = async (purchaseId) => {
    if (!confirm(`Are you sure you want to delete Purchase Order ${purchaseId}? This will reverse the inventory changes.`)) return;

    const data = await fetchData(`/purchases/${purchaseId}`, {
        method: 'DELETE'
    });

    if (data && data.success) {
        showMsg(qs('#messageArea'), `Purchase Order ${purchaseId} deleted and inventory reversed successfully!`, 'green');
        fetchPurchases();
        fetchInventory(currentPageNumber, itemsPerPage, qs('#inventorySearch').value); // Refresh inventory
        fetchActivityLog();
    } else {
        const msg = data && data.message ? data.message : 'Failed to delete purchase order.';
        showMsg(qs('#messageArea'), msg, 'red');
    }
};

window.viewPurchaseDetails = (purchaseId) => {
    const purchase = purchases.find(p => p.purchaseId === purchaseId);
    if (!purchase) return;

    qs('#purchaseDetailsId').textContent = purchase.purchaseId;
    qs('#purchaseDetailsSupplier').textContent = escapeHtml(purchase.supplierName);
    qs('#purchaseDetailsDate').textContent = new Date(purchase.purchaseDate).toLocaleDateString();

    const detailBody = qs('#purchaseDetailsTableBody');
    detailBody.innerHTML = '';
    let grandTotal = 0;

    purchase.products.forEach(p => {
        const total = p.quantity * p.unitCost;
        grandTotal += total;
        const row = detailBody.insertRow();
        row.innerHTML = `
            <td>${escapeHtml(p.productName)}</td>
            <td>${escapeHtml(p.productDescription)}</td>
            <td>${p.quantity}</td>
            <td>$${p.unitCost.toFixed(2)}</td>
            <td>$${total.toFixed(2)}</td>
        `;
    });

    qs('#purchaseDetailsGrandTotal').textContent = `$${grandTotal.toFixed(2)}`;

    const modal = new bootstrap.Modal(qs('#purchaseDetailsModal'));
    modal.show();
};

window.closePurchaseDetailsModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#purchaseDetailsModal'));
    if (modal) modal.hide();
};


// --- Sales Order Management ---

const fetchSales = async () => {
    if (!isAuthenticated) return;
    const data = await fetchData('/sales');
    if (data && data.sales) {
        sales = data.sales;
        renderSalesHistory();
    }
};

window.openSalesHistoryModal = () => {
    const modal = new bootstrap.Modal(qs('#salesHistoryModal'));
    modal.show();
};

window.closeSalesHistoryModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#salesHistoryModal'));
    if (modal) modal.hide();
};

const renderSalesHistory = () => {
    const tableBody = qs('#salesHistoryTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    let netProfit = 0;

    sales.forEach(sale => {
        const totalRevenue = sale.products.reduce((sum, p) => sum + (p.quantity * p.unitPrice), 0);
        const totalCost = sale.products.reduce((sum, p) => sum + (p.quantity * p.unitCost), 0);
        const profit = totalRevenue - totalCost;
        netProfit += profit;

        const row = tableBody.insertRow();
        row.innerHTML = `
            <td>${sale.salesId}</td>
            <td>${new Date(sale.salesDate).toLocaleDateString()}</td>
            <td>${escapeHtml(sale.customerName)}</td>
            <td>${sale.products.length}</td>
            <td>$${totalRevenue.toFixed(2)}</td>
            <td>$${profit.toFixed(2)}</td>
            <td>
                <button class="btn btn-sm btn-info" onclick="viewSalesDetails('${sale.salesId}')">View</button>
                <button class="btn btn-sm btn-secondary" onclick="printAndSaveSalesInvoice('${sale.salesId}')">Print/Save</button>
                <button class="btn btn-sm btn-danger" onclick="deleteSales('${sale.salesId}')">Delete</button>
            </td>
        `;
    });

    totalNetProfit = netProfit;
    const profitEl = qs('#totalNetProfit');
    if (profitEl) profitEl.textContent = `$${totalNetProfit.toFixed(2)}`;
};

window.openNewSalesModal = () => {
    qs('#newSalesModalLabel').textContent = 'Create New Sales Order';
    qs('#salesCustomerName').value = '';
    qs('#salesDate').value = new Date().toISOString().substring(0, 10);
    qs('#salesTotalAmount').textContent = '$0.00';
    qs('#salesProductList').innerHTML = '';
    qs('#salesMessage').textContent = '';
    addSalesProductRow(); // Start with one row

    const modal = new bootstrap.Modal(qs('#newSalesModal'));
    modal.show();
};

window.closeNewSalesModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#newSalesModal'));
    if (modal) modal.hide();
};

window.addSalesProductRow = () => {
    const listEl = qs('#salesProductList');
    const newIndex = listEl.children.length + 1;
    
    const row = document.createElement('div');
    row.className = 'row g-3 mb-3 sales-product-row';
    row.id = `salesRow_${newIndex}`;
    row.innerHTML = `
        <div class="col-md-3">
            <input type="text" class="form-control" id="salesProductName_${newIndex}" placeholder="Product Name">
        </div>
        <div class="col-md-3">
            <input type="text" class="form-control" id="salesProductDescription_${newIndex}" placeholder="Description (Optional)">
        </div>
        <div class="col-md-2">
            <input type="number" class="form-control sales-calc" id="salesQuantity_${newIndex}" placeholder="Qty" value="1" min="1" oninput="calculateSalesTotal()">
        </div>
        <div class="col-md-2">
            <input type="number" class="form-control sales-calc" id="salesUnitPrice_${newIndex}" placeholder="Unit Price" value="0.00" min="0" step="0.01" oninput="calculateSalesTotal()">
        </div>
        <div class="col-md-1 d-flex align-items-center">
            <span class="product-subtotal" id="salesSubtotal_${newIndex}">$0.00</span>
        </div>
        <div class="col-md-1 d-flex align-items-center">
            <button class="btn btn-sm btn-danger" onclick="removeSalesProductRow(${newIndex})"><i class="fas fa-trash"></i></button>
        </div>
    `;
    listEl.appendChild(row);
    calculateSalesTotal();
};

window.removeSalesProductRow = (index) => {
    const row = qs(`#salesRow_${index}`);
    if (row) {
        row.remove();
        calculateSalesTotal();
    }
};

window.calculateSalesTotal = () => {
    let total = 0;
    qsa('.sales-product-row').forEach((row, i) => {
        const index = i + 1; // Assuming indices are sequential
        const quantity = Number(qs(`#salesQuantity_${index}`).value) || 0;
        const unitPrice = Number(qs(`#salesUnitPrice_${index}`).value) || 0;
        const subtotal = quantity * unitPrice;
        
        const subtotalEl = qs(`#salesSubtotal_${index}`);
        if (subtotalEl) {
            subtotalEl.textContent = `$${subtotal.toFixed(2)}`;
        }
        total += subtotal;
    });

    qs('#salesTotalAmount').textContent = `$${total.toFixed(2)}`;
};

window.saveSalesOrder = async () => {
    const customerName = qs('#salesCustomerName').value.trim();
    const salesDate = qs('#salesDate').value;
    const messageEl = qs('#salesMessage');
    const productRows = qsa('.sales-product-row');

    if (!customerName || !salesDate || productRows.length === 0) {
        showMsg(messageEl, 'Please fill in customer name, date, and at least one product.', 'red');
        return;
    }

    const products = [];
    let isValid = true;
    productRows.forEach((row, i) => {
        const index = i + 1;
        const productName = qs(`#salesProductName_${index}`).value.trim();
        const quantity = Number(qs(`#salesQuantity_${index}`).value) || 0;
        const unitPrice = Number(qs(`#salesUnitPrice_${index}`).value) || 0;

        if (!productName || quantity <= 0 || unitPrice < 0) {
            isValid = false;
        }

        const productDetails = {
            productName: productName,
            productDescription: qs(`#salesProductDescription_${index}`).value.trim(),
            quantity: quantity,
            unitPrice: unitPrice, // **FIXED SYNTAX ERROR HERE** (for unitPrice in sales)
            totalPrice: quantity * unitPrice
        };
        products.push(productDetails);
    });

    if (!isValid) {
        showMsg(messageEl, 'Please ensure all product fields have valid data (Name, Qty > 0, Price >= 0).', 'red');
        return;
    }

    const salesOrder = {
        customerName,
        salesDate,
        products
    };

    const data = await fetchData('/sales', {
        method: 'POST',
        body: JSON.stringify(salesOrder)
    });

    if (data && data.sale) {
        showMsg(messageEl, `Sales Order ${data.sale.salesId} saved and inventory updated!`, 'green');
        closeNewSalesModal();
        fetchSales();
        fetchInventory(currentPageNumber, itemsPerPage, qs('#inventorySearch').value); // Refresh inventory
        fetchActivityLog();
    } else {
        const msg = data && data.message ? data.message : 'Failed to save sales order. (Check inventory stock)';
        showMsg(messageEl, msg, 'red');
    }
};

window.printAndSaveSalesInvoice = (salesId) => {
    // Simple print function, modern systems would generate a PDF on the server.
    const sale = sales.find(s => s.salesId === salesId);
    if (!sale) {
        alert('Sales order not found.');
        return;
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`<html><head><title>Sales Invoice - ${sale.salesId}</title>`);
    printWindow.document.write('<link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css">');
    printWindow.document.write('</head><body>');
    
    printWindow.document.write('<div class="container mt-5">');
    printWindow.document.write(`<h1>Sales Invoice #${sale.salesId}</h1>`);
    printWindow.document.write(`<p><strong>Customer:</strong> ${escapeHtml(sale.customerName)}</p>`);
    printWindow.document.write(`<p><strong>Date:</strong> ${new Date(sale.salesDate).toLocaleDateString()}</p>`);
    
    let totalRevenue = 0;
    printWindow.document.write('<table class="table table-bordered">');
    printWindow.document.write('<thead><tr><th>Product Name</th><th>Description</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>');
    printWindow.document.write('<tbody>');
    sale.products.forEach(p => {
        const subtotal = p.quantity * p.unitPrice;
        totalRevenue += subtotal;
        printWindow.document.write(`
            <tr>
                <td>${escapeHtml(p.productName)}</td>
                <td>${escapeHtml(p.productDescription)}</td>
                <td>${p.quantity}</td>
                <td>$${p.unitPrice.toFixed(2)}</td>
                <td>$${subtotal.toFixed(2)}</td>
            </tr>
        `);
    });
    printWindow.document.write('</tbody>');
    printWindow.document.write(`<tfoot><tr><td colspan="4" class="text-right"><strong>Total Revenue:</strong></td><td><strong>$${totalRevenue.toFixed(2)}</strong></td></tr></tfoot>`);
    printWindow.document.write('</table>');
    
    printWindow.document.write('</div>');
    printWindow.document.write('<script>window.onload = function() { window.print(); };</script>');
    printWindow.document.write('</body></html>');
    printWindow.document.close();
};

window.deleteSales = async (salesId) => {
    if (!confirm(`Are you sure you want to delete Sales Order ${salesId}? This will reverse the inventory changes.`)) return;

    const data = await fetchData(`/sales/${salesId}`, {
        method: 'DELETE'
    });

    if (data && data.success) {
        showMsg(qs('#messageArea'), `Sales Order ${salesId} deleted and inventory reversed successfully!`, 'green');
        fetchSales();
        fetchInventory(currentPageNumber, itemsPerPage, qs('#inventorySearch').value); // Refresh inventory
        fetchActivityLog();
    } else {
        const msg = data && data.message ? data.message : 'Failed to delete sales order.';
        showMsg(qs('#messageArea'), msg, 'red');
    }
};

window.viewSalesDetails = (salesId) => {
    const sale = sales.find(s => s.salesId === salesId);
    if (!sale) return;

    qs('#salesDetailsId').textContent = sale.salesId;
    qs('#salesDetailsCustomer').textContent = escapeHtml(sale.customerName);
    qs('#salesDetailsDate').textContent = new Date(sale.salesDate).toLocaleDateString();

    const detailBody = qs('#salesDetailsTableBody');
    detailBody.innerHTML = '';
    let grandTotal = 0;
    let netProfit = 0;

    sale.products.forEach(p => {
        const revenue = p.quantity * p.unitPrice;
        const cost = p.quantity * p.unitCost;
        const profit = revenue - cost;
        grandTotal += revenue;
        netProfit += profit;
        const row = detailBody.insertRow();
        row.innerHTML = `
            <td>${escapeHtml(p.productName)}</td>
            <td>${escapeHtml(p.productDescription)}</td>
            <td>${p.quantity}</td>
            <td>$${p.unitPrice.toFixed(2)}</td>
            <td>$${revenue.toFixed(2)}</td>
            <td>$${profit.toFixed(2)}</td>
        `;
    });

    qs('#salesDetailsGrandTotal').textContent = `$${grandTotal.toFixed(2)}`;
    qs('#salesDetailsNetProfit').textContent = `$${netProfit.toFixed(2)}`;


    const modal = new bootstrap.Modal(qs('#salesDetailsModal'));
    modal.show();
};

window.closeSalesDetailsModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#salesDetailsModal'));
    if (modal) modal.hide();
};


// --- Reporting ---

window.openReportModal = () => {
    qs('#reportType').value = 'sales_summary';
    selectReportType();
    const modal = new bootstrap.Modal(qs('#reportModal'));
    modal.show();
};

window.selectReportType = () => {
    const type = qs('#reportType').value;
    const dateRangeDiv = qs('#reportDateRange');
    const specificFieldDiv = qs('#reportSpecificField');

    // Reset visibility
    dateRangeDiv.classList.add('d-none');
    specificFieldDiv.classList.add('d-none');
    qs('#reportStartDate').value = '';
    qs('#reportEndDate').value = '';
    qs('#reportSpecificFieldInput').value = '';

    // Set fields based on type
    if (type.includes('_summary') || type === 'profit_loss') {
        dateRangeDiv.classList.remove('d-none');
    } else if (type === 'inventory_stock') {
        // No extra fields needed
    } else if (type === 'top_products') {
        dateRangeDiv.classList.remove('d-none');
        specificFieldDiv.classList.remove('d-none');
        qs('#reportSpecificFieldLabel').textContent = 'Limit (e.g., 10):';
    }
};

window.generateSelectedReport = async () => {
    const type = qs('#reportType').value;
    const startDate = qs('#reportStartDate').value;
    const endDate = qs('#reportEndDate').value;
    const specificField = qs('#reportSpecificFieldInput').value;
    const messageEl = qs('#reportMessageArea');
    const resultEl = qs('#reportResults');

    let endpoint = `/reports/${type}?`;
    
    if (startDate) endpoint += `startDate=${startDate}&`;
    if (endDate) endpoint += `endDate=${endDate}&`;
    if (specificField) endpoint += `limit=${specificField}&`; // Only used for top_products

    showMsg(messageEl, 'Generating report...', 'blue');
    resultEl.innerHTML = '<div class="text-center"><div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div></div>';

    const data = await fetchData(endpoint, { method: 'GET' });

    if (data && data.report) {
        showMsg(messageEl, 'Report generated successfully.', 'green');
        renderReportResults(type, data.report);
    } else {
        const msg = data && data.message ? data.message : 'Failed to generate report.';
        showMsg(messageEl, msg, 'red');
        resultEl.innerHTML = '';
    }
};

const renderReportResults = (type, reportData) => {
    const resultEl = qs('#reportResults');
    resultEl.innerHTML = '';
    let html = `<h4>${formatReportTitle(type)} Report</h4>`;

    if (type === 'inventory_stock') {
        html += '<table class="table table-striped"><thead><tr><th>Product Name</th><th>Qty in Stock</th><th>Unit Cost</th><th>Total Value</th></tr></thead><tbody>';
        reportData.forEach(p => {
            html += `<tr><td>${escapeHtml(p.productName)}</td><td>${p.quantity}</td><td>$${p.unitCost.toFixed(2)}</td><td>$${(p.quantity * p.unitCost).toFixed(2)}</td></tr>`;
        });
        html += '</tbody></table>';
    } else if (type.includes('_summary')) {
        html += `<p>Total Orders: ${reportData.totalOrders}</p>`;
        html += `<p>Total Amount: $${reportData.totalAmount.toFixed(2)}</p>`;
        html += `<p>Total Items Sold/Purchased: ${reportData.totalItems}</p>`;
    } else if (type === 'profit_loss') {
        html += `<p>Total Revenue: $${reportData.totalRevenue.toFixed(2)}</p>`;
        html += `<p>Total Cost of Goods Sold (COGS): $${reportData.totalCost.toFixed(2)}</p>`;
        html += `<p><strong>Net Profit: $${reportData.netProfit.toFixed(2)}</strong></p>`;
    } else if (type === 'top_products') {
        html += '<table class="table table-striped"><thead><tr><th>Rank</th><th>Product Name</th><th>Total Quantity Sold</th><th>Total Revenue</th></tr></thead><tbody>';
        reportData.forEach((p, index) => {
            html += `<tr><td>${index + 1}</td><td>${escapeHtml(p.productName)}</td><td>${p.totalQuantity}</td><td>$${p.totalRevenue.toFixed(2)}</td></tr>`;
        });
        html += '</tbody></table>';
    } else {
        html += '<pre>' + JSON.stringify(reportData, null, 2) + '</pre>';
    }

    resultEl.innerHTML = html;
};

const formatReportTitle = (type) => {
    return type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};


// --- Statements/Invoice Preview ---

// Placeholder/Example functions for statements/invoices
window.openStatementsModal = () => {
    const modal = new bootstrap.Modal(qs('#statementsModal'));
    modal.show();
    // Assuming initial tab is set to purchase history
    switchTab('purchase-statement');
};

window.switchTab = (tabName) => {
    // Logic to switch the active tab content
    qsa('.statement-tab-content').forEach(el => el.classList.add('d-none'));
    qsa('.statement-tab-link').forEach(el => el.classList.remove('active'));

    qs(`#${tabName}`).classList.remove('d-none');
    qs(`#link-${tabName}`).classList.add('active');

    if (tabName === 'purchase-statement') {
        renderPurchaseHistoryForStatements();
    } else if (tabName === 'sales-statement') {
        renderSalesHistoryForStatements();
    }
};

// Re-render functions for the statement modal (simpler tables)
const renderPurchaseHistoryForStatements = () => {
     const tableBody = qs('#statementPurchaseTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    purchases.forEach(purchase => {
        const total = purchase.products.reduce((sum, p) => sum + (p.quantity * p.unitCost), 0);
        const row = tableBody.insertRow();
        row.innerHTML = `
            <td>${purchase.purchaseId}</td>
            <td>${new Date(purchase.purchaseDate).toLocaleDateString()}</td>
            <td>${escapeHtml(purchase.supplierName)}</td>
            <td>$${total.toFixed(2)}</td>
            <td>
                <button class="btn btn-sm btn-info" onclick="previewDocument('purchase', '${purchase.purchaseId}')">Preview Invoice</button>
            </td>
        `;
    });
};

const renderSalesHistoryForStatements = () => {
    const tableBody = qs('#statementSalesTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';

    sales.forEach(sale => {
        const total = sale.products.reduce((sum, p) => sum + (p.quantity * p.unitPrice), 0);
        const row = tableBody.insertRow();
        row.innerHTML = `
            <td>${sale.salesId}</td>
            <td>${new Date(sale.salesDate).toLocaleDateString()}</td>
            <td>${escapeHtml(sale.customerName)}</td>
            <td>$${total.toFixed(2)}</td>
            <td>
                <button class="btn btn-sm btn-info" onclick="previewDocument('sales', '${sale.salesId}')">Preview Invoice</button>
            </td>
        `;
    });
};

window.previewDocument = (type, id) => {
    let documentData = null;
    let title = '';

    if (type === 'purchase') {
        documentData = purchases.find(p => p.purchaseId === id);
        title = `Purchase Invoice #${id}`;
    } else if (type === 'sales') {
        documentData = sales.find(s => s.salesId === id);
        title = `Sales Invoice #${id}`;
    }

    if (!documentData) {
        alert('Document not found.');
        return;
    }

    qs('#previewModalLabel').textContent = title;
    const previewBody = qs('#previewDocumentBody');
    previewBody.innerHTML = '';
    
    // Simple HTML structure for preview
    let html = `<div class="p-3">`;
    html += `<h4>${title}</h4>`;
    
    if (type === 'purchase') {
        html += `<p><strong>Supplier:</strong> ${escapeHtml(documentData.supplierName)}</p>`;
        html += `<p><strong>Date:</strong> ${new Date(documentData.purchaseDate).toLocaleDateString()}</p>`;
        
        let totalAmount = 0;
        html += '<table class="table table-sm table-bordered mt-3"><thead><tr><th>Product</th><th>Qty</th><th>Unit Cost</th><th>Total</th></tr></thead><tbody>';
        documentData.products.forEach(p => {
            const subtotal = p.quantity * p.unitCost;
            totalAmount += subtotal;
            html += `<tr><td>${escapeHtml(p.productName)}</td><td>${p.quantity}</td><td>$${p.unitCost.toFixed(2)}</td><td>$${subtotal.toFixed(2)}</td></tr>`;
        });
        html += `</tbody><tfoot><tr><td colspan="3" class="text-right"><strong>Total:</strong></td><td><strong>$${totalAmount.toFixed(2)}</strong></td></tr></tfoot></table>`;
        
    } else if (type === 'sales') {
        html += `<p><strong>Customer:</strong> ${escapeHtml(documentData.customerName)}</p>`;
        html += `<p><strong>Date:</strong> ${new Date(documentData.salesDate).toLocaleDateString()}</p>`;
        
        let totalRevenue = 0;
        html += '<table class="table table-sm table-bordered mt-3"><thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead><tbody>';
        documentData.products.forEach(p => {
            const subtotal = p.quantity * p.unitPrice;
            totalRevenue += subtotal;
            html += `<tr><td>${escapeHtml(p.productName)}</td><td>${p.quantity}</td><td>$${p.unitPrice.toFixed(2)}</td><td>$${subtotal.toFixed(2)}</td></tr>`;
        });
        html += `</tbody><tfoot><tr><td colspan="3" class="text-right"><strong>Total:</strong></td><td><strong>$${totalRevenue.toFixed(2)}</strong></td></tr></tfoot></table>`;
    }
    
    html += `</div>`;
    previewBody.innerHTML = html;

    const modal = new bootstrap.Modal(qs('#previewModal'));
    modal.show();
};

window.closePreviewModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#previewModal'));
    if (modal) modal.hide();
};


// --- Company Information ---

const fetchCompanyInfo = async () => {
    if (!isAuthenticated) return;
    const data = await fetchData('/company/info');
    if (data && data.companyInfo) {
        companyInfo = data.companyInfo;
        renderCompanyInfo();
    }
};

const renderCompanyInfo = () => {
    const nameEl = qs('#companyNameDisplay');
    const addressEl = qs('#companyAddressDisplay');
    const phoneEl = qs('#companyPhoneDisplay');
    const emailEl = qs('#companyEmailDisplay');

    if (nameEl) nameEl.textContent = escapeHtml(companyInfo.companyName || 'N/A');
    if (addressEl) addressEl.textContent = escapeHtml(companyInfo.address || 'N/A');
    if (phoneEl) phoneEl.textContent = escapeHtml(companyInfo.phone || 'N/A');
    if (emailEl) emailEl.textContent = escapeHtml(companyInfo.email || 'N/A');
};

window.openCompanyInfoModal = () => {
    qs('#infoCompanyName').value = companyInfo.companyName || '';
    qs('#infoAddress').value = companyInfo.address || '';
    qs('#infoPhone').value = companyInfo.phone || '';
    qs('#infoEmail').value = companyInfo.email || '';
    qs('#companyInfoMessage').textContent = '';

    const modal = new bootstrap.Modal(qs('#companyInfoModal'));
    modal.show();
};

window.closeCompanyInfoModal = () => {
    const modal = bootstrap.Modal.getInstance(qs('#companyInfoModal'));
    if (modal) modal.hide();
};

window.updateCompanyInfo = async () => {
    const companyName = qs('#infoCompanyName').value.trim();
    const address = qs('#infoAddress').value.trim();
    const phone = qs('#infoPhone').value.trim();
    const email = qs('#infoEmail').value.trim();
    const messageEl = qs('#companyInfoMessage');

    if (!companyName) {
        showMsg(messageEl, 'Company Name is required.', 'red');
        return;
    }

    const updatedInfo = { companyName, address, phone, email };

    const data = await fetchData('/company/info', {
        method: 'PUT',
        body: JSON.stringify(updatedInfo)
    });

    if (data && data.companyInfo) {
        showMsg(messageEl, 'Company information updated successfully!', 'green');
        companyInfo = data.companyInfo;
        renderCompanyInfo();
        closeCompanyInfoModal();
        fetchActivityLog();
    } else {
        const msg = data && data.message ? data.message : 'Failed to update company information.';
        showMsg(messageEl, msg, 'red');
    }
};

// --- Initialization & Event Listeners ---

window.addEventListener('load', () => {
    // Check login status is already called on script load
    
    // Attach search and filter handlers if elements exist on the page
    if (qs('#inventorySearch')) {
        qs('#inventorySearch').addEventListener('input', () => {
            // Debounce or immediate search on input
            searchInventory();
        });
    }

    if (qs('#itemsPerPage')) {
        qs('#itemsPerPage').addEventListener('change', changeItemsPerPage);
    }
    
    // Attach sort handlers to table headers
    qsa('#inventoryTable th[data-sort]').forEach(th => {
        th.addEventListener('click', () => sortInventory(th.dataset.sort));
    });

    // Initial fetch of data if authenticated
    // Note: checkLoginStatus calls fetchInitialData if authenticated and not on login page
});

// Expose functions globally for HTML event handlers
window.checkLoginStatus = checkLoginStatus;
window.openLoginModal = openLoginModal;
window.closeLoginModal = closeLoginModal;
window.login = login;
window.logout = logout;

window.openNewProductModal = openNewProductModal;
window.closeNewProductModal = closeNewProductModal;
window.saveNewProduct = saveNewProduct;
window.openEditProductModal = openEditProductModal;
window.closeEditProductModal = closeEditProductModal;
window.saveEditProduct = saveEditProduct;
window.deleteProduct = deleteProduct;
window.searchInventory = searchInventory;
window.changeItemsPerPage = changeItemsPerPage;
window.changePage = changePage;
window.sortInventory = sortInventory;
window.openActivityLogModal = openActivityLogModal;
window.closeActivityLogModal = closeActivityLogModal;

window.uploadDocument = uploadDocument;
window.downloadDocument = downloadDocument;
window.deleteDocument = deleteDocument;
window.openDocumentsModal = openDocumentsModal;

window.openPurchaseHistoryModal = openPurchaseHistoryModal;
window.closePurchaseHistoryModal = closePurchaseHistoryModal;
window.openNewPurchaseModal = openNewPurchaseModal;
window.closeNewPurchaseModal = closeNewPurchaseModal;
window.addPurchaseProductRow = addPurchaseProductRow;
window.removePurchaseProductRow = removePurchaseProductRow;
window.calculatePurchaseTotal = calculatePurchaseTotal;
window.savePurchaseOrder = savePurchaseOrder;
window.printAndSavePurchaseInvoice = printAndSavePurchaseInvoice;
window.deletePurchase = deletePurchase;
window.viewPurchaseDetails = viewPurchaseDetails;
window.closePurchaseDetailsModal = closePurchaseDetailsModal;

window.openSalesHistoryModal = openSalesHistoryModal;
window.closeSalesHistoryModal = closeSalesHistoryModal;
window.openNewSalesModal = openNewSalesModal;
window.closeNewSalesModal = closeNewSalesModal;
window.addSalesProductRow = addSalesProductRow;
window.removeSalesProductRow = removeSalesProductRow;
window.calculateSalesTotal = calculateSalesTotal;
window.saveSalesOrder = saveSalesOrder;
window.printAndSaveSalesInvoice = printAndSaveSalesInvoice;
window.deleteSales = deleteSales;
window.viewSalesDetails = viewSalesDetails;
window.closeSalesDetailsModal = closeSalesDetailsModal;

window.openReportModal = openReportModal;
window.selectReportType = selectReportType;
window.generateSelectedReport = generateSelectedReport;

window.openStatementsModal = openStatementsModal;
window.switchTab = switchTab;
window.previewDocument = previewDocument;
window.closePreviewModal = closePreviewModal;

window.createFolder = createFolder;
window.renameFolder = renameFolder;
window.deleteFolder = deleteFolder;
window.navigateToFolder = navigateToFolder;

window.updateCompanyInfo = updateCompanyInfo;
window.openCompanyInfoModal = openCompanyInfoModal;
window.closeCompanyInfoModal = closeCompanyInfoModal;

window.login = login;
