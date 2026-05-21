# Patch: src/App.jsx
## What to do: Add 3 things to your existing App.jsx

---

### STEP 1 — Add import at the top (with your other imports)

```jsx
import ComplianceDashboard from './components/ComplianceDashboard';
```

---

### STEP 2 — Add 'compliance' to your view switch

Find the section in App.jsx where you render different views/pages based on `currentView` or `activeModule` (the big if/switch block). Add this case:

```jsx
{currentView === 'compliance' && (
  <ComplianceDashboard
    apiJson={apiJson}
    authToken={token || localStorage.getItem('token')}
  />
)}
```

If your app uses a switch statement instead of conditionals:
```jsx
case 'compliance':
  return (
    <ComplianceDashboard
      apiJson={apiJson}
      authToken={token || localStorage.getItem('token')}
    />
  );
```

---

### STEP 3 — Add sidebar nav item (super admin only)

Find your sidebar/nav section where other menu items like "Payroll", "Attendance", etc. are rendered.
Add this — wrapped in a role check so only super_admin sees it:

```jsx
{(userRole === 'super_admin' || user?.role === 'super_admin') && (
  <li
    className={`nav-item ${currentView === 'compliance' ? 'active' : ''}`}
    onClick={() => setCurrentView('compliance')}
    style={{ cursor: 'pointer' }}
  >
    <span className="nav-icon">⚖️</span>
    <span className="nav-label">Compliance Agent</span>
  </li>
)}
```

> **Note:** Replace `userRole`, `user?.role`, `currentView`, `setCurrentView`, `nav-item`, `nav-icon`, `nav-label` with whatever variable/class names your app actually uses. The pattern is the same — just match your existing sidebar item structure.
