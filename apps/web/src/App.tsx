import { Link, Navigate, Route, Routes } from 'react-router'
import { AdminPage } from './admin/AdminPage'
import { DiagnosticsPage } from './player/DiagnosticsPage'
import { PlayerPage } from './player/PlayerPage'
import './home.css'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/player" element={<PlayerPage />} />
      <Route path="/player/diagnostics" element={<DiagnosticsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function Home() {
  return (
    <main className="home-shell event-home">
      <div className="home-content">
        <header className="home-masthead"><span className="home-wordmark">REVEL<span> / MOVIES</span></span><span>CONTROL DE PANTALLAS PARA EVENTOS</span></header>
        <div className="home-intro">
          <div><p className="eyebrow">CADA MOMENTO TIENE SU PANTALLA</p><h1>Tu evento,<br /><em>en pantalla.</em></h1><p className="home-description">Videos, anuncios y escenas. Todo preparado para acompañar lo que pasa en tu evento.</p></div>
          <div className="home-stage" aria-hidden="true"><div className="stage-screen stage-main"><span>REVEL</span><i /></div><div className="stage-screen stage-side"><span>PLAY</span><b>▶</b></div><div className="stage-caption">UNA IDEA. MUCHAS PANTALLAS.</div></div>
        </div>
        <nav className="home-entrypoints" aria-label="Elegí cómo usar Revel Movies">
          <Link className="home-entry home-entry-primary" to="/admin"><span className="entry-kicker">01 / DESDE TU COMPUTADORA O CELULAR</span><h2>Controlar mi evento <span aria-hidden="true">↗</span></h2><p>Organizá el contenido, vinculá las pantallas y controlá cada momento desde el panel.</p><span className="entry-action">Abrir el panel <span aria-hidden="true">→</span></span></Link>
          <Link className="home-entry" to="/player"><span className="entry-kicker">02 / DESDE LA TV O PANTALLA</span><h2>Conectar una pantalla <span aria-hidden="true">↗</span></h2><p>Abrí el reproductor en el dispositivo que va a mostrar el contenido y vinculalo con su código.</p><span className="entry-action">Abrir el reproductor <span aria-hidden="true">→</span></span></Link>
        </nav>
        <footer className="home-footer"><span>De la bienvenida al último tema.</span><Link to="/player/diagnostics">Diagnóstico de esta pantalla <span aria-hidden="true">↗</span></Link></footer>
      </div>
    </main>
  )
}
