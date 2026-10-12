<script lang="ts">
  import { page } from '$app/stores';
  import '$lib/styles/theme-gold.css';
  import { supabaseClient } from '$lib/supabaseClient';
  import AdminSettingsModal from '$lib/components/AdminSettingsModal.svelte';

  let {
    title = 'GateQR',
    userEmail = '',
    children,
    showSidebar = false,
    userRole = 'osa'
  }: {
    title?: string;
    userEmail?: string;
    children?: any;
    showSidebar?: boolean;
    userRole?: string;
  } = $props();

  let settingsModalOpen = $state(false);

  let currentPath = $derived($page.url.pathname);
  let currentSearchTab = $derived($page.url.searchParams.get('tab'));

  let isManageRoute = $derived(currentPath === '/osa' || currentPath.startsWith('/osa/change-requests'));
  let isAccountsRoute = $derived(currentPath.startsWith('/osa/admin') || currentPath.startsWith('/osa/deans'));

  // User manual close overrides
  let userClosedManage = $state(false);
  let userClosedAccounts = $state(false);

  let manageAppsOpen = $state(false);
  let accountsOpen = $state(false);
  let mobileNavOpen = $state(false);

  function toggleMobileNav() {
    mobileNavOpen = !mobileNavOpen;
  }

  $effect(() => {
    if (isManageRoute) {
      manageAppsOpen = !userClosedManage;
    } else if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('gateqr_manage_apps_open');
      manageAppsOpen = stored === 'true';
    }

    if (isAccountsRoute) {
      accountsOpen = !userClosedAccounts;
    } else if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem('gateqr_accounts_open');
      accountsOpen = stored === 'true';
    }
  });

  function toggleManageApps() {
    if (isManageRoute) {
      userClosedManage = !userClosedManage;
      manageAppsOpen = !userClosedManage;
    } else {
      manageAppsOpen = !manageAppsOpen;
    }
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('gateqr_manage_apps_open', String(manageAppsOpen));
    }
  }

  function toggleAccounts() {
    if (isAccountsRoute) {
      userClosedAccounts = !userClosedAccounts;
      accountsOpen = !userClosedAccounts;
    } else {
      accountsOpen = !accountsOpen;
    }
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('gateqr_accounts_open', String(accountsOpen));
    }
  }

  // Notification state
  let notifications = $state<any[]>([]);
  let unreadCount = $state(0);
  let notificationDropdownOpen = $state(false);
  let loadingNotifications = $state(false);

  // User display helper
  let userInitials = $derived(
    userRole === 'applicant' ? 'AP' :
    (userEmail ? userEmail.slice(0, 2).toUpperCase() : 'AD')
  );
  let userDisplayName = $derived(
    userRole === 'applicant' ? 'Applicant' :
    (userEmail ? userEmail.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Admin User')
  );
  let userRoleLabel = $derived(
    userRole === 'applicant' ? (userEmail || 'Applicant') :
    (userRole === 'security' ? 'Security Administrator' : (userRole === 'dean' ? 'College Dean' : 'OSA Administrator'))
  );
  let portalSubtitle = $derived(
    userRole === 'applicant' ? 'Application Form' :
    userRole === 'dean' ? 'Department Head Portal' :
    userRole === 'security' ? 'Safety & Security Office' :
    'Office of Student Affairs'
  );

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  // Notification functions
  async function fetchNotifications() {
    loadingNotifications = true;
    try {
      const res = await fetch('/api/notifications');
      if (res.ok) {
        const data = await res.json();
        notifications = data.notifications || [];
        unreadCount = notifications.filter((n: any) => !n.is_read).length;
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      loadingNotifications = false;
    }
  }

  async function markAsRead(notificationId: number) {
    try {
      const res = await fetch(`/api/notifications/${notificationId}/read`, { method: 'POST' });
      if (res.ok) {
        notifications = notifications.map(n => 
          n.notification_id === notificationId ? { ...n, is_read: true, read_at: new Date().toISOString() } : n
        );
        unreadCount = notifications.filter((n: any) => !n.is_read).length;
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  }

  async function markAllAsRead() {
    try {
      const res = await fetch('/api/notifications/mark-all-read', { method: 'POST' });
      if (res.ok) {
        notifications = notifications.map(n => ({
          ...n,
          is_read: true,
          read_at: new Date().toISOString()
        }));
        unreadCount = 0;
      }
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  }

  function formatNotificationTime(timestamp: string) {
    if (!timestamp) return 'Just now';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatNotificationType(type: string | undefined): string {
    if (!type) return 'System Notification';
    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  }

  function clickOutside(node: HTMLElement, callback: () => void) {
    const handleClick = (e: MouseEvent) => {
      if (node && !node.contains(e.target as Node) && !e.defaultPrevented) {
        callback();
      }
    };
    document.addEventListener('click', handleClick, true);
    return {
      destroy() {
        document.removeEventListener('click', handleClick, true);
      }
    };
  }

  // Fetch notifications on mount, tab focus & pure realtime WebSocket
  $effect(() => {
    fetchNotifications();

    const channel = supabaseClient
      .channel('appshell-notifications-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notification' }, () => {
        fetchNotifications();
      })
      .subscribe();

    const handleFocus = () => {
      fetchNotifications();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', handleFocus);
      document.addEventListener('visibilitychange', handleFocus);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleFocus);
      }
      supabaseClient.removeChannel(channel);
    };
  });

  const securityActions = [
    {
      label: 'Dashboard',
      href: '/security/dashboard',
      icon: `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><line x1="10" y1="17" x2="10" y2="17"/>`,
      description: 'View security dashboard and stats'
    },
    {
      label: 'Application Review',
      href: '/security',
      icon: `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>`,
      description: 'Review applications and stickers'
    },
    {
      label: 'Vehicle Log',
      href: '/security/logs',
      icon: `<path d="M12 2v20M2 12h20M12 2l4 4m-4-4l-4 4"/>`,
      description: 'Gate entry and exit history logs'
    },
    {
      label: 'Complaints',
      href: '/security/complaints',
      icon: `<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
      description: 'View and manage complaints'
    },
    {
      label: 'Campus Vehicle Capacity Management',
      href: '/security/capacity',
      icon: `<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/><path d="M12 22v-7"/><path d="M20 22v-7"/>`,
      description: 'Manage capacity per campus'
    }
  ];

  const manageAppSubLinks = [
    { label: 'Accept & Schedule Application', tab: 'validation', href: '/osa?tab=validation' },
    { label: 'Application Schedules for Hardcopy Compliance', tab: 'distribution', href: '/osa?tab=distribution' },
    { label: 'Sticker Release', tab: 'release', href: '/osa?tab=release' },
    { label: 'Registered Vehicle', tab: 'registered', href: '/osa?tab=registered' },
    { label: 'Rejected Applications', tab: 'rejected', href: '/osa?tab=rejected' },
    { label: 'Revoked Application', tab: 'revoked', href: '/osa?tab=revoked' },
    { label: 'Overdue Application Schedules', tab: 'overdue', href: '/osa?tab=overdue' },
    { label: 'Application request to change details', path: '/osa/change-requests', href: '/osa/change-requests' }
  ];

  function isAppTabActive(item: typeof manageAppSubLinks[number]): boolean {
    if (item.path) {
      return currentPath === item.path;
    }
    if (currentPath === '/osa') {
      const activeTab = currentSearchTab || 'validation';
      return activeTab === item.tab;
    }
    return false;
  }
</script>

<!-- Page shell -->
<main class="app-shell theme-osa">
  {#if showSidebar}
    <aside class="sidebar" class:mobile-open={mobileNavOpen}>
      <!-- Brand Section -->
      <div class="sidebar-brand">
        <div class="brand-left-group">
          <div class="brand-logo">
            <img src="/liceo-logo.png" alt="LICEO DE CAGAYAN UNIVERSITY" />
          </div>
          <div class="brand-info">
            <div class="brand-top-row">
              <span class="brand-name">GateQR</span>
              <span class="brand-tag">ADMIN PORTAL</span>
            </div>
            <span class="brand-sub">Office of Student Affairs</span>
          </div>
        </div>
        <button
          type="button"
          class="mobile-menu-toggle-btn"
          onclick={toggleMobileNav}
          aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
        >
          <span class="mobile-toggle-text">{mobileNavOpen ? "Close" : "Menu"}</span>
          <svg class="mobile-toggle-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            {#if mobileNavOpen}
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            {:else}
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            {/if}
          </svg>
        </button>
      </div>

      <!-- Main Navigation Menu -->
      <div class="sidebar-menu-wrapper">
        <div class="sidebar-menu-heading">MAIN MENU</div>

        <nav class="sidebar-nav-tree">
          {#if userRole === 'osa'}
            <!-- Dashboard Link -->
            <a href="/osa/dashboard" class="menu-item-btn" class:active={currentPath === '/osa/dashboard'}>
              <div class="menu-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>
                </svg>
              </div>
              <span class="menu-item-label">Dashboard</span>
            </a>

            <!-- Manage Applications (Dropdown) -->
            <div class="dropdown-parent-group" class:is-open={manageAppsOpen}>
              <button
                type="button"
                class="menu-item-btn dropdown-toggle"
                class:active-parent={currentPath === '/osa' || currentPath.startsWith('/osa/change-requests')}
                onclick={toggleManageApps}
              >
                <div class="menu-item-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                  </svg>
                </div>
                <span class="menu-item-label">Manage Applications</span>
                <span class="dropdown-chevron" class:rotated={manageAppsOpen}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </span>
              </button>

              {#if manageAppsOpen}
                <div class="submenu-container">
                  {#each manageAppSubLinks as subItem}
                    <a
                      href={subItem.href}
                      class="submenu-link"
                      class:active={isAppTabActive(subItem)}
                    >
                      <span class="submenu-text">{subItem.label}</span>
                    </a>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Accounts (Dropdown: Add Admin & Add Dean) -->
            <div class="dropdown-parent-group" class:is-open={accountsOpen}>
              <button
                type="button"
                class="menu-item-btn dropdown-toggle"
                class:active-parent={currentPath.startsWith('/osa/admin') || currentPath.startsWith('/osa/deans')}
                onclick={toggleAccounts}
              >
                <div class="menu-item-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                  </svg>
                </div>
                <span class="menu-item-label">Accounts</span>
                <span class="dropdown-chevron" class:rotated={accountsOpen}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </span>
              </button>

              {#if accountsOpen}
                <div class="submenu-container">
                  <a
                    href="/osa/admin"
                    class="submenu-link"
                    class:active={currentPath === '/osa/admin'}
                  >
                    <span class="submenu-text">Add Admin</span>
                  </a>
                  <a
                    href="/osa/deans"
                    class="submenu-link"
                    class:active={currentPath === '/osa/deans'}
                  >
                    <span class="submenu-text">Add Dean</span>
                  </a>
                </div>
              {/if}
            </div>

            <!-- Departments Link -->
            <a href="/osa/departments" class="menu-item-btn" class:active={currentPath === '/osa/departments'}>
              <div class="menu-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
              </div>
              <span class="menu-item-label">Departments</span>
            </a>

            <!-- Settings Link -->
            <a href="/osa/settings" class="menu-item-btn" class:active={currentPath === '/osa/settings'}>
              <div class="menu-item-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
              <span class="menu-item-label">Settings</span>
            </a>
          {:else}
            <!-- Non-OSA / Security Actions -->
            {#each securityActions as action}
              <a href={action.href} class="menu-item-btn" class:active={currentPath === action.href}>
                <div class="menu-item-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    {@html action.icon}
                  </svg>
                </div>
                <span class="menu-item-label">{action.label}</span>
              </a>
            {/each}
          {/if}
        </nav>
      </div>

      <!-- Bottom Logout Pill -->
      <div class="sidebar-bottom-action">
        <button class="bottom-logout-pill" onclick={handleLogout} title="Logout of GateQR">
          Logout
        </button>
      </div>
    </aside>
  {/if}

  <div class="shell-content">
    <!-- Topbar Header (Matching Screenshots 1 & 2) -->
    <div class="content-header">
      <div class="header-left-meta">
        <span class="meta-system-badge">
          <img src="/liceo-logo.png" alt="LDCU" class="badge-mini-logo" />
          <span class="meta-title">GateQR</span>
          <span class="meta-sep">•</span>
          <span class="meta-sub">{portalSubtitle}</span>
        </span>
      </div>

      <div class="header-actions-group">
        {#if userRole === 'applicant'}
          {#if currentPath === '/complaints'}
            <a href="/status" class="topbar-action-pill complaints-pill">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <span>Application Status</span>
            </a>
          {:else}
            <a href="/complaints" class="topbar-action-pill complaints-pill">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
              </svg>
              <span>My Complaints</span>
            </a>
          {/if}
        {/if}

        <!-- Notification Bell with Popover (All roles including Applicant) -->
        <div class="notification-wrapper" use:clickOutside={() => notificationDropdownOpen = false}>
          <button
            class="topbar-bell-btn"
            onclick={() => notificationDropdownOpen = !notificationDropdownOpen}
            aria-label="Toggle notifications"
          >
            <!-- Amber bell SVG matching screenshot 1 -->
            <svg class="bell-svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {#if unreadCount > 0}
              <span class="notification-counter-badge">{unreadCount}</span>
            {/if}
          </button>

          <!-- Notification Dropdown Popover matching Screenshot 2 -->
          {#if notificationDropdownOpen}
            <div class="notification-flyout-card">
              <div class="flyout-header">
                <span class="flyout-title">Recent Notifications</span>
                {#if notifications.length > 0}
                  <button class="flyout-mark-btn" onclick={markAllAsRead}>
                    Mark all as read
                  </button>
                {/if}
              </div>

              <div class="flyout-scroll-body">
                {#if loadingNotifications}
                  <div class="flyout-empty-state">Loading notifications...</div>
                {:else if notifications.length === 0}
                  <div class="flyout-empty-state">No recent notifications</div>
                {:else}
                  {#each notifications as notif}
                    <div
                      class="flyout-item-card"
                      class:item-unread={!notif.is_read}
                      role="button"
                      tabindex="0"
                      onclick={() => markAsRead(notif.notification_id)}
                      onkeydown={(e) => { if (e.key === 'Enter') markAsRead(notif.notification_id); }}
                    >
                      <div class="item-text-body">
                        <div class="item-header-row">
                          <span class="item-type-badge">{formatNotificationType(notif.notification_type)}</span>
                          <span class="item-time">{formatNotificationTime(notif.created_at)}</span>
                        </div>
                        <p class="item-message">{notif.message}</p>
                        {#if notif.actor?.email}
                          <span class="item-actor">By: {notif.actor.email}</span>
                        {/if}
                      </div>
                      {#if !notif.is_read}
                        <span class="unread-indicator-dot"></span>
                      {/if}
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          {/if}
        </div>

        <!-- User Profile Pill (Matching Screenshot 1) -->
        <div class="topbar-profile-pill">
          <div class="profile-avatar-circle">
            <span>{userInitials}</span>
          </div>
          <div class="profile-info-block">
            <span class="profile-name">{userDisplayName}</span>
            <span class="profile-role-sub">{userRoleLabel}</span>
          </div>
        </div>

        <!-- Topbar Logout Button Beside User -->
        <button class="topbar-logout-btn" onclick={handleLogout} title="Logout of GateQR">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          <span>Logout</span>
        </button>
      </div>
    </div>

    <!-- Page Body Slot -->
    {@render children()}
  </div>

  <AdminSettingsModal open={settingsModalOpen} onclose={() => settingsModalOpen = false} />
</main>

<style>
  .app-shell {
    min-height: 100vh;
    padding: 1.5rem 2rem;
    display: flex;
    gap: 1.75rem;
    background: #f8fafc;
    align-items: flex-start;
    max-width: 1920px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }


  /* ─── Modern Dark Sidebar (Theme-Preserved) ─── */
  .sidebar {
    width: 290px;
    flex-shrink: 0;
    background: linear-gradient(180deg, #10192e 0%, #0a1120 100%);
    border-radius: 20px;
    padding: 1.5rem 1.25rem;
    position: sticky;
    top: 1.5rem;
    align-self: flex-start;
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 3rem);
    box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.08);
    z-index: 40;
    box-sizing: border-box;
  }

  /* Brand Header */
  .sidebar-brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.85rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .brand-left-group {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-width: 0;
  }

  .mobile-menu-toggle-btn {
    display: none;
    align-items: center;
    gap: 6px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: #E9C25E;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .mobile-menu-toggle-btn:hover {
    background: rgba(233, 194, 94, 0.2);
  }

  .brand-logo {
    width: 44px;
    height: 44px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.08);
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
  }

  .brand-logo img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .brand-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .brand-top-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .brand-name {
    font-size: 1.15rem;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.01em;
  }

  .brand-tag {
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    background: #E9C25E;
    color: #3D0818;
    padding: 1px 6px;
    border-radius: 4px;
    text-transform: uppercase;
  }

  .brand-sub {
    font-size: 0.7rem;
    color: #94a3b8;
    font-weight: 500;
    line-height: 1.2;
  }

  /* Navigation Tree */
  .sidebar-menu-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    margin-top: 1.5rem;
  }

  .sidebar-menu-heading {
    font-size: 0.75rem;
    font-weight: 800;
    color: #f1f5f9;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    margin-bottom: 0.85rem;
    padding-left: 0.5rem;
    opacity: 0.95;
  }

  .sidebar-nav-tree {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  /* Base Menu Button */
  .menu-item-btn {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.75rem 0.95rem;
    border-radius: 12px;
    background: transparent;
    border: none;
    color: #ffffff;
    font-size: 0.925rem;
    font-weight: 700;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-sizing: border-box;
    text-align: left;
  }

  .menu-item-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  /* Dashboard / Active Button - Gold theme */
  .menu-item-btn.active {
    background: linear-gradient(135deg, #F0CF72 0%, #D4A62A 100%);
    color: #3D0818;
    font-weight: 800;
    box-shadow: 0 4px 14px rgba(212, 166, 42, 0.4);
  }

  .menu-item-btn.active .menu-item-icon {
    color: #3D0818;
    opacity: 1;
  }

  .menu-item-btn.active-parent {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
    font-weight: 700;
  }

  .menu-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0.95;
  }

  .menu-item-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dropdown-toggle {
    justify-content: space-between;
  }

  .dropdown-chevron {
    display: flex;
    align-items: center;
    transition: transform 0.25s ease;
    opacity: 0.85;
  }

  .dropdown-chevron.rotated {
    transform: rotate(180deg);
    opacity: 1;
  }

  /* Submenu Dropdown Container - with hierarchy line indicators */
  .submenu-container {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.45rem 0 0.5rem 1.25rem;
    margin-left: 1.15rem;
    border-left: 2px solid rgba(233, 194, 94, 0.45);
    position: relative;
  }

  .submenu-link {
    position: relative;
    display: flex;
    align-items: center;
    padding: 0.6rem 0.95rem;
    border-radius: 10px;
    font-size: 0.85rem;
    font-weight: 600;
    color: #ffffff;
    text-decoration: none;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    background: rgba(255, 255, 255, 0.05);
  }

  /* Branch indicator line showing this tab is from the dropdown */
  .submenu-link::before {
    content: '';
    position: absolute;
    left: -1.25rem;
    top: 50%;
    width: 0.95rem;
    height: 2px;
    background: rgba(233, 194, 94, 0.45);
    transform: translateY(-50%);
    transition: all 0.2s ease;
  }

  .submenu-link:hover::before {
    background: #F0CF72;
    width: 1.25rem;
  }

  .submenu-link.active::before {
    background: #F0CF72;
    width: 1.25rem;
  }

  .submenu-link:hover {
    color: #ffffff;
    background: rgba(233, 194, 94, 0.25);
    transform: translateX(4px);
  }

  .submenu-link.active {
    color: #3D0818;
    font-weight: 800;
    background: linear-gradient(135deg, #F0CF72 0%, #D4A62A 100%);
    box-shadow: 0 3px 12px rgba(212, 166, 42, 0.4);
  }

  .submenu-text {
    display: block;
    white-space: normal;
    line-height: 1.35;
    flex: 1;
  }

  .submenu-badge {
    margin-left: 0.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25rem;
    height: 1.25rem;
    padding: 0 0.35rem;
    border-radius: 999px;
    background: #b91c1c;
    color: #ffffff;
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 1;
    text-align: center;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    flex-shrink: 0;
  }

  .submenu-link.active .submenu-badge {
    background: #6b1a2a;
    color: #ffffff;
  }

  /* Bottom Logout Pill */
  .sidebar-bottom-action {
    margin-top: auto;
    padding-top: 1.25rem;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .sidebar-user-brief {
    padding-left: 0.25rem;
  }

  .brief-role {
    font-size: 0.875rem;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.02em;
  }

  .bottom-logout-pill {
    width: 100%;
    padding: 0.65rem 1rem;
    border-radius: 10px;
    background: rgba(239, 68, 68, 0.08);
    border: 1.5px solid #ef4444;
    color: #ef4444;
    font-size: 0.85rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: center;
  }

  .bottom-logout-pill:hover {
    background: #ef4444;
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.35);
  }

  /* ─── Main Shell Content Area ─── */
  .shell-content {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* ─── Topbar Header ─── */
  .content-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.35rem 0;
  }

  .header-left-meta {
    display: flex;
    align-items: center;
  }

  .meta-system-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.4rem 0.85rem;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 999px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
  }

  .badge-mini-logo {
    width: 22px;
    height: 22px;
    object-fit: contain;
  }

  .meta-title {
    font-size: 0.875rem;
    font-weight: 800;
    color: #7A1734;
  }

  .meta-sep {
    color: #cbd5e1;
    font-size: 0.75rem;
  }

  .meta-sub {
    font-size: 0.8rem;
    font-weight: 600;
    color: #64748b;
  }

  .header-actions-group {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  /* Topbar Notification Bell Button (Matching Screenshot 1) */
  .notification-wrapper {
    position: relative;
  }

  .topbar-bell-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #edf2f7;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    position: relative;
    transition: all 0.2s ease;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);
  }

  .topbar-bell-btn:hover {
    background: #e2e8f0;
    transform: translateY(-1px);
  }

  .bell-svg {
    color: #f59e0b; /* Amber / gold bell */
  }

  .notification-counter-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    background: #ef4444;
    color: #ffffff;
    font-size: 0.7rem;
    font-weight: 800;
    min-width: 18px;
    height: 18px;
    border-radius: 999px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    border: 2px solid #ffffff;
    box-shadow: 0 2px 5px rgba(239, 68, 68, 0.4);
  }

  /* Notification Flyout Card (Matching Screenshot 2) */
  .notification-flyout-card {
    position: absolute;
    top: calc(100% + 10px);
    right: 0;
    width: 380px;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    box-shadow: 0 16px 36px -6px rgba(0, 0, 0, 0.15), 0 0 1px rgba(0, 0, 0, 0.1);
    z-index: 1000;
    overflow: hidden;
  }

  .flyout-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid #f1f5f9;
  }

  .flyout-title {
    font-size: 0.95rem;
    font-weight: 800;
    color: #0f172a;
  }

  .flyout-mark-btn {
    background: transparent;
    border: none;
    color: #8B1A3C;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.2s ease;
    padding: 0;
  }

  .flyout-mark-btn:hover {
    text-decoration: underline;
    opacity: 0.85;
  }

  .flyout-scroll-body {
    max-height: 380px;
    overflow-y: auto;
    padding: 0.85rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  /* Maroon-accented notification item cards */
  .flyout-item-card {
    background: #f8fafc;
    border-radius: 10px;
    border-left: 4px solid #8B1A3C;
    padding: 0.75rem 0.9rem;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.65rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  }

  .flyout-item-card:hover {
    background: #fdf2f4;
    transform: translateX(2px);
  }

  .flyout-item-card.item-unread {
    background: #ffffff;
    box-shadow: 0 2px 6px rgba(139, 26, 60, 0.08);
  }

  .item-text-body {
    flex: 1;
    min-width: 0;
  }

  .item-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }

  .item-type-badge {
    display: inline-block;
    padding: 0.15rem 0.55rem;
    background: #fdf2f4;
    color: #8B1A3C;
    border: 1px solid #fecdd3;
    border-radius: 6px;
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: capitalize;
  }

  .item-time {
    font-size: 0.7rem;
    color: #94a3b8;
    font-weight: 600;
    white-space: nowrap;
  }

  .item-message {
    font-size: 0.825rem;
    font-weight: 600;
    color: #1e293b;
    line-height: 1.4;
    margin: 0 0 0.35rem 0;
    word-break: break-word;
  }

  .item-actor {
    display: block;
    font-size: 0.68rem;
    color: #64748b;
    margin-top: 2px;
  }

  .unread-indicator-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #8B1A3C;
    flex-shrink: 0;
    margin-top: 5px;
    box-shadow: 0 0 6px rgba(139, 26, 60, 0.6);
  }

  .flyout-empty-state {
    padding: 2rem 1rem;
    text-align: center;
    color: #94a3b8;
    font-size: 0.85rem;
    font-weight: 600;
  }

  /* Topbar User Profile Pill (Matching Screenshot 1) */
  .topbar-profile-pill {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.35rem 0.85rem 0.35rem 0.45rem;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 999px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
  }

  .profile-avatar-circle {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: linear-gradient(135deg, #7A1734 0%, #4a0d1e 100%);
    color: #E9C25E;
    border: 1.5px solid rgba(233, 194, 94, 0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  .profile-info-block {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }

  .profile-name {
    font-size: 0.825rem;
    font-weight: 700;
    color: #0f172a;
  }

  .profile-role-sub {
    font-size: 0.7rem;
    color: #64748b;
    font-weight: 500;
  }

  /* Topbar Logout Button & Action Pills */
  .topbar-logout-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.45rem 0.95rem;
    background: #ffffff;
    border: 1.5px solid #fecaca;
    color: #ef4444;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 6px rgba(239, 68, 68, 0.08);
  }

  .topbar-logout-btn:hover {
    background: #ef4444;
    color: #ffffff;
    border-color: #ef4444;
    box-shadow: 0 4px 12px rgba(239, 68, 68, 0.28);
    transform: translateY(-1px);
  }

  .topbar-action-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 1rem;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    color: #475569;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 700;
    text-decoration: none;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
  }

  .topbar-action-pill:hover {
    background: #f8fafc;
    color: #0f172a;
    border-color: #cbd5e1;
    transform: translateY(-1px);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.06);
  }

  .complaints-pill {
    color: #7A1734;
    border-color: #fed7aa;
    background: #fffaf0;
  }

  .complaints-pill:hover {
    background: #feebc8;
    color: #7A1734;
    border-color: #fbd38d;
  }

  @media (max-width: 1280px) {
    .app-shell {
      padding: 1.25rem 1.5rem;
      gap: 1.25rem;
    }

    .sidebar {
      width: 260px;
      padding: 1.25rem 1rem;
    }
  }

  @media (max-width: 1024px) {
    .app-shell {
      flex-direction: column;
      padding: 1rem;
      gap: 1.25rem;
      overflow-x: hidden;
      width: 100%;
    }

    .shell-content {
      width: 100%;
      min-width: 0;
      overflow-x: hidden;
    }

    .sidebar {
      width: 100%;
      position: static;
      min-height: auto;
      padding: 1rem 1.25rem;
      border-radius: 16px;
    }

    .sidebar-brand {
      padding-bottom: 0;
      border-bottom: none;
    }

    .sidebar.mobile-open .sidebar-brand {
      padding-bottom: 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .mobile-menu-toggle-btn {
      display: inline-flex;
    }

    .sidebar-menu-wrapper {
      display: none;
      margin-top: 1rem;
    }

    .sidebar-bottom-action {
      display: none;
    }

    .sidebar.mobile-open .sidebar-menu-wrapper {
      display: flex;
      animation: fadeIn 0.2s ease;
    }

    .sidebar.mobile-open .sidebar-bottom-action {
      display: flex;
      animation: fadeIn 0.2s ease;
    }

    .notification-flyout-card {
      width: min(360px, calc(100vw - 2rem));
      right: 0;
    }
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 768px) {
    .app-shell {
      padding: 0.75rem 0.5rem;
      gap: 1rem;
    }

    .content-header {
      flex-direction: column;
      align-items: stretch;
      gap: 0.75rem;
    }

    .header-left-meta {
      width: 100%;
      justify-content: space-between;
    }

    .header-actions-group {
      width: 100%;
      justify-content: flex-end;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .profile-info-block {
      display: none;
    }

    .sidebar {
      padding: 0.9rem 1rem;
      border-radius: 14px;
    }
  }

  @media (max-width: 480px) {
    .app-shell {
      padding: 0.5rem 0.35rem;
    }

    .meta-system-badge {
      padding: 0.35rem 0.65rem;
      max-width: 100%;
    }

    .meta-sub {
      display: none;
    }

    .meta-sep {
      display: none;
    }

    .topbar-logout-btn span {
      display: none;
    }

    .topbar-logout-btn {
      padding: 0.45rem 0.65rem;
    }

    .topbar-action-pill {
      padding: 0.4rem 0.75rem;
      font-size: 0.75rem;
    }

    .notification-flyout-card {
      width: min(340px, calc(100vw - 1rem));
      right: 0;
    }
  }

  @media (max-width: 360px) {
    .app-shell {
      padding: 0.35rem 0.25rem;
    }

    .brand-name {
      font-size: 1rem;
    }

    .meta-title {
      font-size: 0.8rem;
    }
  }
</style>
