import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

const API = import.meta.env.VITE_API_URL;
const API_KEY = import.meta.env.VITE_API_KEY;
const PAGE_SIZE = 20;

async function apiFetch(path) {
  const response = await fetch(`${API}${path}`, {
    headers: { "x-api-key": API_KEY }
  });
  if (!response.ok) throw new Error(`API failed: ${response.status}`);
  return response.json();
}

const formatDate = value =>
  value
    ? new Date(value).toLocaleString(undefined, {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
    })
    : "—";

function Badge({ value }) {
  if (!value) return <span className="muted">—</span>;
  const key = String(value).toLowerCase().replace(/\s+/g, "");
  const cls = key.includes("progress") ? "progress" : key;
  return <span className={`badge ${cls}`}>{value}</span>;
}

function attachmentSrc(a) {
  if (a.url) return a.url;
  if (!a.base64) return null;
  return a.base64.startsWith("data:")
    ? a.base64
    : `data:${a.mimeType || "image/jpeg"};base64,${a.base64}`;
}

function Attachments({ items, onOpen }) {
  const images = items
    .map(a => ({ ...a, src: attachmentSrc(a) }))
    .filter(a => a.src && (a.type === "image" || a.mimeType?.startsWith("image/")));
  const others = items.length - images.length;

  return (
    <div className="attachments">
      {images.map((a, i) => (
        <button
          type="button"
          className="thumb"
          key={a.fileName || i}
          title={a.fileName}
          onClick={() => onOpen(a)}
        >
          <img src={a.src} alt={a.fileName || "attachment"} loading="lazy" />
        </button>
      ))}
      {others > 0 && <span className="attach">📎 {others} file(s)</span>}
    </div>
  );
}

function Lightbox({ image, onClose }) {
  useEffect(() => {
    const onKey = e => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button className="lightbox-close" onClick={onClose} aria-label="Close">×</button>
      <img src={image.src} alt={image.fileName || "attachment"} onClick={e => e.stopPropagation()} />
      {image.fileName && <div className="lightbox-caption">{image.fileName}</div>}
    </div>
  );
}

function Messages({ items, onOpenImage }) {
  if (!items) {
    return (
      <div className="state">
        <div className="spinner" />Loading conversation…
      </div>
    );
  }
  if (items.length === 0) return <div className="state">No messages in this thread.</div>;

  return (
    <div className="messages">
      {items.map((message, i) => (
        <div className={`bubble ${i === 0 ? "first" : ""}`} key={message.message_id}>
          <div className="bubble-head">
            <strong>{message.sender || "Unknown"}</strong>
            <span>{formatDate(message.message_timestamp)}</span>
          </div>
          <div className="bubble-text">{message.text}</div>
          {message.attachments?.length > 0 && (
            <Attachments items={message.attachments} onOpen={onOpenImage} />
          )}
        </div>
      ))}
    </div>
  );
}

function App() {
  const [threads, setThreads] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [expanded, setExpanded] = useState(null);
  const [messages, setMessages] = useState({});
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [lightbox, setLightbox] = useState(null);

  const loadThreads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/api/threads?page=${page}&pageSize=${PAGE_SIZE}`);
      setThreads(data.threads);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  async function toggleThread(threadId) {
    if (expanded === threadId) return setExpanded(null);
    setExpanded(threadId);
    if (!messages[threadId]) {
      try {
        const data = await apiFetch(`/api/threads/${threadId}/messages`);
        setMessages(current => ({ ...current, [threadId]: data }));
      } catch {
        setMessages(current => ({ ...current, [threadId]: [] }));
      }
    }
  }

  const severities = useMemo(
    () => [...new Set(threads.map(t => t.severity).filter(Boolean))],
    [threads]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter(t => {
      if (severity !== "all" && t.severity !== severity) return false;
      if (!q) return true;
      return [t.summary, t.jira_key, t.customer, t.module, t.started_by, t.classification]
        .some(v => v && String(v).toLowerCase().includes(q));
    });
  }, [threads, query, severity]);

  const linked = threads.filter(t => t.jira_key).length;
  const high = threads.filter(t => /high|critical/i.test(t.severity || "")).length;

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Z" />
            </svg>
          </div>
          <div className="brand">
            <h1>Support Threads</h1>
            <p>SuperProcure · WhatsApp Control Room</p>
          </div>
          <div className="spacer" />
          <button className="btn" onClick={loadThreads} disabled={loading}>Refresh</button>
        </div>
      </header>

      <main className="page">
        <section className="stats">
          <div className="stat"><div className="label">Total threads</div><div className="value">{total}</div></div>
          <div className="stat"><div className="label">Linked to Jira (page)</div><div className="value">{linked}</div></div>
          <div className="stat"><div className="label">High severity (page)</div><div className="value">{high}</div></div>
        </section>

        <section className="card">
          <div className="toolbar">
            <h2>Conversations</h2>
            <div className="spacer" />
            <input
              className="search"
              type="search"
              placeholder="Search summary, Jira, customer…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <select className="select" value={severity} onChange={e => setSeverity(e.target.value)}>
              <option value="all">All severities</option>
              {severities.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {error ? (
            <div className="state error">
              Couldn’t load threads ({error}). <button className="btn" onClick={loadThreads}>Retry</button>
            </div>
          ) : loading && threads.length === 0 ? (
            <div className="state"><div className="spinner" />Loading threads…</div>
          ) : visible.length === 0 ? (
            <div className="state">No threads match your filters.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    <th>Summary</th>
                    <th>Customer / Module</th>
                    <th>Type</th>
                    <th>Severity</th>
                    <th>Jira</th>
                    <th>Status</th>
                    <th>Last message</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(thread => {
                    const open = expanded === thread.thread_id;
                    return (
                      <Fragment key={thread.thread_id}>
                        <tr
                          className={`row ${open ? "open" : ""}`}
                          onClick={() => toggleThread(thread.thread_id)}
                        >
                          <td><span className="chev">▸</span></td>
                          <td>
                            <div className="summary">{thread.summary || "Untitled thread"}</div>
                            {thread.started_by && <div className="sub">Started by {thread.started_by}</div>}
                          </td>
                          <td>
                            <div>{thread.customer || <span className="muted">—</span>}</div>
                            {thread.module && <div className="sub">{thread.module}</div>}
                          </td>
                          <td><Badge value={thread.classification} /></td>
                          <td><Badge value={thread.severity} /></td>
                          <td>
                            {thread.jira_key ? (
                              thread.jira_url ? (
                                <a className="jira" href={thread.jira_url} target="_blank" rel="noreferrer"
                                  onClick={e => e.stopPropagation()}>{thread.jira_key}</a>
                              ) : <span className="jira">{thread.jira_key}</span>
                            ) : <span className="muted">—</span>}
                          </td>
                          <td><Badge value={thread.jira_status} /></td>
                          <td className="nowrap">{formatDate(thread.last_message_at)}</td>
                        </tr>
                        {open && (
                          <tr className="detail">
                            <td colSpan="8"><Messages items={messages[thread.thread_id]} onOpenImage={setLightbox} /></td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="pagination">
            <span className="muted">Page {page} of {totalPages}</span>
            <div className="pager">
              <button className="btn" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </section>
      </main>

      {lightbox && <Lightbox image={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

export default App;
