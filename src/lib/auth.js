// DropLister Pro - Authentication & License Module
// Handles login, trial timer, and license validation

const AUTH_SERVER = 'https://nickets.xyz/droplister';
const TRIAL_DURATION_MS = 30 * 60 * 1000; // 30 minutes

export async function getAuthState() {
  const data = await chrome.storage.local.get([
    'dl_auth_token', 'dl_user_email', 'dl_license_type',
    'dl_trial_start', 'dl_trial_expired', 'dl_session_id'
  ]);
  return {
    token: data.dl_auth_token || null,
    email: data.dl_user_email || null,
    licenseType: data.dl_license_type || null,
    trialStart: data.dl_trial_start || null,
    trialExpired: data.dl_trial_expired || false,
    sessionId: data.dl_session_id || null,
    isLoggedIn: !!data.dl_auth_token,
  };
}

export async function login(email, password) {
  try {
    const resp = await fetch(`${AUTH_SERVER}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || 'Login failed');
    }

    const data = await resp.json();

    await chrome.storage.local.set({
      dl_auth_token: data.token,
      dl_user_email: email,
      dl_license_type: data.license_type || 'trial',
      dl_trial_start: Date.now(),
      dl_trial_expired: false,
      dl_session_id: generateSessionId()
    });

    return {
      success: true,
      licenseType: data.license_type || 'trial',
      email: email
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function logout() {
  await chrome.storage.local.remove([
    'dl_auth_token', 'dl_user_email', 'dl_license_type',
    'dl_trial_start', 'dl_trial_expired', 'dl_session_id'
  ]);
}

export async function checkAccess() {
  const state = await getAuthState();

  if (!state.isLoggedIn) {
    return { allowed: false, reason: 'not_logged_in' };
  }

  // Full license - always allowed
  if (state.licenseType === 'full' || state.licenseType === 'premium') {
    return { allowed: true, reason: 'licensed', remaining: Infinity };
  }

  // Trial - check time
  if (state.licenseType === 'trial') {
    if (state.trialExpired) {
      return { allowed: false, reason: 'trial_expired', remaining: 0 };
    }

    const elapsed = Date.now() - (state.trialStart || Date.now());
    const remaining = TRIAL_DURATION_MS - elapsed;

    if (remaining <= 0) {
      await chrome.storage.local.set({ dl_trial_expired: true });
      return { allowed: false, reason: 'trial_expired', remaining: 0 };
    }

    return { allowed: true, reason: 'trial', remaining };
  }

  return { allowed: false, reason: 'unknown_license' };
}

export function getTrialTimeRemaining(trialStart) {
  if (!trialStart) return 0;
  const elapsed = Date.now() - trialStart;
  return Math.max(0, TRIAL_DURATION_MS - elapsed);
}

export function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function generateSessionId() {
  return 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 8);
}

export async function validateToken() {
  const state = await getAuthState();
  if (!state.token) return false;

  try {
    const resp = await fetch(`${AUTH_SERVER}/api/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      }
    });
    if (!resp.ok) {
      await logout();
      return false;
    }
    const data = await resp.json();
    if (data.license_type) {
      await chrome.storage.local.set({ dl_license_type: data.license_type });
    }
    return true;
  } catch {
    return true; // Allow offline use if server is unreachable
  }
}
