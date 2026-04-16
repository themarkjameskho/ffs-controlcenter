import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import './App.css'
import { useDeliverablesIndex } from './lib/deliverables'
import Dashboard from './pages/Dashboard'
import Calendar from './pages/Calendar'
import ClientDashboard from './pages/ClientDashboard'

function Sidebar({ clients }: { clients: Array<{ slug: string; name: string }> }) {
  const navClass = ({ isActive }: { isActive: boolean }) => `sidebar-link ${isActive ? 'active' : ''}`
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="brand-logo" src="/FFS-Logo_300px.png" alt="Fast Forward Search logo" />
        <div className="brand-sub">Control Center</div>
      </div>

      <nav className="sidebar-nav" aria-label="Main">
        <NavLink to="/" end className={navClass}>
          Dashboard
        </NavLink>
        <NavLink to="/calendar" className={navClass}>
          Calendar
        </NavLink>
      </nav>

      <details className="sidebar-clients" open>
        <summary>Clients</summary>
        <div className="sidebar-client-list">
          {clients.length === 0 ? (
            <p className="sidebar-empty">No clients found</p>
          ) : (
            clients.map((client) => (
              <NavLink key={client.slug} to={`/clients/${client.slug}`} className={navClass}>
                {client.name}
              </NavLink>
            ))
          )}
        </div>
      </details>
    </aside>
  )
}

export default function App() {
  const deliverables = useDeliverablesIndex()

  return (
    <div className="root-layout">
      <Sidebar clients={deliverables.clients} />
      <main className="content-pane">
        <Routes>
          <Route path="/" element={<Dashboard deliverables={deliverables} />} />
          <Route path="/kanban" element={<Navigate to="/" replace />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/clients/:clientSlug" element={<ClientDashboard deliverables={deliverables} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
