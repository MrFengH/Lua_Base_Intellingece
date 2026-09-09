import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  CaptureCorrection,
  CaptureSessionView,
  Customer360View,
  CustomerListItem,
  DashboardView,
  InferenceRuntimeInfo,
} from '@/application/contracts';
import { MODALITIES } from '@/domain/model';
import type { ApproximateAge, DraftField, InstallationEstimate } from '@/domain';
import type { IpcResult } from '@/shared';

type Page = 'capture' | 'customers' | 'dashboard';

const unwrap = <T,>(result: IpcResult<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
};

const fieldText = <T,>(field: DraftField<T>, format: (value: T) => string = String): string => {
  if (field.state === 'Known') return format(field.value);
  return field.state === 'DeclaredUnknown' ? 'Unknown (acknowledged)' : 'Missing';
};

const ageText = (age: ApproximateAge): string => {
  if (age.type === 'unknown') return 'Unknown';
  if (age.type === 'qualitative') return age.label;
  if (age.type === 'exact') return `${age.years} years`;
  if (age.minYears === age.maxYears) return `~${age.minYears} years`;
  return `${age.minYears}–${age.maxYears} years`;
};

const installationText = (installation: InstallationEstimate): string => {
  if (installation.type === 'unknown') return 'Unknown';
  if (installation.type === 'year') return `~${installation.year} (derived)`;
  return `${installation.minYear}–${installation.maxYear} (derived)`;
};

const RuntimeBadge = ({
  runtime,
  initialize,
  busy,
}: {
  runtime: InferenceRuntimeInfo | null;
  initialize: () => void;
  busy: boolean;
}): React.JSX.Element => {
  if (!runtime) return <div className="runtime-card skeleton">Checking inference runtime…</div>;
  const ready = runtime.status === 'ready';
  return (
    <div className={`runtime-card ${runtime.engine === 'Development Mock' ? 'mock' : ''}`}>
      <div className="runtime-title">
        <span className={`status-dot ${ready ? 'ready' : runtime.status}`} />
        <strong>Inference Engine: {runtime.engine}</strong>
        <span className="runtime-state">{runtime.status.replaceAll('-', ' ')}</span>
      </div>
      <div className="runtime-grid">
        <span>Execution</span>
        <b>{runtime.execution}</b>
        <span>Model</span>
        <b>{runtime.model}</b>
        <span>Network for inference</span>
        <b>{runtime.networkRequiredForInference ? 'Yes' : 'No'}</b>
      </div>
      {runtime.detail && <p>{runtime.detail}</p>}
      {runtime.engine === 'QVAC' && !ready && (
        <button className="small-button" onClick={initialize} disabled={busy}>
          {busy ? 'Initializing…' : 'Initialize local model'}
        </button>
      )}
      {runtime.engine === 'Development Mock' && (
        <div className="mock-warning">Development Mock — not valid for the final QVAC demo</div>
      )}
    </div>
  );
};

interface EquipmentEdit {
  id: string;
  modality: string;
  quantity: string;
  manufacturer: string;
  model: string;
  age: string;
  notes: string;
}

type EquipmentEditField = Exclude<keyof EquipmentEdit, 'id'>;

interface EditState {
  customer: { name: string; city: string; country: string };
  equipment: EquipmentEdit[];
}

const editStateFromCapture = (capture: CaptureSessionView): EditState => ({
  customer: {
    name: capture.draft.customer.name.state === 'Known' ? capture.draft.customer.name.value : '',
    city: capture.draft.customer.city.state === 'Known' ? capture.draft.customer.city.value : '',
    country:
      capture.draft.customer.country.state === 'Known' ? capture.draft.customer.country.value : '',
  },
  equipment: capture.draft.equipment.map((item) => ({
    id: item.id,
    modality: item.modality.state === 'Known' ? item.modality.value : '',
    quantity: item.quantity.state === 'Known' ? String(item.quantity.value) : '',
    manufacturer: item.manufacturer.state === 'Known' ? item.manufacturer.value : '',
    model: item.model.state === 'Known' ? item.model.value : '',
    age:
      item.approximateAge.state === 'Known' &&
      (item.approximateAge.value.type === 'exact' || item.approximateAge.value.type === 'estimate')
        ? String(
            item.approximateAge.value.type === 'exact'
              ? item.approximateAge.value.years
              : item.approximateAge.value.minYears,
          )
        : '',
    notes: item.notes.state === 'Known' ? item.notes.value : '',
  })),
});

const CapturePage = ({
  capture,
  runtime,
  busy,
  initializeRuntime,
  submit,
  review,
  save,
  correct,
  startNew,
}: {
  capture: CaptureSessionView | null;
  runtime: InferenceRuntimeInfo | null;
  busy: boolean;
  initializeRuntime: () => void;
  submit: (text: string) => void;
  review: () => void;
  save: () => void;
  correct: (correction: CaptureCorrection) => void;
  startNew: () => void;
}): React.JSX.Element => {
  const [input, setInput] = useState('');
  const [editing, setEditing] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);
  const send = (): void => {
    if (!input.trim()) return;
    submit(input.trim());
    setInput('');
  };
  const beginEdit = (): void => {
    if (!capture) return;
    setEditState(editStateFromCapture(capture));
    setEditing(true);
  };
  const updateEquipmentField = (id: string, field: EquipmentEditField, value: string): void => {
    setEditState((current) =>
      current
        ? {
            ...current,
            equipment: current.equipment.map((candidate) =>
              candidate.id === id ? { ...candidate, [field]: value } : candidate,
            ),
          }
        : current,
    );
  };
  const applyEdit = (): void => {
    if (!editState) return;
    correct({
      customer: {
        name: editState.customer.name || null,
        city: editState.customer.city || null,
        country: editState.customer.country || null,
      },
      equipment: editState.equipment.map((item) => ({
        id: item.id,
        modality: item.modality || null,
        quantity: item.quantity ? Number(item.quantity) : null,
        manufacturer: item.manufacturer || null,
        model: item.model || null,
        approximateAgeYears: item.age ? Number(item.age) : null,
        notes: item.notes || null,
      })),
    });
    setEditing(false);
  };

  return (
    <div className="capture-layout">
      <section className="conversation-panel">
        <div className="page-heading">
          <div>
            <span className="eyebrow">Capture observation</span>
            <h1>Turn field notes into traceable evidence.</h1>
          </div>
          {capture?.draft.state === 'SAVED' && (
            <button className="secondary-button" onClick={startNew}>
              New capture
            </button>
          )}
        </div>
        <RuntimeBadge runtime={runtime} initialize={initializeRuntime} busy={busy} />
        <div className="conversation">
          {!capture?.messages.length && (
            <div className="empty-conversation">
              <div className="empty-icon">✦</div>
              <strong>Start with what you observed.</strong>
              <p>
                Facility, modalities and quantities are enough to begin. Missing details come next.
              </p>
              <button
                className="example-prompt"
                onClick={() =>
                  setInput(
                    'I am at Hospital DemoCare Pacific in Panama. They have two MR systems and one CT.',
                  )
                }
              >
                Use demo observation
              </button>
            </div>
          )}
          {capture?.messages.map((message) => (
            <div key={message.id} className={`message-row ${message.role.toLowerCase()}`}>
              <div className="message-label">{message.role}</div>
              <div className="message-bubble">{message.content}</div>
            </div>
          ))}
        </div>
        <div className="composer">
          <button className="mic-button" disabled title="QVAC speech-to-text is a future slice">
            ◉
          </button>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Describe what you saw, or answer the follow-up…"
            rows={2}
            disabled={busy || capture?.draft.state === 'SAVED'}
          />
          <button className="primary-button" onClick={send} disabled={busy || !input.trim()}>
            {busy ? 'Working…' : 'Send'}
          </button>
        </div>
        <div className="privacy-note">
          Local-first · raw observations stay on this device · no cloud AI
        </div>
      </section>

      <aside className="structured-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Structured draft</span>
            <h2>Review before saving</h2>
          </div>
          {capture &&
            capture.draft.equipment.length > 0 &&
            !editing &&
            capture.draft.state !== 'SAVED' && (
              <button className="text-button" onClick={beginEdit}>
                Edit
              </button>
            )}
        </div>
        {!capture || capture.draft.equipment.length === 0 ? (
          <div className="structured-empty">Extracted fields will appear here.</div>
        ) : editing && editState ? (
          <div className="edit-form">
            <label>
              Facility
              <input
                value={editState.customer.name}
                onChange={(event) =>
                  setEditState({
                    ...editState,
                    customer: { ...editState.customer, name: event.target.value },
                  })
                }
              />
            </label>
            <div className="two-columns">
              <label>
                City
                <input
                  value={editState.customer.city}
                  onChange={(event) =>
                    setEditState({
                      ...editState,
                      customer: { ...editState.customer, city: event.target.value },
                    })
                  }
                />
              </label>
              <label>
                Country
                <input
                  value={editState.customer.country}
                  onChange={(event) =>
                    setEditState({
                      ...editState,
                      customer: { ...editState.customer, country: event.target.value },
                    })
                  }
                />
              </label>
            </div>
            {editState.equipment.map((item, index) => (
              <div className="edit-equipment" key={item.id}>
                <strong>Equipment group {index + 1}</strong>
                <div className="two-columns">
                  <label>
                    modality
                    <select
                      value={item.modality}
                      onChange={(event) =>
                        updateEquipmentField(item.id, 'modality', event.target.value)
                      }
                    >
                      <option value="">Unknown (acknowledged)</option>
                      {MODALITIES.map((modality) => (
                        <option key={modality} value={modality}>
                          {modality}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(['quantity', 'manufacturer', 'model', 'age', 'notes'] as const).map((field) => (
                    <label key={field}>
                      {field}
                      <input
                        value={item[field]}
                        onChange={(event) =>
                          updateEquipmentField(item.id, field, event.target.value)
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="action-row">
              <button className="secondary-button" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="primary-button" onClick={applyEdit}>
                Apply corrections
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="facility-summary">
              <span>Facility</span>
              <strong>{fieldText(capture.draft.customer.name)}</strong>
              <small>
                {fieldText(capture.draft.customer.city)},{' '}
                {fieldText(capture.draft.customer.country)}
              </small>
            </div>
            <div className="equipment-list">
              {capture.draft.equipment.map((item) => (
                <article className="equipment-card" key={item.id}>
                  <div className="equipment-title">
                    <span>{fieldText(item.modality)}</span>
                    <b>× {fieldText(item.quantity)}</b>
                  </div>
                  <dl>
                    <div>
                      <dt>Brand</dt>
                      <dd>{fieldText(item.manufacturer)}</dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>{fieldText(item.model)}</dd>
                    </div>
                    <div>
                      <dt>Age</dt>
                      <dd>{fieldText(item.approximateAge, ageText)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            <div className={`capture-state state-${capture.draft.state.toLowerCase()}`}>
              <span>Capture state</span>
              <strong>{capture.draft.state.replaceAll('_', ' ')}</strong>
            </div>
            {capture.pendingQuestion && (
              <p className="next-question">
                Next value: {capture.pendingQuestion.priority} · {capture.pendingQuestion.field}
              </p>
            )}
            <div className="stacked-actions">
              {capture.draft.state === 'NEEDS_FOLLOW_UP' && (
                <button className="secondary-button" onClick={review} disabled={busy}>
                  Review current information
                </button>
              )}
              {capture.draft.state === 'READY_FOR_REVIEW' && (
                <button className="save-button" onClick={save} disabled={busy}>
                  Save observation
                </button>
              )}
              {capture.draft.state === 'SAVED' && (
                <div className="saved-banner">✓ Evidence saved locally</div>
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
};

const CustomersPage = ({
  customers,
  selected,
  select,
}: {
  customers: readonly CustomerListItem[];
  selected: Customer360View | null;
  select: (id: string) => void;
}): React.JSX.Element => (
  <div className="customers-layout">
    <aside className="customer-list-panel">
      <span className="eyebrow">Customer 360</span>
      <h1>Evidence-backed accounts</h1>
      <div className="customer-list">
        {customers.map((customer) => (
          <button
            key={customer.id}
            className={selected?.customer.id === customer.id ? 'selected' : ''}
            onClick={() => select(customer.id)}
          >
            <strong>{customer.name}</strong>
            <span>
              {customer.city ?? 'Unknown city'} · {customer.country ?? 'Unknown country'}
            </span>
          </button>
        ))}
      </div>
    </aside>
    <section className="customer-detail">
      {!selected ? (
        <div className="structured-empty">Select a customer.</div>
      ) : (
        <>
          <div className="customer-hero">
            <div>
              <span className="eyebrow">Facility</span>
              <h2>{selected.customer.name}</h2>
              <p>
                {selected.customer.city ?? 'Unknown city'},{' '}
                {selected.customer.country ?? 'Unknown country'}
              </p>
            </div>
            <div className="evidence-pill">{selected.evidence.length} evidence group(s)</div>
          </div>
          <div className="section-title">
            <h3>Current installed-base projection</h3>
            <span>{selected.projectionStrategy}</span>
          </div>
          <div className="projection-grid">
            {selected.installedBase.map((item) => (
              <article className="projection-card" key={item.projectionKey}>
                <div className="projection-top">
                  <span>{item.modality}</span>
                  <b>× {item.quantity ?? '?'}</b>
                </div>
                <h4>
                  {item.manufacturer ?? 'Unknown brand'} <span>{item.model ?? ''}</span>
                </h4>
                <dl>
                  <div>
                    <dt>Approx. age</dt>
                    <dd>{ageText(item.approximateAge)}</dd>
                  </div>
                  <div>
                    <dt>Installation</dt>
                    <dd>{installationText(item.installationEstimate)}</dd>
                  </div>
                  <div>
                    <dt>Confidence</dt>
                    <dd>{item.confidence.level}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{item.status}</dd>
                  </div>
                  <div>
                    <dt>Last observed</dt>
                    <dd>{item.daysSinceLastObservation} day(s) ago</dd>
                  </div>
                  <div>
                    <dt>Freshness</dt>
                    <dd>{item.freshnessStatus}</dd>
                  </div>
                </dl>
                <small>Trace: {item.contributingObservationIds.length} observation(s)</small>
              </article>
            ))}
          </div>
          <div className="section-title">
            <h3>Supporting observations</h3>
            <span>Append-only evidence</span>
          </div>
          <div className="evidence-table">
            {selected.evidence.map((item) => (
              <div className="evidence-row" key={item.equipmentObservationId}>
                <div>
                  <strong>{new Date(item.observedAt).toLocaleDateString()}</strong>
                  <span>
                    {item.observerName} · {item.source}
                  </span>
                </div>
                <p>{item.rawInput ?? 'Non-text evidence'}</p>
                <code>{item.equipmentObservationId.slice(0, 12)}</code>
              </div>
            ))}
          </div>
          {selected.duplicateCandidates.length > 0 && (
            <div className="duplicate-box">
              <strong>Possible matches detected</strong>
              <span>
                {selected.duplicateCandidates.length} candidate(s), never merged automatically.
              </span>
            </div>
          )}
        </>
      )}
    </section>
  </div>
);

const DashboardPage = ({ dashboard }: { dashboard: DashboardView | null }): React.JSX.Element => {
  const max = Math.max(1, ...Object.values(dashboard?.equipmentByModality ?? {}));
  return (
    <section className="dashboard-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Local intelligence</span>
          <h1>Installed-base overview</h1>
        </div>
        <span className="local-chip">On-device data</span>
      </div>
      {!dashboard ? (
        <div className="structured-empty">Loading local metrics…</div>
      ) : (
        <>
          <div className="metric-grid">
            <article>
              <span>Total customers</span>
              <strong>{dashboard.totalCustomers}</strong>
              <small>synthetic facilities</small>
            </article>
            <article>
              <span>Equipment projected</span>
              <strong>{dashboard.totalEquipmentObserved}</strong>
              <small>latest evidence groups</small>
            </article>
            <article>
              <span>Incomplete observations</span>
              <strong>{dashboard.incompleteObservations}</strong>
              <small>need enrichment</small>
            </article>
            <article>
              <span>Aging equipment</span>
              <strong>—</strong>
              <small>{dashboard.agingPolicy}</small>
            </article>
          </div>
          <div className="dashboard-grid">
            <article className="chart-card">
              <div className="section-title">
                <h3>Equipment by modality</h3>
                <span>Projected quantity</span>
              </div>
              <div className="bars">
                {Object.entries(dashboard.equipmentByModality).map(([label, value]) => (
                  <div className="bar-row" key={label}>
                    <span>{label}</span>
                    <div className="bar-track">
                      <i style={{ width: `${(value / max) * 100}%` }} />
                    </div>
                    <b>{value}</b>
                  </div>
                ))}
              </div>
            </article>
            <article className="chart-card">
              <div className="section-title">
                <h3>Observations by country</h3>
                <span>Saved sessions</span>
              </div>
              <div className="country-list">
                {Object.entries(dashboard.observationsByCountry).map(([country, count]) => (
                  <div key={country}>
                    <span>{country}</span>
                    <b>{count}</b>
                  </div>
                ))}
              </div>
            </article>
          </div>
          <div className="policy-note">
            <strong>Freshness is intentionally unclassified.</strong>
            <span>
              No business thresholds were supplied, so Fresh/Aging/Stale remains a configurable
              future rule.
            </span>
          </div>
        </>
      )}
    </section>
  );
};

function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('capture');
  const [runtime, setRuntime] = useState<InferenceRuntimeInfo | null>(null);
  const [capture, setCapture] = useState<CaptureSessionView | null>(null);
  const [customers, setCustomers] = useState<readonly CustomerListItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer360View | null>(null);
  const [dashboard, setDashboard] = useState<DashboardView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    setError(null);
    try {
      return await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unexpected error.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const refreshQueries = useCallback(async (): Promise<void> => {
    const [customerResult, dashboardResult] = await Promise.all([
      window.installedBaseApi.listCustomers(),
      window.installedBaseApi.getDashboard(),
    ]);
    setCustomers(unwrap(customerResult));
    setDashboard(unwrap(dashboardResult));
  }, []);

  const startNew = useCallback(async (): Promise<void> => {
    const result = await window.installedBaseApi.startCapture('Text');
    setCapture(unwrap(result));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      window.installedBaseApi.getInferenceStatus(),
      window.installedBaseApi.listCustomers(),
      window.installedBaseApi.getDashboard(),
      window.installedBaseApi.startCapture('Text'),
    ])
      .then(async ([statusResult, customerResult, dashboardResult, captureResult]) => {
        const initialCustomers = unwrap(customerResult);
        const initialSelection = initialCustomers[0]
          ? unwrap(await window.installedBaseApi.getCustomer360(initialCustomers[0].id))
          : null;
        if (cancelled) return;
        setRuntime(unwrap(statusResult));
        setCustomers(initialCustomers);
        setDashboard(unwrap(dashboardResult));
        setCapture(unwrap(captureResult));
        setSelectedCustomer(initialSelection);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Unexpected error.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectCustomer = useCallback(
    (id: string): void => {
      void run(async () => {
        setSelectedCustomer(unwrap(await window.installedBaseApi.getCustomer360(id)));
      });
    },
    [run],
  );

  const navItems = useMemo(
    () => [
      { id: 'capture' as const, label: 'Capture', glyph: '✦' },
      { id: 'customers' as const, label: 'Customer 360', glyph: '◎' },
      { id: 'dashboard' as const, label: 'Dashboard', glyph: '▥' },
    ],
    [],
  );

  return (
    <div className="app-shell">
      <aside className="main-nav">
        <div className="brand">
          <div className="brand-mark">IB</div>
          <div>
            <strong>Installed Base</strong>
            <span>Intelligence</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'active' : ''}
              onClick={() => {
                setPage(item.id);
                if (item.id === 'customers' && !selectedCustomer && customers[0])
                  selectCustomer(customers[0].id);
              }}
            >
              <span>{item.glyph}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="nav-footer">
          <span>Privacy mode</span>
          <strong>Local only</strong>
        </div>
      </aside>
      <main className="workspace">
        {error && (
          <div className="error-banner">
            <span>{error}</span>
            <button onClick={() => setError(null)}>×</button>
          </div>
        )}
        {page === 'capture' && (
          <CapturePage
            capture={capture}
            runtime={runtime}
            busy={busy}
            initializeRuntime={() =>
              void run(async () =>
                setRuntime(unwrap(await window.installedBaseApi.initializeInference())),
              )
            }
            submit={(text) =>
              capture &&
              void run(async () => {
                setCapture(
                  unwrap(await window.installedBaseApi.submitCaptureMessage(capture.id, text)),
                );
                setRuntime(unwrap(await window.installedBaseApi.getInferenceStatus()));
              })
            }
            review={() =>
              capture &&
              void run(async () =>
                setCapture(unwrap(await window.installedBaseApi.proceedToReview(capture.id))),
              )
            }
            save={() =>
              capture &&
              void run(async () => {
                const saved = unwrap(await window.installedBaseApi.saveCapture(capture.id));
                setCapture(saved.capture);
                await refreshQueries();
                setPage('customers');
                selectCustomer(saved.customerId);
              })
            }
            correct={(correction) =>
              capture &&
              void run(async () =>
                setCapture(
                  unwrap(await window.installedBaseApi.correctCapture(capture.id, correction)),
                ),
              )
            }
            startNew={() => void run(startNew)}
          />
        )}
        {page === 'customers' && (
          <CustomersPage
            customers={customers}
            selected={selectedCustomer}
            select={selectCustomer}
          />
        )}
        {page === 'dashboard' && <DashboardPage dashboard={dashboard} />}
      </main>
    </div>
  );
}

export default App;
