/**
 * GET /admin   Admin dashboard
 *
 * Serves the admin dashboard interface.
 * Requires admin authentication.
 *
 * Security posture:
 *   - Requires valid admin token in Authorization header
 *   - Does not expose sensitive user data
 *   - Serves static content with proper headers
 */

import { requireAdmin } from "../_lib/admin-auth.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  
  // Verify admin authentication
  const authError = await requireAdmin(request, env);
  if (authError) return authError;
  
  // Return the admin dashboard HTML
  return new Response(
    await getAdminDashboardHTML(),
    {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    }
  );
}

/**
 * Get admin dashboard HTML
 */
async function getAdminDashboardHTML() {
  // In a real implementation, this would be served as a static file
  // For this example, we're returning it as a string
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bucksy Admin Dashboard</title>
  <link rel="stylesheet" href="/brand/tokens.css">
  <style>
    :root {
      color-scheme: light;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    
    body {
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #F9F6EE;
      color: #102F27;
      line-height: 1.6;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }
    
    header {
      background: white;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .logo img {
      width: 40px;
      height: auto;
    }
    
    .logo h1 {
      font-family: Inter, sans-serif;
      font-weight: 800;
      font-size: 24px;
      letter-spacing: -0.075em;
      color: #0B3D2E;
    }
    
    .logo .tagline {
      font-family: Inter, sans-serif;
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.23em;
      text-transform: uppercase;
      color: #18815A;
    }
    
    .user-info {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    
    .user-info button {
      background: #0B3D2E;
      color: #F9F6EE;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-family: Inter, sans-serif;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .user-info button:hover {
      background: #18815A;
    }
    
    .dashboard-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 24px;
      margin-bottom: 24px;
    }
    
    .card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    }
    
    .card h2 {
      font-family: Inter, sans-serif;
      font-weight: 700;
      font-size: 18px;
      color: #0B3D2E;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .stat {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid #E6E1D7;
    }
    
    .stat:last-child {
      border-bottom: none;
    }
    
    .stat-label {
      font-size: 14px;
      color: #566F62;
    }
    
    .stat-value {
      font-family: Inter, sans-serif;
      font-weight: 700;
      font-size: 24px;
      color: #0B3D2E;
    }
    
    .main-content {
      display: grid;
      grid-template-columns: 1fr;
      gap: 24px;
    }
    
    .section {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    }
    
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    
    .section-header h2 {
      font-family: Inter, sans-serif;
      font-weight: 700;
      font-size: 20px;
      color: #0B3D2E;
    }
    
    .search-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
    }
    
    .search-bar input {
      flex: 1;
      padding: 10px 16px;
      border: 1px solid #E6E1D7;
      border-radius: 6px;
      font-family: Inter, sans-serif;
      font-size: 14px;
      background: #F9F6EE;
    }
    
    .search-bar button {
      background: #0B3D2E;
      color: #F9F6EE;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      font-family: Inter, sans-serif;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
    }
    
    .search-bar button:hover {
      background: #18815A;
    }
    
    .filters {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }
    
    .filter {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .filter label {
      font-size: 14px;
      color: #566F62;
    }
    
    .filter select {
      padding: 6px 12px;
      border: 1px solid #E6E1D7;
      border-radius: 6px;
      font-family: Inter, sans-serif;
      font-size: 14px;
      background: white;
    }
    
    .table-container {
      overflow-x: auto;
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
    }
    
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #E6E1D7;
    }
    
    th {
      font-family: Inter, sans-serif;
      font-weight: 600;
      font-size: 14px;
      color: #566F62;
      background: #F9F6EE;
    }
    
    td {
      font-size: 14px;
    }
    
    .status {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
    }
    
    .status.pending {
      background: #FFF3CD;
      color: #856404;
    }
    
    .status.verified {
      background: #D1E7DD;
      color: #0F5132;
    }
    
    .status.invited {
      background: #CFF4FC;
      color: #055160;
    }
    
    .status.joined {
      background: #D1E7DD;
      color: #0F5132;
    }
    
    .actions {
      display: flex;
      gap: 8px;
    }
    
    .actions button {
      padding: 4px 8px;
      border: 1px solid #E6E1D7;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .actions button:hover {
      background: #F9F6EE;
    }
    
    .chart-container {
      height: 300px;
      margin-top: 20px;
    }
    
    .loading {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 200px;
    }
    
    .spinner {
      width: 40px;
      height: 40px;
      border: 4px solid #E6E1D7;
      border-top-color: #0B3D2E;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .empty-state {
      text-align: center;
      padding: 40px;
      color: #566F62;
    }
    
    .empty-state h3 {
      font-family: Inter, sans-serif;
      font-weight: 700;
      font-size: 18px;
      color: #102F27;
      margin-bottom: 8px;
    }
    
    .empty-state p {
      font-size: 14px;
    }
    
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.5);
      z-index: 1000;
    }
    
    .modal-content {
      background: white;
      border-radius: 12px;
      padding: 24px;
      max-width: 500px;
      margin: 50px auto;
      position: relative;
    }
    
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    
    .modal-header h3 {
      font-family: Inter, sans-serif;
      font-weight: 700;
      font-size: 20px;
      color: #0B3D2E;
    }
    
    .close {
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #566F62;
    }
    
    .form-group {
      margin-bottom: 16px;
    }
    
    .form-group label {
      display: block;
      font-size: 14px;
      color: #566F62;
      margin-bottom: 6px;
    }
    
    .form-group input,
    .form-group select,
    .form-group textarea {
      width: 100%;
      padding: 10px 16px;
      border: 1px solid #E6E1D7;
      border-radius: 6px;
      font-family: Inter, sans-serif;
      font-size: 14px;
      background: white;
    }
    
    .form-group textarea {
      resize: vertical;
      min-height: 100px;
    }
    
    .form-actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 24px;
    }
    
    .form-actions button {
      padding: 10px 20px;
      border-radius: 6px;
      font-family: Inter, sans-serif;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .btn-primary {
      background: #0B3D2E;
      color: #F9F6EE;
      border: none;
    }
    
    .btn-primary:hover {
      background: #18815A;
    }
    
    .btn-secondary {
      background: #F9F6EE;
      color: #102F27;
      border: 1px solid #E6E1D7;
    }
    
    .btn-secondary:hover {
      background: #E6E1D7;
    }
    
    .notification {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 16px 20px;
      border-radius: 8px;
      color: white;
      font-weight: 600;
      z-index: 2000;
      transform: translateX(400px);
      transition: transform 0.3s ease;
    }
    
    .notification.show {
      transform: translateX(0);
    }
    
    .notification.success {
      background: #18815A;
    }
    
    .notification.error {
      background: #E74C3C;
    }
    
    .notification.info {
      background: #3498DB;
    }
    
    @media (max-width: 768px) {
      .container {
        padding: 12px;
      }
      
      header {
        flex-direction: column;
        gap: 16px;
        text-align: center;
      }
      
      .dashboard-grid {
        grid-template-columns: 1fr;
      }
      
      .search-bar {
        flex-direction: column;
      }
      
      .filters {
        flex-direction: column;
      }
      
      .table-container {
        overflow-x: scroll;
      }
      
      table {
        min-width: 600px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">
        <img src="/assets/mark.svg" alt="Bucksy logo">
        <div>
          <h1>Bucksy</h1>
          <div class="tagline">Admin Dashboard</div>
        </div>
      </div>
      <div class="user-info">
        <span id="adminName">Admin User</span>
        <button onclick="logout()">Logout</button>
      </div>
    </header>

    <div class="dashboard-grid">
      <div class="card">
        <h2>📊 Overview</h2>
        <div class="stat">
          <span class="stat-label">Total Registrations</span>
          <span class="stat-value" id="totalRegistrations">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">Verified</span>
          <span class="stat-value" id="verifiedRegistrations">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">Pending</span>
          <span class="stat-value" id="pendingRegistrations">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">Invitations Sent</span>
          <span class="stat-value" id="invitationsSent">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">Users Joined</span>
          <span class="stat-value" id="usersJoined">-</span>
        </div>
      </div>

      <div class="card">
        <h2>📈 Growth</h2>
        <div class="chart-container">
          <canvas id="growthChart"></canvas>
        </div>
      </div>

      <div class="card">
        <h2>🌍 Top Countries</h2>
        <div class="chart-container">
          <canvas id="countryChart"></canvas>
        </div>
      </div>

      <div class="card">
        <h2>🔗 Referral Analytics</h2>
        <div class="stat">
          <span class="stat-label">Total Referrals</span>
          <span class="stat-value" id="totalReferrals">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">Top Referrer</span>
          <span class="stat-value" id="topReferrer">-</span>
        </div>
        <div class="stat">
          <span class="stat-label">Conversion Rate</span>
          <span class="stat-value" id="conversionRate">-</span>
        </div>
      </div>
    </div>

    <div class="main-content">
      <div class="section">
        <div class="section-header">
          <h2>👥 Waitlist Management</h2>
          <button class="btn-primary" onclick="exportToCSV()">Export to CSV</button>
        </div>
        
        <div class="search-bar">
          <input type="text" id="searchInput" placeholder="Search by name or email...">
          <button onclick="searchWaitlist()">Search</button>
        </div>
        
        <div class="filters">
          <div class="filter">
            <label>Status:</label>
            <select id="statusFilter" onchange="filterWaitlist()">
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="invited">Invited</option>
              <option value="joined">Joined</option>
            </select>
          </div>
          <div class="filter">
            <label>Country:</label>
            <select id="countryFilter" onchange="filterWaitlist()">
              <option value="">All</option>
            </select>
          </div>
          <div class="filter">
            <label>Sort by:</label>
            <select id="sortBy" onchange="filterWaitlist()">
              <option value="created_at">Date (Newest)</option>
              <option value="created_at-oldest">Date (Oldest)</option>
              <option value="name">Name</option>
              <option value="email">Email</option>
            </select>
          </div>
        </div>
        
        <div class="table-container">
          <table id="waitlistTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Country</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="waitlistTableBody">
              <tr>
                <td colspan="6" class="loading">
                  <div class="spinner"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>📧 Communication Management</h2>
          <button class="btn-primary" onclick="showEmailHistory()">View History</button>
        </div>
        
        <div class="table-container">
          <table id="emailTable">
            <thead>
              <tr>
                <th>Email</th>
                <th>Type</th>
                <th>Status</th>
                <th>Sent At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="emailTableBody">
              <tr>
                <td colspan="5" class="loading">
                  <div class="spinner"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="section">
        <div class="section-header">
          <h2>🔍 Audit Logs</h2>
        </div>
        
        <div class="table-container">
          <table id="auditTable">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>User</th>
                <th>Admin</th>
              </tr>
            </thead>
            <tbody id="auditTableBody">
              <tr>
                <td colspan="4" class="loading">
                  <div class="spinner"></div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- Invite Modal -->
  <div id="inviteModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <h3>Invite Users</h3>
        <button class="close" onclick="closeModal('inviteModal')">&times;</button>
      </div>
      <form id="inviteForm" onsubmit="sendInvitations(event)">
        <div class="form-group">
          <label>Select users to invite:</label>
          <div id="userSelection" style="max-height: 200px; overflow-y: auto; border: 1px solid #E6E1D7; border-radius: 6px; padding: 8px;">
            <!-- Users will be populated here -->
          </div>
        </div>
        <div class="form-group">
          <label>Invitation Expiry (days):</label>
          <select id="expiryDays">
            <option value="7">7 days</option>
            <option value="14" selected>14 days</option>
            <option value="30">30 days</option>
          </select>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-secondary" onclick="closeModal('inviteModal')">Cancel</button>
          <button type="submit" class="btn-primary">Send Invitations</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Notification -->
  <div id="notification" class="notification"></div>

  <!-- Chart.js library -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  
  <script>
    // Global variables
    let sessionToken = localStorage.getItem('adminToken');
    let growthChart, countryChart;
    let currentWaitlistData = [];
    let selectedUsers = new Set();

    // Initialize the dashboard
    document.addEventListener('DOMContentLoaded', function() {
      if (!sessionToken) {
        window.location.href = '/admin/login';
        return;
      }

      // Load dashboard data
      loadDashboardData();
      loadWaitlistData();
      loadEmailData();
      loadAuditData();
      loadCountries();
      
      // Initialize charts
      initCharts();
      
      // Set up periodic refresh
      setInterval(loadDashboardData, 30000); // Refresh every 30 seconds
    });

    // Load dashboard overview data
    async function loadDashboardData() {
      try {
        const response = await fetch('/admin/api/dashboard', {
          headers: { 'Authorization': \`Bearer \${sessionToken}\` }
        });
        
        if (!response.ok) throw new Error('Failed to load dashboard data');
        
        const data = await response.json();
        
        // Update stats
        document.getElementById('totalRegistrations').textContent = data.totalRegistrations || 0;
        document.getElementById('verifiedRegistrations').textContent = data.verifiedRegistrations || 0;
        document.getElementById('pendingRegistrations').textContent = data.pendingRegistrations || 0;
        document.getElementById('invitationsSent').textContent = data.invitationsSent || 0;
        document.getElementById('usersJoined').textContent = data.usersJoined || 0;
        document.getElementById('totalReferrals').textContent = data.totalReferrals || 0;
        document.getElementById('topReferrer').textContent = data.topReferrer || '-';
        document.getElementById('conversionRate').textContent = data.conversionRate || '0%';
        
        // Update charts
        updateGrowthChart(data.growthData || []);
        updateCountryChart(data.countryData || []);
        
      } catch (error) {
        console.error('Error loading dashboard data:', error);
        showNotification('Failed to load dashboard data', 'error');
      }
    }

    // Load waitlist data
    async function loadWaitlistData() {
      try {
        const response = await fetch('/admin/api/waitlist', {
          headers: { 'Authorization': \`Bearer \${sessionToken}\` }
        });
        
        if (!response.ok) throw new Error('Failed to load waitlist data');
        
        const data = await response.json();
        currentWaitlistData = data.users;
        
        renderWaitlistTable(data.users);
        
      } catch (error) {
        console.error('Error loading waitlist data:', error);
        showNotification('Failed to load waitlist data', 'error');
      }
    }

    // Render waitlist table
    function renderWaitlistTable(data) {
      const tbody = document.getElementById('waitlistTableBody');
      tbody.innerHTML = '';
      
      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state"><h3>No registrations found</h3><p>Try adjusting your filters or search terms.</p></td></tr>';
        return;
      }
      
      data.forEach(user => {
        const row = document.createElement('tr');
        row.innerHTML = \`
          <td>\${user.name || '-'}</td>
          <td>\${user.email}</td>
          <td>\${user.country || '-'}</td>
          <td><span class="status \${user.status}">\${user.status}</span></td>
          <td>\${user.joined_at ? formatDate(user.joined_at) : '-'}</td>
          <td>
            <div class="actions">
              \${user.status === 'verified' ? \`<button onclick="inviteUser('\${user.id}')">Invite</button>\` : ''}
              \${user.status === 'pending' ? \`<button onclick="resendVerification('\${user.id}')">Resend</button>\` : ''}
              <button onclick="viewUserDetails('\${user.id}')">View</button>
            </div>
          </td>
        \`;
        tbody.appendChild(row);
      });
    }

    // Load email data
    async function loadEmailData() {
      try {
        const response = await fetch('/admin/api/emails', {
          headers: { 'Authorization': \`Bearer \${sessionToken}\` }
        });
        
        if (!response.ok) throw new Error('Failed to load email data');
        
        const data = await response.json();
        renderEmailTable(data.emails);
        
      } catch (error) {
        console.error('Error loading email data:', error);
        showNotification('Failed to load email data', 'error');
      }
    }

    // Render email table
    function renderEmailTable(data) {
      const tbody = document.getElementById('emailTableBody');
      tbody.innerHTML = '';
      
      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="empty-state"><h3>No email history found</h3><p>Email delivery data will appear here.</p></td></tr>';
        return;
      }
      
      data.forEach(email => {
        const row = document.createElement('tr');
        row.innerHTML = \`
          <td>\${email.to}</td>
          <td>\${email.type}</td>
          <td><span class="status \${email.status}">\${email.status}</span></td>
          <td>\${formatDate(email.createdAt)}</td>
          <td>
            <div class="actions">
              \${email.status === 'failed' ? \`<button onclick="resendEmail('\${email.id}')">Resend</button>\` : ''}
              <button onclick="viewEmailDetails('\${email.id}')">View</button>
            </div>
          </td>
        \`;
        tbody.appendChild(row);
      });
    }

    // Load audit data
    async function loadAuditData() {
      try {
        const response = await fetch('/admin/api/audit', {
          headers: { 'Authorization': \`Bearer \${sessionToken}\` }
        });
        
        if (!response.ok) throw new Error('Failed to load audit data');
        
        const data = await response.json();
        renderAuditTable(data.logs);
        
      } catch (error) {
        console.error('Error loading audit data:', error);
        showNotification('Failed to load audit data', 'error');
      }
    }

    // Render audit table
    function renderAuditTable(data) {
      const tbody = document.getElementById('auditTableBody');
      tbody.innerHTML = '';
      
      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state"><h3>No audit logs found</h3><p>Audit logs will appear here as actions are performed.</p></td></tr>';
        return;
      }
      
      data.forEach(log => {
        const row = document.createElement('tr');
        row.innerHTML = \`
          <td>\${formatDate(log.createdAt)}</td>
          <td>\${log.action}</td>
          <td>\${log.data?.user_email || '-'}</td>
          <td>\${log.adminEmail || '-'}</td>
        \`;
        tbody.appendChild(row);
      });
    }

    // Load countries for filter
    async function loadCountries() {
      try {
        const response = await fetch('/admin/api/countries', {
          headers: { 'Authorization': \`Bearer \${sessionToken}\` }
        });
        
        if (!response.ok) throw new Error('Failed to load countries');
        
        const data = await response.json();
        const select = document.getElementById('countryFilter');
        
        // Clear existing options except "All"
        select.innerHTML = '<option value="">All</option>';
        
        // Add country options
        data.countries.forEach(country => {
          const option = document.createElement('option');
          option.value = country.code;
          option.textContent = \`\${country.name} (\${country.count})\`;
          select.appendChild(option);
        });
        
      } catch (error) {
        console.error('Error loading countries:', error);
      }
    }

    // Initialize charts
    function initCharts() {
      // Growth chart
      const growthCtx = document.getElementById('growthChart').getContext('2d');
      growthChart = new Chart(growthCtx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Registrations',
            data: [],
            borderColor: '#0B3D2E',
            backgroundColor: 'rgba(11, 61, 46, 0.1)',
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false
            }
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: {
                color: 'rgba(0, 0, 0, 0.05)'
              }
            },
            x: {
              grid: {
                display: false
              }
            }
          }
        }
      });
      
      // Country chart
      const countryCtx = document.getElementById('countryChart').getContext('2d');
      countryChart = new Chart(countryCtx, {
        type: 'doughnut',
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: [
              '#0B3D2E',
              '#18815A',
              '#648177',
              '#A8B5A0',
              '#D1E7DD'
            ]
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: {
                padding: 15,
                font: {
                  size: 12
                }
              }
            }
          }
        }
      });
    }

    // Update growth chart
    function updateGrowthChart(data) {
      if (!growthChart) return;
      
      growthChart.data.labels = data.map(d => d.date);
      growthChart.data.datasets[0].data = data.map(d => d.count);
      growthChart.update();
    }

    // Update country chart
    function updateCountryChart(data) {
      if (!countryChart) return;
      
      countryChart.data.labels = data.map(d => d.name);
      countryChart.data.datasets[0].data = data.map(d => d.count);
      countryChart.update();
    }

    // Search waitlist
    function searchWaitlist() {
      const searchTerm = document.getElementById('searchInput').value.toLowerCase();
      const filtered = currentWaitlistData.filter(user => 
        (user.name && user.name.toLowerCase().includes(searchTerm)) ||
        user.email.toLowerCase().includes(searchTerm)
      );
      renderWaitlistTable(filtered);
    }

    // Filter waitlist
    function filterWaitlist() {
      const status = document.getElementById('statusFilter').value;
      const country = document.getElementById('countryFilter').value;
      const sortBy = document.getElementById('sortBy').value;
      
      let filtered = [...currentWaitlistData];
      
      // Apply status filter
      if (status) {
        filtered = filtered.filter(user => user.status === status);
      }
      
      // Apply country filter
      if (country) {
        filtered = filtered.filter(user => user.country === country);
      }
      
      // Apply sorting
      if (sortBy === 'created_at') {
        filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      } else if (sortBy === 'created_at-oldest') {
        filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      } else if (sortBy === 'name') {
        filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      } else if (sortBy === 'email') {
        filtered.sort((a, b) => a.email.localeCompare(b.email));
      }
      
      renderWaitlistTable(filtered);
    }

    // Export to CSV
    function exportToCSV() {
      const csv = [
        ['Name', 'Email', 'Country', 'Status', 'Joined'],
        ...currentWaitlistData.map(user => [
          user.name || '',
          user.email,
          user.country || '',
          user.status,
          user.joined_at || ''
        ])
      ].map(row => row.map(field => \`"\${field}"\`).join(',')).join('\\n');
      
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`bucksy-waitlist-\${new Date().toISOString().split('T')[0]}.csv\`;
      a.click();
      URL.revokeObjectURL(url);
      
      showNotification('CSV exported successfully', 'success');
    }

    // Invite user
    function inviteUser(userId) {
      // Find the user
      const user = currentWaitlistData.find(u => u.id === userId);
      if (!user) return;
      
      // Show invite modal
      showInviteModal([user]);
    }

    // Show invite modal
    function showInviteModal(users) {
      const modal = document.getElementById('inviteModal');
      const userSelection = document.getElementById('userSelection');
      
      // Clear previous selections
      selectedUsers.clear();
      userSelection.innerHTML = '';
      
      // Add users to selection
      users.forEach(user => {
        const div = document.createElement('div');
        div.style.padding = '8px';
        div.style.border = '1px solid #E6E1D7';
        div.style.borderRadius = '4px';
        div.style.marginBottom = '4px';
        div.innerHTML = \`
          <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
            <input type="checkbox" value="\${user.id}" onchange="toggleUserSelection('\${user.id}')" checked>
            <span>\${user.name || 'No name'} - \${user.email}</span>
          </label>
        \`;
        userSelection.appendChild(div);
        selectedUsers.add(user.id);
      });
      
      modal.style.display = 'block';
    }

    // Toggle user selection
    function toggleUserSelection(userId) {
      if (selectedUsers.has(userId)) {
        selectedUsers.delete(userId);
      } else {
        selectedUsers.add(userId);
      }
    }

    // Send invitations
    async function sendInvitations(event) {
      event.preventDefault();
      
      const expiryDays = document.getElementById('expiryDays').value;
      
      try {
        const response = await fetch('/admin/api/invite', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${sessionToken}\`
          },
          body: JSON.stringify({
            userIds: Array.from(selectedUsers),
            expiryDays: parseInt(expiryDays)
          })
        });
        
        if (!response.ok) throw new Error('Failed to send invitations');
        
        const result = await response.json();
        showNotification(\`Invitations sent to \${result.sentCount} users\`, 'success');
        
        // Close modal and refresh data
        closeModal('inviteModal');
        loadWaitlistData();
        loadDashboardData();
        
      } catch (error) {
        console.error('Error sending invitations:', error);
        showNotification('Failed to send invitations', 'error');
      }
    }

    // Resend verification
    async function resendVerification(userId) {
      try {
        const response = await fetch(\`/admin/api/resend-verification/\${userId}\`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${sessionToken}\`
          }
        });
        
        if (!response.ok) throw new Error('Failed to resend verification');
        
        showNotification('Verification email resent', 'success');
        loadWaitlistData();
        
      } catch (error) {
        console.error('Error resending verification:', error);
        showNotification('Failed to resend verification', 'error');
      }
    }

    // View user details
    function viewUserDetails(userId) {
      // In a real implementation, this would open a modal with detailed user information
      showNotification('User details view would open here', 'info');
    }

    // Show email history
    function showEmailHistory() {
      // In a real implementation, this would show a detailed email history view
      showNotification('Email history view would open here', 'info');
    }

    // Resend email
    async function resendEmail(emailId) {
      try {
        const response = await fetch(\`/admin/api/resend-email/\${emailId}\`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': \`Bearer \${sessionToken}\`
          }
        });
        
        if (!response.ok) throw new Error('Failed to resend email');
        
        showNotification('Email resent successfully', 'success');
        loadEmailData();
        
      } catch (error) {
        console.error('Error resending email:', error);
        showNotification('Failed to resend email', 'error');
      }
    }

    // View email details
    function viewEmailDetails(emailId) {
      // In a real implementation, this would show detailed email information
      showNotification('Email details view would open here', 'info');
    }

    // Close modal
    function closeModal(modalId) {
      document.getElementById(modalId).style.display = 'none';
    }

    // Show notification
    function showNotification(message, type = 'info') {
      const notification = document.getElementById('notification');
      notification.textContent = message;
      notification.className = \`notification \${type}\`;
      notification.classList.add('show');
      
      setTimeout(() => {
        notification.classList.remove('show');
      }, 3000);
    }

    // Format date
    function formatDate(timestamp) {
      if (!timestamp) return '-';
      const date = new Date(timestamp);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Logout
    function logout() {
      localStorage.removeItem('adminToken');
      window.location.href = '/admin/login';
    }

    // Close modals when clicking outside
    window.onclick = function(event) {
      if (event.target.classList.contains('modal')) {
        event.target.style.display = 'none';
      }
    }
  </script>
</body>
</html>`;
}