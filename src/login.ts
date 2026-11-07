import { enablePasswordToggles } from './password-toggle';

enablePasswordToggles();

let signInPending = false;

function setSignInPending(pending: boolean) {
  signInPending = pending;
  document
    .querySelectorAll<HTMLButtonElement>(
      '#employeeForm button[type="submit"], #adminForm button[type="submit"]',
    )
    .forEach((button) => {
      button.disabled = pending;
    });
}

function restoreLoginPage() {
  setSignInPending(false);
  document.getElementById('loadingOverlay')?.classList.add('hidden');
}

// Modules can initialize after window.load during hot reloads. The form is ready
// as soon as its handlers are attached; it does not need a page-load timer.
restoreLoginPage();
window.addEventListener('pageshow', (event) => {
  if (event.persisted) restoreLoginPage();
});

function showLoader(text: string) {
  const loader = document.getElementById('loadingOverlay');
  if (loader) {
    const textEl = loader.querySelector('.loading-text');
    if (textEl) textEl.textContent = text;
    loader.classList.remove('hidden');
  }
}

function showError(msgId: string, text: string) {
  const msgEl = document.getElementById(msgId);
  if (msgEl) {
    msgEl.textContent = text;
    msgEl.classList.add('error', 'visible');

    // Add a little shake effect (defined in CSS if needed, or just visual)
    msgEl.style.animation = 'none';
    msgEl.offsetHeight; // trigger reflow
    msgEl.style.animation = 'shake 0.4s ease';
  }
}

function clearError(msgId: string) {
  const msgEl = document.getElementById(msgId);
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.classList.remove('error', 'visible');
  }
}

async function signInForRole(
  role: 'admin' | 'employee',
  usernameInputId: string,
  passwordInputId: string,
  messageId: string,
) {
  if (signInPending) return;

  const identifier = (
    document.getElementById(usernameInputId) as HTMLInputElement
  )?.value.trim();

  const password = (
    document.getElementById(passwordInputId) as HTMLInputElement
  )?.value;

  if (!identifier || !password) {
    showError(messageId, 'Please enter your email and password.');
    return;
  }

  // Supabase password authentication uses an email address.
  if (!identifier.includes('@')) {
    showError(messageId, 'Please use your registered email address.');
    return;
  }

  setSignInPending(true);

  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.auth.signInWithPassword({
      email: identifier,
      password,
    });

    if (error) {
      showError(messageId, authenticationErrorMessage(error));
      return;
    }

    if (!data.user) {
      showError(messageId, 'Invalid email or password.');
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('username, role, active')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile || !profile.active) {
      await supabase.auth.signOut();
      showError(messageId, 'Your account is inactive or not configured.');
      return;
    }

    if (profile.role !== role) {
      await supabase.auth.signOut();
      const message =
        profile.role === 'admin'
          ? 'This is an Admin account. Select the Admin tab above and sign in again.'
          : profile.role === 'employee'
            ? 'This is a Cashier account. Select the Cashier tab above and sign in again.'
            : 'Your account role is not configured. Please contact your administrator.';
      showError(messageId, message);
      return;
    }

    clearError(messageId);

    localStorage.setItem(
      'wh-session',
      JSON.stringify({
        username: profile.username || data.user.email,
        role: profile.role,
      }),
    );

    showLoader(
      role === 'admin'
        ? 'Authenticating as Admin...'
        : 'Authenticating as Cashier...',
    );

    window.location.href = '/app.html';
  } catch (error) {
    console.error('Login error:', error);
    document.getElementById('loadingOverlay')?.classList.add('hidden');
    showError(messageId, authenticationErrorMessage(error));
  } finally {
    setSignInPending(false);
  }
}

function authenticationErrorMessage(error: unknown): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? error.code
      : undefined;
  if (code === 'invalid_credentials') return 'Invalid email or password.';
  if (code === 'email_not_confirmed') {
    return 'Please confirm your email address before signing in.';
  }
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit'
  ) {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }
  if (
    error instanceof Error &&
    error.message.startsWith('Missing Supabase configuration.')
  ) {
    return 'Sign-in is not configured. Please contact your administrator.';
  }
  return 'Unable to connect. Please try again.';
}

document.getElementById('employeeForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  void signInForRole('employee', 'empUsername', 'empPassword', 'empMsg');
});

document.getElementById('adminForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  void signInForRole('admin', 'adminUsername', 'adminPassword', 'adminMsg');
});

const resetOverlay = document.getElementById('resetModal') as HTMLElement;
const resetStep1 = document.getElementById('resetStep1') as HTMLElement;
const resetStep2 = document.getElementById('resetStep2') as HTMLElement;
const resetUsernameInput = document.getElementById(
  'resetUsername',
) as HTMLInputElement;
const resetMsg = document.getElementById('resetMsg') as HTMLElement;
const resetSuccessInfo = document.getElementById(
  'resetSuccessInfo',
) as HTMLElement;

function openResetModal() {
  resetStep1.classList.remove('hidden');
  resetStep2.classList.add('hidden');
  resetUsernameInput.value = '';
  resetMsg.textContent = '';
  resetMsg.className = 'reset-msg';
  resetOverlay.classList.add('open');
  requestAnimationFrame(() => resetUsernameInput.focus());
}

function closeResetModal() {
  resetOverlay.classList.remove('open');
}

document
  .getElementById('forgotCashier')
  ?.addEventListener('click', openResetModal);
document
  .getElementById('forgotAdmin')
  ?.addEventListener('click', openResetModal);
document
  .getElementById('closeResetModal')
  ?.addEventListener('click', closeResetModal);
document
  .getElementById('cancelResetModal')
  ?.addEventListener('click', closeResetModal);

// Close on backdrop click
resetOverlay.addEventListener('click', (e) => {
  if (e.target === resetOverlay) closeResetModal();
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && resetOverlay.classList.contains('open'))
    closeResetModal();
});

const confirmResetButton = document.getElementById(
  'confirmReset',
) as HTMLButtonElement;

confirmResetButton?.addEventListener('click', async () => {
  if (confirmResetButton.disabled) return;
  const email = resetUsernameInput.value.trim();

  if (!email) {
    resetMsg.textContent = 'Please enter your registered email address.';
    resetMsg.className = 'reset-msg error';
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    resetMsg.textContent = 'Please enter a valid email address.';
    resetMsg.className = 'reset-msg error';
    return;
  }

  confirmResetButton.disabled = true;
  confirmResetButton.textContent = 'Sending...';

  try {
    const { supabase } = await import('./supabase');
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password.html`,
    });

    if (error) {
      console.error('Password recovery error:', error);
      resetMsg.textContent =
        'Unable to send the reset email. Please try again.';
      resetMsg.className = 'reset-msg error';
      return;
    }

    resetStep1.classList.add('hidden');
    resetStep2.classList.remove('hidden');
    resetSuccessInfo.textContent =
      'If an account matches that email, you will receive a password recovery link. Please check your inbox and spam folder.';
  } catch (error) {
    console.error('Password recovery error:', error);
    resetMsg.textContent = authenticationErrorMessage(error);
    resetMsg.className = 'reset-msg error';
  } finally {
    confirmResetButton.disabled = false;
    confirmResetButton.textContent = 'Reset';
  }
});

document
  .getElementById('closeResetSuccess')
  ?.addEventListener('click', closeResetModal);

/* ── Tab switching ── */
const tabs = {
  cashier: {
    btn: document.getElementById('tabCashier'),
    panel: document.getElementById('panelCashier'),
  },
  admin: {
    btn: document.getElementById('tabAdmin'),
    panel: document.getElementById('panelAdmin'),
  },
};

function switchTab(active: 'cashier' | 'admin', updateHash = true) {
  Object.entries(tabs).forEach(([key, { btn, panel }]) => {
    const isActive = key === active;
    if (isActive) {
      btn?.classList.add('active');
      panel?.classList.remove('panel-hidden');
    } else {
      btn?.classList.remove('active');
      panel?.classList.add('panel-hidden');
    }
    btn?.setAttribute('aria-selected', String(isActive));
  });
  if (updateHash && window.location.hash !== `#${active}`) {
    window.location.hash = active;
  }
}

tabs.cashier.btn?.addEventListener('click', () => switchTab('cashier'));
tabs.admin.btn?.addEventListener('click', () => switchTab('admin'));

function restoreSelectedTab() {
  switchTab(window.location.hash === '#admin' ? 'admin' : 'cashier', false);
}

restoreSelectedTab();
window.addEventListener('hashchange', restoreSelectedTab);

// Initialize the decoration independently so authentication controls are ready first.
void import('./login-background')
  .then(({ initLoginBackground }) => initLoginBackground())
  .catch((error: unknown) => {
    console.error('The sign-in rack could not be initialized:', error);
  });
