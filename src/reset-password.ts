import { supabase } from './supabase';

const resetPasswordForm = document.getElementById(
  'resetPasswordForm',
) as HTMLFormElement;

const newPasswordInput = document.getElementById(
  'newPassword',
) as HTMLInputElement;

const confirmPasswordInput = document.getElementById(
  'confirmPassword',
) as HTMLInputElement;

const updatePasswordBtn = document.getElementById(
  'updatePasswordBtn',
) as HTMLButtonElement;

const resetMessage = document.getElementById(
  'resetMessage',
) as HTMLParagraphElement;

const successPanel = document.getElementById('successPanel') as HTMLDivElement;

const invalidPanel = document.getElementById('invalidPanel') as HTMLDivElement;

let recoverySessionReady = false;

function showInvalidSession() {
  resetPasswordForm.classList.add('hidden');
  invalidPanel.classList.remove('hidden');
}

function showRecoveryForm() {
  recoverySessionReady = true;
  invalidPanel.classList.add('hidden');
  resetPasswordForm.classList.remove('hidden');
}

// Listen for Supabase authentication events.
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' && session) {
    showRecoveryForm();
    return;
  }

  // Supabase has finished initializing without a recovery session.
  if (event === 'INITIAL_SESSION' && !recoverySessionReady) {
    showInvalidSession();
  }
});

// Handle password update.
resetPasswordForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!recoverySessionReady) {
    showInvalidSession();
    return;
  }

  const newPassword = newPasswordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  resetMessage.className = 'message';
  resetMessage.textContent = '';

  if (!newPassword || !confirmPassword) {
    resetMessage.textContent = 'Please complete both password fields.';
    resetMessage.className = 'message error';
    return;
  }

  if (newPassword.length < 8) {
    resetMessage.textContent = 'Password must contain at least 8 characters.';
    resetMessage.className = 'message error';
    return;
  }

  if (newPassword !== confirmPassword) {
    resetMessage.textContent = 'Passwords do not match.';
    resetMessage.className = 'message error';
    return;
  }

  updatePasswordBtn.disabled = true;
  updatePasswordBtn.textContent = 'Updating...';

  try {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      console.error('Password update error:', error);

      resetMessage.textContent =
        'Unable to update password. Your recovery link may have expired.';

      resetMessage.className = 'message error';
      return;
    }

    // Clear only this browser's recovery session.
    await supabase.auth.signOut({ scope: 'local' });

    resetPasswordForm.classList.add('hidden');
    successPanel.classList.remove('hidden');
  } catch (error) {
    console.error('Password recovery error:', error);

    resetMessage.textContent = 'Unable to connect. Please try again.';

    resetMessage.className = 'message error';
  } finally {
    updatePasswordBtn.disabled = false;
    updatePasswordBtn.textContent = 'Update Password';
  }
});
