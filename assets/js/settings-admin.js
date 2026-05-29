async function loadUserManagement() {
    if (!window.db) return;

    // 1. Fetch data from our custom view
    const { data: users, error } = await window.db
        .from('view_user_roles')
        .select('*');

    if (error) return console.error(error);

    const tbody = document.getElementById('userTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    users.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${user.email}</td>
            <td>
                <select onchange="updateUserRole('${user.user_id}', this.value)">
                    <option value="customer" ${user.role === 'customer' ? 'selected' : ''}>Customer</option>
                    <option value="site-viewer" ${user.role === 'site-viewer' ? 'selected' : ''}>Site Viewer</option>
                    <option value="engineer" ${user.role === 'engineer' ? 'selected' : ''}>Engineer</option>
                    <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
                </select>
            </td>
            <td>${user.role === 'admin' ? '✓' : ''}</td>
        `;
        tbody.appendChild(row);
    });
}

// 3. The Function that saves the change
async function updateUserRole(userId, newRole) {
    const { error } = await window.db
        .from('user_roles')
        .upsert({ user_id: userId, role: newRole });

    if (error) {
        alert("Failed to update: " + error.message);
    } else {
        alert("Role updated! User needs to re-login to see changes.");
    }
}

window.loadUserManagement = loadUserManagement;
