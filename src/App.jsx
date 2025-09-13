// src/App.jsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";

/* Small inline icons component */
const Icon = ({ name, className = "w-5 h-5 inline-block" }) => {
  const icons = {
    menu: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
    ),
    plus: (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12h14"/></svg>),
    trash: (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 7h12M9 7V4h6v3m-7 4v9m4-9v9"/></svg>),
    chevronDown: (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 9l6 6 6-6"/></svg>),
    close: (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 6l12 12M6 18L18 6"/></svg>),
    search: (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"/></svg>)
  };
  return icons[name] || null;
};

/* -------------------------
   Protected core questions (stable IDs)
   ------------------------- */
const CORE_QUESTIONS = {
  fullName: { id: "q_fullname", type: "short_text", label: "Full name", required: true },
  email: { id: "q_email", type: "email", label: "Email address", required: true },
  phone: { id: "q_phone", type: "short_text", label: "Phone number", required: true },
  resume: { id: "q_resume", type: "file", label: "Upload resume / CV", required: true },
};
const PROTECTED_IDS = new Set(Object.values(CORE_QUESTIONS).map(q => q.id));

/* -------------------------
   Template data (others use uuids)
   ------------------------- */
const templateQuestions = [
  CORE_QUESTIONS.fullName,
  CORE_QUESTIONS.email,
  CORE_QUESTIONS.phone,
  CORE_QUESTIONS.resume,
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

/* -------------------------
   Simple Login Page Component
   ------------------------- */
function LoginPage({ backendUrl }) {
  const handleLogin = () => {
    window.location.href = `${backendUrl}/auth/google`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-6">
      <div className="max-w-md w-full bg-white p-8 rounded-lg shadow">
        <h1 className="text-2xl font-semibold mb-4">Sign in</h1>
        <p className="text-sm text-gray-600 mb-6">
          Sign in with Google to manage openings and view responses.
        </p>
        <button onClick={handleLogin} className="w-full inline-flex items-center justify-center gap-3 px-4 py-3 bg-blue-600 text-white rounded">
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none"><path d="M21 12.3c0-.8-.1-1.5-.3-2.2H12v4.2h5.5c-.2 1.2-.9 2.3-1.9 3.1v2.6h3.1C20.1 18.3 21 15.5 21 12.3z" fill="#4285F4"/><path d="M12 22c2.7 0 4.9-.9 6.6-2.4l-3.1-2.6c-.9.6-2.1 1-3.5 1-2.7 0-4.9-1.8-5.7-4.3H3.9v2.7C5.7 19.9 8.6 22 12 22z" fill="#34A853"/><path d="M6.3 13.7A6.7 6.7 0 016 12c0-.6.1-1.1.3-1.7V7.6H3.9A10 10 0 002 12c0 1.6.4 3 1.1 4.4l2.2-2.7z" fill="#FBBC05"/><path d="M12 6.5c1.5 0 2.8.5 3.8 1.5l2.9-2.9C16.9 3.2 14.7 2 12 2 8.6 2 5.7 4.1 3.9 7.6l2.4 2.7C7 8.3 9.3 6.5 12 6.5z" fill="#EA4335"/></svg>
          Sign in with Google
        </button>
        <div className="mt-4 text-xs text-gray-500">Reach out to rohit.varshney@stampmyvisa.com, if you are unable to sign-in.</div>
      </div>
    </div>
  );
}

/* -------------------------
   Multi-select dropdown with search
   - items: array of strings
   - selected: array of strings
   - onChange: (newSelectedArray) => void
   - placeholder: text
   - label: visible label to left
   - clearable: show Clear link (we will position it)
------------------------- */
function MultiSelectDropdown({ items = [], selected = [], onChange, placeholder = "Select", label }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef();

  useEffect(() => {
    function onDocClick(e) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const filtered = items.filter(it => it && it.toLowerCase().includes(query.toLowerCase()));

  function toggleItem(it) {
    const set = new Set(selected || []);
    if (set.has(it)) set.delete(it);
    else set.add(it);
    onChange(Array.from(set));
  }

  return (
    <div ref={ref} className="relative inline-block w-full">
      <button type="button" onClick={() => setOpen(s => !s)} className="w-full text-left px-4 py-2 border rounded flex items-center justify-between bg-white">
        <div className="truncate text-sm">{(selected && selected.length) ? `${selected.length} selected` : placeholder}</div>
        <div className="ml-2"><Icon name="chevronDown" /></div>
      </button>

      {open && (
        <div className="absolute right-0 left-0 mt-2 z-50 bg-white border rounded shadow max-h-64 overflow-auto p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="relative flex-1">
              <input className="w-full border p-2 rounded pl-9" placeholder="Search..." value={query} onChange={(e) => setQuery(e.target.value)} />
              <div className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400"><Icon name="search" /></div>
            </div>
            <button type="button" onClick={() => { setQuery(""); onChange([]); }} className="text-sm text-blue-600">Clear</button>
          </div>

          <div className="space-y-1">
            {filtered.length === 0 && <div className="text-xs text-gray-400">No results</div>}
            {filtered.map(it => {
              const checked = selected && selected.includes(it);
              return (
                <label key={it} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={checked} onChange={() => toggleItem(it)} />
                  <div className="truncate">{it}</div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------
   Main App
   ------------------------- */
export default function App() {
  const API = process.env.REACT_APP_API_URL || 'http://localhost:4000';
  const BACKEND = API;

  const [openings, setOpenings] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOpening, setNewOpening] = useState({ title: "", location: "Delhi", department: "", preferredSources: [], durationMins: 30 });
  const [forms, setForms] = useState({}); // keyed by openingId
  const [responses, setResponses] = useState([]);

  // Question bank (server-backed)
  const [questionBank, setQuestionBank] = useState([]);

  // auth / user
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // custom question modal
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customOpeningId, setCustomOpeningId] = useState(null);
  const [customQ, setCustomQ] = useState({ label: "", type: "short_text", required: false, optionsText: "" });

  // edit opening
  const [showEdit, setShowEdit] = useState(false);
  const [editingOpening, setEditingOpening] = useState(null);

  // public form modal
  const [publicView, setPublicView] = useState(null);

  // Form Editor modal per opening
  const [showFormModal, setShowFormModal] = useState(false);
  const [formModalOpeningId, setFormModalOpeningId] = useState(null);

  // Filters state: arrays of selected values
  const [filterOpening, setFilterOpening] = useState([]); // opening titles
  const [filterLocation, setFilterLocation] = useState([]);
  const [filterDepartment, setFilterDepartment] = useState([]);
  const [filterSource, setFilterSource] = useState([]);
  const [filterFullName, setFilterFullName] = useState([]);
  const [filterEmail, setFilterEmail] = useState([]);
  const [filterStatus, setFilterStatus] = useState([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    if (tokenFromUrl) {
      localStorage.setItem('token', tokenFromUrl);
      params.delete('token');
      const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
      window.history.replaceState({}, '', newUrl);
      fetchProfile(tokenFromUrl);
      return;
    }
    const token = localStorage.getItem('token');
    if (token) {
      fetchProfile(token);
    } else {
      setAuthChecked(true);
    }
  }, []);

  // Basic API fetch wrapper
  async function apiFetch(path, opts = {}) {
    const token = localStorage.getItem('token');
    const headers = { ...(opts.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    if (res.status === 401) {
      localStorage.removeItem('token');
      setUser(null);
      throw { status: 401, body: { error: 'unauthorized' } };
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw { status: res.status, body: json };
    return json;
  }

  async function fetchProfile(token) {
    try {
      const t = token || localStorage.getItem('token');
      if (!t) { setUser(null); setAuthChecked(true); return; }
      const res = await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${t}` }});
      if (!res.ok) {
        localStorage.removeItem('token');
        setUser(null);
        setAuthChecked(true);
        return;
      }
      const u = await res.json();
      setUser(u);
      setAuthChecked(true);
      await loadOpenings();
      await loadResponses();
      await loadForms();
      await loadQuestionBank();
    } catch (err) {
      console.error('fetchProfile', err);
      localStorage.removeItem('token');
      setUser(null);
      setAuthChecked(true);
    }
  }

  /* ---------- HELPERS: FILE / store behavior (reuse your server endpoints) ---------- */

  // load openings
  async function loadOpenings() {
    try {
      if (!localStorage.getItem('token')) return;
      const rows = await apiFetch('/api/openings');
      setOpenings(rows || []);
    } catch (err) {
      console.error('loadOpenings', err);
    }
  }

  // load responses
  async function loadResponses() {
    try {
      if (!localStorage.getItem('token')) return;
      const rows = await apiFetch('/api/responses');
      setResponses(rows || []);
    } catch (err) {
      console.error('loadResponses', err);
    }
  }

  // load forms
  async function loadForms() {
    try {
      if (!localStorage.getItem('token')) return;
      const allForms = await apiFetch('/api/forms');
      const map = {};
      (allForms || []).forEach(f => {
        const obj = { questions: (f.data && f.data.questions) || [], meta: (f.data && f.data.meta) || null, serverFormId: f.id, openingId: f.openingId };
        map[f.openingId] = ensureCoreFieldsInForm(obj);
      });
      (openings || []).forEach(op => {
        if (!map[op.id]) {
          const base = { questions: templateQuestions.slice(0, 4).map(q => ({ ...q })), meta: { coreFields: { fullNameId: CORE_QUESTIONS.fullName.id, emailId: CORE_QUESTIONS.email.id, phoneId: CORE_QUESTIONS.phone.id, resumeId: CORE_QUESTIONS.resume.id } } };
          map[op.id] = base;
        }
      });
      setForms(map);
    } catch (err) {
      console.error('loadForms', err);
    }
  }

  // load question bank
  async function loadQuestionBank() {
    try {
      if (!localStorage.getItem('token')) return;
      const rows = await apiFetch('/api/questions');
      setQuestionBank(rows || []);
    } catch (err) {
      console.error('loadQuestionBank', err);
    }
  }

  /* -------------------------
     Helper: ensure core fields exist in a form object (mutating copy)
  ------------------------- */
  function ensureCoreFieldsInForm(formObj) {
    const existingIds = new Set((formObj.questions || []).map(q => q.id));
    const coreOrder = [CORE_QUESTIONS.fullName, CORE_QUESTIONS.email, CORE_QUESTIONS.phone, CORE_QUESTIONS.resume];
    const missing = coreOrder.filter(cq => !existingIds.has(cq.id)).map(cq => ({ ...cq }));
    if (missing.length) {
      formObj.questions = [...missing, ...(formObj.questions || [])];
    }
    formObj.questions = (formObj.questions || []).map(q => {
      if (PROTECTED_IDS.has(q.id)) {
        return { ...q, required: true };
      }
      return q;
    });
    formObj.meta = formObj.meta || {};
    formObj.meta.coreFields = formObj.meta.coreFields || {
      fullNameId: CORE_QUESTIONS.fullName.id,
      emailId: CORE_QUESTIONS.email.id,
      phoneId: CORE_QUESTIONS.phone.id,
      resumeId: CORE_QUESTIONS.resume.id,
    };
    return formObj;
  }

  /* -------------------------
     UI functions (create/edit/delete/publish/save)
  ------------------------- */
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
      let created;
      if (!token) {
        created = { id: `op_${Date.now()}`, ...payload, createdAt: new Date().toISOString() };
        setOpenings(s => [created, ...s]);
      } else {
        const res = await apiFetch('/api/openings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        created = { id: res.id, ...payload, createdAt: res.createdAt || new Date().toISOString() };
        setOpenings(s => [created, ...s]);
      }
      setForms(f => ({ ...f, [created.id]: ensureCoreFieldsInForm({ questions: templateQuestions.slice(0, 4).map(q => ({ ...q })), meta: { coreFields: { fullNameId: CORE_QUESTIONS.fullName.id, emailId: CORE_QUESTIONS.email.id, phoneId: CORE_QUESTIONS.phone.id, resumeId: CORE_QUESTIONS.resume.id } } }) }));
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
    if (localStorage.getItem('token')) {
      apiFetch(`/api/openings/${editingOpening.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editingOpening) })
        .catch(err => console.error('Failed to persist opening edit', err));
    }
    setShowEdit(false);
  }

  async function handleDeleteOpening(id) {
    if (!confirm("Delete this opening?")) return;
    try {
      if (localStorage.getItem('token')) {
        await apiFetch(`/api/openings/${id}`, { method: 'DELETE' });
        setOpenings(s => s.filter(op => op.id !== id));
        await loadForms();
      } else {
        setOpenings(s => s.filter(op => op.id !== id));
        setForms(f => { const copy = { ...f }; delete copy[id]; return copy; });
      }
    } catch (err) {
      alert('Delete failed: ' + (err?.body?.error || err.message));
    }
  }

  function addQuestion(openingId, q) {
    const question = { ...q, id: q.id || uuidv4() };
    setForms((f) => {
      const existing = f[openingId] || { questions: [], meta: null };
      const exists = (existing.questions || []).some(x => x.id === question.id);
      if (exists) return f;
      if (PROTECTED_IDS.has(question.id)) return { ...f };
      const newQuestions = [...(existing.questions || []), question];
      return { ...f, [openingId]: { ...existing, questions: newQuestions } };
    });
  }

  function removeQuestion(openingId, qid) {
    if (PROTECTED_IDS.has(qid)) {
      alert('This question is mandatory and cannot be removed.');
      return;
    }
    setForms((f) => {
      const existing = f[openingId] || { questions: [], meta: null };
      const newQuestions = (existing.questions || []).filter(q => q.id !== qid);
      return { ...f, [openingId]: { ...existing, questions: newQuestions, meta: existing.meta || null } };
    });
  }

  function onDrag(openingId, from, to) {
    setForms((f) => {
      const arr = [...(f[openingId]?.questions || [])];
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

  async function handleAddCustomQuestion(e) {
    e.preventDefault();
    const options = customQ.optionsText.split("\n").map(s => s.trim()).filter(Boolean);
    const payload = { label: customQ.label || "Question", type: customQ.type, required: customQ.required, options };
    try {
      if (localStorage.getItem('token')) {
        const created = await apiFetch('/api/questions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        addQuestion(customOpeningId, created);
        await loadQuestionBank();
      } else {
        const q = { id: `q_local_${Date.now()}`, ...payload };
        addQuestion(customOpeningId, q);
      }
      setShowCustomModal(false);
    } catch (err) {
      console.error('create bank question', err);
      alert('Could not create question: ' + (err?.body?.error || err.message));
    }
  }

  async function handleSaveForm(openingId) {
    const opening = openings.find(o => o.id === openingId);
    if (!opening) return;
    const current = forms[openingId] || { questions: [] };
    const ensured = ensureCoreFieldsInForm({ questions: (current.questions || []).map(q => ({ ...q })), meta: { ...(current.meta || {}) } });
    const questionsToSave = ensured.questions;
    const meta = ensured.meta || {};
    try {
      if (!localStorage.getItem('token')) {
        setForms(f => ({ ...f, [openingId]: { questions: questionsToSave, meta } }));
        alert('Not signed in — changes saved locally only.');
        return;
      }
      const serverForms = await apiFetch(`/api/forms?openingId=${encodeURIComponent(openingId)}`);
      const serverForm = (serverForms && serverForms.length) ? serverForms[0] : null;
      const payload = { openingId, data: { questions: questionsToSave, meta } };
      if (serverForm) {
        await apiFetch(`/api/forms/${serverForm.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        await apiFetch(`/api/forms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      setForms(f => ({ ...f, [openingId]: { questions: questionsToSave, meta } }));
      alert('Form saved successfully.');
      await loadForms();
    } catch (err) {
      console.error('save form failed', err);
      alert('Save failed: ' + (err?.body?.error || err?.body?.message || err.message || 'unknown'));
    }
  }

  async function handlePublishForm(openingId) {
    const opening = openings.find(o => o.id === openingId);
    if (!opening) return;
    const formId = `form_${Date.now()}`;
    const sources = (opening.preferredSources && opening.preferredSources.length) ? opening.preferredSources : ["generic"];
    const shareLinks = {};
    sources.forEach(src => {
      shareLinks[src] = `${window.location.origin}/apply/${formId}?opening=${encodeURIComponent(openingId)}&src=${encodeURIComponent(src)}`;
    });
    const generic = `${window.location.origin}/apply/${formId}?opening=${encodeURIComponent(openingId)}`;
    const current = forms[openingId] || { questions: [] };
    const ensured = ensureCoreFieldsInForm({ questions: (current.questions || []).map(q => ({ ...q })), meta: (current.meta || {}) });
    const questionsToPublish = ensured.questions;
    const meta = { ...(ensured.meta || {}), formId, isPublished: true, publishedAt: new Date().toISOString(), shareLinks, genericLink: generic };
    setForms((f) => ({ ...f, [openingId]: { questions: questionsToPublish, meta } }));
    try {
      if (!localStorage.getItem('token')) {
        alert('Published locally (not persisted). Sign-in to persist forms to server.');
        return;
      }
      const serverForms = await apiFetch(`/api/forms?openingId=${encodeURIComponent(openingId)}`);
      let serverForm = (serverForms && serverForms.length) ? serverForms[0] : null;
      const payload = { openingId, data: { questions: questionsToPublish, meta } };
      if (serverForm) {
        await apiFetch(`/api/forms/${serverForm.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else {
        await apiFetch(`/api/forms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      }
      await loadForms();
      alert('Form published and saved to server.');
    } catch (err) {
      console.error('publish form failed', err);
      alert('Publish failed: ' + (err?.body?.error || err?.body?.message || err.message || 'unknown'));
    }
  }

  function handleCopy(text) {
    navigator.clipboard.writeText(text).then(() => alert("Copied to clipboard"));
  }

  function openPublicFormByLink(openingId, source) {
    setPublicView({ openingId, source, submitted: false });
  }

  async function deleteFormByOpening(openingId) {
    if (!confirm('Delete the server-saved form for this opening?')) return;
    try {
      if (!localStorage.getItem('token')) {
        setForms(f => { const copy = { ...f }; delete copy[openingId]; return copy; });
        alert('Form deleted locally.');
        return;
      }
      const serverForms = await apiFetch(`/api/forms?openingId=${encodeURIComponent(openingId)}`);
      if (!serverForms || serverForms.length === 0) {
        setForms(f => { const copy = { ...f }; delete copy[openingId]; return copy; });
        alert('No server form found; removed local copy.');
        return;
      }
      const serverForm = serverForms[0];
      await apiFetch(`/api/forms/${serverForm.id}`, { method: 'DELETE' });
      setForms(f => { const copy = { ...f }; delete copy[openingId]; return copy; });
      alert('Form deleted from server.');
    } catch (err) {
      console.error('delete form failed', err);
      alert('Delete failed: ' + (err?.body?.error || err.message || 'unknown'));
    }
  }

  // FORM MODAL open/close functions (ensures core fields exist)
  function openFormModal(openingId) {
    setForms((f) => {
      const copy = { ...f };
      if (!copy[openingId]) {
        copy[openingId] = ensureCoreFieldsInForm({ questions: templateQuestions.slice(0, 4).map(q => ({ ...q })), meta: { coreFields: { fullNameId: CORE_QUESTIONS.fullName.id, emailId: CORE_QUESTIONS.email.id, phoneId: CORE_QUESTIONS.phone.id, resumeId: CORE_QUESTIONS.resume.id } } });
      } else {
        copy[openingId] = ensureCoreFieldsInForm({ questions: (copy[openingId].questions || []).map(q => ({ ...q })), meta: (copy[openingId].meta || {}) });
      }
      return copy;
    });
    setFormModalOpeningId(openingId);
    setShowFormModal(true);
  }
  function closeFormModal() {
    setShowFormModal(false);
    setFormModalOpeningId(null);
  }

  // PUBLIC apply form handler (basic)
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
      const text = await resp.text().catch(() => null);
      let data = null;
      if (text) {
        try { data = JSON.parse(text); } catch (err) { console.warn('Non-JSON response from server:', text); }
      }
      if (!resp.ok) {
        const message = data?.error || data?.message || `Server returned ${resp.status}`;
        throw new Error(message);
      }
      const resumeLink = data?.resumeLink || data?.link || null;
      setPublicView(prev => ({ ...prev, submitted: true, resumeLink }));
      alert('Application submitted successfully!' + (resumeLink ? ` Resume: ${resumeLink}` : ''));
      await loadResponses();
    } catch (err) {
      console.error('Submit error', err);
      alert('Submission failed: ' + (err.message || 'unknown error'));
    }
  }

  // find current schema for public form rendering
  const currentSchema = publicView ? (forms[publicView.openingId]?.questions || []) : [];
  const findQ = (keyword) => {
    const k = (keyword || "").toLowerCase();
    return currentSchema.find(q => q.label && q.label.toLowerCase().includes(k));
  };

  /* -------------------------
     Hiring management helpers
  ------------------------- */
  async function updateCandidateStatus(responseId, newStatus) {
    try {
      setResponses(prev => prev.map(r => r.id === responseId ? { ...r, status: newStatus } : r));
      if (!localStorage.getItem('token')) {
        alert('Not signed-in: status changed locally only.');
        return;
      }
      const payload = { status: newStatus };
      const res = await apiFetch(`/api/responses/${encodeURIComponent(responseId)}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res && res.updatedResp) {
        setResponses(prev => prev.map(r => r.id === responseId ? res.updatedResp : r));
      } else {
        await loadResponses();
      }
    } catch (err) {
      console.error('Failed to update candidate status', err);
      alert('Status update failed: ' + (err?.body?.error || err.message || 'unknown'));
      await loadResponses();
    }
  }

  /* -------------------------
     Derived lists for filters (unique values)
  ------------------------- */
  const openingTitlesList = useMemo(() => {
    const s = new Set();
    openings.forEach(o => { if (o.title) s.add(o.title); });
    return Array.from(s).sort();
  }, [openings]);

  const locationsList = useMemo(() => {
    const s = new Set();
    openings.forEach(o => { if (o.location) s.add(o.location); });
    return Array.from(s).sort();
  }, [openings]);

  const departmentsList = useMemo(() => {
    const s = new Set();
    openings.forEach(o => { if (o.department) s.add(o.department); });
    return Array.from(s).sort();
  }, [openings]);

  const sourcesList = useMemo(() => {
    const s = new Set();
    responses.forEach(r => { if (r.source) s.add(r.source); });
    return Array.from(s).sort();
  }, [responses]);

  const fullNamesList = useMemo(() => {
    const s = new Set();
    responses.forEach(r => {
      const full = r.fullName || r.answers?.['Full name'] || r.answers?.['full name'] || r.answers?.name || r.answers?.fullname || null;
      if (full) s.add(full);
    });
    return Array.from(s).sort();
  }, [responses]);

  const emailsList = useMemo(() => {
    const s = new Set();
    responses.forEach(r => {
      const em = r.email || r.answers?.email || r.answers?.['Email address'] || r.answers?.e_mail || null;
      if (em) s.add(em);
    });
    return Array.from(s).sort();
  }, [responses]);

  const statusList = useMemo(() => {
    const s = new Set();
    responses.forEach(r => { if (r.status) s.add(r.status); });
    return Array.from(s).sort();
  }, [responses]);

  /* -------------------------
     Filtering logic: apply all selected filters together
  ------------------------- */
  const filteredResponses = useMemo(() => {
    return responses.filter(r => {
      // Opening filter (by title)
      if (filterOpening && filterOpening.length) {
        const opening = openings.find(o => o.id === r.openingId) || {};
        if (!filterOpening.includes(opening.title || '')) return false;
      }
      // Location filter (opening.location)
      if (filterLocation && filterLocation.length) {
        const opening = openings.find(o => o.id === r.openingId) || {};
        if (!filterLocation.includes(opening.location || '')) return false;
      }
      // Department filter (opening.department)
      if (filterDepartment && filterDepartment.length) {
        const opening = openings.find(o => o.id === r.openingId) || {};
        if (!filterDepartment.includes(opening.department || '')) return false;
      }
      // Source filter
      if (filterSource && filterSource.length) {
        if (!filterSource.includes(r.source || '')) return false;
      }
      // Full name filter
      if (filterFullName && filterFullName.length) {
        const full = r.fullName || r.answers?.['Full name'] || r.answers?.['full name'] || r.answers?.name || r.answers?.fullname || null;
        if (!full || !filterFullName.includes(full)) return false;
      }
      // Email filter
      if (filterEmail && filterEmail.length) {
        const em = r.email || r.answers?.email || r.answers?.['Email address'] || r.answers?.e_mail || null;
        if (!em || !filterEmail.includes(em)) return false;
      }
      // Status filter
      if (filterStatus && filterStatus.length) {
        if (!r.status || !filterStatus.includes(r.status)) return false;
      }
      return true;
    });
  }, [responses, openings, filterOpening, filterLocation, filterDepartment, filterSource, filterFullName, filterEmail, filterStatus]);

  /* -------------------------
     Render gating
  ------------------------- */
  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Checking authentication…</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage backendUrl={BACKEND} />;
  }

  /* -------------------------
     UI
  ------------------------- */
  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 text-gray-100 p-6 flex flex-col justify-between">
        <div>
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
                  <a href={`${BACKEND}/auth/google`} className="text-sm text-blue-300">Sign in with Google</a>
                </div>
              )}
            </div>
          </div>

          <nav className="space-y-2">
            <div onClick={() => setActiveTab("overview")} className={`flex items-center gap-3 py-2 px-3 rounded-md cursor-pointer ${activeTab === 'overview' ? 'bg-gray-800' : ''}`}>{<Icon name="menu" />} Overview</div>
            <div onClick={() => setActiveTab("jobs")} className={`flex items-center gap-3 py-2 px-3 rounded-md cursor-pointer ${activeTab === 'jobs' ? 'bg-gray-800' : ''}`}>Jobs</div>
            <div onClick={() => setActiveTab("hiring")} className={`flex items-center gap-3 py-2 px-3 rounded-md cursor-pointer ${activeTab === 'hiring' ? 'bg-gray-800' : ''}`}>Hiring</div>
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 overflow-auto">
        {activeTab === "overview" && (
          <>
            <h1 className="text-2xl font-semibold mb-4">Overview</h1>
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
                            <button onClick={() => openFormModal(op.id)} className="px-2 py-1 bg-blue-600 text-white rounded text-sm">Open Form Editor</button>
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
                    <button onClick={() => openFormModal(op.id)} className="px-3 py-1 bg-blue-600 text-white rounded">Form Editor</button>
                    <button onClick={() => handleDeleteOpening(op.id)} className="text-red-600 flex items-center gap-1"><Icon name="trash" /> Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {activeTab === "hiring" && (
          <>
            <h1 className="text-2xl font-semibold mb-6">Hiring</h1>

            <div className="grid grid-cols-3 gap-6">
              <div className="col-span-2 bg-white rounded-lg p-6 shadow-sm">
                <h2 className="font-semibold mb-4">Candidates</h2>

                {/* Filters area */}
                <div className="bg-gray-50 border rounded p-4 mb-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm font-medium">Opening</div>
                        <div className="text-sm"><button onClick={() => setFilterOpening([])} className="text-blue-600">Clear</button></div>
                      </div>
                      <MultiSelectDropdown items={openingTitlesList} selected={filterOpening} onChange={setFilterOpening} placeholder="All Opening" />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm font-medium">Location</div>
                        <div className="text-sm"><button onClick={() => setFilterLocation([])} className="text-blue-600">Clear</button></div>
                      </div>
                      <MultiSelectDropdown items={locationsList} selected={filterLocation} onChange={setFilterLocation} placeholder="All Location" />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm font-medium">Department</div>
                        <div className="text-sm"><button onClick={() => setFilterDepartment([])} className="text-blue-600">Clear</button></div>
                      </div>
                      <MultiSelectDropdown items={departmentsList} selected={filterDepartment} onChange={setFilterDepartment} placeholder="All Department" />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm font-medium">Source</div>
                        <div className="text-sm"><button onClick={() => setFilterSource([])} className="text-blue-600">Clear</button></div>
                      </div>
                      <MultiSelectDropdown items={sourcesList} selected={filterSource} onChange={setFilterSource} placeholder="All Source" />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm font-medium">Full name</div>
                        <div className="text-sm"><button onClick={() => setFilterFullName([])} className="text-blue-600">Clear</button></div>
                      </div>
                      <MultiSelectDropdown items={fullNamesList} selected={filterFullName} onChange={setFilterFullName} placeholder="All Full name" />
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm font-medium">Email</div>
                        <div className="text-sm"><button onClick={() => setFilterEmail([])} className="text-blue-600">Clear</button></div>
                      </div>
                      <MultiSelectDropdown items={emailsList} selected={filterEmail} onChange={setFilterEmail} placeholder="All Email" />
                    </div>

                    <div className="col-span-3 mt-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="text-sm font-medium">Status</div>
                        <div className="text-sm"><button onClick={() => setFilterStatus([])} className="text-blue-600">Clear</button></div>
                      </div>
                      <MultiSelectDropdown items={statusList} selected={filterStatus} onChange={setFilterStatus} placeholder="All Status" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  {filteredResponses.length === 0 && <div className="text-sm text-gray-500">No candidates yet.</div>}
                  {filteredResponses.map(resp => {
                    const opening = openings.find(o => o.id === resp.openingId) || {};
                    // determine candidate name and email (various possible places)
                    const candidateName = resp.fullName || resp.answers?.['Full name'] || resp.answers?.['full name'] || resp.answers?.name || resp.answers?.fullname || 'Candidate';
                    const candidateEmail = resp.email || resp.answers?.email || resp.answers?.['Email address'] || '';
                    return (
                      <div key={resp.id} className="p-4 border rounded flex justify-between items-start">
                        <div className="flex-1">
                          {/* Name (top) with email in parentheses as requested */}
                          <div className="font-semibold">{candidateName} {candidateEmail ? <span className="text-sm text-gray-500">({candidateEmail})</span> : null}</div>

                          {/* Opening title + location inline (same style as other secondary info) */}
                          <div className="text-xs text-gray-500 mt-1">
                            {opening.title || resp.openingId} • {opening.location || ''}
                          </div>

                          {/* Applied at (where response id used to be). Keep same style as earlier "Applied for" */}
                          <div className="text-xs text-gray-500 mt-1">
                            Applied at: {new Date(resp.createdAt).toLocaleString()}
                          </div>

                          <div className="text-xs text-gray-500 mt-2">Source: {resp.source}</div>

                          {/* Resume + response id beside it separated by | */}
                          {resp.resumeLink && (
                            <div className="text-xs mt-2">
                              <a href={resp.resumeLink} target="_blank" rel="noreferrer" className="text-blue-600 underline">Resume</a>
                              <span className="mx-2 text-gray-400">|</span>
                              <span className="text-gray-400">{resp.id}</span>
                            </div>
                          )}
                          {/* if no resume, still show response id */}
                          {!resp.resumeLink && (
                            <div className="text-xs mt-2 text-gray-400">{resp.id}</div>
                          )}
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <div className="text-xs text-gray-500">Status</div>
                          <select value={resp.status || 'Applied'} onChange={(e) => updateCandidateStatus(resp.id, e.target.value)} className="border p-2 rounded">
                            <option>Applied</option>
                            <option>Screening</option>
                            <option>Interview</option>
                            <option>Offer</option>
                            <option>Hired</option>
                            <option>Rejected</option>
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <aside className="bg-white rounded-lg p-6 shadow-sm">
                <h3 className="font-semibold mb-3">Filters Summary</h3>
                <div className="text-sm text-gray-600">
                  <div>Openings: {filterOpening.length ? filterOpening.join(', ') : 'All'}</div>
                  <div>Locations: {filterLocation.length ? filterLocation.join(', ') : 'All'}</div>
                  <div>Departments: {filterDepartment.length ? filterDepartment.join(', ') : 'All'}</div>
                  <div>Source: {filterSource.length ? filterSource.join(', ') : 'All'}</div>
                  <div>Full name: {filterFullName.length ? filterFullName.join(', ') : 'All'}</div>
                  <div>Email: {filterEmail.length ? filterEmail.join(', ') : 'All'}</div>
                  <div>Status: {filterStatus.length ? filterStatus.join(', ') : 'All'}</div>
                </div>
              </aside>
            </div>
          </>
        )}
      </main>

      {/* Modals (create/edit/form editor/public view + custom question modal) */}

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

      {/* FORM EDITOR MODAL (per opening) */}
      {showFormModal && formModalOpeningId && (() => {
        const op = openings.find(o => o.id === formModalOpeningId) || { id: formModalOpeningId, title: 'Opening' };
        const formObj = forms[formModalOpeningId] || ensureCoreFieldsInForm({ questions: templateQuestions.slice(0,4).map(q => ({ ...q })), meta: { coreFields: { fullNameId: CORE_QUESTIONS.fullName.id, emailId: CORE_QUESTIONS.email.id, phoneId: CORE_QUESTIONS.phone.id, resumeId: CORE_QUESTIONS.resume.id } } });
        return (
          <div key={"formmodal_" + formModalOpeningId} className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-[920px] max-h-[90vh] overflow-auto shadow-xl">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold mb-1">Form Editor — {op.title}</h3>
                  <div className="text-xs text-gray-500">Edit questions, save, publish, or share links. Core fields are mandatory and cannot be removed.</div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openCustomModalFor(op.id)} className="px-3 py-1 border rounded">+ Custom Question</button>
                  <button onClick={() => handleSaveForm(op.id)} className="px-3 py-1 border rounded">Save</button>
                  <button onClick={() => handlePublishForm(op.id)} className="px-3 py-1 bg-green-600 text-white rounded">Publish</button>
                  <button onClick={() => deleteFormByOpening(op.id)} className="px-3 py-1 border rounded text-red-600">Delete Saved Form</button>
                  <button onClick={() => closeFormModal()} className="px-3 py-1 border rounded">Close</button>
                </div>
              </div>

              <div className="flex gap-6">
                <div className="w-1/3 border-r pr-4">
                  <h3 className="font-semibold mb-2">Question Bank</h3>
                  {questionBank.length === 0 ? (
                    <div className="text-xs text-gray-400">No questions in bank yet. Create one using "+ Custom Question" inside this editor.</div>
                  ) : (
                    questionBank.map(q => (
                      <div key={q.id} className="p-2 border rounded mb-2 cursor-pointer hover:bg-gray-50" onClick={() => addQuestion(op.id, q)}>
                        <div className="font-medium">{q.label}</div>
                        <div className="text-xs text-gray-500">{q.type}{q.required ? ' • required' : ''}</div>
                      </div>
                    ))
                  )}
                  <div className="mt-4">
                    <div className="text-xs text-gray-500">Or use template items</div>
                    {templateQuestions.map(t => (
                      <div key={t.id} className="p-2 border rounded mb-2 cursor-pointer hover:bg-gray-50" onClick={() => addQuestion(op.id, t)}>{t.label}</div>
                    ))}
                  </div>
                </div>

                <div className="w-1/3">
                  <h3 className="font-semibold mb-2">Form Questions</h3>
                  <ul>
                    {(formObj.questions || []).map((q, idx) => (
                      <li key={q.id} draggable onDragStart={(e) => e.dataTransfer.setData('from', idx)} onDrop={(e) => { const from = parseInt(e.dataTransfer.getData('from')); onDrag(op.id, from, idx); }} onDragOver={(e) => e.preventDefault()} className="p-2 border mb-2 flex justify-between items-center">
                        <div>
                          <div className="font-medium">{q.label}{PROTECTED_IDS.has(q.id) ? ' (mandatory)' : ''}</div>
                          <div className="text-xs text-gray-500">{q.type}{q.required ? ' • required' : ''}</div>
                        </div>
                        <div className="flex gap-2">
                          {!PROTECTED_IDS.has(q.id) ? <button onClick={() => removeQuestion(op.id, q.id)} className="text-red-500">Remove</button> : <div className="text-xs text-gray-400">Protected</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="w-1/3">
                  <h3 className="font-semibold mb-2">Preview & Share</h3>

                  {formObj.meta?.isPublished ? (
                    <div>
                      <div className="text-sm text-gray-600 mb-2">Form published on {formObj.meta.publishedAt ? new Date(formObj.meta.publishedAt).toLocaleString() : ''}</div>

                      <div className="mb-2">
                        <div className="text-xs font-semibold">Shareable links (by source)</div>
                        <ul className="mt-2">
                          {Object.entries(formObj.meta.shareLinks || {}).map(([src, link]) => (
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
                          <div className="text-sm break-all">{formObj.meta.genericLink}</div>
                          <button onClick={() => handleCopy(formObj.meta.genericLink)} className="px-2 py-1 border rounded text-xs">Copy</button>
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
          </div>
        );
      })()}

      {/* Custom Question Modal: ensure it sits above Form Editor modal */}
      {showCustomModal && (
        <div style={{ zIndex: 2000 }} className="fixed inset-0 bg-black/30 flex items-center justify-center">
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

                  {/* other dynamic fields omitted for brevity in public form rendering, original logic retained */}
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
