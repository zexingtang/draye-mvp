import { useCallback, useEffect, useState } from 'react';

export interface UseAuthReturn {
  loading: boolean;
  loggedIn: boolean;
  companyName: string | null;
  username: string | null;
  loginError: string | null;
  loggingIn: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  const checkSession = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/session');
      const body = await res.json();
      setLoggedIn(!!body.loggedIn);
      setCompanyName(body.companyName ?? null);
      setUsername(body.username ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
  }, [checkSession]);

  const login = useCallback(async (u: string, p: string): Promise<boolean> => {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
      const body = await res.json();
      if (!res.ok) {
        setLoginError(body.error || 'Login failed');
        return false;
      }
      setLoggedIn(true);
      setCompanyName(body.companyName);
      setUsername(body.username);
      return true;
    } catch {
      setLoginError('Could not reach the server');
      return false;
    } finally {
      setLoggingIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setLoggedIn(false);
    setCompanyName(null);
    setUsername(null);
  }, []);

  return { loading, loggedIn, companyName, username, loginError, loggingIn, login, logout };
}
