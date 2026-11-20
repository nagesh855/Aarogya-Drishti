import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Bell, LogOut, Menu, Mic, ShieldAlert, X } from 'lucide-react';
import { apiRequest, getStoredToken, setStoredToken } from './utils/api.js';
import { useWebSocket, type WsSignalMessage } from './hooks/useWebSocket.js';
import type { NotificationItem, UserRole } from '../../shared/types/index.js';
import { LanguageSelector } from './i18n.js';
import { PublicLanding } from './components/PublicLanding.js';
import { AuthModal, type AuthSessionUser } from './components/AuthModal.js';
import { AshaWorkerAccessModal } from './components/AshaWorkerAccessModal.js';
import { NotificationDrawer } from './components/NotificationDrawer.js';
import { VoiceAssistantDrawer } from './components/VoiceAssistantDrawer.js';
import { BrandLogo } from './components/ui/SignatureCard.js';
import { PATIENT_NAV_ITEMS, PatientDashboard } from './components/dashboards/PatientDashboard.js';
import { DOCTOR_NAV_ITEMS, DoctorDashboard } from './components/dashboards/DoctorDashboard.js';
import {
  HospitalManagerDashboard,
  MANAGER_NAV_ITEMS,
} from './components/dashboards/HospitalManagerDashboard.js';
import { ADMIN_NAV_ITEMS, AdminDashboard } from './components/dashboards/AdminDashboard.js';
import { ASHA_NAV_ITEMS, AshaDashboard } from './components/dashboards/AshaDashboard.js';

export default function App() {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [bootstrapping, setBootstrapping] = useState(Boolean(getStoredToken()));

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [ashaAccessOpen, setAshaAccessOpen] = useState(false);
  const [authModalRole, setAuthModalRole] = useState<UserRole>('patient');
  const [pendingLandingTab, setPendingLandingTab] = useState<string>('overview');

  const [activeTab, setActiveTab] = useState('overview');
  const [tabHistory, setTabHistory] = useState<string[]>([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [voiceDrawerOpen, setVoiceDrawerOpen] = useState(false);
  const [voiceInitialPrompt, setVoiceInitialPrompt] = useState<string | null>(null);
  const [lastSignalMessage, setLastSignalMessage] = useState<WsSignalMessage | null>(null);

  // Forced initial password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!getStoredToken()) return;
    try {
      const res = await apiRequest<{ notifications: NotificationItem[] }>('/api/notifications');
      setNotifications(res.notifications || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const existing = getStoredToken();
    if (!existing) {
      setBootstrapping(false);
      return;
    }
    apiRequest<{ user: AuthSessionUser }>('/api/auth/me')
      .then((res) => {
        setUser(res.user);
        setToken(existing);
        void fetchNotifications();
      })
      .catch(() => {
        setStoredToken(null);
        setToken(null);
        setUser(null);
      })
      .finally(() => setBootstrapping(false));
  }, [fetchNotifications]);

  const handleIncomingNotification = useCallback((n: NotificationItem) => {
    setNotifications((prev) => [n, ...prev.filter((x) => x.id !== n.id)]);
  }, []);

  const handleSignalMessage = useCallback((msg: WsSignalMessage) => {
    setLastSignalMessage(msg);
  }, []);

  const { sendMessage } = useWebSocket(token, handleIncomingNotification, handleSignalMessage);

  const navigateToTab = useCallback(
    (nextTab: string) => {
      if (nextTab === activeTab) return;
      if (
        user?.role === 'patient' ||
        user?.role === 'doctor' ||
        user?.role === 'hospital_manager' ||
        user?.role === 'admin'
      ) {
        setTabHistory((history) => [...history, activeTab]);
      }
      setActiveTab(nextTab);
    },
    [activeTab, user?.role]
  );

  const handleGoBack = () => {
    const previousTab = tabHistory[tabHistory.length - 1] || 'overview';
    setTabHistory((history) => history.slice(0, -1));
    setActiveTab(previousTab);
  };

  const handleAuthenticated = (nextToken: string, nextUser: AuthSessionUser) => {
    setToken(nextToken);
    setUser(nextUser);
    setTabHistory([]);
    setActiveTab(nextUser.role === 'patient' ? pendingLandingTab : 'overview');
    setPendingLandingTab('overview');
    setAuthModalOpen(false);
    setAshaAccessOpen(false);
    void fetchNotifications();
  };

  const handleLogout = () => {
    setStoredToken(null);
    setToken(null);
    setUser(null);
    setNotifications([]);
    setTabHistory([]);
    setActiveTab('overview');
  };

  const handleMarkRead = async (id: string) => {
    await apiRequest(`/api/notifications/${id}/read`, { method: 'PATCH' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const handleMarkAllRead = async () => {
    await apiRequest('/api/notifications/read-all', { method: 'PATCH' });
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const handleForcedPasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    setPwError(null);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (user) {
        setUser({ ...user, mustChangePassword: false });
      }
      setCurrentPassword('');
      setNewPassword('');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Unable to update password.');
    }
  };

  if (bootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FBFBFA] ad-grid-56 text-sm text-gray-600">
        Loading Aarogya Drishti session...
      </div>
    );
  }

  if (!user || !token) {
    return (
      <>
        <PublicLanding
          onOpenAuth={(role, targetTab) => {
            setAuthModalRole(role || 'patient');
            setPendingLandingTab(targetTab || 'overview');
            setAuthModalOpen(true);
          }}
          onOpenAshaAccess={() => setAshaAccessOpen(true)}
          onOpenVoiceGuide={(prompt) => {
            setVoiceInitialPrompt(prompt || null);
            setVoiceDrawerOpen(true);
          }}
        />
        {authModalOpen && (
          <AuthModal
            initialRole={authModalRole}
            onClose={() => setAuthModalOpen(false)}
            onAuthenticated={handleAuthenticated}
          />
        )}
        {ashaAccessOpen && (
          <AshaWorkerAccessModal
            onClose={() => setAshaAccessOpen(false)}
            onAuthenticated={handleAuthenticated}
          />
        )}
        <VoiceAssistantDrawer
          open={voiceDrawerOpen}
          publicMode
          initialPrompt={voiceInitialPrompt}
          onSignInRequest={() => {
            setAuthModalRole('patient');
            setPendingLandingTab('overview');
            setAuthModalOpen(true);
          }}
          onClose={() => {
            setVoiceDrawerOpen(false);
            setVoiceInitialPrompt(null);
          }}
        />
      </>
    );
  }

  const navItems =
    user.role === 'patient'
      ? PATIENT_NAV_ITEMS
      : user.role === 'doctor'
      ? DOCTOR_NAV_ITEMS
      : user.role === 'hospital_manager'
      ? MANAGER_NAV_ITEMS
      : user.role === 'asha_worker'
      ? ASHA_NAV_ITEMS
      : ADMIN_NAV_ITEMS;

  const roleTitle =
    user.role === 'patient'
      ? 'Patient Portal'
      : user.role === 'doctor'
      ? 'Doctor Clinical Portal'
      : user.role === 'hospital_manager'
      ? 'Hospital Manager Portal'
      : user.role === 'asha_worker'
      ? 'ASHA Worker Portal'
      : 'Platform Administration';

  const currentNavLabel = navItems.find((n) => n.id === activeTab)?.label || 'Overview';
  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen bg-[#FBFBFA] ad-grid-56 flex text-gray-900">
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:flex-col w-68 bg-white/95 backdrop-blur-md border-r border-gray-200/80 shrink-0">
        <div className="px-6 py-5 border-b border-gray-200/70">
          <BrandLogo />
          <p className="text-xs font-medium text-gray-500 mt-1.5">{roleTitle}</p>
        </div>

        <nav className="flex-1 p-4 space-y-1.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateToTab(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium rounded-2xl transition-all cursor-pointer ${
                  active
                    ? 'ad-btn-teal text-white font-semibold'
                    : 'text-gray-600 hover:bg-gray-100/80 hover:text-gray-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${active ? 'text-[#A7F3D0]' : 'text-gray-400'}`}
                />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-200/70 space-y-3 bg-[#FBFBFA]/70">
          <div className="px-2">
            <p className="text-xs font-bold text-gray-900 truncate">{user.name}</p>
            <p className="text-[11px] font-mono text-gray-500 truncate">{user.identifier}</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-red-600 border border-red-700 hover:bg-red-700 hover:border-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 rounded-xl cursor-pointer transition-colors"
          >
            <LogOut className="w-3.5 h-3.5 text-white" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-68 bg-white h-full flex flex-col z-50 border-r border-gray-200">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <BrandLogo />
                <p className="text-xs text-gray-500 mt-1">{roleTitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-gray-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      navigateToTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-2xl cursor-pointer ${
                      active ? 'ad-btn-teal text-white font-semibold' : 'text-gray-600'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-gray-200">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-white bg-red-600 border border-red-700 hover:bg-red-700 hover:border-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 rounded-xl cursor-pointer transition-colors"
              >
                <LogOut className="w-3.5 h-3.5 text-white" />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="no-print sticky top-0 z-20 backdrop-blur-md bg-white/80 border-b border-gray-200/70 shadow-sm px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              className="lg:hidden p-2 text-gray-600 hover:bg-gray-100 rounded-xl cursor-pointer"
            >
              <Menu className="w-5 h-5" />
            </button>
            {(user.role === 'patient' ||
              user.role === 'doctor' ||
              user.role === 'hospital_manager' ||
              user.role === 'admin') && (
              <button
                type="button"
                onClick={handleGoBack}
                disabled={tabHistory.length === 0 && activeTab === 'overview'}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-emerald-50 hover:text-[#0D5C58] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-gray-700"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Go Back</span>
              </button>
            )}
            <div className="rounded-full bg-gray-50/80 border border-gray-200 px-3.5 py-1.5 text-xs font-medium text-gray-600 truncate">
              <span className="hidden sm:inline">{roleTitle} · </span>
              <span className="font-bold text-gray-900">{currentNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setVoiceDrawerOpen(true)}
              className="ad-btn-teal inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white rounded-full whitespace-nowrap shrink-0 cursor-pointer transition-all"
            >
              <Mic className="w-3.5 h-3.5 text-[#A7F3D0]" />
              <span>AI Voice Guide</span>
            </button>
            <LanguageSelector />
            <button
              type="button"
              onClick={() => setNotifDrawerOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-gray-800 bg-white border border-gray-200 hover:bg-gray-50 rounded-full whitespace-nowrap shrink-0 cursor-pointer transition-colors"
            >
              <Bell className="w-3.5 h-3.5 text-[#0D5C58]" />
              <span>Notifications</span>
              {unreadCount > 0 && (
                <span className="font-mono font-bold text-[#0D5C58] tabular-nums">
                  ({unreadCount})
                </span>
              )}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-7xl w-full mx-auto">
          {user.role === 'patient' && (
            <PatientDashboard
              userName={user.name}
              activeTab={activeTab}
              onChangeTab={navigateToTab}
              sendWsMessage={sendMessage}
              lastSignalMessage={lastSignalMessage}
            />
          )}
          {user.role === 'doctor' && (
            <DoctorDashboard
              activeTab={activeTab}
              onChangeTab={navigateToTab}
              sendWsMessage={sendMessage}
              lastSignalMessage={lastSignalMessage}
            />
          )}
          {user.role === 'hospital_manager' && (
            <HospitalManagerDashboard activeTab={activeTab} onChangeTab={navigateToTab} lastSignalMessage={lastSignalMessage} />
          )}
          {user.role === 'asha_worker' && (
            <AshaDashboard
              activeTab={activeTab}
              onChangeTab={navigateToTab}
              lastSignalMessage={lastSignalMessage}
            />
          )}
          {user.role === 'admin' && (
            <AdminDashboard activeTab={activeTab} onChangeTab={navigateToTab} />
          )}
        </main>
      </div>

      <NotificationDrawer
        open={notifDrawerOpen}
        notifications={notifications}
        onClose={() => setNotifDrawerOpen(false)}
        onMarkRead={(id) => void handleMarkRead(id)}
        onMarkAllRead={() => void handleMarkAllRead()}
      />

      <VoiceAssistantDrawer
        open={voiceDrawerOpen}
        userRole={user.role}
        initialPrompt={voiceInitialPrompt}
        onClose={() => {
          setVoiceDrawerOpen(false);
          setVoiceInitialPrompt(null);
        }}
      />

      {/* Forced Initial Password Change Modal */}
      {user.mustChangePassword && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleForcedPasswordChange}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Update Initial Account Password
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  For security, staff accounts provisioned with an initial password must set a new
                  private password before accessing records.
                </p>
              </div>
            </div>
            {pwError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                {pwError}
              </div>
            )}
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current (Initial) Password"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New Password (min 8 characters)"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <button
              type="submit"
              className="w-full py-2.5 text-sm font-semibold text-white bg-teal-700 rounded-lg cursor-pointer"
            >
              Update Password &amp; Continue
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
