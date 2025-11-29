"use client";

import React, { useEffect, useState, useRef } from "react";

/**
 * /auth/login page (login.jsx)
 * - Full UI built with Tailwind classes
 * - Email/password credential flow with validation
 * - Password strength indicator
 * - Captcha handling (Google reCAPTCHA if RECAPTCHA_SITE_KEY available, otherwise checkbox fallback)
 * - Social login buttons (redirect to OAuth endpoints)
 * - Session persistence using localStorage + cookie
 *
 * Notes:
 * - Replace /api/auth/login and /api/auth/oauth?provider=... with your backend endpoints.
 * - If you want to use Google reCAPTCHA, provide a RECAPTCHA_SITE_KEY at build/run time and uncomment the grecaptcha usage.
 */

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState({ email: "", password: "", captcha: "" });
  const [loading, setLoading] = useState(false);
  const [strength, setStrength] = useState({ score: 0, label: "", color: "bg-gray-300" });
  const [captchaReady, setCaptchaReady] = useState(false);
  const captchaTokenRef = useRef(null);
  const recaptchaSiteKey = typeof process !== "undefined" && process.env && process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY ? process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY : null;
  const [fallbackCaptchaChecked, setFallbackCaptchaChecked] = useState(false);

  useEffect(() => {
    evaluateStrength(password);
  }, [password]);

  useEffect(() => {
    if (recaptchaSiteKey) {
      // load grecaptcha script
      if (!document.querySelector('#recaptcha-script')) {
        const s = document.createElement('script');
        s.id = 'recaptcha-script';
        s.src = `https://www.google.com/recaptcha/api.js?render=${recaptchaSiteKey}`;
        s.async = true;
        document.head.appendChild(s);
        s.onload = () => setCaptchaReady(true);
      } else {
        setCaptchaReady(true);
      }
    } else {
      // no recaptcha key -> fallback checkbox
      setCaptchaReady(true);
    }
  }, []);

  function evaluateStrength(pw) {
    // Simple heuristic strength meter (no external libs)
    let score = 0;
    if (!pw || pw.length === 0) return setStrength({ score: 0, label: "Too short", color: "bg-gray-300" });
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;

    let label = "Very weak";
    let color = "bg-red-400";
    if (score <= 1) { label = "Very weak"; color = "bg-red-400"; }
    else if (score === 2) { label = "Weak"; color = "bg-orange-400"; }
    else if (score === 3) { label = "Okay"; color = "bg-yellow-400"; }
    else if (score === 4) { label = "Good"; color = "bg-green-400"; }
    else { label = "Strong"; color = "bg-green-600"; }

    setStrength({ score, label, color });
  }

  function validate() {
    const e = { email: "", password: "", captcha: "" };
    let ok = true;
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRe.test(email)) { e.email = "Enter a valid email"; ok = false; }
    if (!password || password.length < 8) { e.password = "Password must be at least 8 characters"; ok = false; }
    if (recaptchaSiteKey) {
      if (!captchaTokenRef.current) { e.captcha = "Captcha required"; ok = false; }
    } else {
      if (!fallbackCaptchaChecked) { e.captcha = "Please confirm you're not a robot"; ok = false; }
    }
    setErrors(e);
    return ok;
  }

  async function executeRecaptcha() {
    if (!recaptchaSiteKey) return null;
    if (window.grecaptcha && window.grecaptcha.execute) {
      try {
        const token = await window.grecaptcha.execute(recaptchaSiteKey, { action: 'login' });
        captchaTokenRef.current = token;
        return token;
      } catch (err) {
        console.warn('recaptcha execute failed', err);
        return null;
      }
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setErrors({ email: "", password: "", captcha: "" });

    // if recaptcha key present, attempt to get token
    if (recaptchaSiteKey) {
      try {
        await executeRecaptcha();
      } catch (err) {
        console.warn(err);
      }
    }

    const ok = validate();
    if (!ok) { setLoading(false); return; }

    // POST credentials to backend - replace endpoint with your API
    try {
      const payload = { email, password, captcha: captchaTokenRef.current };
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrors(prev => ({ ...prev, email: body?.message || 'Login failed' }));
        setLoading(false);
        return;
      }

      const data = await res.json();
      // expected: { token: 'jwt...', user: { name, email } }
      const token = data?.token;
      if (!token) {
        setErrors(prev => ({ ...prev, email: 'No token received from server' }));
        setLoading(false);
        return;
      }

      // Persist session
      persistSession(token, data.user, remember);

      // Optionally redirect to dashboard
      window.location.href = data?.redirect || '/';
    } catch (err) {
      console.error(err);
      setErrors(prev => ({ ...prev, email: 'Network error' }));
    } finally {
      setLoading(false);
    }
  }

  function persistSession(token, user, rememberMe) {
    // Save token to localStorage with expiry if rememberMe
    try {
      const payload = { token, user };
      if (rememberMe) {
        // persist for 30 days
        localStorage.setItem('auth', JSON.stringify(payload));
        const expiry = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toUTCString();
        document.cookie = `auth_token=${token}; path=/; expires=${expiry}; samesite=strict`;
      } else {
        // session-only
        sessionStorage.setItem('auth', JSON.stringify(payload));
        document.cookie = `auth_token=${token}; path=/; samesite=strict`;
      }
    } catch (err) {
      console.warn('failed to persist session', err);
    }
  }

  function handleSocialLogin(provider) {
    // This should redirect to your OAuth entrypoint that starts the provider flow.
    // Example: /api/auth/oauth?provider=google
    window.location.href = `/api/auth/oauth?provider=${provider}`;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Sign in to your account</h2>
          <p className="mt-2 text-center text-sm text-gray-600">Or <a href="/auth/register" className="font-medium text-indigo-600 hover:text-indigo-500">create a new account</a></p>
        </div>

        <div className="bg-white py-8 px-6 shadow rounded-lg">
          <div className="space-y-4">
            <div className="flex gap-3">
              <button onClick={() => handleSocialLogin('google')} className="flex-1 inline-flex justify-center items-center px-4 py-2 border rounded-md text-sm font-medium hover:shadow-sm focus:outline-none">
                <svg className="w-5 h-5 mr-2" viewBox="0 0 533.5 544.3" xmlns="http://www.w3.org/2000/svg"><path fill="#4285f4" d="M533.5 278.4c0-18.4-1.6-36.1-4.7-53.3H272v100.8h146.9c-6.3 34.4-25.5 63.6-54.5 83.2v68h87.9c51.5-47.5 81.2-117.4 81.2-198.7z"/><path fill="#34a853" d="M272 544.3c73.7 0 135.6-24.4 180.7-66.1l-87.9-68c-24.4 16.4-55.9 26-92.8 26-71.3 0-131.8-48.2-153.5-112.9H28.7v70.7C73.7 489.6 165 544.3 272 544.3z"/><path fill="#fbbc04" d="M118.5 327.2c-11.6-34.4-11.6-71.5 0-105.9V150.6H28.7C-5.5 199.5-21.6 253.8-21.6 308.3s16.1 108.8 50.3 157.7l89.8-70.8z"/><path fill="#ea4335" d="M272 108.1c39.8 0 76.1 13.7 104.4 40.6l78.3-78.3C399.7 24.4 337.8 0 272 0 165 0 73.7 54.7 28.7 150.6l89.8 70.7C140.2 156.4 200.7 108.1 272 108.1z"/></svg>
                Continue with Google
              </button>
              <button onClick={() => handleSocialLogin('github')} className="flex-1 inline-flex justify-center items-center px-4 py-2 border rounded-md text-sm font-medium hover:shadow-sm focus:outline-none">
                GitHub
              </button>
            </div>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or continue with</span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">Email address</label>
                <input id="email" name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm ${errors.email ? 'border-red-400' : 'border-gray-300'}`} />
                {errors.email && <p className="mt-1 text-sm text-red-600">{errors.email}</p>}
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
                <input id="password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={`mt-1 block w-full px-3 py-2 border rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm ${errors.password ? 'border-red-400' : 'border-gray-300'}`} />
                {errors.password && <p className="mt-1 text-sm text-red-600">{errors.password}</p>}

                {/* Password strength bar */}
                <div className="mt-2">
                  <div className="w-full bg-gray-200 h-2 rounded">
                    <div className={`${strength.color} h-2 rounded`} style={{ width: `${Math.min(100, (strength.score / 5) * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-gray-600">Strength: <span className="font-medium">{strength.label}</span></p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="flex items-center text-sm">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 text-indigo-600 border-gray-300 rounded" />
                  <span className="ml-2 text-gray-600">Remember me</span>
                </label>
                <div className="text-sm">
                  <a href="/auth/forgot" className="font-medium text-indigo-600 hover:text-indigo-500">Forgot your password?</a>
                </div>
              </div>

              {/* Captcha area */}
              <div>
                {recaptchaSiteKey ? (
                  <div className="text-sm text-gray-600">Captcha is enabled. It will validate automatically on submit.</div>
                ) : (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={fallbackCaptchaChecked} onChange={(e) => setFallbackCaptchaChecked(e.target.checked)} className="h-4 w-4 text-indigo-600 border-gray-300 rounded" />
                    <span>I am not a robot</span>
                  </label>
                )}
                {errors.captcha && <p className="mt-1 text-sm text-red-600">{errors.captcha}</p>}
              </div>

              <div>
                <button type="submit" disabled={loading} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none">
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
              </div>
            </form>

            <div className="pt-4 text-center text-sm text-gray-500">
              <p>By signing in you agree to our <a href="/terms" className="underline">Terms</a> and <a href="/privacy" className="underline">Privacy Policy</a>.</p>
            </div>
          </div>
        </div>

        <div className="text-center text-xs text-gray-400">Built with ❤️ — replace API endpoints to connect to your auth backend</div>
      </div>
    </div>
  );
}
///changes