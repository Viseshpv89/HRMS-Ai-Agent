/**
 * Vinpro HRMS — Sidebar Nav Item for Compliance Agent
 * 
 * This is a REFERENCE EXAMPLE showing how the compliance nav item 
 * should look in context. Do NOT copy this whole file — 
 * just find the matching pattern in your existing sidebar and insert the 
 * ⚖️ Compliance Agent item in the right place.
 * 
 * Place it near the bottom of the admin section, after Payroll/Reports.
 */

// ─── EXAMPLE: How your sidebar might look after the change ───────────────────

function Sidebar({ currentView, setCurrentView, user }) {
  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <nav className="sidebar">
      {/* ... your existing nav items ... */}

      <NavItem icon="💰" label="Payroll"     view="payroll"     current={currentView} onClick={setCurrentView} />
      <NavItem icon="📊" label="Reports"     view="reports"     current={currentView} onClick={setCurrentView} />
      <NavItem icon="⚙️"  label="Settings"   view="settings"    current={currentView} onClick={setCurrentView} />

      {/* ← ADD THIS BLOCK */}
      {isSuperAdmin && (
        <NavItem
          icon="⚖️"
          label="Compliance Agent"
          view="compliance"
          current={currentView}
          onClick={setCurrentView}
          badge="AI"   // optional — shows a small "AI" badge on the item
        />
      )}
      {/* END ADD */}
    </nav>
  );
}

// Generic nav item component (use your existing one, not this)
function NavItem({ icon, label, view, current, onClick, badge }) {
  const isActive = current === view;
  return (
    <div
      className={`nav-item ${isActive ? 'active' : ''}`}
      onClick={() => onClick(view)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        cursor: 'pointer',
        borderRadius: 8,
        background: isActive ? '#f0f4ff' : 'transparent',
        color: isActive ? '#2563eb' : '#374151',
        fontWeight: isActive ? 600 : 400,
        transition: 'all 0.15s',
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge && (
        <span style={{
          fontSize: 10,
          background: '#2563eb',
          color: 'white',
          padding: '1px 5px',
          borderRadius: 4,
          fontWeight: 700,
          letterSpacing: 0.5,
        }}>
          {badge}
        </span>
      )}
    </div>
  );
}
