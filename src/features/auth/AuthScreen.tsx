import { useEffect, useState } from 'react';
import { Dumbbell, Eye, EyeOff, WifiOff } from 'lucide-react';
import { signIn, signUp } from '../../lib/sync';
import { Segmented } from '../../components/ui';
import { greetSir } from '../../utils/dates';

/** First screen when not signed in. The login is then remembered on this device. */
export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password);
      } else {
        const r = await signUp(email.trim(), password);
        if (r.needsConfirmation) {
          setInfo('Check your inbox to confirm your email, then sign in here.');
          setMode('signin');
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      setError(/invalid login/i.test(msg) ? 'Wrong email or password.' : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen auth">
      <div className="screen__scroll">
        <div className="auth__inner">
          <div className="auth-logo">
            <Dumbbell size={30} strokeWidth={2.2} />
          </div>
          <h1 className="auth__title">{greetSir()}</h1>
          <p className="auth__subtitle">
            {mode === 'signin' ? 'Sign in to LiftLog to pick up where you left off.' : 'Create your LiftLog account.'}
          </p>

          <form
            className="auth-card stack"
            style={{ gap: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <Segmented
              value={mode}
              onChange={(m) => {
                setMode(m);
                setError(null);
              }}
              options={[
                { value: 'signin', label: 'Sign in' },
                { value: 'signup', label: 'Create account' },
              ]}
            />
            <input
              className="input input--lg"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <div className="password-field">
              <input
                className="input input--lg"
                type={show ? 'text' : 'password'}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
              />
              <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {error && <p className="auth__msg auth__msg--error">{error}</p>}
            {info && <p className="auth__msg">{info}</p>}
            {!online && (
              <p className="auth__msg">
                <WifiOff size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                You're offline. Connect once to sign in — after that LiftLog works offline.
              </p>
            )}
            <button className="btn btn--primary btn--lg btn--block" disabled={busy || !email || password.length < 6 || !online}>
              {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="auth__foot">You stay signed in on this device until you sign out.</p>
        </div>
      </div>
    </div>
  );
}
