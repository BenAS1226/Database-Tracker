// DOM Elements
const sidebarList = document.getElementById('collection-list');
const activeCollTitle = document.getElementById('active-collection-title');
const collActions = document.getElementById('collection-actions');
const noCollState = document.getElementById('no-collection-state');
const activeCollView = document.getElementById('active-collection-view');

const tableHead = document.getElementById('table-head');
const tableBody = document.getElementById('table-body');

// Modals
const collModal = document.getElementById('collection-modal');
const itemModal = document.getElementById('item-modal');
const dynItemForm = document.getElementById('dynamic-item-form');
const dynFormFields = document.getElementById('dynamic-form-fields');
const fieldsContainer = document.getElementById('fields-container');
const fieldModal = document.getElementById('field-modal');
const fieldForm = document.getElementById('field-form');


// State
let collections = [];
const masterCollectionId = '0683a769-afef-4359-9405-2aced27e87a2';
let activeCollectionId = masterCollectionId;
let currentItems = [];
let currentCalendarDate = new Date();
let currentView = 'table'; // 'table' or 'calendar'
let formulaIdeContext = 'post-creation';
let relationMapCache = {}; // Cache to prevent excessive fetching of target DB titles

// Hierarchy tracking for Nested Databases as explicit fields
let nestedParentItemId = null;
let nestedParentCollectionId = null;
let nestedParentFieldSafeName = null;
let fieldEditOldSafeName = null;


// View State (Grid vs Calendar)
let localCalendarMode = 'month'; // month, week, day
let globalCalendarMode = 'month';

// Sorting State
let currentSortColumn = null;
let currentSortAscending = true;

// Drag & Drop State
let dragSrcEl = null;

// API Helpers
const API_URL = '/api';

// Search State
let currentRowSearchQuery = '';

// --- Search Handler ---
const searchInput = document.getElementById('row-search-input');
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        currentRowSearchQuery = e.target.value.toLowerCase().trim();
        fetchActiveCollectionItems(); // Re-render with local filtering
    });
}

// --- Toast Notifications ---
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    container.appendChild(toast);

    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Initialization & Sidebar ---
async function fetchCollections() {
    try {
        const res = await fetch(`${API_URL}/collections`);
        collections = await res.json();
        renderSidebar();

        // Auto-select first collection if any and none is selected
        if (collections.length > 0 && !activeCollectionId) {
            selectCollection(collections[0].id);
        } else if (collections.length === 0) {
            setupEmptyState();
        } else {
            // Re-select active to trigger UI updates
            selectCollection(activeCollectionId);
        }
    } catch (e) {
        console.error("Failed to load databases:", e);
    }
}

function renderSidebar() {
    sidebarList.innerHTML = '';

    function buildTree(parentId, containerElement, level = 0) {
        // Find all databases that are direct children of the given parent collection
        let children;
        if (parentId === null) {
            children = collections.filter(c => !c.parent_collection_id);
        } else {
            children = collections.filter(c => c.parent_collection_id === parentId);
        }

        if (children.length === 0) return;

        // For root items (Master Database layer), just list them normally but make them act like folders
        if (parentId === null) {
            children.forEach(coll => {
                const details = document.createElement('details');
                details.className = 'sidebar-details';
                // Keep open if this is the master DB containing the active collection
                details.open = activeCollectionId === coll.id || true; // Default open for Master 

                const summary = document.createElement('summary');
                summary.className = `collection-item ${coll.id === activeCollectionId ? 'active' : ''}`;
                summary.innerHTML = `<span class="caret"></span>🗄️ ${escapeHTML(coll.name)}`;
                summary.onclick = (e) => {
                    e.preventDefault(); // Prevent default toggle immediately
                    selectCollection(coll.id); // Load the collection
                    details.open = !details.open; // Manually toggle
                };

                const childrenContainer = document.createElement('div');
                childrenContainer.className = 'sidebar-children';
                childrenContainer.style.paddingLeft = '1rem';

                details.appendChild(summary);
                details.appendChild(childrenContainer);
                containerElement.appendChild(details);

                // Recursively build the tree for this collection's children
                buildTree(coll.id, childrenContainer, level + 1);
            });
        }
        // For nested items, we group them by their parent item (the "Folder" row they belong to)
        else {
            // Group children by `parent_item_id` so we can render Folder headers
            const groupedByItem = {};
            children.forEach(c => {
                const itemKey = c.parent_item_id || 'root';
                if (!groupedByItem[itemKey]) groupedByItem[itemKey] = { title: c.parent_item_title || 'Unnamed Item', children: [] };
                groupedByItem[itemKey].children.push(c);
            });

            // Render each folder group
            for (const [itemId, group] of Object.entries(groupedByItem)) {

                // If the group title is null, these are just directly nested somehow without typical row linkage, just list them
                if (itemId === 'root') {
                    group.children.forEach(coll => {
                        renderCollectionLeaf(coll, containerElement, level);
                    });
                } else {
                    // Render a Folder wrapper
                    const details = document.createElement('details');
                    details.className = 'sidebar-folder-details';
                    // Open the folder if one of its children is active
                    const hasActiveChild = group.children.some(c => c.id === activeCollectionId);
                    details.open = hasActiveChild;

                    const summary = document.createElement('summary');
                    summary.className = 'sidebar-folder-summary';
                    summary.innerHTML = `<span class="caret"></span>📁 ${escapeHTML(group.title)}`;

                    const childrenContainer = document.createElement('div');
                    childrenContainer.className = 'sidebar-children';
                    childrenContainer.style.paddingLeft = '1rem';

                    details.appendChild(summary);
                    details.appendChild(childrenContainer);
                    containerElement.appendChild(details);

                    // Render the databases inside this folder
                    group.children.forEach(coll => {
                        renderCollectionLeaf(coll, childrenContainer, level + 1);
                    });
                }
            }
        }
    }

    function renderCollectionLeaf(coll, container, level) {
        // Determine if this leaf has its own children
        const hasChildren = collections.some(c => c.parent_collection_id === coll.id);

        if (hasChildren) {
            const details = document.createElement('details');
            details.className = 'sidebar-details';
            details.open = activeCollectionId === coll.id || collections.some(c => c.parent_collection_id === coll.id && c.id === activeCollectionId);

            const summary = document.createElement('summary');
            summary.className = `collection-item leaf-node ${coll.id === activeCollectionId ? 'active' : ''}`;
            summary.innerHTML = `<span class="caret"></span>📄 ${escapeHTML(coll.name)}`;
            summary.onclick = (e) => {
                e.preventDefault();
                selectCollection(coll.id);
                details.open = !details.open;
            };

            const childrenContainer = document.createElement('div');
            childrenContainer.className = 'sidebar-children';
            childrenContainer.style.paddingLeft = '1rem';

            details.appendChild(summary);
            details.appendChild(childrenContainer);
            container.appendChild(details);

            buildTree(coll.id, childrenContainer, level + 1);
        } else {
            // Standard leaf, no children
            const li = document.createElement('li');
            li.className = `collection-item leaf-node no-children ${coll.id === activeCollectionId ? 'active' : ''}`;
            li.innerHTML = `<span style="padding-left: 1rem;">📄 ${escapeHTML(coll.name)}</span>`;
            li.onclick = () => selectCollection(coll.id);
            container.appendChild(li);
        }
    }

    // Start building the recursive tree from the root elements
    buildTree(null, sidebarList, 0);

    // Populate Template Dropdown in New Database Modal (Kept from original)
    const templateSelect = document.getElementById('collection-template');
    if (templateSelect) {
        templateSelect.innerHTML = '<option value="">None (Start Blank)</option>';
        collections.forEach(c => {
            let displayName = c.name;
            if (c.parent_item_title) {
                displayName += ` (${c.parent_item_title})`;
            }
            templateSelect.innerHTML += '<option value="' + c.id + '">' + escapeHTML(displayName) + '</option>';
        });
    }
}

// --- Navigation & View Switching ---
function setupEmptyState() {
    activeCollectionId = null;
    currentView = 'table';
    activeCollTitle.textContent = "Select a Database";
    const renameBtn = document.getElementById('rename-collection-btn');
    if (renameBtn) renameBtn.style.display = 'none';
    collActions.style.display = 'none';
    noCollState.style.display = 'block';
    activeCollView.style.display = 'none';
    document.getElementById('global-calendar-view').style.display = 'none';
    renderSidebar();
}

document.getElementById('global-calendar-nav').addEventListener('click', async () => {
    activeCollectionId = null; // No active single collection
    currentView = 'global-calendar';
    renderSidebar();

    activeCollTitle.textContent = "Global Calendar";
    const renameBtn = document.getElementById('rename-collection-btn');
    if (renameBtn) renameBtn.style.display = 'none';
    collActions.style.display = 'none';
    noCollState.style.display = 'none';
    activeCollView.style.display = 'none';
    document.getElementById('global-calendar-view').style.display = 'block';

    await fetchGlobalCalendar();
});

async function selectCollection(id) {
    const sidebar = document.querySelector('.sidebar');
    const mobileOverlay = document.getElementById('mobile-overlay');
    if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        mobileOverlay.classList.remove('active');
    }

    activeCollectionId = id;
    currentView = 'table';
    const coll = collections.find(c => c.id === id);
    if (!coll) return;

    renderSidebar();

    activeCollTitle.textContent = coll.name;
    const renameBtn = document.getElementById('rename-collection-btn');
    if (renameBtn) renameBtn.style.display = 'inline-block';

    collActions.style.display = 'flex';
    noCollState.style.display = 'none';
    activeCollView.style.display = 'block';

    // Show/Hide Calendar Toggle based on schema
    const hasDateField = coll.schema.fields.some(f => f.type === 'DateTime');
    const toggleBtn = document.getElementById('view-toggle-btn');
    if (toggleBtn) {
        toggleBtn.style.display = hasDateField ? 'inline-block' : 'none';
        toggleBtn.textContent = '📅 Calendar View'; // Reset text if it was 'Grid View'
    }

    document.getElementById('global-calendar-view').style.display = 'none';
    document.getElementById('table-view-container').style.display = 'block';
    document.getElementById('calendar-view-container').style.display = 'none';

    if (id === masterCollectionId) {
        document.getElementById('delete-collection-btn').style.display = 'none';
        document.getElementById('rename-collection-btn').style.display = 'none';
        let addBtn = document.getElementById('add-item-btn');
        addBtn.innerHTML = addBtn.innerHTML.replace('New Item', 'New Database');
        addBtn.onclick = () => createCollection();
    } else {
        document.getElementById('delete-collection-btn').style.display = 'inline-block';
        document.getElementById('rename-collection-btn').style.display = 'inline-block';
        let addBtn = document.getElementById('add-item-btn');
        addBtn.innerHTML = addBtn.innerHTML.replace('New Database', 'New Item');
        addBtn.onclick = () => window.openItemModal(null);
    }

    await fetchActiveCollectionItems();
}

// --- Dynamic Table & Calendar Data ---
// Fetches items for the currently selected collection, 
// and pre-loads data for any connected 'Relation' fields 
// so linked item titles can be displayed in the UI instead of raw IDs.
async function fetchActiveCollectionItems() {
    if (!activeCollectionId) return;

    const coll = collections.find(c => c.id === activeCollectionId);
    try {
        const res = await fetch(`${API_URL}/collections/${activeCollectionId}/items`);
        const resData = await res.json();

        // Handle new API payload structure {items: [], summaries: []}
        if (resData && typeof resData === 'object' && !Array.isArray(resData) && resData.items) {
            currentItems = resData.items;
        } else {
            currentItems = resData; // Fallback for old API format if cached
        }

        // Ensure relation target items are fetched and cached for display
        const relations = coll.schema.fields.filter(f => f.type === 'Relation');
        for (const rel of relations) {
            if (!relationMapCache[rel.target_collection_id]) {
                const tr = await fetch(`${API_URL}/collections/${rel.target_collection_id}/items`);
                const tItems = await tr.json();

                // create map mapping ID -> Title (assumes Title is first field)
                const tMap = {};
                const tColl = collections.find(c => c.id === rel.target_collection_id);
                const titleKey = tColl && tColl.schema.fields.length > 0 ? tColl.schema.fields[0].safe_name : 'id';

                const relationItems = Array.isArray(tItems) ? tItems : (tItems.items || []);
                relationItems.forEach(i => tMap[i.id] = i[titleKey]);
                relationMapCache[rel.target_collection_id] = tMap;
            }
        }

        if (currentView === 'table') {
            if (resData.summaries) {
                renderSummaryBar(resData.summaries);
            } else {
                document.getElementById('summary-bar').style.display = 'none';
            }

            // Apply Local Search Filter
            let filteredItems = currentItems;
            if (currentRowSearchQuery) {
                filteredItems = currentItems.filter(item => {
                    return coll.schema.fields.some(f => {
                        const val = item[f.safe_name];
                        if (val === null || val === undefined) return false;
                        return String(val).toLowerCase().includes(currentRowSearchQuery);
                    });
                });
            }
            renderTable(coll.schema.fields, filteredItems);
        } else {
            document.getElementById('summary-bar').style.display = 'none';

            // Apply Local Search Filter for Calendar View
            let filteredItems = currentItems;
            if (currentRowSearchQuery) {
                filteredItems = currentItems.filter(item => {
                    return coll.schema.fields.some(f => {
                        const val = item[f.safe_name];
                        if (val === null || val === undefined) return false;
                        return String(val).toLowerCase().includes(currentRowSearchQuery);
                    });
                });
            }
            renderCalendar(coll.schema.fields, filteredItems);
        }
    } catch (e) {
        console.error("Failed to fetch items:", e);
    }
}

function renderSummaryBar(summaries) {
    const bar = document.getElementById('summary-bar');
    if (!summaries || summaries.length === 0) {
        bar.style.display = 'none';
        return;
    }

    bar.innerHTML = '';
    summaries.forEach(s => {
        const chip = document.createElement('div');
        chip.className = 'summary-chip';

        const lbl = document.createElement('div');
        lbl.className = 'summary-label';
        lbl.textContent = s.name;

        const val = document.createElement('div');
        val.className = 'summary-value';
        // Check if value is a number for formatting, or an error string
        if (typeof s.value === 'number') {
            // Rough format to avoid excessive decimals, e.g. 14.50
            val.textContent = Number.isInteger(s.value) ? s.value : s.value.toFixed(2);
        } else {
            val.textContent = s.value !== null ? s.value : '--';
        }

        if (String(s.value).startsWith('Err:')) {
            val.style.color = 'var(--danger-color)';
            val.style.fontSize = '1rem';
        }

        const actions = document.createElement('div');
        actions.className = 'formula-summary-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'action-icon';
        editBtn.title = 'Edit';
        editBtn.textContent = '✏️';
        editBtn.onclick = (e) => editFormula(s.name, s.expression || '', true, e);

        const delBtn = document.createElement('button');
        delBtn.className = 'action-icon';
        delBtn.title = 'Delete';
        delBtn.textContent = '🗑️';
        delBtn.onclick = (e) => deleteFormula(s.name, true, e);

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        chip.appendChild(lbl);
        chip.appendChild(val);
        chip.appendChild(actions);
        bar.appendChild(chip);
    });

    bar.style.display = 'flex';
}

function formatValue(value, field) {
    if (value === null || value === undefined) return '';
    if (field.type === 'DateTime' && value) {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
            return d.toLocaleString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        }
    } else if (field.type === 'Relation' && value) {
        const map = relationMapCache[field.target_collection_id];
        if (map && map[value]) {
            return escapeHTML(String(map[value]));
        }
        return `[Linked: #${value}]`;
    } else if (field.type === 'NestedDatabase' && value) {
        const childColl = collections.find(c => String(c.id) === String(value));
        return childColl ? `🗂️ ${escapeHTML(childColl.name)}` : `[Nested DB #${value}]`;
    }
    return escapeHTML(String(value));
}

function renderTable(fields, items) {
    const coll = collections.find(c => c.id === activeCollectionId);

    // Add Back Button if nested
    if (coll && coll.parent_collection_id) {
        const parent = collections.find(c => c.id === coll.parent_collection_id);
        const parentName = parent ? parent.name : 'Parent Database';

        const backRow = document.createElement('div');
        backRow.style.padding = '0.5rem 0';
        backRow.style.marginBottom = '0.5rem';

        const btn = document.createElement('button');
        btn.className = 'secondary-btn small-btn';
        btn.textContent = `← Back to ${parentName}`;
        btn.onclick = () => selectCollection(coll.parent_collection_id);

        backRow.appendChild(btn);

        // Prepend to table head container or similar. 
        // Actually, table-head is inside a table. We should probably put this in the view container.
        const container = document.getElementById('table-view-container');
        // Clear old back buttons if any
        const oldBack = container.querySelector('.back-nav-container');
        if (oldBack) oldBack.remove();

        const navWrapper = document.createElement('div');
        navWrapper.className = 'back-nav-container';
        navWrapper.appendChild(backRow);
        container.insertBefore(navWrapper, container.firstChild);
    } else {
        const oldBack = document.querySelector('.back-nav-container');
        if (oldBack) oldBack.remove();
    }

    // Sort items if needed
    let displayItems = [...items];
    if (currentSortColumn) {
        displayItems.sort((a, b) => {
            let valA = a[currentSortColumn];
            let valB = b[currentSortColumn];
            if (valA === valB) return 0;
            if (valA === null || valA === undefined) return currentSortAscending ? 1 : -1;
            if (valB === null || valB === undefined) return currentSortAscending ? -1 : 1;
            if (typeof valA === 'string' && typeof valB === 'string') {
                return currentSortAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return currentSortAscending ? (valA > valB ? 1 : -1) : (valA > valB ? -1 : 1);
        });
    }

    // Render Header
    tableHead.innerHTML = '';
    const trHead = document.createElement('tr');
    fields.forEach(f => {
        const th = document.createElement('th');
        th.style.position = 'relative';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = f.name;
        titleSpan.style.cursor = 'pointer';

        if (currentSortColumn === f.safe_name) {
            titleSpan.textContent += currentSortAscending ? ' ▲' : ' ▼';
        }

        titleSpan.onclick = () => {
            if (currentSortColumn === f.safe_name) {
                currentSortAscending = !currentSortAscending;
            } else {
                currentSortColumn = f.safe_name;
                currentSortAscending = true;
            }
            renderTable(fields, items);
        };
        th.appendChild(titleSpan);

        if (f.type === 'Formula') {
            const actions = document.createElement('div');
            actions.className = 'formula-header-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'action-icon';
            editBtn.title = 'Edit';
            editBtn.textContent = '✏️';
            editBtn.onclick = (e) => editFormula(f.name, f.expression, false, e);

            const delBtn = document.createElement('button');
            delBtn.className = 'action-icon';
            delBtn.title = 'Delete';
            delBtn.textContent = '🗑️';
            delBtn.onclick = (e) => deleteFormula(f.name, false, e);

            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            th.appendChild(actions);
        } else {
            // Standard columns can also be edited/deleted post-creation
            const actions = document.createElement('div');
            actions.className = 'formula-header-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'action-icon';
            editBtn.title = 'Rename';
            editBtn.textContent = '✏️';
            editBtn.onclick = (e) => editField(f.name, f.safe_name, f.type, f.target_collection_id, e);

            const delBtn = document.createElement('button');
            delBtn.className = 'action-icon';
            delBtn.title = 'Delete';
            delBtn.textContent = '🗑️';
            delBtn.onclick = (e) => deleteField(f.safe_name, e);

            actions.appendChild(editBtn);
            actions.appendChild(delBtn);
            th.appendChild(actions);
        }

        trHead.appendChild(th);
    });
    // Action column
    const thAct = document.createElement('th');
    thAct.textContent = 'Actions';
    trHead.appendChild(thAct);
    tableHead.appendChild(trHead);

    // Render Body
    tableBody.innerHTML = '';
    if (displayItems.length === 0) {
        const trEmpty = document.createElement('tr');
        trEmpty.innerHTML = `<td colspan="${fields.length + 1}" style="text-align:center;color:#8b949e">No records found.</td>`;
        tableBody.appendChild(trEmpty);
        return;
    }

    displayItems.forEach(item => {
        const tr = document.createElement('tr');

        fields.forEach(f => {
            const td = document.createElement('td');
            if (f.type === 'NestedDatabase' && item[f.safe_name]) {
                const val = item[f.safe_name];
                const childColl = collections.find(c => String(c.id) === String(val));
                const cname = childColl ? childColl.name : 'Sub-Database';

                const wrapper = document.createElement('div');
                wrapper.style.display = 'flex';
                wrapper.style.gap = '0.5rem';
                wrapper.style.alignItems = 'center';

                const btn = document.createElement('button');
                btn.className = 'secondary-btn small-btn';
                btn.textContent = `🗂️ Open ${cname}`;
                btn.onclick = (e) => {
                    e.stopPropagation();
                    selectCollection(val);
                };

                const delBtn = document.createElement('button');
                if (activeCollectionId === masterCollectionId) {
                    delBtn.style.display = 'none';
                } else {
                    delBtn.style.display = 'inline-block';
                }
                delBtn.className = 'icon-btn delete-btn small-btn';
                delBtn.innerHTML = '🗑️';
                delBtn.title = 'Delete Nested Database';
                delBtn.style.padding = '0.2rem 0.5rem';
                delBtn.onclick = async (e) => {
                    e.stopPropagation();
                    if (!confirm("Are you sure you want to completely delete this nested database? This cannot be undone.")) return;

                    try {
                        // 1. Delete the actual nested database
                        await fetch(`${API_URL}/collections/${val}`, { method: 'DELETE' });

                        // 2. Clear the reference from the parent row
                        const updateData = {};
                        updateData[f.safe_name] = null;
                        await fetch(`${API_URL}/collections/${activeCollectionId}/items/${item.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(updateData)
                        });

                        showToast('Nested database deleted successfully', 'success');

                        // 3. Refresh UI
                        await fetchCollections();
                        await fetchActiveCollectionItems();
                    } catch (err) {
                        showToast("Error deleting nested database", 'error');
                        console.error(err);
                    }
                };

                wrapper.appendChild(btn);
                wrapper.appendChild(delBtn);
                td.appendChild(wrapper);
                wrapper.appendChild(btn);
                wrapper.appendChild(delBtn);
                td.appendChild(wrapper);
            } else if (f.type === 'NestedDatabase' && !item[f.safe_name]) {
                const addBtn = document.createElement('button');
                addBtn.className = 'secondary-btn small-btn';
                addBtn.textContent = '+ Create Sub-Database';
                addBtn.onclick = (e) => {
                    e.stopPropagation();
                    // Just open the record modal which already has the flow for creating newly targeted sub-dbs
                    openItemModal(item);
                };
                td.appendChild(addBtn);
            } else {
                td.innerHTML = formatValue(item[f.safe_name], f);
            }
            tr.appendChild(td);
        });

        // Actions
        const tdAct = document.createElement('td');
        const editBtn = document.createElement('button');
        editBtn.className = 'icon-btn edit-btn';
        editBtn.textContent = '✏️';
        editBtn.onclick = () => openItemModal(item);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'icon-btn delete-btn';
        deleteBtn.textContent = '🗑️';
        deleteBtn.onclick = () => deleteItem(item.id);

        tdAct.appendChild(editBtn);
        tdAct.appendChild(deleteBtn);
        tr.appendChild(tdAct);

        tableBody.appendChild(tr);
    });
}

// --- Recurrence Engine ---
// Takes a list of items and expands those with repeating rules (DAILY, WEEKLY, etc.) 
// into separate physical instances mapped to their respective dates 
// within the current visible date range [viewStart, viewEnd].
function getEventsByDate(items, dateKey, viewStart, viewEnd) {
    const map = {};
    const start = new Date(viewStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(viewEnd);
    end.setHours(23, 59, 59, 999);

    items.forEach(item => {
        const itemDateStr = item[dateKey] || item.date;
        if (!itemDateStr) return;
        const baseDate = new Date(itemDateStr);
        if (isNaN(baseDate.getTime())) return;

        const rule = item.recurrence_rule || 'NONE';

        let recEnd = null;
        if (item.recurrence_end_date) {
            recEnd = new Date(item.recurrence_end_date);
            recEnd.setHours(23, 59, 59, 999);
        }

        let curr = new Date(baseDate);

        if (rule === 'NONE') {
            const dateStr = curr.toDateString();
            if (!map[dateStr]) map[dateStr] = [];
            map[dateStr].push(item);
            return;
        }

        // Fast forward near start if needed to avoid long loops
        if (rule === 'DAILY' && curr < start) {
            curr = new Date(start);
            curr.setHours(baseDate.getHours(), baseDate.getMinutes(), baseDate.getSeconds());
        }

        let safety = 1000;
        let selectedDays = item.recurrence_days ? item.recurrence_days.split(',') : [];

        while (curr <= end && safety > 0) {
            if (recEnd && curr > recEnd) break; // Honor recurrence end date

            let shouldAdd = true;
            if (rule === 'WEEKLY' && selectedDays.length > 0) {
                if (!selectedDays.includes(curr.getDay().toString())) {
                    shouldAdd = false;
                }
            }

            if (shouldAdd && (curr >= start || curr.toDateString() === start.toDateString())) {
                const dateStr = curr.toDateString();
                if (!map[dateStr]) map[dateStr] = [];
                map[dateStr].push(item);
            }

            if (rule === 'DAILY') {
                curr.setDate(curr.getDate() + 1);
            } else if (rule === 'WEEKLY') {
                if (selectedDays.length > 0) {
                    curr.setDate(curr.getDate() + 1); // Step day-by-day if specific days are chosen
                } else {
                    curr.setDate(curr.getDate() + 7);
                }
            } else if (rule === 'MONTHLY') {
                curr.setMonth(curr.getMonth() + 1);
            } else if (rule === 'YEARLY') {
                curr.setFullYear(curr.getFullYear() + 1);
            } else {
                break;
            }
            safety--;
        }
    });
    return map;
}

// Core rendering engine for the Calendar. Builds out the DOM structure for either:
// 1. A classic 7-column Month grid (mode === 'month')
// 2. A 24-hour vertical timeline grid (mode === 'week' or mode === 'day')
function generateCalendarGrid(containerSelector, titleSelector, mode, baseDate, items, dateKey, titleKey, isGlobal) {
    let grid = document.querySelector(containerSelector);
    if (!grid && containerSelector.includes('.calendar-grid')) {
        grid = document.querySelector(containerSelector.replace('.calendar-grid', '.time-grid-wrapper'));
    }
    const monthLabel = document.querySelector(titleSelector);
    grid.innerHTML = '';

    let startDate, endDate, totalCells;
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const date = baseDate.getDate();

    if (mode === 'month') {
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
        startDate = new Date(year, month, 1 - firstDay);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + totalCells - 1);
        monthLabel.textContent = new Date(year, month, 1).toLocaleString('default', { month: 'long', year: 'numeric' });
    } else if (mode === 'week') {
        const firstDay = new Date(year, month, date - baseDate.getDay());
        startDate = firstDay;
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        totalCells = 7;
        monthLabel.textContent = `Week of ${startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    } else {
        startDate = new Date(year, month, date);
        endDate = new Date(startDate);
        totalCells = 1;
        monthLabel.textContent = startDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    }

    const eventsMap = getEventsByDate(items, dateKey, startDate, endDate);

    // Month View (Classic Grid)
    if (mode === 'month') {
        grid.className = 'calendar-grid';
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        dayNames.forEach(d => {
            const el = document.createElement('div');
            el.className = 'calendar-day-header';
            el.textContent = d;
            grid.appendChild(el);
        });

        for (let i = 0; i < totalCells; i++) {
            const cellDate = new Date(startDate);
            cellDate.setDate(startDate.getDate() + i);

            const cell = document.createElement('div');
            cell.className = 'calendar-day';
            if (cellDate.getMonth() !== month) {
                cell.classList.add('other-month');
            }

            const header = document.createElement('div');
            header.className = 'day-number';
            header.textContent = cellDate.getDate();
            cell.appendChild(header);

            const events = eventsMap[cellDate.toDateString()] || [];
            events.forEach(evt => {
                if (isGlobal && !activeFilters.has(evt.collection_id)) return;
                const eventEl = document.createElement('div');
                eventEl.className = 'calendar-event';
                eventEl.textContent = isGlobal ? `[${evt.collection_name}] ${evt.title}` : (evt[titleKey] || 'Untitled');
                if (!isGlobal) {
                    eventEl.onclick = (e) => {
                        e.stopPropagation();
                        openItemModal(evt);
                    };
                }
                cell.appendChild(eventEl);
            });

            grid.appendChild(cell);
        }
    }
    // Week & Day Views (24-Hour Timeline)
    else {
        grid.className = 'time-grid-wrapper';

        // Render Y-Axis
        const yAxis = document.createElement('div');
        yAxis.className = 'time-grid-y-axis';

        const ySpacer = document.createElement('div');
        ySpacer.className = 'time-grid-day-header';
        ySpacer.style.background = 'var(--sidebar-bg)';
        ySpacer.style.zIndex = '11';
        ySpacer.style.color = 'var(--text-secondary)';
        ySpacer.style.fontSize = '0.75rem';
        ySpacer.textContent = 'Time';
        yAxis.appendChild(ySpacer);

        for (let h = 0; h < 24; h++) {
            const lbl = document.createElement('div');
            lbl.className = 'time-grid-hour-label';
            const ampm = h >= 12 ? 'PM' : 'AM';
            const displayH = h % 12 === 0 ? 12 : h % 12;
            lbl.textContent = `${displayH} ${ampm}`;
            yAxis.appendChild(lbl);
        }
        grid.appendChild(yAxis);

        // Render Columns Container
        const colsContainer = document.createElement('div');
        colsContainer.className = 'time-grid-days-container';

        for (let i = 0; i < totalCells; i++) {
            const cellDate = new Date(startDate);
            cellDate.setDate(startDate.getDate() + i);

            const col = document.createElement('div');
            col.className = 'time-grid-day-col';
            if (mode === 'day') {
                col.style.flex = '1';
                col.style.borderRight = 'none'; // Only 1 col so no right divider
            }

            const header = document.createElement('div');
            header.className = 'time-grid-day-header';
            if (mode === 'week') {
                header.textContent = cellDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            } else if (mode === 'day') {
                header.textContent = cellDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
            } else {
                header.textContent = 'Events';
            }
            col.appendChild(header);

            const body = document.createElement('div');
            body.className = 'time-grid-day-body';

            const events = eventsMap[cellDate.toDateString()] || [];

            // --- Overlap Detection & Column Packing ---
            // First, convert actual Date properties into continuous float hours (e.g. 14:30 -> 14.5)
            // so we can mathematically compute visual vertical overlaps.
            const mappedEvents = events.map(e => {
                const dateVal = e[dateKey] || e.date;
                const d = new Date(dateVal);
                let sHours = isNaN(d.getTime()) ? 0 : d.getHours() + (d.getMinutes() / 60);

                let eHours = sHours + 1; // default 1 hour duration
                if (e.end_date_time) {
                    const de = new Date(e.end_date_time);
                    if (!isNaN(de.getTime())) {
                        eHours = de.getHours() + (de.getMinutes() / 60);
                        if (de.getDate() !== d.getDate()) {
                            eHours = 24; // Caps at midnight for this day's column
                        }
                    }
                }

                if (e.is_all_day === 1) {
                    sHours = 0;
                    eHours = 24;
                }

                return { item: e, start: sHours, end: eHours };
            });

            // Sort events primarily by their start time. If they start at the same time,
            // sort by their end time so longer events get placed first.
            mappedEvents.sort((a, b) => a.start - b.start || b.end - a.end);

            // 'columns' array keeps track of the maximum Y-boundary (end time) of the last event placed 
            // in each vertical CSS column, allowing us to pack concurrent events side-by-side visually.
            const columns = []; // Tracks end time of the last event in each overlap column
            mappedEvents.forEach(me => {
                let placed = false;
                for (let c = 0; c < columns.length; c++) {
                    if (columns[c] <= me.start) {
                        me.colIndex = c;
                        columns[c] = me.end;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    me.colIndex = columns.length;
                    columns.push(me.end);
                }
            });

            mappedEvents.forEach(me => {
                if (isGlobal && !activeFilters.has(me.item.collection_id)) return;

                const ev = document.createElement('div');
                ev.className = 'time-grid-event';

                // 40px per hour
                const topPx = me.start * 40;
                let heightPx = (me.end - me.start) * 40;
                if (heightPx < 20) heightPx = 20; // Minimum clickable height

                ev.style.top = `${topPx}px`;
                ev.style.height = `${heightPx}px`;

                // Width calculation based on overlap columns
                const overlapCount = columns.length;
                const widthPct = 100 / overlapCount;
                ev.style.width = `calc(${widthPct}% - 2px)`;
                ev.style.left = `${me.colIndex * widthPct}%`;

                const titleSpan = document.createElement('span');
                titleSpan.className = 'event-title';
                titleSpan.textContent = isGlobal ? `[${me.item.collection_name}] ${me.item.title}` : (me.item[titleKey] || 'Untitled');
                ev.appendChild(titleSpan);

                const formatTime = h => {
                    const hr = Math.floor(h);
                    const min = Math.round((h - hr) * 60);
                    const ampm = hr >= 12 ? 'pm' : 'am';
                    const dHr = hr % 12 === 0 ? 12 : hr % 12;
                    return `${dHr}:${min.toString().padStart(2, '0')}${ampm}`;
                };

                const timeSpan = document.createElement('span');
                timeSpan.className = 'event-time';
                timeSpan.textContent = `${formatTime(me.start)} - ${formatTime(me.end)}`;
                ev.appendChild(timeSpan);

                // Show additional metadata on day view
                if (mode === 'day') {
                    timeSpan.style.display = 'block';
                    timeSpan.style.fontSize = '0.9em';
                    timeSpan.style.marginBottom = '5px';

                    const detailsDiv = document.createElement('div');
                    detailsDiv.className = 'event-details-preview';
                    detailsDiv.style.fontSize = '0.85em';
                    detailsDiv.style.opacity = '0.8';
                    detailsDiv.style.marginTop = '4px';

                    // Add summary of custom fields 
                    Object.keys(me.item).forEach(key => {
                        if (['id', 'created_at', 'collection_id', 'collection_name', 'recurrence_rule', 'recurrence_end_date', 'recurrence_days', 'end_date_time', 'is_all_day', 'title'].includes(key) || key === dateKey || key === titleKey) return;

                        // It's a custom field
                        if (me.item[key] !== null && me.item[key] !== '') {
                            const df = document.createElement('div');
                            df.textContent = `${key.replace(/_/g, ' ')}: ${me.item[key]}`;
                            detailsDiv.appendChild(df);
                        }
                    });

                    ev.appendChild(detailsDiv);
                }

                if (!isGlobal) {
                    ev.onclick = (e) => {
                        e.stopPropagation();
                        openItemModal(me.item);
                    };
                }

                body.appendChild(ev);
            });

            col.appendChild(body);
            colsContainer.appendChild(col);
        }
        grid.appendChild(colsContainer);
    }
}

// --- Calendar View Implementation ---
function renderCalendar(fields, items) {
    let dateField = fields.find(f => f.type === 'DateTime');
    const dateKey = dateField ? dateField.safe_name : 'created_at';
    const titleKey = fields[0].safe_name;

    generateCalendarGrid(
        '#calendar-view-container .calendar-grid',
        '#calendar-month-label',
        localCalendarMode,
        currentCalendarDate,
        items,
        dateKey,
        titleKey,
        false
    );
}

document.getElementById('calendar-mode-select').addEventListener('change', (e) => {
    localCalendarMode = e.target.value;
    fetchActiveCollectionItems();
});

document.getElementById('view-toggle-btn').addEventListener('click', (e) => {
    const tableContainer = document.getElementById('table-view-container');
    const calContainer = document.getElementById('calendar-view-container');

    if (currentView === 'table') {
        currentView = 'calendar';
        e.target.textContent = '📋 Grid View';
        tableContainer.style.display = 'none';
        calContainer.style.display = 'block';
    } else {
        currentView = 'table';
        e.target.textContent = '📅 Calendar View';
        tableContainer.style.display = 'block';
        calContainer.style.display = 'none';
    }

    fetchActiveCollectionItems();
});

document.getElementById('prev-month-btn').addEventListener('click', () => {
    if (localCalendarMode === 'week') currentCalendarDate.setDate(currentCalendarDate.getDate() - 7);
    else if (localCalendarMode === 'day') currentCalendarDate.setDate(currentCalendarDate.getDate() - 1);
    else currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    fetchActiveCollectionItems();
});

document.getElementById('next-month-btn').addEventListener('click', () => {
    if (localCalendarMode === 'week') currentCalendarDate.setDate(currentCalendarDate.getDate() + 7);
    else if (localCalendarMode === 'day') currentCalendarDate.setDate(currentCalendarDate.getDate() + 1);
    else currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    fetchActiveCollectionItems();
});

// --- Global Calendar Implementation ---
// Handles the "Global Calendar" view where items from ALL collections 
// are fetched simultaneously and displayed on a single unified grid.
let globalCalendarEvents = [];
let activeFilters = new Set();

async function fetchGlobalCalendar() {
    try {
        const res = await fetch(`${API_URL}/calendar/items`);
        globalCalendarEvents = await res.json();

        // Initialize filters - show everything by default
        activeFilters.clear();
        globalCalendarEvents.forEach(evt => activeFilters.add(evt.collection_id));

        renderGlobalCalendar();
        renderGlobalFilters();
    } catch (e) {
        console.error("Failed to fetch global calendar:", e);
    }
}

function renderGlobalFilters() {
    const filterContainer = document.getElementById('calendar-filter');
    filterContainer.innerHTML = '';

    // Only show databases that CAN have calendar entries (have a DateTime field)
    const calendarCapableColls = collections.filter(coll =>
        coll.schema.fields.some(f => f.type === 'DateTime')
    );

    calendarCapableColls.forEach(coll => {
        const label = document.createElement('label');
        label.style.display = 'flex';
        label.style.alignItems = 'center';
        label.style.gap = '0.5rem';
        label.style.cursor = 'pointer';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = activeFilters.has(coll.id);
        checkbox.onchange = (e) => {
            if (e.target.checked) activeFilters.add(coll.id);
            else activeFilters.delete(coll.id);
            renderGlobalCalendar();
        };

        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(coll.name));
        filterContainer.appendChild(label);
    });
}

function renderGlobalCalendar() {
    generateCalendarGrid(
        '#global-calendar-view .calendar-grid',
        '#gc-month-label',
        globalCalendarMode,
        currentCalendarDate,
        globalCalendarEvents,
        'date',
        'title',
        true
    );
}

document.getElementById('gc-mode-select').addEventListener('change', (e) => {
    globalCalendarMode = e.target.value;
    renderGlobalCalendar();
});

document.getElementById('gc-prev-month-btn').addEventListener('click', () => {
    if (globalCalendarMode === 'week') currentCalendarDate.setDate(currentCalendarDate.getDate() - 7);
    else if (globalCalendarMode === 'day') currentCalendarDate.setDate(currentCalendarDate.getDate() - 1);
    else currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderGlobalCalendar();
});

document.getElementById('gc-next-month-btn').addEventListener('click', () => {
    if (globalCalendarMode === 'week') currentCalendarDate.setDate(currentCalendarDate.getDate() + 7);
    else if (globalCalendarMode === 'day') currentCalendarDate.setDate(currentCalendarDate.getDate() + 1);
    else currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderGlobalCalendar();
});

// --- Item Operations ---
window.deleteItem = async (itemId) => {
    if (!confirm("Delete this record?")) return;
    try {
        await fetch(`${API_URL}/collections/${activeCollectionId}/items/${itemId}`, { method: 'DELETE' });
        showToast('Record deleted successfully', 'success');
        fetchActiveCollectionItems();
        await fetchCollections(); // Refresh global list in case this item contained nested databases
    } catch (e) {
        showToast("Error deleting: " + e.message, 'error');
        console.error("Error deleting", e);
    }
};

// Dynamically builds the "Add/Edit Record" popup form.
// It iterates through the current collection's Schema fields and constructs 
// appropriate HTML inputs (Datepicker, Numbers, Selects, Checkboxes) on the fly.
window.openItemModal = (item = null) => {
    const coll = collections.find(c => c.id === activeCollectionId);
    if (!coll) return;

    dynFormFields.innerHTML = ''; // Clear old form
    document.getElementById('dynamic-item-id').value = item ? item.id : '';
    document.getElementById('item-modal-title').textContent = item ? 'Edit Record' : 'New Record';

    // Setup Duplicate Dropdown
    const dupContainer = document.getElementById('duplicate-entry-container');
    const dupSelect = document.getElementById('duplicate-select');
    if (!item && currentItems.length > 0) {
        dupContainer.style.display = 'block';
        dupSelect.innerHTML = '<option value="">-- Select an entry to duplicate --</option>';
        currentItems.forEach(i => {
            const displayName = i[coll.schema.fields[0].safe_name] || `Record #${i.id}`;
            dupSelect.innerHTML += `<option value="${i.id}">${escapeHTML(String(displayName))}</option>`;
        });
    } else {
        dupContainer.style.display = 'none';
    }

    let hasDateField = false;

    // Generate inputs dynamically based on schema
    coll.schema.fields.forEach(f => {
        if (f.type === 'DateTime') hasDateField = true;

        const val = item ? item[f.safe_name] : '';
        const group = document.createElement('div');
        group.className = 'form-group';

        const label = document.createElement('label');
        label.textContent = f.name;

        let input;
        if (f.type === 'Number') {
            input = document.createElement('input');
            input.type = 'number';
            input.step = 'any';
            input.value = val !== null && val !== undefined ? val : '';
        } else if (f.type === 'DateTime') {
            const isAllDay = (item && item.is_all_day === 1);
            input = document.createElement('input');
            input.type = isAllDay ? 'date' : 'datetime-local';
            if (val) {
                try {
                    const d = new Date(val);
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    input.value = d.toISOString().slice(0, isAllDay ? 10 : 16);
                } catch (e) { }
            }
            // Add End Time input right after Start Time
            const endGroup = document.createElement('div');
            endGroup.className = 'form-group mt-2';
            const endLabel = document.createElement('label');
            endLabel.textContent = 'End Time (Optional)';
            const endInput = document.createElement('input');
            endInput.type = isAllDay ? 'date' : 'datetime-local';
            endInput.id = 'field_end_date_time';
            endInput.dataset.key = 'end_date_time';
            endInput.dataset.type = 'DateTime';
            endInput.className = 'dynamic-input-field';
            if (item && item.end_date_time) {
                try {
                    const de = new Date(item.end_date_time);
                    de.setMinutes(de.getMinutes() - de.getTimezoneOffset());
                    endInput.value = de.toISOString().slice(0, isAllDay ? 10 : 16);
                } catch (e) { }
            }
            endGroup.appendChild(endLabel);
            endGroup.appendChild(endInput);

            // All Day Checkbox
            const allDayGroup = document.createElement('div');
            allDayGroup.className = 'form-group mt-2';
            const allDayLabel = document.createElement('label');
            allDayLabel.style.display = 'flex';
            allDayLabel.style.alignItems = 'center';
            allDayLabel.style.gap = '0.5rem';
            const allDayCheck = document.createElement('input');
            allDayCheck.type = 'checkbox';
            allDayCheck.id = 'field_is_all_day';
            allDayCheck.dataset.key = 'is_all_day';
            allDayCheck.dataset.type = 'Boolean';
            allDayCheck.className = 'dynamic-input-field';
            allDayCheck.checked = isAllDay;

            allDayCheck.addEventListener('change', (e) => {
                const isAll = e.target.checked;
                input.type = isAll ? 'date' : 'datetime-local';
                endInput.type = isAll ? 'date' : 'datetime-local';

                // Keep values sensible
                if (isAll) {
                    if (input.value && input.value.length > 10) input.value = input.value.slice(0, 10);
                    if (endInput.value && endInput.value.length > 10) endInput.value = endInput.value.slice(0, 10);
                } else {
                    if (input.value && input.value.length === 10) input.value = input.value + 'T00:00';
                    if (endInput.value && endInput.value.length === 10) endInput.value = endInput.value + 'T00:00';
                }
            });
            allDayLabel.appendChild(allDayCheck);
            allDayLabel.appendChild(document.createTextNode('All Day Event'));
            allDayGroup.appendChild(allDayLabel);

            // Queue groups to be added after the main group
            setTimeout(() => {
                dynFormFields.insertBefore(allDayGroup, group.nextSibling);
                dynFormFields.insertBefore(endGroup, allDayGroup.nextSibling);
            }, 0);
        } else if (f.type === 'Relation') {
            input = document.createElement('select');
            input.innerHTML = '<option value="">-- Select Linked Record --</option>';
            const tMap = relationMapCache[f.target_collection_id];
            if (tMap) {
                Object.keys(tMap).forEach(tId => {
                    const opt = document.createElement('option');
                    opt.value = tId;
                    opt.textContent = tMap[tId];
                    if (String(val) === String(tId)) opt.selected = true;
                    input.appendChild(opt);
                });
            }
        } else if (f.type === 'Formula') {
            input = document.createElement('input');
            input.type = 'text';
            input.value = 'TBD';
            input.style.color = 'var(--text-secondary)';
            input.disabled = true;
        } else if (f.type === 'NestedDatabase') {
            input = document.createElement('input');
            input.type = 'hidden';
            input.value = val !== null && val !== undefined ? val : '';

            const btnGroup = document.createElement('div');
            btnGroup.style.padding = '0.5rem';
            btnGroup.style.border = '1px dashed var(--border-color)';
            btnGroup.style.borderRadius = 'var(--modal-radius)';

            if (val) {
                const childColl = collections.find(c => String(c.id) === String(val));
                const cname = childColl ? escapeHTML(childColl.name) : 'Sub-Database';

                const wrapper = document.createElement('div');
                wrapper.style.display = 'flex';
                wrapper.style.gap = '0.5rem';

                const openBtn = document.createElement('button');
                openBtn.type = 'button';
                openBtn.className = 'secondary-btn';
                openBtn.style.flex = '1';
                openBtn.innerHTML = `🗂️ Open ${cname}`;
                openBtn.onclick = () => {
                    itemModal.classList.add('hidden');
                    selectCollection(val);
                };

                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'icon-btn delete-btn';
                delBtn.innerHTML = '🗑️';
                delBtn.title = 'Delete Nested Database';
                delBtn.style.padding = '0 0.5rem';
                delBtn.onclick = async () => {
                    if (!confirm("Are you sure you want to completely delete this nested database? This cannot be undone.")) return;
                    try {
                        // 1. Delete the actual nested database
                        await fetch(`${API_URL}/collections/${val}`, { method: 'DELETE' });

                        // 2. Clear the reference from the parent row
                        const updateData = {};
                        updateData[f.safe_name] = null;
                        await fetch(`${API_URL}/collections/${activeCollectionId}/items/${item.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(updateData)
                        });

                        showToast('Nested database deleted successfully', 'success');

                        // 3. Refresh UI & Modal
                        await fetchCollections();
                        await fetchActiveCollectionItems();

                        // Re-fetch the item to refresh the modal view
                        const updatedRes = await fetch(`${API_URL}/collections/${activeCollectionId}/items`);
                        const updatedData = await updatedRes.json();
                        const updatedItems = Array.isArray(updatedData) ? updatedData : (updatedData.items || []);
                        const refreshedItem = updatedItems.find(i => String(i.id) === String(item.id));
                        if (refreshedItem) {
                            openItemModal(refreshedItem);
                        } else {
                            itemModal.classList.add('hidden');
                        }
                    } catch (err) {
                        showToast("Error deleting nested database", 'error');
                        console.error(err);
                    }
                };

                wrapper.appendChild(openBtn);
                wrapper.appendChild(delBtn);
                btnGroup.appendChild(wrapper);
            } else {
                if (item && item.id) {
                    btnGroup.innerHTML = `<button type="button" class="secondary-btn" style="width:100%;">+ Create Sub-Database</button>`;
                    btnGroup.querySelector('button').onclick = () => {
                        nestedParentItemId = item.id;
                        nestedParentCollectionId = activeCollectionId;
                        nestedParentFieldSafeName = f.safe_name;

                        document.getElementById('collection-form').reset();
                        resetCustomFields();
                        itemModal.classList.add('hidden');
                        collModal.classList.remove('hidden');
                    };
                } else {
                    btnGroup.innerHTML = `<span style="color:var(--text-secondary); font-size:0.85rem;">Save record first to configure sub-database.</span>`;
                }
            }

            group.appendChild(label);
            group.appendChild(input);
            group.appendChild(btnGroup);
            dynFormFields.appendChild(group);

            // We fully handle DOM appending here to avoid duplicating the label below for this custom type
            input.id = `field_${f.safe_name}`;
            input.dataset.key = f.safe_name;
            input.dataset.type = f.type;
            input.className = 'dynamic-input-field';
            return; // Move to next field iteration

        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.value = val !== null && val !== undefined ? val : '';
        }

        input.id = `field_${f.safe_name}`;
        input.dataset.key = f.safe_name;
        input.dataset.type = f.type;
        input.className = 'dynamic-input-field';

        // Require Title by convention (usually first field)
        if (f.name === 'Title') input.required = true;

        group.appendChild(label);
        group.appendChild(input);
        dynFormFields.appendChild(group);
    });

    // --- Recurrence Rule Dropdown ---
    const recGroup = document.createElement('div');
    recGroup.className = 'form-group';
    const recLabel = document.createElement('label');
    recLabel.textContent = 'Date Recurrence (Optional)';
    const recSelect = document.createElement('select');
    recSelect.id = 'field_recurrence_rule';
    recSelect.className = 'dynamic-input-field';
    recSelect.dataset.key = 'recurrence_rule';
    recSelect.dataset.type = 'Text';

    const recOptions = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
    recOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt === 'NONE' ? 'None' : opt.charAt(0) + opt.slice(1).toLowerCase();
        if (item && item.recurrence_rule === opt) {
            option.selected = true;
        }
        recSelect.appendChild(option);
    });

    recGroup.appendChild(recLabel);
    recGroup.appendChild(recSelect);

    // --- Recurrence End Date ---
    const recEndGroup = document.createElement('div');
    recEndGroup.className = 'form-group mt-2';
    recEndGroup.style.display = (item && item.recurrence_rule && item.recurrence_rule !== 'NONE') ? 'block' : 'none';
    const recEndLabel = document.createElement('label');
    recEndLabel.textContent = 'End Recurrence On (Optional)';
    const recEndInput = document.createElement('input');
    recEndInput.type = 'date';
    recEndInput.id = 'field_recurrence_end_date';
    recEndInput.dataset.key = 'recurrence_end_date';
    recEndInput.dataset.type = 'DateTime';
    recEndInput.className = 'dynamic-input-field';
    if (item && item.recurrence_end_date) {
        try {
            const dre = new Date(item.recurrence_end_date);
            recEndInput.value = dre.toISOString().slice(0, 10);
        } catch (e) { }
    }
    recEndGroup.appendChild(recEndLabel);
    recEndGroup.appendChild(recEndInput);

    // --- Recurrence Specific Days (Weekly only) ---
    const recDaysGroup = document.createElement('div');
    recDaysGroup.className = 'form-group mt-2';
    recDaysGroup.style.display = (item && item.recurrence_rule === 'WEEKLY') ? 'block' : 'none';
    const recDaysLabel = document.createElement('label');
    recDaysLabel.textContent = 'Repeat On Days (Optional)';
    recDaysGroup.appendChild(recDaysLabel);

    const daysWrapper = document.createElement('div');
    daysWrapper.style.display = 'flex';
    daysWrapper.style.gap = '0.5rem';

    // Hidden input to store the csv data
    const recDaysHidden = document.createElement('input');
    recDaysHidden.type = 'hidden';
    recDaysHidden.id = 'field_recurrence_days';
    recDaysHidden.dataset.key = 'recurrence_days';
    recDaysHidden.dataset.type = 'Text';
    recDaysHidden.className = 'dynamic-input-field';

    let selectedDays = item && item.recurrence_days ? item.recurrence_days.split(',') : [];
    recDaysHidden.value = selectedDays.join(',');

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach((d, idx) => {
        const dLabel = document.createElement('label');
        dLabel.style.display = 'flex';
        dLabel.style.alignItems = 'center';
        dLabel.style.gap = '0.2rem';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = idx.toString();
        if (selectedDays.includes(idx.toString())) cb.checked = true;

        cb.addEventListener('change', () => {
            if (cb.checked) {
                if (!selectedDays.includes(cb.value)) selectedDays.push(cb.value);
            } else {
                selectedDays = selectedDays.filter(val => val !== cb.value);
            }
            recDaysHidden.value = selectedDays.join(',');
        });

        dLabel.appendChild(cb);
        dLabel.appendChild(document.createTextNode(d));
        daysWrapper.appendChild(dLabel);
    });
    recDaysGroup.appendChild(daysWrapper);
    recDaysGroup.appendChild(recDaysHidden);

    // Dynamic visibility binding
    recSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        recEndGroup.style.display = val !== 'NONE' ? 'block' : 'none';
        recDaysGroup.style.display = val === 'WEEKLY' ? 'block' : 'none';
    });

    if (hasDateField) {
        dynFormFields.appendChild(recGroup);
        dynFormFields.appendChild(recEndGroup);
        dynFormFields.appendChild(recDaysGroup);
    }

    itemModal.classList.remove('hidden');
};

// Auto-fills form values when the user selects an existing record to duplicate.
document.getElementById('duplicate-select').addEventListener('change', (e) => {
    const sourceId = e.target.value;
    if (!sourceId) return;

    const sourceItem = currentItems.find(i => String(i.id) === String(sourceId));
    if (!sourceItem) return;

    // Auto-fill physical DOM inputs
    document.querySelectorAll('.dynamic-input-field').forEach(inp => {
        const key = inp.dataset.key;
        const type = inp.dataset.type;
        const val = sourceItem[key];

        if (val !== undefined && val !== null) {
            if (type === 'DateTime') {
                try {
                    const d = new Date(val);
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    inp.value = d.toISOString().slice(0, 16);
                } catch (err) { }
            } else {
                inp.value = val;
            }
        }
    });
});

// Form Submission Logic: Sweeps through all dynamic input pieces, formats the 
// values properly according to their data types, and sends them to the API.
dynItemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('dynamic-item-id').value;
    const inputs = dynFormFields.querySelectorAll('.dynamic-input-field');

    const data = {};
    inputs.forEach(inp => {
        let val = inp.value;
        if (inp.dataset.type === 'Number') {
            val = val ? parseFloat(val) : null;
        } else if (inp.dataset.type === 'DateTime') {
            if (val && inp.type === 'date') val = val + 'T00:00';
            val = val ? new Date(val).toISOString() : null;
        } else if (inp.dataset.type === 'Relation') {
            val = val ? parseInt(val) : null;
        } else if (inp.dataset.type === 'Boolean') {
            val = inp.checked ? 1 : 0;
        }
        data[inp.dataset.key] = val;
    });

    try {
        const url = id ? `${API_URL}/collections/${activeCollectionId}/items/${id}` : `${API_URL}/collections/${activeCollectionId}/items`;
        const method = id ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Failed to save record');
        }

        itemModal.classList.add('hidden');
        showToast(id ? 'Record updated successfully' : 'Record created successfully', 'success');
        fetchActiveCollectionItems();
    } catch (e) {
        showToast("Error saving record: " + e.message, 'error');
        console.error("Error saving", e);
    }
});

function createCollection() {
    document.getElementById('collection-form').reset();
    resetCustomFields();

    // Populate Template Dropdown
    const templateSelect = document.getElementById('collection-template');
    if (templateSelect) {
        templateSelect.innerHTML = '<option value="">None (Start Blank)</option>';
        collections.forEach(c => {
            let displayName = c.name;
            if (c.parent_item_title) {
                displayName += ` (${c.parent_item_title})`;
            } else if (c.parent_collection_id) {
                const parentFields = collections.find(p => p.id === c.parent_collection_id).schema.fields;
                parentFields.forEach(field => {
                    if (field.type === 'NestedDatabase' && field.target_collection_id === c.id) {
                        displayName = field.name + ' (' + (parentFields[0].name || parentFields[0].safe_name) + ')';
                    }
                });
            }
            templateSelect.innerHTML += '<option value="' + c.id + '">' + escapeHTML(displayName) + '</option>';
        });
    }

    collModal.classList.remove('hidden');
}

// Template selection listener for DB Duplication
document.getElementById('collection-template')?.addEventListener('change', (e) => {
    const templateId = e.target.value;
    if (!templateId) {
        resetCustomFields();
        return;
    }

    const templateColl = collections.find(c => c.id === templateId);
    if (!templateColl) return;

    resetCustomFields();

    const fields = templateColl.schema.fields;
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (i > 0) document.getElementById('add-field-btn').click();

        // The newly added row is the last child
        const container = document.getElementById('fields-container');
        const newRow = container.lastElementChild;

        newRow.querySelector('.field-name-input').value = field.name;

        const typeSelect = newRow.querySelector('.field-type-select');
        typeSelect.value = field.type;
        typeSelect.dispatchEvent(new Event('change')); // Trigger visibility logic

        if (field.type === 'Relation') {
            const targetSel = newRow.querySelector('.target-collection-select');
            targetSel.value = field.target_collection_id || '';
        } else if (field.type === 'Formula') {
            const formulaInp = newRow.querySelector('.formula-expression-input');
            formulaInp.value = field.expression || '';
            const ideBtn = newRow.querySelector('.open-formula-ide-btn');
            ideBtn.textContent = '</> Edit (' + (field.expression || '').substring(0, 10) + '...)';
        }
    }

    // Clone summary formulas if any
    if (templateColl.schema.summary_formulas) {
        templateColl.schema.summary_formulas.forEach(summary => {
            document.getElementById('add-summary-btn').click();
            const summaryContainer = document.getElementById('summary-formulas-container');
            const newSummaryRow = summaryContainer.lastElementChild;

            newSummaryRow.querySelector('.summary-name-input').value = summary.name;
            newSummaryRow.querySelector('.summary-expression-input').value = summary.expression;
        });
    }
});

document.getElementById('delete-collection-btn').addEventListener('click', async () => {
    if (!confirm("Are you sure? This will delete the entire database and all its records!")) return;
    try {
        await fetch(`${API_URL}/collections/${activeCollectionId}`, { method: 'DELETE' });
        setupEmptyState();
        fetchCollections();
    } catch (e) { console.error("Error deleting DB", e); }
});

const renameCollBtn = document.getElementById('rename-collection-btn');
if (renameCollBtn) {
    renameCollBtn.addEventListener('click', async () => {
        if (!activeCollectionId) return;
        const currentName = activeCollTitle.textContent;
        const newName = prompt("Enter new name for the database:", currentName);

        if (newName && newName.trim() !== "" && newName !== currentName) {
            try {
                const res = await fetch(`${API_URL}/collections/${activeCollectionId}/name`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newName.trim() })
                });

                if (!res.ok) throw new Error("Failed to rename collection");

                showToast("Database renamed successfully!");
                await fetchCollections();
                // selectCollection will update the title text
            } catch (e) {
                console.error(e);
                showToast("Error renaming database", "error");
            }
        }
    });
}

// Custom Fields Logic: Handles dynamically adding fields when creating a NEW Database Collection.
document.getElementById('add-field-btn').addEventListener('click', () => {
    const row = document.createElement('div');
    row.className = 'field-row';
    row.innerHTML = `
        <input type="text" class="field-name-input" placeholder="Field Name" required>
        <select class="field-type-select">
            <option value="Text">Text</option>
            <option value="Number">Number</option>
            <option value="DateTime">Date / Time</option>
            <option value="Relation">Relation</option>
            <option value="NestedDatabase">Nested Database</option>
            <option value="Formula">Formula</option>
        </select>
        <select class="target-collection-select" style="display:none;" disabled></select>
        <button type="button" class="secondary-btn small-btn open-formula-ide-btn" style="display:none;" disabled>&lt;/&gt; Editor</button>
        <input type="hidden" class="formula-expression-input" disabled>
        <button type="button" class="icon-btn delete-btn" onclick="this.parentElement.remove()">🗑️</button>
    `;

    // Attach event listener for showing target DB dropdown or Formula input
    const typeSel = row.querySelector('.field-type-select');
    const targetSel = row.querySelector('.target-collection-select');
    const formulaInp = row.querySelector('.formula-expression-input');

    typeSel.addEventListener('change', () => {
        // Reset both
        targetSel.style.display = 'none';
        targetSel.disabled = true;
        targetSel.required = false;

        formulaInp.style.display = 'none';
        formulaInp.disabled = true;
        formulaInp.required = false;

        if (typeSel.value === 'Relation') {
            targetSel.style.display = 'inline-block';
            targetSel.disabled = false;
            targetSel.required = true;
            targetSel.innerHTML = '<option value="">Select target DB...option>';
            collections.forEach(c => {
                let displayName = c.name;
                if (c.parent_item_title) {
                    displayName += ` (${c.parent_item_title})`;
                }
                targetSel.innerHTML += '<option value="' + c.id + '">' + escapeHTML(displayName) + '</option>';
            });
        } else if (typeSel.value === 'Formula') {
            const ideBtn = row.querySelector('.open-formula-ide-btn');
            ideBtn.style.display = 'inline-block';
            ideBtn.disabled = false;
            ideBtn.onclick = () => {
                window.activeFieldRow = row;
                openFormulaIDE('db-creation');
            };
            formulaInp.disabled = false;
        }
    });

    fieldsContainer.appendChild(row);
});

// Database Summary Formulas Logic
document.getElementById('add-summary-btn').addEventListener('click', () => {
    const container = document.getElementById('summary-formulas-container');
    const row = document.createElement('div');
    row.className = 'summary-formula-row';
    row.style.display = 'flex';
    row.style.gap = '0.5rem';
    row.style.marginBottom = '0.5rem';
    row.innerHTML = `
        <input type="text" class="summary-name-input" placeholder="Metric Name (e.g. Total Cost)" style="flex:1;" required>
        <input type="text" class="summary-expression-input" placeholder="Expression (e.g. sum(r['cost'] for r in rows))" style="flex:2;" required>
        <button type="button" class="icon-btn delete-btn" onclick="this.parentElement.remove()">🗑️</button>
    `;
    container.appendChild(row);
});

function resetCustomFields() {
    fieldsContainer.innerHTML = `
        <div class="field-row">
            <input type="text" class="field-name-input" value="Title" required>
            <select class="field-type-select">
                <option value="Text">Text</option>
                <option value="Number">Number</option>
                <option value="DateTime">Date / Time</option>
                <option value="Relation">Relation</option>
                <option value="NestedDatabase">Nested Database</option>
                <option value="Formula">Formula</option>
            </select>
            <select class="target-collection-select" style="display:none;" disabled></select>
            <button type="button" class="secondary-btn small-btn open-formula-ide-btn" style="display:none;" disabled>&lt;/&gt; Editor</button>
            <input type="hidden" class="formula-expression-input" disabled>
            <button type="button" class="icon-btn" disabled>🔒</button>
        </div>
    `;

    const row = fieldsContainer.querySelector('.field-row');
    const typeSel = row.querySelector('.field-type-select');
    const targetSel = row.querySelector('.target-collection-select');
    const formulaInp = row.querySelector('.formula-expression-input');

    document.getElementById('summary-formulas-container').innerHTML = ''; // reset summaries

    typeSel.addEventListener('change', () => {
        // Reset both
        targetSel.style.display = 'none';
        targetSel.disabled = true;
        targetSel.required = false;

        formulaInp.style.display = 'none';
        formulaInp.disabled = true;
        formulaInp.required = false;

        if (typeSel.value === 'Relation') {
            targetSel.style.display = 'inline-block';
            targetSel.disabled = false;
            targetSel.required = true;
            targetSel.innerHTML = '<option value="">Select target DB...</option>';
            collections.forEach(c => {
                let displayName = c.name;
                if (c.parent_item_title) {
                    displayName += ` (${c.parent_item_title})`;
                }
                targetSel.innerHTML += '<option value="' + c.id + '">' + escapeHTML(displayName) + '</option>';
            });
        } else if (typeSel.value === 'Formula') {
            const ideBtn = row.querySelector('.open-formula-ide-btn');
            ideBtn.style.display = 'inline-block';
            ideBtn.disabled = false;
            ideBtn.onclick = () => {
                window.activeFieldRow = row;
                openFormulaIDE('db-creation');
            };
            formulaInp.disabled = false;
        }
    });
}

document.getElementById('collection-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('collection-name').value;
    const fields = [];

    document.querySelectorAll('.field-row').forEach(row => {
        fields.push({
            name: row.querySelector('.field-name-input').value,
            type: row.querySelector('.field-type-select').value,
            target_collection_id: row.querySelector('.target-collection-select').value || null,
            expression: row.querySelector('.formula-expression-input') ? row.querySelector('.formula-expression-input').value : null
        });
    });

    const summary_formulas = [];
    document.querySelectorAll('.summary-formula-row').forEach(row => {
        summary_formulas.push({
            name: row.querySelector('.summary-name-input').value,
            expression: row.querySelector('.summary-expression-input').value
        });
    });

    try {
        let actualParentCollectionId = nestedParentCollectionId;
        let actualParentItemId = nestedParentItemId;
        let actualParentFieldSafeName = nestedParentFieldSafeName;

        let isRootDb = !nestedParentCollectionId || nestedParentCollectionId === masterCollectionId;

        let createdMasterRowId = null;
        if (isRootDb) {
            // Create a row in the Master DB first to act as the parent folder
            const masterRes = await fetch(`${API_URL}/collections/${masterCollectionId}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name })
            });
            const masterData = await masterRes.json();
            createdMasterRowId = masterData.id;

            actualParentCollectionId = masterCollectionId;
            actualParentItemId = createdMasterRowId;
            actualParentFieldSafeName = 'databases';
        }

        const payload = {
            name,
            fields,
            summary_formulas,
            parent_collection_id: actualParentCollectionId,
            parent_item_id: actualParentItemId
        };

        const res = await fetch(`${API_URL}/collections`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        // Update parent row field explicitly (including the Master DB row we just created).
        if (actualParentItemId && actualParentCollectionId && actualParentFieldSafeName && data.id) {
            const updatePayload = {};
            updatePayload[actualParentFieldSafeName] = data.id;
            await fetch(`${API_URL}/collections/${actualParentCollectionId}/items/${actualParentItemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatePayload)
            });
        }

        // Reset nested state so future plain DB creations aren't tangled
        nestedParentItemId = null;
        nestedParentCollectionId = null;
        nestedParentFieldSafeName = null;

        collModal.classList.add('hidden');
        await fetchCollections();
        selectCollection(data.id); // Select newly created
    } catch (e) { console.error("Error creating collection", e); }
});

// Modals close buttons
document.querySelectorAll('.close-collection-modal').forEach(b => b.addEventListener('click', () => collModal.classList.add('hidden')));
document.querySelectorAll('.close-item-modal').forEach(b => b.addEventListener('click', () => itemModal.classList.add('hidden')));

// Security Helper
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, t => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[t] || t));
}

// Utility: Camel Case formatter
function toCamelCase(str) {
    if (!str) return '';
    return str.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/).map((word, index) => {
        if (index === 0) return word.toLowerCase();
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join('');
}

// --- Formula Editor IDE ---
const formulaModal = document.getElementById('formula-ide-modal');
const formulaVarsList = document.getElementById('formula-ide-vars');
let formulaEditOldName = null;
window.activeFieldRow = null;
function highlightPython(text) {
    if (!text) return '';

    let escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const keywords = ['def', 'lambda', 'for', 'in', 'if', 'else', 'elif', 'return', 'and', 'or', 'not', 'True', 'False', 'None'];
    const parts = [
        { name: 'string', regex: /(?:'.*?'|".*?")/g, color: '#e6db74' },
        { name: 'keyword', regex: new RegExp(`\\b(?:${keywords.join('|')})\\b`, 'g'), color: '#f92672' },
        { name: 'function', regex: /\b[a-zA-Z_]\w*(?=\()/g, color: '#a6e22e' },
        { name: 'number', regex: /\b\d+(?:\.\d+)?\b/g, color: '#ae81ff' },
        { name: 'bracket', regex: /[\[\]{}()]/g, color: '#f8f8f2' },
        { name: 'operator', regex: /[+\-*/%=><!&|^~]/g, color: '#f8f8f2' }
    ];

    const combinedRegex = new RegExp(parts.map(p => `(${p.regex.source})`).join('|'), 'g');

    return escaped.replace(combinedRegex, (...args) => {
        const match = args[0];
        for (let i = 0; i < parts.length; i++) {
            if (args[i + 1] !== undefined) {
                return `<span style="color: ${parts[i].color};">${match}</span>`;
            }
        }
        return match;
    });
}

document.getElementById('add-formula-btn').addEventListener('click', () => {
    openFormulaIDE('post-creation');
});

window.editFormula = function (name, expression, isSummary, e) {
    if (e) e.stopPropagation();
    openFormulaIDE('edit', { name, expression, isSummary });
};

window.deleteFormula = async function (name, isSummary, e) {
    if (e) e.stopPropagation();
    if (!confirm(`Are you sure you want to delete the formula "${name}"?`)) return;
    try {
        const res = await fetch(`${API_URL}/collections/${activeCollectionId}/formulas/${encodeURIComponent(name)}?is_summary=${isSummary}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            showToast("Formula deleted", "success");
            await fetchCollections();
            fetchActiveCollectionItems();
        } else {
            const data = await res.json();
            showToast(data.error || "Failed to delete formula", "error");
        }
    } catch (err) {
        showToast("Server error", "error");
    }
};

function openFormulaIDE(context, editData = null) {
    formulaIdeContext = context;
    formulaEditOldName = editData ? editData.name : null;
    document.getElementById('formula-ide-name').value = editData ? editData.name : '';
    const formulaTextArea = document.getElementById('formula-ide-expression');
    formulaTextArea.value = (editData && editData.expression) ? editData.expression : '';
    updateFormulaIDEHighlight();

    if (context === 'db-creation' && window.activeFieldRow) {
        document.getElementById('formula-ide-name').value = window.activeFieldRow.querySelector('.field-name-input').value;
        document.getElementById('formula-ide-expression').value = window.activeFieldRow.querySelector('.formula-expression-input').value;
        document.getElementById('formula-ide-is-summary').checked = false;
        document.getElementById('formula-ide-is-summary').parentElement.style.display = 'none';
    } else if (context === 'edit') {
        document.getElementById('formula-ide-is-summary').checked = editData.isSummary;
        document.getElementById('formula-ide-is-summary').parentElement.style.display = 'none';
    } else {
        document.getElementById('formula-ide-is-summary').checked = false;
        document.getElementById('formula-ide-is-summary').parentElement.style.display = 'flex';
    }

    // Overhaul reference panel
    formulaVarsList.innerHTML = '';
    const helpContainer = document.createElement('div');
    helpContainer.className = 'formula-help-container';

    const addSection = (title, items) => {
        const sec = document.createElement('div');
        sec.style.marginBottom = '1.5rem';
        sec.innerHTML = `<div style="color: #75715e; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; border-bottom: 1px solid #3e3e3e; padding-bottom: 0.2rem;">${title}</div>`;
        const list = document.createElement('ul');
        list.style.listStyle = 'none';
        list.style.padding = '0';

        items.forEach(item => {
            const li = document.createElement('li');
            li.style.marginBottom = '0.6rem';
            li.style.cursor = 'pointer';

            const code = document.createElement('div');
            code.style.fontFamily = 'monospace';
            code.style.fontSize = '0.9rem';
            code.style.color = '#d4d4d4';
            code.innerHTML = highlightPython(item.code);

            if (item.desc) {
                const d = document.createElement('div');
                d.style.color = '#75715e';
                d.style.fontSize = '0.75rem';
                d.textContent = `// ${item.desc}`;
                li.appendChild(d);
            }

            li.appendChild(code);
            li.onclick = () => {
                const start = formulaTextArea.selectionStart;
                const end = formulaTextArea.selectionEnd;
                const val = formulaTextArea.value;
                formulaTextArea.value = val.substring(0, start) + item.code + val.substring(end);
                formulaTextArea.focus();
                formulaTextArea.setSelectionRange(start + item.code.length, start + item.code.length);
                updateFormulaIDEHighlight();
            };
            list.appendChild(li);
        });
        sec.appendChild(list);
        helpContainer.appendChild(sec);
    };

    // 1. Variables
    const variables = [
        { code: 'row', desc: 'The current record' },
        { code: 'rows', desc: 'The list of all records' }
    ];
    addSection('Variables', variables);

    // 2. Database Fields
    let currentFields = [];
    if (activeCollectionId && (context === 'post-creation' || context === 'edit')) {
        const coll = collections.find(c => c.id === activeCollectionId);
        if (coll) currentFields = coll.schema.fields;
    } else {
        document.querySelectorAll('.field-row').forEach(row => {
            currentFields.push({ name: row.querySelector('.field-name-input').value });
        });
    }

    const fieldItems = currentFields.filter(f => f.name).map(f => {
        const camel = toCamelCase(f.name); // Using existing toCamelCase
        return { code: `row['${camel}']`, desc: f.name };
    });
    if (fieldItems.length > 0) addSection('Database Fields', fieldItems);

    // 3. Functions
    const functions = [
        { code: 'sum()', desc: 'Add values together' },
        { code: 'len()', desc: 'Count items' },
        { code: 'max()', desc: 'Highest value' },
        { code: 'min()', desc: 'Lowest value' }
    ];
    addSection('Functions', functions);

    // 4. Advanced Examples
    const examples = [
        { code: "sum(r['Price'] for r in rows)", desc: 'Calculate total price' },
        { code: "rows.sort('Date', ascending=True)", desc: 'Sort records' },
        { code: "rows.filter(lambda x: x['Qty'] > 0)", desc: 'Filter records' }
    ];
    addSection('Advanced Examples', examples);

    formulaVarsList.appendChild(helpContainer);
    formulaModal.classList.remove('hidden');
}

// Simple Python IDE Highlighter Logic
const formulaIDEInput = document.getElementById('formula-ide-expression');
const formulaIEDHighlight = document.getElementById('formula-ide-highlight');

function highlightPython(text) {
    if (!text) return '';

    // 1. Escape HTML entities first
    let escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // 2. Define patterns in priority order (using non-capturing groups for 1:1 mapping)
    const keywords = ['def', 'lambda', 'for', 'in', 'if', 'else', 'elif', 'return', 'and', 'or', 'not', 'True', 'False', 'None'];
    const parts = [
        { name: 'string', regex: /(?:'.*?'|".*?")/g, color: '#e6db74' },
        { name: 'keyword', regex: new RegExp(`\\b(?:${keywords.join('|')})\\b`, 'g'), color: '#f92672' },
        { name: 'function', regex: /\b[a-zA-Z_]\w*(?=\()/g, color: '#a6e22e' },
        { name: 'number', regex: /\b\d+(?:\.\d+)?\b/g, color: '#ae81ff' },
        { name: 'bracket', regex: /[\[\]{}()]/g, color: '#f8f8f2' }
    ];

    // Combine into one large regex with capturing groups for each part
    const combinedRegex = new RegExp(parts.map(p => `(${p.regex.source})`).join('|'), 'g');

    // 3. One-pass replacement
    return escaped.replace(combinedRegex, (...args) => {
        const match = args[0];
        // The mapping is now strictly 1:1 due to non-capturing groups in sources
        for (let i = 0; i < parts.length; i++) {
            if (args[i + 1] !== undefined) {
                return `<span style="color: ${parts[i].color};">${match}</span>`;
            }
        }
        return match;
    });
}

function updateFormulaIDEHighlight() {
    let text = formulaIDEInput.value;
    let highlighted = highlightPython(text);
    // Adding invisible trailing space to fix scrolling bug when text ends in newline
    highlighted += text.endsWith('\n') ? ' ' : '';
    formulaIEDHighlight.innerHTML = highlighted;
}

formulaIDEInput.addEventListener('input', updateFormulaIDEHighlight);
formulaIDEInput.addEventListener('scroll', () => {
    formulaIEDHighlight.scrollTop = formulaIDEInput.scrollTop;
    formulaIEDHighlight.scrollLeft = formulaIDEInput.scrollLeft;
});

document.querySelectorAll('.close-formula-modal').forEach(b => {
    b.addEventListener('click', () => formulaModal.classList.add('hidden'));
});

document.getElementById('formula-ide-save-btn').addEventListener('click', async () => {
    const name = document.getElementById('formula-ide-name').value;
    const expression = document.getElementById('formula-ide-expression').value;
    const isSummary = document.getElementById('formula-ide-is-summary').checked;

    if (!name || !expression) {
        showToast("Name and expression are required", "error");
        return;
    }

    if (formulaIdeContext === 'post-creation' || formulaIdeContext === 'edit') {
        try {
            const method = formulaIdeContext === 'edit' ? 'PUT' : 'POST';
            const endpoint = formulaIdeContext === 'edit'
                ? `/collections/${activeCollectionId}/formulas/${encodeURIComponent(formulaEditOldName)}`
                : `/collections/${activeCollectionId}/formulas`;

            const res = await fetch(`${API_URL}${endpoint}?is_summary=${isSummary}`, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, expression, is_summary: isSummary })
            });
            if (res.ok) {
                formulaModal.classList.add('hidden');
                showToast(`Formula ${formulaIdeContext === 'edit' ? 'updated' : 'added'} directly to database`, "success");
                await fetchCollections(); // reloads schema
                fetchActiveCollectionItems();
            } else {
                const data = await res.json();
                showToast(data.error || "Failed to save formula", "error");
            }
        } catch (e) {
            console.error(e);
            showToast("Server error", "error");
        }
    } else if (formulaIdeContext === 'field-config') {
        const formulaBtn = document.getElementById('field-modal-formula-btn');
        const expressionInput = document.getElementById('field-modal-expression');

        document.getElementById('field-modal-name').value = name;
        expressionInput.value = expression;
        formulaBtn.textContent = '</> Edit (' + expression.substring(0, 10) + '...)';
        formulaModal.classList.add('hidden');
    } else {
        // Just inject into the New DB modal fields
        if (window.activeFieldRow) {
            window.activeFieldRow.querySelector('.field-name-input').value = name;
            window.activeFieldRow.querySelector('.formula-expression-input').value = expression;
            window.activeFieldRow.querySelector('.open-formula-ide-btn').textContent = '</> Edit (' + expression.substring(0, 10) + '...)';
        }
        formulaModal.classList.add('hidden');
    }
});

// --- Field / Property Editor Modal ---

document.getElementById('add-property-btn').addEventListener('click', () => {
    openFieldModal();
});

document.getElementById('field-modal-type').addEventListener('change', (e) => {
    const targetSelect = document.getElementById('field-modal-target');
    const formulaBtn = document.getElementById('field-modal-formula-btn');

    // Always hide both first
    targetSelect.style.display = 'none';
    targetSelect.required = false;
    formulaBtn.style.display = 'none';

    if (e.target.value === 'Relation') {
        targetSelect.style.display = '';
        targetSelect.required = true;
        targetSelect.innerHTML = '<option value="">Select Target DB...</option>';
        collections.filter(c => c.id !== activeCollectionId).forEach(c => {
            let displayName = c.name;
            if (c.parent_item_title) {
                displayName += ` (${c.parent_item_title})`;
            }
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = displayName;
            targetSelect.appendChild(opt);
        });
    } else if (e.target.value === 'Formula') {
        formulaBtn.style.display = '';
    }
});

document.getElementById('field-modal-formula-btn').addEventListener('click', () => {
    openFormulaIDE('field-config');
});

function openFieldModal(editData = null) {
    fieldEditOldSafeName = editData ? editData.safeName : null;

    document.getElementById('field-modal-name').value = editData ? editData.name : '';
    document.getElementById('field-modal-title').textContent = editData ? "Rename Property" : "Configure Property";

    const typeSelect = document.getElementById('field-modal-type');
    typeSelect.value = editData ? editData.type : 'Text';
    typeSelect.disabled = !!editData; // Cannot change physical type after creation

    const targetSelect = document.getElementById('field-modal-target');
    const formulaBtn = document.getElementById('field-modal-formula-btn');
    const expressionInput = document.getElementById('field-modal-expression');

    // Reset visibility using explicit display styles for reliability
    targetSelect.style.display = 'none';
    formulaBtn.style.display = 'none';

    expressionInput.value = editData ? (editData.expression || '') : '';

    if (editData && editData.type === 'Relation') {
        targetSelect.style.display = '';
        targetSelect.innerHTML = `<option value="${editData.target_collection_id}">Existing Target</option>`;
        targetSelect.value = editData.target_collection_id;
        targetSelect.disabled = true;
    } else if (editData && editData.type === 'Formula') {
        formulaBtn.style.display = '';
        formulaBtn.textContent = editData.expression ? '</> Edit (' + editData.expression.substring(0, 10) + '...)' : '</> Edit Formula';
    } else {
        targetSelect.disabled = !!editData;
        typeSelect.dispatchEvent(new Event('change'));
    }

    fieldModal.classList.remove('hidden');
}

window.editField = function (name, safeName, type, targetCollectionId, e) {
    if (e) e.stopPropagation();
    openFieldModal({ name, safeName, type, target_collection_id: targetCollectionId });
};

window.deleteField = async function (safeName, e) {
    if (e) e.stopPropagation();
    if (!confirm(`Are you sure you want to delete the physical column "${safeName}"? This will ERASE all data stored within it!`)) return;
    try {
        const res = await fetch(`${API_URL}/collections/${activeCollectionId}/fields/${safeName}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            showToast("Column deleted", "success");
            await fetchCollections();
            fetchActiveCollectionItems();
        } else {
            const data = await res.json();
            showToast(data.error || "Failed to drop column", "error");
        }
    } catch (err) {
        showToast("Server error", "error");
    }
};

document.querySelectorAll('.close-field-modal').forEach(b => {
    b.addEventListener('click', () => fieldModal.classList.add('hidden'));
});

fieldForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('field-modal-name').value;
    const type = document.getElementById('field-modal-type').value;
    const target_collection_id = document.getElementById('field-modal-target').value || null;
    const expression = document.getElementById('field-modal-expression').value || null;

    try {
        const method = fieldEditOldSafeName ? 'PUT' : 'POST';
        const endpoint = fieldEditOldSafeName
            ? `/collections/${activeCollectionId}/fields/${fieldEditOldSafeName}`
            : `/collections/${activeCollectionId}/fields`;

        const payload = fieldEditOldSafeName
            ? { name, expression }
            : { name, type, target_collection_id, expression };

        const res = await fetch(`${API_URL}${endpoint}`, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            fieldModal.classList.add('hidden');
            showToast(`Column ${fieldEditOldSafeName ? 'renamed' : 'created'} successfully`, "success");
            await fetchCollections();
            fetchActiveCollectionItems();
        } else {
            const data = await res.json();
            showToast(data.error || "Failed to modify column", "error");
        }
    } catch (err) {
        showToast("Server error", "error");
    }
});


// Mobile menu logic
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileOverlay = document.getElementById('mobile-overlay');
const sidebar = document.querySelector('.sidebar');

if (mobileMenuBtn && mobileOverlay && sidebar) {
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
        mobileOverlay.classList.add('active');
    });

    mobileOverlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        mobileOverlay.classList.remove('active');
    });
}

// Start
fetchCollections();
