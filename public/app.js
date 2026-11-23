(() => {
  const state = {
    accounts: [],
    searchQuery: '',
    deletingId: null,
  };

  // Lock Screen DOM references
  const lockScreen = document.getElementById('lockScreen');
  const appShell = document.getElementById('appShell');
  const loginForm = document.getElementById('loginForm');
  const vaultPasswordInput = document.getElementById('vaultPasswordInput');
  const toggleVaultPasswordBtn = document.getElementById('toggleVaultPasswordBtn');
  const loginError = document.getElementById('loginError');
  const unlockBtn = document.getElementById('unlockBtn');
  const lockBtn = document.getElementById('lockBtn');

  // DOM references
  const accountsGrid = document.getElementById('accountsGrid');
  const emptyState = document.getElementById('emptyState');
  const emptyTitle = document.getElementById('emptyTitle');
  const emptyDesc = document.getElementById('emptyDesc');
  const emptyAddBtn = document.getElementById('emptyAddBtn');

  const totalMainCount = document.getElementById('totalMainCount');
  const totalInviteCount = document.getElementById('totalInviteCount');
  const storagePathLabel = document.getElementById('storagePathLabel');
  const storagePill = document.getElementById('storagePill');

  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const searchMeta = document.getElementById('searchMeta');

  const openAddModalBtn = document.getElementById('openAddModalBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFileInput = document.getElementById('importFileInput');

  // Add/Edit Modal
  const accountModal = document.getElementById('accountModal');
  const modalTitle = document.getElementById('modalTitle');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const accountForm = document.getElementById('accountForm');
  const editingAccountId = document.getElementById('editingAccountId');
  const mainGmailInput = document.getElementById('mainGmailInput');
  const passwordInput = document.getElementById('passwordInput');
  const toggleModalPasswordBtn = document.getElementById('toggleModalPasswordBtn');
  const twoFactorInput = document.getElementById('twoFactorInput');
  const notesInput = document.getElementById('notesInput');
  const inviteRowsContainer = document.getElementById('inviteRowsContainer');
  const addInviteRowBtn = document.getElementById('addInviteRowBtn');

  // Delete Modal
  const deleteModal = document.getElementById('deleteModal');
  const deleteTargetEmail = document.getElementById('deleteTargetEmail');
  const closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');

  const toastContainer = document.getElementById('toastContainer');

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function highlightText(text, query) {
    const safe = escapeHtml(text);
    const trimmed = query.trim();
    if (!trimmed) return safe;
    const regex = new RegExp(`(${escapeRegex(escapeHtml(trimmed))})`, 'gi');
    return safe.replace(regex, '<mark>$1</mark>');
  }

  function formatDate(iso) {
    if (!iso) return '';
    try {
      const date = new Date(iso);
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast${type === 'error' ? ' error' : ''}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  async function copyToClipboard(text, label = 'Gmail') {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copied: ${text}`);
    } catch {
      const temp = document.createElement('textarea');
      temp.value = text;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      temp.remove();
      showToast(`${label} copied: ${text}`);
    }
  }

  async function fetchAccounts() {
    try {
      const res = await fetch('/api/accounts');
      if (res.status === 401) {
        showLockedView();
        return;
      }
      if (!res.ok) throw new Error('Failed to load accounts');
      const data = await res.json();
      state.accounts = Array.isArray(data.accounts) ? data.accounts : [];
      if (data.storageFile) {
        storagePathLabel.textContent = data.storageFile.replace(/\\/g, '/');
      }
      if (storagePill && data.storageMode) {
        storagePill.classList.toggle('warning', data.storageMode === 'ephemeral');
        const pillText = storagePill.querySelector('span:last-child');
        if (pillText) {
          if (data.storageMode === 'postgres') {
            pillText.textContent = 'Cloud DB Permanent';
          } else if (data.storageMode === 'ephemeral') {
            pillText.textContent = 'Temporary Disk';
          } else {
            pillText.textContent = 'Saved Locally';
          }
        }
      }
      render();
    } catch (err) {
      showToast('Could not load data. Please check that the server is running.', 'error');
      console.error(err);
    }
  }

  function getFilteredAccounts() {
    const q = state.searchQuery.trim().toLowerCase();
    if (!q) return state.accounts;

    return state.accounts.filter((acc) => {
      const inMain = (acc.mainGmail || '').toLowerCase().includes(q);
      const inTwoFactor = (acc.twoFactor || '').toLowerCase().includes(q);
      const inNotes = (acc.notes || '').toLowerCase().includes(q);
      const inInvites = (acc.inviteGmails || []).some(
        (inv) =>
          (inv.email || '').toLowerCase().includes(q) ||
          (inv.note || '').toLowerCase().includes(q)
      );
      return inMain || inTwoFactor || inNotes || inInvites;
    });
  }

  function updateStats() {
    totalMainCount.textContent = String(state.accounts.length);
    const totalInvites = state.accounts.reduce(
      (sum, acc) => sum + (Array.isArray(acc.inviteGmails) ? acc.inviteGmails.length : 0),
      0
    );
    totalInviteCount.textContent = String(totalInvites);
  }

  function render() {
    updateStats();
    const q = state.searchQuery.trim();
    const filtered = getFilteredAccounts();

    clearSearchBtn.hidden = !q;

    if (q) {
      const unit = filtered.length === 1 ? 'account' : 'accounts';
      searchMeta.textContent = `Found ${filtered.length} ${unit} matching "${q}" (out of ${state.accounts.length} saved)`;
    } else {
      const unit = state.accounts.length === 1 ? 'account' : 'accounts';
      searchMeta.textContent = state.accounts.length
        ? `Showing ${state.accounts.length} saved Gmail ${unit}`
        : '';
    }

    if (filtered.length === 0) {
      accountsGrid.innerHTML = '';
      emptyState.hidden = false;
      if (q) {
        emptyTitle.textContent = 'No matching accounts found';
        emptyDesc.innerHTML = `No Main Gmail, Invite Gmail, or details matched <strong>${escapeHtml(q)}</strong>.`;
        emptyAddBtn.hidden = true;
      } else {
        emptyTitle.textContent = 'No Gmail accounts saved yet';
        emptyDesc.innerHTML = 'Click <strong>Add Gmail</strong> above to securely save your first Gmail account and any invite Gmails under it.';
        emptyAddBtn.hidden = false;
      }
      return;
    }

    emptyState.hidden = true;

    const qLower = q.toLowerCase();

    accountsGrid.innerHTML = filtered
      .map((acc) => {
        const invites = Array.isArray(acc.inviteGmails) ? acc.inviteGmails : [];
        const inviteHtml = invites.length
          ? `<ul class="invite-list">${invites
              .map((inv) => {
                const isMatch =
                  qLower &&
                  ((inv.email || '').toLowerCase().includes(qLower) ||
                    (inv.note || '').toLowerCase().includes(qLower));
                return `
                  <li class="invite-item${isMatch ? ' matched' : ''}">
                    <div class="invite-info">
                      <div class="invite-email">${highlightText(inv.email, q)}</div>
                      ${inv.note ? `<div class="invite-note">${highlightText(inv.note, q)}</div>` : ''}
                    </div>
                    <button type="button" class="mini-btn copy-btn" data-copy="${escapeHtml(inv.email)}" data-copy-label="Invite Gmail" title="Copy Invite Gmail">
                      Copy
                    </button>
                  </li>
                `;
              })
              .join('')}</ul>`
          : `<p class="no-invites">No invite Gmails added</p>`;

        const hasPassword = Boolean(acc.password);
        const hasTwoFactor = Boolean(acc.twoFactor);
        const credsHtml =
          hasPassword || hasTwoFactor
            ? `
              <div class="creds-box">
                ${
                  hasPassword
                    ? `
                      <div class="cred-row">
                        <div class="cred-info">
                          <span class="cred-label">Password</span>
                          <span class="cred-value password-value" data-revealed="false" data-secret="${escapeHtml(acc.password)}">••••••••••••</span>
                        </div>
                        <div class="cred-actions">
                          <button type="button" class="mini-btn toggle-secret-btn" title="Show / Hide Password">Show</button>
                          <button type="button" class="mini-btn copy-btn" data-copy="${escapeHtml(acc.password)}" data-copy-label="Password" title="Copy Password">Copy</button>
                        </div>
                      </div>
                    `
                    : ''
                }
                ${
                  hasTwoFactor
                    ? `
                      <div class="cred-row">
                        <div class="cred-info">
                          <span class="cred-label">Two-Factor (2FA)</span>
                          <span class="cred-value">${highlightText(acc.twoFactor, q)}</span>
                        </div>
                        <div class="cred-actions">
                          <button type="button" class="mini-btn copy-btn" data-copy="${escapeHtml(acc.twoFactor)}" data-copy-label="Two-Factor (2FA)" title="Copy 2FA">Copy</button>
                        </div>
                      </div>
                    `
                    : ''
                }
              </div>
            `
            : '';

        return `
          <article class="account-card" data-id="${escapeHtml(acc.id)}">
            <div class="card-header">
              <div class="main-gmail-block">
                <div class="main-gmail-tag">
                  <span>Main Gmail</span>
                </div>
                <div class="main-gmail-row">
                  <div class="main-gmail-text">${highlightText(acc.mainGmail, q)}</div>
                </div>
              </div>
              <div class="card-actions">
                <button type="button" class="mini-btn copy-btn" data-copy="${escapeHtml(acc.mainGmail)}" data-copy-label="Main Gmail" title="Copy Main Gmail">
                  Copy
                </button>
                <button type="button" class="mini-btn edit-btn" data-id="${escapeHtml(acc.id)}" title="Edit or add invite Gmails">
                  Edit
                </button>
                <button type="button" class="mini-btn danger delete-btn" data-id="${escapeHtml(acc.id)}" title="Delete account">
                  Delete
                </button>
              </div>
            </div>

            ${credsHtml}

            <div class="invites-box">
              <div class="invites-box-header">
                <span>Invite Gmails</span>
                <span class="invite-count-pill">${invites.length}</span>
              </div>
              ${inviteHtml}
            </div>

            ${acc.notes ? `<div class="card-notes">${highlightText(acc.notes, q)}</div>` : ''}

            <div class="card-footer">
              <span>Saved: ${escapeHtml(formatDate(acc.createdAt))}</span>
              ${
                acc.updatedAt && acc.updatedAt !== acc.createdAt
                  ? `<span>Updated: ${escapeHtml(formatDate(acc.updatedAt))}</span>`
                  : ''
              }
            </div>
          </article>
        `;
      })
      .join('');
  }

  function syncInviteContainerVisibility() {
    inviteRowsContainer.hidden = inviteRowsContainer.children.length === 0;
  }

  // Invite rows inside Add/Edit modal
  function createInviteRow(email = '', note = '', id = '') {
    const row = document.createElement('div');
    row.className = 'invite-row';
    if (id) row.dataset.inviteId = id;

    row.innerHTML = `
      <input
        type="email"
        class="invite-email-input"
        placeholder="invite-user@gmail.com"
        value="${escapeHtml(email)}"
        autocomplete="off"
      />
      <input
        type="text"
        class="invite-note-input"
        placeholder="Note (optional)"
        value="${escapeHtml(note)}"
        autocomplete="off"
      />
      <button type="button" class="remove-invite-btn" title="Remove invite row" aria-label="Remove">&times;</button>
    `;

    row.querySelector('.remove-invite-btn').addEventListener('click', () => {
      row.remove();
      syncInviteContainerVisibility();
    });

    return row;
  }

  function openAddModal(account = null) {
    accountForm.reset();
    inviteRowsContainer.innerHTML = '';
    passwordInput.type = 'password';
    toggleModalPasswordBtn.textContent = 'Show';

    if (account) {
      modalTitle.textContent = 'Edit Gmail Account';
      editingAccountId.value = account.id;
      mainGmailInput.value = account.mainGmail || '';
      passwordInput.value = account.password || '';
      twoFactorInput.value = account.twoFactor || '';
      notesInput.value = account.notes || '';

      const invites = Array.isArray(account.inviteGmails) ? account.inviteGmails : [];
      invites.forEach((inv) => {
        inviteRowsContainer.appendChild(createInviteRow(inv.email, inv.note, inv.id));
      });
    } else {
      modalTitle.textContent = 'Add Gmail';
      editingAccountId.value = '';
    }

    syncInviteContainerVisibility();
    accountModal.hidden = false;
    setTimeout(() => mainGmailInput.focus(), 30);
  }

  function closeAddModal() {
    accountModal.hidden = true;
  }

  function openDeleteModal(account) {
    state.deletingId = account.id;
    deleteTargetEmail.textContent = account.mainGmail;
    deleteModal.hidden = false;
  }

  function closeDeleteModal() {
    state.deletingId = null;
    deleteModal.hidden = true;
  }

  // Event listeners
  openAddModalBtn.addEventListener('click', () => openAddModal());
  emptyAddBtn.addEventListener('click', () => openAddModal());
  closeModalBtn.addEventListener('click', closeAddModal);
  cancelModalBtn.addEventListener('click', closeAddModal);

  accountModal.addEventListener('click', (e) => {
    if (e.target === accountModal) closeAddModal();
  });

  toggleModalPasswordBtn.addEventListener('click', () => {
    const isHidden = passwordInput.type === 'password';
    passwordInput.type = isHidden ? 'text' : 'password';
    toggleModalPasswordBtn.textContent = isHidden ? 'Hide' : 'Show';
  });

  addInviteRowBtn.addEventListener('click', () => {
    const newRow = createInviteRow();
    inviteRowsContainer.appendChild(newRow);
    syncInviteContainerVisibility();
    newRow.querySelector('.invite-email-input').focus();
  });

  accountForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const mainGmail = mainGmailInput.value.trim();
    if (!mainGmail) {
      showToast('Please enter a Main Gmail address.', 'error');
      mainGmailInput.focus();
      return;
    }

    const inviteGmails = [];
    inviteRowsContainer.querySelectorAll('.invite-row').forEach((row) => {
      const email = row.querySelector('.invite-email-input').value.trim();
      const note = row.querySelector('.invite-note-input').value.trim();
      if (email) {
        const item = { email, note };
        if (row.dataset.inviteId) item.id = row.dataset.inviteId;
        inviteGmails.push(item);
      }
    });

    const payload = {
      mainGmail,
      password: passwordInput.value.trim(),
      twoFactor: twoFactorInput.value.trim(),
      notes: notesInput.value.trim(),
      inviteGmails,
    };

    const editId = editingAccountId.value;
    const url = editId ? `/api/accounts/${encodeURIComponent(editId)}` : '/api/accounts';
    const method = editId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save account');
      }

      closeAddModal();
      await fetchAccounts();
      showToast(editId ? 'Account updated successfully!' : 'Gmail account saved to local folder!');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Search events
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    render();
  });

  clearSearchBtn.addEventListener('click', () => {
    state.searchQuery = '';
    searchInput.value = '';
    searchInput.focus();
    render();
  });

  // Card action delegation
  accountsGrid.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.toggle-secret-btn');
    if (toggleBtn) {
      const credRow = toggleBtn.closest('.cred-row');
      const valueEl = credRow && credRow.querySelector('.password-value');
      if (valueEl) {
        const revealed = valueEl.dataset.revealed === 'true';
        if (revealed) {
          valueEl.textContent = '••••••••••••';
          valueEl.dataset.revealed = 'false';
          toggleBtn.textContent = 'Show';
        } else {
          valueEl.textContent = valueEl.dataset.secret || '';
          valueEl.dataset.revealed = 'true';
          toggleBtn.textContent = 'Hide';
        }
      }
      return;
    }

    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      copyToClipboard(copyBtn.dataset.copy, copyBtn.dataset.copyLabel || 'Gmail');
      return;
    }

    const editBtn = e.target.closest('.edit-btn');
    if (editBtn) {
      const acc = state.accounts.find((a) => a.id === editBtn.dataset.id);
      if (acc) openAddModal(acc);
      return;
    }

    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
      const acc = state.accounts.find((a) => a.id === deleteBtn.dataset.id);
      if (acc) openDeleteModal(acc);
    }
  });

  // Delete modal events
  closeDeleteModalBtn.addEventListener('click', closeDeleteModal);
  cancelDeleteBtn.addEventListener('click', closeDeleteModal);
  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });

  confirmDeleteBtn.addEventListener('click', async () => {
    if (!state.deletingId) return;
    try {
      const res = await fetch(`/api/accounts/${encodeURIComponent(state.deletingId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete account');
      closeDeleteModal();
      await fetchAccounts();
      showToast('Account deleted.');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Export & Import backup
  exportBtn.addEventListener('click', () => {
    window.location.href = '/api/export';
    showToast('Downloading JSON backup...');
  });

  importBtn.addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      await fetchAccounts();
      showToast(`Imported ${data.imported} new account(s)!`);
    } catch (err) {
      showToast(`Import failed: ${err.message}`, 'error');
    }
  });

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!accountModal.hidden) closeAddModal();
      if (!deleteModal.hidden) closeDeleteModal();
    }
  });

  // Auth / Lock Screen logic
  function showLockedView() {
    state.accounts = [];
    accountsGrid.innerHTML = '';
    appShell.hidden = true;
    lockScreen.hidden = false;
    loginError.hidden = true;
    vaultPasswordInput.value = '';
    vaultPasswordInput.type = 'password';
    toggleVaultPasswordBtn.textContent = 'Show';
    setTimeout(() => vaultPasswordInput.focus(), 30);
  }

  function showUnlockedView() {
    lockScreen.hidden = true;
    appShell.hidden = false;
    loginError.hidden = true;
    fetchAccounts();
  }

  toggleVaultPasswordBtn.addEventListener('click', () => {
    const isHidden = vaultPasswordInput.type === 'password';
    vaultPasswordInput.type = isHidden ? 'text' : 'password';
    toggleVaultPasswordBtn.textContent = isHidden ? 'Hide' : 'Show';
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = vaultPasswordInput.value;
    if (!password) return;

    loginError.hidden = true;
    unlockBtn.disabled = true;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        loginError.textContent = data.error || 'Incorrect password.';
        loginError.hidden = false;
        vaultPasswordInput.select();
        return;
      }
      showUnlockedView();
      showToast('Vault unlocked.');
    } catch {
      loginError.textContent = 'Connection error. Please try again.';
      loginError.hidden = false;
    } finally {
      unlockBtn.disabled = false;
    }
  });

  lockBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    showLockedView();
    showToast('Vault locked.');
  });

  async function checkAuthAndInit() {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      if (data && data.authenticated) {
        showUnlockedView();
      } else {
        showLockedView();
      }
    } catch {
      showLockedView();
    }
  }

  // Initial load
  checkAuthAndInit();
})();
