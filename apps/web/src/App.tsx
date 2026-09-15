import { Link, Navigate, Route, Routes } from 'react-router'
import { AdminPage } from './admin/AdminPage'
import { PlayerPage } from './player/PlayerPage'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/player" element={<PlayerPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function Home() {
  return (
    <main className="home-shell">
      <div>
        <p className="eyebrow">REVEL MOVIES</p>
        <h1>Multi-screen media orchestration.</h1>
        <p>Browser-first control for event displays and digital signage.</p>
        <nav className="home-actions">
          <Link to="/admin">Open Admin</Link>
          <Link to="/player">Open Player</Link>
        </nav>
      </div>
    </main>
  )
}
