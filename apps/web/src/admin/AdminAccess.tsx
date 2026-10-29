import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { adminSessionExpired, getAdminSession, loginAdmin, logoutAdmin, type AdminSession } from '../api/auth'
import { AdminPage } from './AdminPage'
import './auth.css'

export function AdminAccess() {
  const [session, setSession] = useState<AdminSession>()
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    let disposed = false
    void getAdminSession().then(value => { if (!disposed) setSession(value) })
      .catch(() => { if (!disposed) setError('No se pudo conectar con el servidor.') })
      .finally(() => { if (!disposed) setChecking(false) })
    function expired() {
      setSession(value => value ? { ...value, authenticated: false, username: null } : value)
      setPassword('')
      setError('Tu sesión terminó. Ingresá nuevamente para continuar.')
    }
    window.addEventListener(adminSessionExpired, expired)
    return () => { disposed = true; window.removeEventListener(adminSessionExpired, expired) }
  }, [])

  useEffect(() => {
    if (!session?.authenticated) document.title = 'Ingresar · Revel Movies'
  }, [session?.authenticated])

  async function checkSession() {
    setChecking(true); setError('')
    try { setSession(await getAdminSession()) }
    catch { setError('No se pudo conectar con el servidor.') }
    finally { setChecking(false) }
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true); setError('')
    try { setSession(await loginAdmin(username, password)); setPassword('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo iniciar sesión.'); setPassword('') }
    finally { setSubmitting(false) }
  }

  async function logout() {
    setSubmitting(true); setError('')
    try {
      await logoutAdmin()
      setSession(value => value ? { ...value, authenticated: false, username: null } : value)
      setPassword('')
    } catch { setError('No se pudo cerrar la sesión. Volvé a intentar.') }
    finally { setSubmitting(false) }
  }

  if (session?.authenticated) return <AdminPage username={session.username!} onLogout={logout} loggingOut={submitting} sessionError={error} />

  return <main className="admin-access">
    <div className="access-layout">
      <Link className="access-brand" to="/">REVEL <span>/ MOVIES</span></Link>
      <section className="access-card" aria-labelledby="access-title">
        <p className="eyebrow">CONTROL DE EVENTO</p>
        <h1 id="access-title">Tu evento.<br /><span>En tus manos.</span></h1>
        <p className="access-description">Ingresá para preparar el contenido y controlar tus pantallas.</p>
        {checking ? <p role="status">Comprobando acceso…</p> : !session ? <>
          <p role="alert" className="access-error">{error}</p><button onClick={() => void checkSession()}>Reintentar</button>
        </> : !session.configured ? <div role="alert" className="access-error">El acceso al panel todavía no está configurado. Contactá al administrador del servidor.</div> :
          <form onSubmit={login} className="access-form">
            <label htmlFor="admin-username">Usuario</label>
            <input id="admin-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={100} value={username} onChange={event => setUsername(event.target.value)} />
            <label htmlFor="admin-password">Contraseña</label>
            <input id="admin-password" name="password" type="password" autoComplete="current-password" required maxLength={256} value={password} onChange={event => setPassword(event.target.value)} aria-describedby={error ? 'access-error' : undefined} />
            {error && <p id="access-error" role="alert" className="access-error">{error}</p>}
            <button type="submit" disabled={submitting}>{submitting ? 'Ingresando…' : 'Ingresar al panel'}<span aria-hidden="true"> →</span></button>
          </form>}
      </section>
      <Link className="access-player" to="/player">Conectar una pantalla <span aria-hidden="true">↗</span></Link>
    </div>
  </main>
}
