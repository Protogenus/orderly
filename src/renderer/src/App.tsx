import { useEffect, useState } from 'react';
import { ToastProvider, useToast, errMsg } from './components/Toast';
import { setSetting } from './api';
import { OverviewPage, ProductionPage, ReturnsPage, ReportsPage, IntegrationsPage } from './pages/placeholders';
import { FulfillmentPage } from './pages/Fulfillment';
import { OrdersPage } from './pages/Orders';
import { InboxPage } from './pages/Inbox';
import { CustomersPage } from './pages/Customers';
import { ProductsPage } from './pages/Products';
import { SettingsPage } from './pages/Settings';
import './design-tokens.css';

type PageId =
  | 'overview' | 'orders' | 'inbox' | 'customers' | 'products'
  | 'fulfillment' | 'production' | 'returns' | 'reports' | 'integrations' | 'settings';

const NAV: { group: string; items: { id: PageId; label: string; icon: string }[] }[] = [
  {
    group: 'Workspace',
    items: [
      { id: 'overview', label: 'Overview', icon: '▦' },
      { id: 'inbox', label: 'Inbox', icon: '📥' },
      { id: 'orders', label: 'Orders', icon: '🧾' },
    ],
  },
  {
    group: 'Records',
    items: [
      { id: 'customers', label: 'Customers', icon: '👥' },
      { id: 'products', label: 'Products', icon: '📦' },
    ],
  },
  {
    group: 'Operations',
    items: [
      { id: 'fulfillment', label: 'Fulfillment', icon: '🚚' },
      { id: 'production', label: 'Production', icon: '🏭' },
      { id: 'returns', label: 'Returns', icon: '↩' },
    ],
  },
  {
    group: 'Other',
    items: [
      { id: 'reports', label: 'Reports', icon: '📊' },
      { id: 'integrations', label: 'Integrations', icon: '🔌' },
      { id: 'settings', label: 'Settings', icon: '⚙' },
    ],
  },
];

function pageTitle(id: PageId): string {
  for (const g of NAV) for (const i of g.items) if (i.id === id) return i.label;
  return 'Overview';
}

function Shell() {
  const { notifyError } = useToast();
  const [page, setPage] = useState<PageId>('overview');
  const [ready, setReady] = useState(false);
  const [orderDeepLink, setOrderDeepLink] = useState<string | null>(null);

  function openOrder(id: string) {
    setOrderDeepLink(id);
    setPage('orders');
  }

  useEffect(() => {
    // Restore last page; keyboard shortcut: Alt+1..9,0,= jumps to nav items.
    (async () => {
      try {
        const s = await window.orderly.getSettings();
        const last = s.last_page as PageId | undefined;
        if (last && NAV.some((g) => g.items.some((i) => i.id === last))) setPage(last);
      } catch (e) {
        notifyError(errMsg(e));
      } finally {
        setReady(true);
      }
    })();
  }, [notifyError]);

  useEffect(() => {
    if (!ready) return;
    setSetting('last_page', page).catch(() => {});
  }, [page, ready]);

  useEffect(() => {
    const flat = NAV.flatMap((g) => g.items);
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const digits = '1234567890=';
      const idx = digits.indexOf(e.key);
      if (idx >= 0 && idx < flat.length) {
        e.preventDefault();
        setPage(flat[idx].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!ready) return <div className="shell" />;

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Primary">
        <div className="brand">
          <span className="brand-dot" />
          <div>
            <div>Orderly</div>
            <div className="brand-sub">Clever Signal</div>
          </div>
        </div>
        {NAV.map((g) => (
          <div key={g.group}>
            <div className="nav-group-label">{g.group}</div>
            {g.items.map((item) => (
              <button
                key={item.id}
                className={page === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => setPage(item.id)}
                aria-current={page === item.id ? 'page' : undefined}
              >
                <span className="nav-icon" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </div>
        ))}
        <div className="sidebar-foot">Every order, in order.</div>
      </nav>
      <main className="workspace">
        {page === 'overview' && <OverviewPage />}
        {page === 'orders' && <OrdersPage openRequest={orderDeepLink} onOpenConsumed={() => setOrderDeepLink(null)} />}
        {page === 'inbox' && <InboxPage onOpenOrder={openOrder} />}
        {page === 'customers' && <CustomersPage />}
        {page === 'products' && <ProductsPage />}
        {page === 'fulfillment' && <FulfillmentPage />}
        {page === 'production' && <ProductionPage />}
        {page === 'returns' && <ReturnsPage />}
        {page === 'reports' && <ReportsPage />}
        {page === 'integrations' && <IntegrationsPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
