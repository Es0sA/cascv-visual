/* ============================================================
   CAS CV Builder — auth.js (Login Page)
   Real Firebase email/password auth with robust persistence,
   form submission support, and detailed error feedback.
   ============================================================ */
import { auth } from "./firebase-init.js";
import {
  signInWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

// Multi-tiered persistence fallback for Private Browsing / Incognito mode
async function configurePersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (errLocal) {
    try {
      await setPersistence(auth, browserSessionPersistence);
    } catch (errSession) {
      try {
        await setPersistence(auth, inMemoryPersistence);
      } catch {
        // Fall back to default
      }
    }
  }
}

// Ensure initial persistence setup
configurePersistence().catch(() => {});

// If already signed in, wait until auth state is confirmed before redirecting
auth.authStateReady().then(() => {
  if (auth.currentUser) {
    window.location.replace("dashboard.html");
  }
});

// Elements
const loginForm   = document.getElementById('loginForm');
const signinBtn   = document.getElementById('signinBtn');
const usernameInp = document.getElementById('username');
const passwordInp = document.getElementById('password');
const errorMsg    = document.getElementById('errorMsg');
const togglePwd   = document.getElementById('togglePwd');
const eyeOpen     = document.getElementById('eyeOpen');
const eyeClosed   = document.getElementById('eyeClosed');
const btnText     = document.getElementById('btnText');

// Toggle password visibility
if (togglePwd) {
  togglePwd.addEventListener('click', () => {
    const isHidden = passwordInp.type === 'password';
    passwordInp.type   = isHidden ? 'text' : 'password';
    eyeOpen.style.display   = isHidden ? 'none'  : '';
    eyeClosed.style.display = isHidden ? '' : 'none';
  });
}

// Sign in logic
async function handleSignIn(e) {
  if (e) e.preventDefault();

  const email    = (usernameInp.value || '').trim().toLowerCase();
  const password = passwordInp.value || '';

  errorMsg.textContent = '';

  if (!email || !password) {
    errorMsg.textContent = 'Please fill in both fields.';
    return;
  }

  signinBtn.disabled = true;
  btnText.textContent = 'Signing in...';

  try {
    await configurePersistence();
    await signInWithEmailAndPassword(auth, email, password);
    window.location.replace('dashboard.html');
  } catch (err) {
    console.error('Login error:', err);
    let message = 'Incorrect email or password.';
    if (err.code === 'auth/too-many-requests') {
      message = 'Too many unsuccessful attempts. Please wait a few minutes and try again.';
    } else if (err.code === 'auth/network-request-failed') {
      message = 'Network error. Please check your internet connection and try again.';
    } else if (err.code === 'auth/invalid-email') {
      message = 'Please enter a valid email address.';
    } else if (err.code === 'auth/user-disabled') {
      message = 'This account has been disabled.';
    } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
      message = 'Incorrect email or password. Please verify your credentials and try again.';
    }
    errorMsg.textContent = message;
    passwordInp.value = '';
    passwordInp.focus();
    signinBtn.disabled = false;
    btnText.textContent = 'Sign In';
  }
}

if (loginForm) {
  loginForm.addEventListener('submit', handleSignIn);
} else if (signinBtn) {
  signinBtn.addEventListener('click', handleSignIn);
}
