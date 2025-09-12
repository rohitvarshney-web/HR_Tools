// src/App.jsx
import React, { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";

/* Small inline icons component */
const Icon = ({ name, className = "w-5 h-5 inline-block" }) => {
  const icons = {
    menu: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
    ),
    plus: (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12h14"/></svg>),
    trash: (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 7h12M9 7V4h6v3m-7 4v9m4-9v9"/></svg>),
  };
  return icons[name] || null;
};

const templateQuestions = [
  { id: uuidv4(), type: "short_text", label: "Full name", required: true },
  { id: uuidv4(), type: "email", label: "Email address", required: true },
  { id: uuidv4(), type: "short_text", label: "Phone number" },
  { id: uuidv4(), type: "file", label: "Upload resume / CV", required: true },
  { id: uuidv4(), type: "number", label: "Years of experience" },
  { id: uuidv4(), type: "url", label: "LinkedIn / Portfolio URL" },
  { id: uuidv4(), type: "dropdown", label: "How did you hear about us?", options: ["LinkedIn", "Internshala", "Referral"] },
  { id: uuidv4(), type: "long_text", label: "Why are you a good fit for this role?" },
];

const QUESTION_TYPES = [
  { value: "short_text", label: "Short text" },
  { value: "long_text", label: "Paragraph" },
  { value: "email", label: "Email" },
  { value: "number", label: "Number" },
  { value: "dropdown", label: "Dropdown (single select)" },
  { value: "checkboxes", label: "Checkboxes (multi select)" },
  { value: "radio", label: "Multiple choice" },
  { value: "file", label: "File upload" },
  { value: "url", label: "URL" },
  { value: "date", label: "Date" },
];

export default function App() {
// TEMP: force backend URL for debugging — remove later and use REACT_APP_API_URL env var
const API = process.env.REACT_APP_API_URL || 'https://hr-tools-backend.onrender.com';
console.log('Using API endpoint:', API);

  const [openings, setOpenings] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOpening, setNewOpening] = useState({ title: "", location: "Delhi", department: "", preferredSources: [], durationMins: 30 });
  const [forms, setForms] = useState({});
  const [responses, setResponses] = useState([]);

  // auth / user
  const [user, setUser] = useState(null);

  // custom question modal
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customOpeningId, setCustomOpeningId] = useState(null);
  const [customQ, setCustomQ] = useState({ label: "", type: "short_text", required: false, optionsText: "" });

  // edit opening
  const [showEdit, setShowEdit] = useState(false);
  const [editingOpening, setEditingOpening] = useState(null);

  // public form modal
  const [publicView, setPublicView] = useState(null); // { openingId, source, submitted, resumeLink }

  useEffect(() => {
    // Check if OAuth redirected back with token
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      localStorage.setItem('token', token);
      params.delete('token');
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);
      fetchProfile(token);
    } else {
      const existing = localStorage.getItem('token');
      if (existing) fetchProfile(existing);
    }
    // If not signed in, keep local openings (pre-existing)
  }, []);

  // fetch logged-in user
  async function fetchProfile(token) {
    try {
      const t = token || localStorage.getItem('token');
      if (!t) return setUser(null);
      const res = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${t}` }});
      if (!res.ok) { localStorage.removeItem('token'); setUser(null); return; }
      const u = await res.json();
      setUser(u);
      // load server-side openings & responses
      loadOpenings();
      loadResponses();
    } catch (err) {
      console.error('fetchProfile', err);
      setUser(null);
    }
  }

  async function apiFetch(path, opts = {}) {
    const token = localStorage.getItem('token');
    const headers = opts.headers || {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    const json = await res.json().catch(()=>null);
    if (!res.ok) throw { status: res.status, body: json };
    return json;
  }

  async function loadOpenings() {
    try {
      if (!localStorage.getItem('token')) return;
      const rows = await apiFetch('/api/openings');
      setOpenings(rows);
    } catch (err) {
      console.error('loadOpenings', err);
    }
  }

  async function loadResponses() {
    try {
      if (!localStorage.getItem('token')) return;
      const rows = await apiFetch('/api/responses');
      setResponses(rows);
    } catch (err) {
      console.error('loadResponses', err);
    }
  }

  function openCreate() {
    setNewOpening({ title: "", location: "Delhi", department: "", preferredSources: [], durationMins: 30 });
    setShowCreate(true);
  }

  async function handleCreateOpening(e) {
    e.preventDefault();
    const payload = {
      title: newOpening.title,
      location: newOpening.location,
      department: newOpening.department,
      preferredSources: newOpening.preferredSources || [],
      durationMins: newOpening.durationMins,
    };

    try {
      const token = localStorage.getItem('token');
      if (!token) {
        const created = { id: `op_${Date.now()}`, ...payload, createdAt: new Date().toISOString() };
        setOpenings(s => [created, ...s]);
        setForms(f => ({ ...f, [created.id]: { questions: templateQuestions.slice(0,5).map(q => ({...q, id: uuidv4()})), meta: null } }));
      } else {
        const res = await apiFetch('/api/openings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const created = { id: res.id, ...payload, createdAt: new Date().toISOString() };
        setOpenings(s => [created, ...s]);
        setForms(f => ({ ...f, [created.id]: { questions: templateQuestions.slice(0,5).map(q => ({...q, id: uuidv4()})), meta: null } }));
      }
      setShowCreate(false);
    } catch (err) {
      console.error('create opening', err);
      alert('Could not create opening: ' + (err?.body?.error || err.message || 'unknown'));
    }
  }

  function handleEditOpeningOpen(op) {
    setEditingOpening({ ...op });
    setShowEdit(true);
  }

  function handleSaveEdit(e) {
    e.preventDefault();
    setOpenings((s) => s.map(op => op.id === editingOpening.id ? editingOpening : op));
    setShowEdit(false);
  }

  async function handleDeleteOpening(id) {
    if (!confirm("Delete this opening?")) return;
    try {
      if (localStorage.getItem('token')) {
        await apiFetch(`/api/openings/${id}`, { method: 'DELETE' });
        setOpenings(s => s.filter(op => op.id !== id));
      } else {
        setOpenings(s => s.filter(op => op.id !== id));
        setForms(f => { const copy = { ...f }; delete copy[id]; return copy; });
      }
    } catch (err) {
      alert('Delete failed: ' + (err?.body?.error || err.message));
    }
  }

  function addQuestion(openingId, q) {
    const question = { ...q, id: uuidv4() };
    setForms((f) => ({ ...f, [openingId]: { ...(f[openingId] || { questions: [] }), questions: [...((f[openingId] && f[openingId].questions) || []), question], meta: f[openingId]?.meta || null } }));
  }

  function removeQuestion(openingId, qid) {
    setForms((f) => ({ ...f, [openingId]: { ...(f[openingId] || {}), questions: f[openingId].questions.filter(q => q.id !== qid), meta: f[openingId]?.meta || null } }));
  }

  function onDrag(openingId, from, to) {
    setForms((f) => {
      const arr = [...(f[openingId].questions || [])];
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return { ...f, [openingId]: { ...(f[openingId] || {}), questions: arr, meta: f[openingId]?.meta || null } };
    });
  }

  function openCustomModalFor(openingId) {
    setCustomOpeningId(openingId);
    setCustomQ({ label: "", type: "short_text", required: false, optionsText: "" });
    setShowCustomModal(true);
  }

  function handleAddCustomQuestion(e) {
    e.preventDefault();
    const options = customQ.optionsText.split("\n").map(s => s.trim()).filter(Boolean);
    const q = { label: customQ.label || "Question", type: customQ.type, required: customQ.required, options: options.length ? options : undefined };
    addQuestion(customOpeningId, q);
    setShowCustomModal(false);
  }

  function handlePublishForm(openingId) {
    const opening = openings.find(o => o.id === openingId);
    if (!opening) return;
    const formId = `form_${Date.now()}`;
    const sources = (opening.preferredSources && opening.preferredSources.length) ? opening.preferredSources : ["generic"];
    const shareLinks = {};
    sources.forEach(src => {
      shareLinks[src] = `${window.location.origin}/apply/${formId}?opening=${encodeURIComponent(openingId)}&src=${encodeURIComponent(src)}`;
    });
    const generic = `${window.location.origin}/apply/${formId}?opening=${encodeURIComponent(openingId)}`;
    setForms((f) => ({ ...f, [openingId]: { ...(f[openingId] || { questions: [] }), questions: f[openingId]?.questions || [], meta: { formId, isPublished: true, publishedAt: new Date().toISOString(), shareLinks, genericLink: generic } } }));
  }

  function handleCopy(text) {
    navigator.clipboard.writeText(text).then(() => alert("Copied to clipboard"));
  }

  function openPublicFormByLink(openingId, source) {
    setPublicView({ openingId, source, submitted: false });
  }

  // NEW: submit to backend (multipart/form-data)
async function handlePublicSubmit(e) {
  e.preventDefault();
  const formEl = e.target;
  const openingId = publicView.openingId;
  const source = publicView.source || 'unknown';
  const fd = new FormData();

  for (let i = 0; i < formEl.elements.length; i++) {
    const el = formEl.elements[i];
    if (!el.name) continue;
    if (el.type === 'file') {
      if (el.files && el.files[0]) fd.append('resume', el.files[0], el.files[0].name);
    } else if (el.type === 'checkbox') {
      if (el.checked) fd.append(el.name, el.value);
    } else {
      fd.append(el.name, el.value);
    }
  }

  try {
    const resp = await fetch(`${API}/api/apply?opening=${encodeURIComponent(openingId)}&src=${encodeURIComponent(source)}`, {
      method: 'POST',
      body: fd
    });

    // read raw text first (prevent json() from throwing on empty body)
    const text = await resp.text().catch(() => null);
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (err) {
        // the server returned something but it's not valid JSON
        console.warn('Non-JSON response from server:', text);
      }
    }

    if (!resp.ok) {
      const message = data?.error || data?.message || `Server returned ${resp.status}`;
      throw new Error(message);
    }

    // success: prefer resumeLink if provided, otherwise show raw body
    const resumeLink = data?.resumeLink || data?.link || null;
    setPublicView(prev => ({ ...prev, submitted: true, resumeLink }));
    alert('Application submitted successfully!' + (resumeLink ? ` Resume: ${resumeLink}` : ''));
  } catch (err) {
    console.error('Submit error', err);
    alert('Submission failed: ' + (err.message || 'unknown error'));
  }
}


  // helper for public form layout mapping by keywords
  const currentSchema = publicView ? (forms[publicView.openingId]?.questions || []) : [];
  const findQ = (keyword) => {
    const k = (keyword || "").toLowerCase();
    return currentSchema.find(q => q.label && q.label.toLowerCase().includes(k));
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-gray-100 p-6 flex flex-col justify-between">
        <div>
          {/* SIGN IN AREA */}
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center font-bold">SV</div>
            <div>
              <div className="text-sm font-semibold">StampMyVisa</div>
              {user ? (
                <>
                  <div className="text-xs opacity-80">{user.email} <span className="text-xs text-blue-300">({user.role})</span></div>
                  <div className="mt-1">
                    <button onClick={() => { localStorage.removeItem('token'); setUser(null); }} className="text-xs text-red-400">Sign out</button>
                  </div>
                </>
              ) : (
                <div className="text-xs opacity-80">
                  <a href={`${API}/auth/google`} className="text-sm text-blue-300">Sign in with Google</a>
                </div>
              )}
            </div>
          </div>

          <nav className="space-y-2">
            <div onClick={() => setActiveTab("overview")} className={`flex items-center gap-3 py-2 px-3 rounded-md cursor-pointer ${activeTab === 'overview' ? 'bg-gray-800' : ''}`}>{<Icon name="menu" />} Overview</div>
            <div onClick={() => setActiveTab("jobs")} className={`flex items-center gap-3 py-2 px-3 rounded-md cursor-pointer ${activeTab === 'jobs' ? 'bg-gray-800' : ''}`}>Jobs</div>
            <div onClick={() => setActiveTab("forms")} className={`flex items-center gap-3 py-2 px-3 rounded-md cursor-pointer ${activeTab === 'forms' ? 'bg-gray-800' : ''}`}>Form Editor</div>
          </nav>
        </div>
      </aside>

      {/* Main content (unchanged visual layout) */}
      <main className="flex-1 p-8 overflow-auto">
        {activeTab === "overview" && (
          <>
            <h1 className="text-2xl font-semibold mb-4">Overview</h1>
            {/* ... same overview UI as before ... */}
            <div className="grid grid-cols-3 gap-6 mb-6">
              <div className="col-span-2 bg-white rounded-lg p-6 shadow-sm">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="font-semibold">Openings</h2>
                  <div className="text-sm opacity-60">{openings.length} openings</div>
                </div>
                <div className="space-y-4">
                  {openings.map(op => (
                    <div key={op.id} className="p-4 rounded-lg border border-gray-100">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="font-semibold">{op.title}</div>
                          <div className="text-sm text-gray-500">{op.department} • {op.location}</div>
                          <div className="text-xs text-gray-400 mt-1">Created on {op.createdAt}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-500">Responses: {responses.filter(r => r.openingId === op.id).length}</div>
                          <div className="mt-2 flex gap-2">
                            <button onClick={() => handleEditOpeningOpen(op)} className="px-2 py-1 border rounded text-sm">Edit</button>
                            <button onClick={() => { const hasForm = forms[op.id]?.meta?.isPublished; if (hasForm) { alert('Form link available in Form Editor > share'); } else { alert('Form not published yet. Go to Form Editor and Publish.'); } }} className="px-2 py-1 bg-blue-600 text-white rounded text-sm">Get Link</button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <aside className="bg-white rounded-lg p-6 shadow-sm">
                <h3 className="font-semibold mb-3">Quick Stats</h3>
                <div className="text-sm text-gray-500">Candidates: {responses.length}</div>
                <div className="text-sm text-gray-500">Active Jobs: {openings.length}</div>
                <div className="text-sm text-gray-500">Talent Pools: 10</div>
                <div className="text-sm text-gray-500">Members: 3</div>
              </aside>
            </div>

            <section className="grid grid-cols-3 gap-6">
              <div className="col-span-2 bg-white rounded-lg p-6 shadow-sm">
                <h3 className="font-semibold mb-4">Recent Responses</h3>
                <table className="w-full text-sm">
                  <thead className="text-left text-gray-500 text-xs">
                    <tr><th>Response ID</th><th>Opening</th><th>Source</th><th>Date</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {responses.map(r => (
                      <tr key={r.id}><td>{r.id}</td><td>{openings.find(o => o.id === r.openingId)?.title || '—'}</td><td>{r.source}</td><td>{new Date(r.createdAt).toLocaleString()}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <aside className="bg-white rounded-lg p-6 shadow-sm">
                <h3 className="font-semibold mb-3">Onboarding Status</h3>
                <ul className="space-y-3 text-sm text-gray-600">
                  <li>Brooklyn Simmons — Reviewing Contract</li>
                  <li>Darlene Robertson — Reviewing Contract</li>
                  <li>Savannah Nguyen — Reviewing Contract</li>
                </ul>
              </aside>
            </section>
          </>
        )}

        {activeTab === "jobs" && (
          <>
            <header className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-semibold">Jobs</h1>
              <button onClick={openCreate} className="bg-blue-600 text-white px-4 py-2 rounded inline-flex items-center gap-2">{<Icon name="plus" />} New Opening</button>
            </header>

            <div className="space-y-4">
              {openings.map(op => (
                <div key={op.id} className="p-4 rounded-lg border flex justify-between items-center">
                  <div>
                    <div className="font-semibold">{op.title}</div>
                    <div className="text-sm text-gray-500">{op.department} • {op.location}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => handleEditOpeningOpen(op)} className="px-3 py-1 border rounded">Edit</button>
                    <button onClick={() => openCustomModalFor(op.id)} className="px-3 py-1 border rounded">+ Custom Question</button>
                    <button onClick={() => handleDeleteOpening(op.id)} className="text-red-600 flex items-center gap-1"><Icon name="trash" /> Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === "forms" && (
          <>
            <h1 className="text-2xl font-semibold mb-6">Form Editor</h1>

            {openings.map(op => (
              <div key={op.id} className="mb-10 bg-white p-6 rounded shadow">
                <div className="flex justify-between items-center mb-3">
                  <h2 className="font-semibold">{op.title} ({op.location})</h2>
                  <div className="flex gap-2">
                    <button onClick={() => openCustomModalFor(op.id)} className="px-3 py-1 border rounded">+ Custom Question</button>
                    <button onClick={() => handlePublishForm(op.id)} className="px-3 py-1 bg-green-600 text-white rounded">Publish</button>
                  </div>
                </div>

                <div className="flex gap-6">
                  <div className="w-1/3 border-r pr-4">
                    <h3 className="font-semibold mb-2">Template Bank</h3>
                    {templateQuestions.map(t => (
                      <div key={t.id} className="p-2 border rounded mb-2 cursor-pointer hover:bg-gray-50" onClick={() => addQuestion(op.id, t)}>{t.label}</div>
                    ))}
                  </div>

                  <div className="w-1/3">
                    <h3 className="font-semibold mb-2">Form Questions</h3>
                    <ul>
                      {(forms[op.id]?.questions || []).map((q, idx) => (
                        <li key={q.id} draggable onDragStart={(e) => e.dataTransfer.setData('from', idx)} onDrop={(e) => { const from = parseInt(e.dataTransfer.getData('from')); onDrag(op.id, from, idx); }} onDragOver={(e) => e.preventDefault()} className="p-2 border mb-2 flex justify-between items-center">
                          <div>
                            <div className="font-medium">{q.label}</div>
                            <div className="text-xs text-gray-500">{q.type}{q.required ? ' • required' : ''}</div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => removeQuestion(op.id, q.id)} className="text-red-500">Remove</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="w-1/3">
                    <h3 className="font-semibold mb-2">Preview & Share</h3>

                    {forms[op.id]?.meta?.isPublished ? (
                      <div>
                        <div className="text-sm text-gray-600 mb-2">Form published on {new Date(forms[op.id].meta.publishedAt).toLocaleString()}</div>

                        <div className="mb-2">
                          <div className="text-xs font-semibold">Shareable links (by source)</div>
                          <ul className="mt-2">
                            {Object.entries(forms[op.id].meta.shareLinks).map(([src, link]) => (
                              <li key={src} className="flex items-center justify-between mb-2">
                                <div className="text-sm">{src}</div>
                                <div className="flex items-center gap-2">
                                  <button onClick={() => handleCopy(link)} className="px-2 py-1 border rounded text-xs">Copy</button>
                                  <button onClick={() => openPublicFormByLink(op.id, src)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <div className="mt-3">
                          <div className="text-xs font-semibold">Generic link</div>
                          <div className="flex items-center gap-2 mt-2">
                            <div className="text-sm break-all">{forms[op.id].meta.genericLink}</div>
                            <button onClick={() => handleCopy(forms[op.id].meta.genericLink)} className="px-2 py-1 border rounded text-xs">Copy</button>
                            <button onClick={() => openPublicFormByLink(op.id, undefined)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">Form not yet published. Click Publish to generate shareable links per source.</div>
                    )}

                    <div className="mt-4">
                      <div className="text-xs font-semibold">Live response count</div>
                      <div className="text-lg font-medium mt-1">{responses.filter(r => r.openingId === op.id).length}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}
      </main>

      {/* Modals (create/edit/custom/public form) — unchanged UI, ensure resume input name is "resume" */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[720px] shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Create New Opening</h3>
            <form onSubmit={handleCreateOpening} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-600">Job Title</label>
                  <input value={newOpening.title} onChange={(e) => setNewOpening({ ...newOpening, title: e.target.value })} className="w-full mt-1 p-2 border rounded" required />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Location</label>
                  <select value={newOpening.location} onChange={(e) => setNewOpening({ ...newOpening, location: e.target.value })} className="w-full mt-1 p-2 border rounded">
                    <option>Delhi</option><option>Mumbai</option><option>Bangalore</option><option>Remote</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600">Department</label>
                  <input value={newOpening.department} onChange={(e) => setNewOpening({ ...newOpening, department: e.target.value })} className="w-full mt-1 p-2 border rounded" />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Interview duration (mins)</label>
                  <input type="number" value={newOpening.durationMins} onChange={(e) => setNewOpening({ ...newOpening, durationMins: Number(e.target.value) })} className="w-full mt-1 p-2 border rounded" />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-600">Preferred Sources (select multiple)</label>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {["LinkedIn", "Internshala", "Indeed", "Company Website", "Referral"].map(src => (
                    <button type="button" key={src} onClick={() => {
                      setNewOpening(s => {
                        const arr = new Set(s.preferredSources || []);
                        if (arr.has(src)) arr.delete(src); else arr.add(src);
                        return { ...s, preferredSources: Array.from(arr) };
                      });
                    }} className={`px-3 py-1 rounded ${newOpening.preferredSources?.includes(src) ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>{src}</button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2">Cancel</button>
                <button type="submit" disabled={creating} className="px-4 py-2 bg-blue-600 text-white rounded">{creating ? "Creating..." : "Create Opening"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showEdit && editingOpening && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[720px] shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Edit Opening</h3>
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-600">Job Title</label>
                  <input value={editingOpening.title} onChange={(e) => setEditingOpening({ ...editingOpening, title: e.target.value })} className="w-full mt-1 p-2 border rounded" required />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Location</label>
                  <select value={editingOpening.location} onChange={(e) => setEditingOpening({ ...editingOpening, location: e.target.value })} className="w-full mt-1 p-2 border rounded">
                    <option>Delhi</option><option>Mumbai</option><option>Bangalore</option><option>Remote</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600">Department</label>
                  <input value={editingOpening.department} onChange={(e) => setEditingOpening({ ...editingOpening, department: e.target.value })} className="w-full mt-1 p-2 border rounded" />
                </div>
                <div>
                  <label className="text-xs text-gray-600">Interview duration (mins)</label>
                  <input type="number" value={editingOpening.durationMins} onChange={(e) => setEditingOpening({ ...editingOpening, durationMins: Number(e.target.value) })} className="w-full mt-1 p-2 border rounded" />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-600">Preferred Sources (select multiple)</label>
                <div className="mt-2 flex gap-2 flex-wrap">
                  {["LinkedIn", "Internshala", "Indeed", "Company Website", "Referral"].map(src => (
                    <button type="button" key={src} onClick={() => {
                      setEditingOpening(s => {
                        const arr = new Set(s.preferredSources || []);
                        if (arr.has(src)) arr.delete(src); else arr.add(src);
                        return { ...s, preferredSources: Array.from(arr) };
                      });
                    }} className={`px-3 py-1 rounded ${editingOpening.preferredSources?.includes(src) ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>{src}</button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowEdit(false)} className="px-4 py-2">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCustomModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[560px] shadow-xl">
            <h3 className="text-lg font-semibold mb-3">Add Custom Question</h3>
            <form onSubmit={handleAddCustomQuestion} className="space-y-3">
              <div>
                <label className="text-xs text-gray-600">Question label</label>
                <input value={customQ.label} onChange={(e) => setCustomQ({ ...customQ, label: e.target.value })} className="w-full mt-1 p-2 border rounded" required />
              </div>
              <div>
                <label className="text-xs text-gray-600">Type</label>
                <select value={customQ.type} onChange={(e) => setCustomQ({ ...customQ, type: e.target.value })} className="w-full mt-1 p-2 border rounded">
                  {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              {(customQ.type === 'dropdown' || customQ.type === 'checkboxes' || customQ.type === 'radio') && (
                <div>
                  <label className="text-xs text-gray-600">Options (one per line)</label>
                  <textarea value={customQ.optionsText} onChange={(e) => setCustomQ({ ...customQ, optionsText: e.target.value })} className="w-full mt-1 p-2 border rounded" rows={4} />
                </div>
              )}

              <div className="flex items-center gap-2">
                <input id="req" type="checkbox" checked={customQ.required} onChange={(e) => setCustomQ({ ...customQ, required: e.target.checked })} />
                <label htmlFor="req" className="text-sm">Required</label>
              </div>

              <div className="flex justify-end gap-2 mt-4">
                <button type="button" onClick={() => setShowCustomModal(false)} className="px-4 py-2">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">Add Question</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {publicView && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[760px] max-h-[90vh] overflow-auto shadow-xl">
            {!publicView.submitted ? (
              <>
                <h3 className="text-2xl font-semibold mb-1">Personal data</h3>
                <div className="text-sm text-gray-500 mb-4">Fields with <span className="text-red-500">*</span> are mandatory.</div>

                <form onSubmit={handlePublicSubmit} className="space-y-6">
                  {(() => {
                    const q = findQ("full name") || findQ("name");
                    if (!q) return null;
                    return (
                      <div>
                        <label className="block text-sm font-medium mb-2">{q.label}{q.required ? " *" : ""}</label>
                        <input name={q.id} className="w-full border-2 border-gray-200 rounded-md p-3 text-base focus:outline-none focus:ring-4 focus:ring-blue-100 focus:border-blue-400" />
                      </div>
                    );
                  })()}

                  {(() => {
                    const q = findQ("profile") || findQ("picture") || findQ("photo") || findQ("profile picture");
                    if (!q) return null;
                    return (
                      <div>
                        <label className="block text-sm font-medium mb-2">Profile picture</label>
                        <label className="block border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors">
                          <div className="flex items-center gap-4 justify-center">
                            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-xl">📷</div>
                            <div className="text-left">
                              <div className="text-sm">Drop your file here or <span className="text-blue-600 underline">Select a file</span></div>
                              <div className="text-xs text-gray-400 mt-1">Only JPG, PNG are allowed — up to 2MB</div>
                            </div>
                          </div>
                          {/* ENSURE resume input uses name="resume" */}
                          <input type="file" name="resume" className="hidden" />
                        </label>
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-2 gap-4">
                    {(() => {
                      const q1 = findQ("birth") || findQ("date");
                      const q2 = findQ("country");
                      return (
                        <>
                          <div>
                            {q1 && (
                              <>
                                <label className="block text-sm font-medium mb-2">{q1.label}{q1.required ? " *" : ""}</label>
                                <input type="date" name={q1.id} className="w-full border p-2 rounded-md" />
                              </>
                            )}
                          </div>
                          <div>
                            {q2 && (
                              <>
                                <label className="block text-sm font-medium mb-2">{q2.label}{q2.required ? " *" : ""}</label>
                                <select name={q2.id} className="w-full border p-2 rounded-md">
                                  <option>India</option><option>United States</option><option>United Kingdom</option><option>Australia</option>
                                </select>
                              </>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {(() => {
                    const q = findQ("mother");
                    if (!q) return null;
                    return (
                      <div>
                        <label className="block text-sm font-medium mb-2">{q.label}{q.required ? " *" : ""}</label>
                        <input name={q.id} className="w-full border p-2 rounded-md" />
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-2 gap-4">
                    {(() => {
                      const items = [
                        { key: "gender", labelHint: "gender" },
                        { key: "color", labelHint: "color" },
                        { key: "marital", labelHint: "marital" },
                        { key: "special", labelHint: "special needs" },
                        { key: "state", labelHint: "state" },
                        { key: "city", labelHint: "city" }
                      ];
                      return items.map(it => {
                        const q = findQ(it.labelHint);
                        return q ? (
                          <div key={it.key}>
                            <label className="block text-sm font-medium mb-2">{q.label}{q.required ? " *" : ""}</label>
                            {q.type === "dropdown" || q.type === "radio" ? (
                              <select name={q.id} className="w-full border p-2 rounded-md">{(q.options || []).map(opt => <option key={opt}>{opt}</option>)}</select>
                            ) : (
                              <input name={q.id} className="w-full border p-2 rounded-md" />
                            )}
                          </div>
                        ) : null;
                      });
                    })()}
                  </div>

                  {currentSchema.filter(q => {
                    const lower = (q.label || "").toLowerCase();
                    return !["name","full name","profile","picture","photo","birth","date","country","mother","gender","color","race","marital","special needs","state","city"].some(k => lower.includes(k));
                  }).map(q => (
                    <div key={q.id}>
                      <label className="block text-sm font-medium mb-2">{q.label}{q.required ? " *" : ""}</label>
                      {q.type === "long_text" ? (
                        <textarea name={q.id} className="w-full border p-2 rounded-md" />
                      ) : q.type === "dropdown" || q.type === "radio" ? (
                        <select name={q.id} className="w-full border p-2 rounded-md">{(q.options || []).map(opt => <option key={opt}>{opt}</option>)}</select>
                      ) : q.type === "checkboxes" ? (
                        (q.options || []).map(opt => <div key={opt}><label className="inline-flex items-center"><input name={q.id} value={opt} type="checkbox" className="mr-2" /> {opt}</label></div>)
                      ) : q.type === "file" ? (
                        <input name={q.id} type="file" />
                      ) : (
                        <input name={q.id} className="w-full border p-2 rounded-md" />
                      )}
                    </div>
                  ))}

                  <div className="flex items-center justify-between mt-4">
                    <button type="button" onClick={() => setPublicView(null)} className="px-4 py-2 border rounded-md text-sm">← BACK</button>
                    <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm">NEXT →</button>
                  </div>
                </form>
              </>
            ) : (
              <div className="text-center py-8">
                <h3 className="text-lg font-semibold">Thanks — application submitted</h3>
                <div className="mt-3">You can close this window.</div>
                <div className="mt-4"><button onClick={() => setPublicView(null)} className="px-4 py-2 bg-blue-600 text-white rounded">Close</button></div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
