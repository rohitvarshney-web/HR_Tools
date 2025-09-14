// src/App.jsx
import React, { useState, useEffect, useMemo } from "react";
import { v4 as uuidv4 } from "uuid";

/* Small inline icons component */
const Icon = ({ name, className = "w-5 h-5 inline-block" }) => {
  const icons = {
    menu: (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
    ),
    plus: (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12h14"/></svg>),
    trash: (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 7h12M9 7V4h6v3m-7 4v9m4-9v9"/></svg>),
    chevron: (<svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 9l6 6 6-6"/></svg>)
  };
  return icons[name] || null;
};

const LockIcon = ({ className = "w-4 h-4 inline-block text-gray-500" }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V8a5 5 0 0110 0v3"/></svg>
);

/* -------------------------
   Protected core questions (stable IDs)
   ------------------------- */
const CORE_QUESTIONS = {
  fullName: { id: "q_fullname", type: "short_text", label: "Full name", required: true },
  email: { id: "q_email", type: "email", label: "Email address", required: true },
  phone: { id: "q_phone", type: "short_text", label: "Phone number", required: true },
  resume: { id: "q_resume", type: "file", label: "Upload resume / CV", required: true },
  college: { id: "q_college", type: "short_text", label: "College / Institute", required: true },
};
const PROTECTED_IDS = new Set(Object.values(CORE_QUESTIONS).map(q => q.id));

/* -------------------------
   Template data (non-core only)
   ------------------------- */
const templateQuestions = [
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
   MultiSelectDropdown
  ------------------------- */
function MultiSelectDropdown({ label, options = [], selected = [], onChange = () => {}, placeholder = "Select", searchEnabled = true }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onDocClick(e) {
      if (!e.target.closest || !e.target.closest('.msdd-root')) {
        setOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const selectedSet = new Set(selected || []);

  const filtered = useMemo(() => {
    const q = (query || "").toLowerCase().trim();
    if (!q) return options;
    return options.filter(o => (o.label || "").toLowerCase().includes(q) || (o.value || "").toString().toLowerCase().includes(q));
  }, [options, query]);

  function toggleValue(v) {
    const s = new Set(selectedSet);
    if (s.has(v)) s.delete(v);
    else s.add(v);
    onChange(Array.from(s));
  }

  function clearAll() {
    onChange([]);
  }

  return (
    <div className="relative msdd-root" style={{ minWidth: 220 }}>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-sm">
          <button type="button" onClick={clearAll} className="text-blue-600 hover:underline">Clear</button>
        </div>
      </div>

      <button type="button" onClick={() => setOpen(o => !o)} className="mt-2 w-full text-left px-4 py-3 border rounded bg-white flex items-center justify-between">
        <div className="text-sm text-gray-700">{selected.length ? `${selected.length} selected` : placeholder}</div>
        <div>{<Icon name="chevron" />}</div>
      </button>

      {open && (
        <div className="absolute right-0 left-0 z-50 mt-2 bg-white border rounded shadow-lg p-3 max-h-64 overflow-auto">
          {searchEnabled && (
            <div className="mb-2">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." className="w-full border p-2 rounded text-sm" />
            </div>
          )}
          <div className="space-y-2">
            {filtered.length === 0 ? (<div className="text-xs text-gray-400">No results</div>) : filtered.map(opt => (
              <label key={opt.value} className="flex items-center gap-2 cursor-pointer text-sm">
                <input checked={selectedSet.has(opt.value)} onChange={() => toggleValue(opt.value)} type="checkbox" className="h-4 w-4" />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------
   Login Page
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
   Main App
  ------------------------- */
export default function App() {
  const API = process.env.REACT_APP_API_URL || 'https://hr-tools-backend.onrender.com';
  const BACKEND = API;

  const [openings, setOpenings] = useState([]);
  const [activeTab, setActiveTab] = useState("overview");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOpening, setNewOpening] = useState({ title: "", location: "Delhi", department: "", preferredSources: [], durationMins: 30 });
  const [forms, setForms] = useState({});
  const [responses, setResponses] = useState([]);
  const [questionBank, setQuestionBank] = useState([]);

  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  // Custom question modal + form editor states
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customOpeningId, setCustomOpeningId] = useState(null);
  const [customQ, setCustomQ] = useState({
    label: "",
    type: "short_text",
    required: false,
    optionsText: "",
    validation: {}
  });

  const [showEdit, setShowEdit] = useState(false);
  const [editingOpening, setEditingOpening] = useState(null);

  const [publicView, setPublicView] = useState(null);

  const [showFormModal, setShowFormModal] = useState(false);
  const [formModalOpeningId, setFormModalOpeningId] = useState(null);

  // Filters state (all arrays of selected values)
  const [filterOpenings, setFilterOpenings] = useState([]);
  const [filterLocations, setFilterLocations] = useState([]);
  const [filterDepartments, setFilterDepartments] = useState([]);
  const [filterSources, setFilterSources] = useState([]);
  const [filterStatus, setFilterStatus] = useState([]);

  // Search query for candidate list (search across name, email, college, opening title, source, response id)
  const [searchQuery, setSearchQuery] = useState("");

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

  /* -------------------------
     Helper: ensure core fields exist in a form object
  ------------------------- */
  function ensureCoreFieldsInForm(formObj) {
    const existingIds = new Set((formObj.questions || []).map(q => q.id));
    // always inject core fields at start in this defined order
    const coreOrder = [CORE_QUESTIONS.fullName, CORE_QUESTIONS.email, CORE_QUESTIONS.phone, CORE_QUESTIONS.resume, CORE_QUESTIONS.college];
    const missing = coreOrder.filter(cq => !existingIds.has(cq.id)).map(cq => ({ ...cq }));
    if (missing.length) {
      formObj.questions = [...missing, ...(formObj.questions || [])];
    }
    formObj.questions = (formObj.questions || []).map(q => {
      if (PROTECTED_IDS.has(q.id)) {
        return { ...q, required: true, validation: q.validation || {}, pageBreak: q.pageBreak || false };
      }
      return { ...q, validation: q.validation || {}, pageBreak: q.pageBreak || false };
    });
    formObj.meta = formObj.meta || {};
    formObj.meta.coreFields = formObj.meta.coreFields || {
      fullNameId: CORE_QUESTIONS.fullName.id,
      emailId: CORE_QUESTIONS.email.id,
      phoneId: CORE_QUESTIONS.phone.id,
      resumeId: CORE_QUESTIONS.resume.id,
      collegeId: CORE_QUESTIONS.college.id,
    };
    return formObj;
  }

  /* -------------------------
     Loaders for openings / responses / forms / question bank
  ------------------------- */
  async function loadOpenings() {
    try {
      if (!localStorage.getItem('token')) return;
      const rows = await apiFetch('/api/openings');
      setOpenings(rows);
    } catch (err) { console.error('loadOpenings', err); }
  }

  async function loadResponses() {
    try {
      if (!localStorage.getItem('token')) return;
      const rows = await apiFetch('/api/responses');
      setResponses(rows || []);
    } catch (err) { console.error('loadResponses', err); }
  }

  async function loadForms() {
    try {
      if (!localStorage.getItem('token')) return;
      const allForms = await apiFetch('/api/forms');
      const map = {};
      (allForms || []).forEach(f => {
        const obj = { questions: (f.data && f.data.questions) || [], meta: (f.data && f.data.meta) || null, serverFormId: f.id, created_at: f.created_at, updated_at: f.updated_at, openingId: f.openingId };
        map[f.openingId] = ensureCoreFieldsInForm(obj);
      });
      (openings || []).forEach(op => {
        if (!map[op.id]) {
          const base = { questions: templateQuestions.map(q => ({ ...q })), meta: { coreFields: { fullNameId: CORE_QUESTIONS.fullName.id, emailId: CORE_QUESTIONS.email.id, phoneId: CORE_QUESTIONS.phone.id, resumeId: CORE_QUESTIONS.resume.id, collegeId: CORE_QUESTIONS.college.id } } };
          map[op.id] = ensureCoreFieldsInForm(base);
        }
      });
      setForms(map);
    } catch (err) { console.error('loadForms', err); }
  }

  async function loadQuestionBank() {
    try {
      if (!localStorage.getItem('token')) return;
      const rows = await apiFetch('/api/questions');
      setQuestionBank(rows || []);
    } catch (err) { console.error('loadQuestionBank', err); }
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
      let created;
      if (!localStorage.getItem('token')) {
        created = { id: `op_${Date.now()}`, ...payload, createdAt: new Date().toISOString() };
        setOpenings(s => [created, ...s]);
      } else {
        const res = await apiFetch('/api/openings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        created = { id: res.id, ...payload, createdAt: res.createdAt || new Date().toISOString() };
        setOpenings(s => [created, ...s]);
      }
      // initialize form with core + non-core template items
      setForms(f => ({ ...f, [created.id]: ensureCoreFieldsInForm({ questions: templateQuestions.map(q => ({ ...q })), meta: { coreFields: { fullNameId: CORE_QUESTIONS.fullName.id, emailId: CORE_QUESTIONS.email.id, phoneId: CORE_QUESTIONS.phone.id, resumeId: CORE_QUESTIONS.resume.id, collegeId: CORE_QUESTIONS.college.id } } }) }));
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
    const question = { ...q, id: q.id || uuidv4(), validation: q.validation || {}, pageBreak: q.pageBreak || false };
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

  function togglePageBreak(openingId, qid) {
    setForms(f => {
      const copy = { ...f };
      const obj = copy[openingId] || { questions: [] };
      obj.questions = (obj.questions || []).map(q => q.id === qid ? { ...q, pageBreak: !q.pageBreak } : q);
      copy[openingId] = obj;
      return copy;
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
    setCustomQ({ label: "", type: "short_text", required: false, optionsText: "", validation: {} });
    setShowCustomModal(true);
  }

  async function handleAddCustomQuestion(e) {
    e.preventDefault();
    const options = customQ.optionsText.split("\n").map(s => s.trim()).filter(Boolean);
    const payload = {
      label: customQ.label || "Question",
      type: customQ.type,
      required: !!customQ.required,
      options,
      validation: customQ.validation || {}
    };
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
    // initialize page index to 0
    setPublicView({ openingId, source, submitted: false, page: 0 });
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

  // Open/close Form Editor modal
  function openFormModal(openingId) {
    setForms((f) => {
      const copy = { ...f };
      if (!copy[openingId]) {
        copy[openingId] = ensureCoreFieldsInForm({ questions: templateQuestions.map(q => ({ ...q })), meta: { coreFields: { fullNameId: CORE_QUESTIONS.fullName.id, emailId: CORE_QUESTIONS.email.id, phoneId: CORE_QUESTIONS.phone.id, resumeId: CORE_QUESTIONS.resume.id, collegeId: CORE_QUESTIONS.college.id } } });
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

  /* -------------------------
     Public form submission with validation and top-level core fields
  ------------------------- */
  async function handlePublicSubmit(e) {
    e.preventDefault();
    const formEl = e.target;
    const openingId = publicView.openingId;
    const source = publicView.source || 'unknown';

    // client-side validation pass using the form questions' validation metadata
    const formObj = forms[openingId];
    if (!formObj) {
      alert('Form schema not found.');
      return;
    }
    const qMap = {};
    (formObj.questions || []).forEach(q => { qMap[q.id] = q; });

    // collect values and validate
    const values = {};
    for (let i = 0; i < formEl.elements.length; i++) {
      const el = formEl.elements[i];
      if (!el.name) continue;
      if (el.type === 'file') {
        values[el.name] = el.files && el.files[0] ? el.files[0] : null;
      } else if (el.type === 'checkbox') {
        if (!values[el.name]) values[el.name] = [];
        if (el.checked) values[el.name].push(el.value);
      } else {
        values[el.name] = el.value;
      }
    }

    // validate each field mapped in schema
    for (const q of (formObj.questions || [])) {
      const name = q.id;
      const val = values[name];
      // required
      if (q.required) {
        if (q.type === 'file') {
          if (!val) { alert(`${q.label} is required.`); return; }
        } else if (q.type === 'checkboxes') {
          if (!val || (Array.isArray(val) && val.length === 0)) { alert(`${q.label} is required.`); return; }
        } else if (!val || String(val).trim() === "") {
          alert(`${q.label} is required.`); return;
        }
      }
      const v = q.validation || {};
      if (q.type === 'short_text' || q.type === 'long_text' || q.type === 'email' || q.type === 'url') {
        const s = (val || "").toString();
        if (v.minLength && s.length < Number(v.minLength)) { alert(`${q.label} must be at least ${v.minLength} characters.`); return; }
        if (v.maxLength && s.length > Number(v.maxLength)) { alert(`${q.label} must be at most ${v.maxLength} characters.`); return; }
        if (v.pattern) {
          try {
            const re = new RegExp(v.pattern);
            if (!re.test(s)) { alert(`${q.label} has invalid format.`); return; }
          } catch (err) {
            // ignore bad regex stored in validation
          }
        }
        if (q.id === CORE_QUESTIONS.email.id || q.type === 'email') {
          const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (s && !emailRe.test(s)) { alert(`${q.label} must be a valid email address.`); return; }
        }
      }
      if (q.id === CORE_QUESTIONS.phone.id || q.label.toLowerCase().includes('phone')) {
        const s = (val || "").toString().replace(/\D/g, '');
        if (q.required && s.length === 0) { alert(`${q.label} is required.`); return; }
        if (s && (s.length < 7 || s.length > 15)) { alert(`${q.label} must be between 7 and 15 digits.`); return; }
      }
      if (q.type === 'number') {
        if (val !== undefined && val !== null && String(val).trim() !== "") {
          const num = Number(val);
          if (Number.isNaN(num)) { alert(`${q.label} must be a number.`); return; }
          if (v.min !== undefined && v.min !== "" && num < Number(v.min)) { alert(`${q.label} must be >= ${v.min}`); return; }
          if (v.max !== undefined && v.max !== "" && num > Number(v.max)) { alert(`${q.label} must be <= ${v.max}`); return; }
        }
      }
      if (q.type === 'file' && val) {
        const f = val;
        if (v.accept && v.accept.length) {
          const acceptArr = v.accept.split(',').map(s => s.trim().toLowerCase());
          const ext = (f.name || "").split('.').pop().toLowerCase();
          if (!acceptArr.includes('.' + ext) && !acceptArr.includes(f.type.toLowerCase())) {
            alert(`${q.label} must be one of: ${v.accept}`); return;
          }
        }
        if (v.maxFileSize && Number(v.maxFileSize) > 0) {
          if (f.size > Number(v.maxFileSize)) {
            alert(`${q.label} must be smaller than ${v.maxFileSize} bytes.`); return;
          }
        }
      }
    }

    // if all validations passed — build FormData and submit
    const fd = new FormData();

    // Add answers and files
    for (const [k, v] of Object.entries(values)) {
      if (v === null || v === undefined) continue;
      if (v instanceof File) {
        fd.append(k, v, v.name);
      } else if (Array.isArray(v)) {
        v.forEach(item => fd.append(k, item));
      } else {
        fd.append(k, v);
      }
    }

    // Also append top-level core fields so backend receives them as first-class fields
    // (so they can be saved into the top-level response properties and Google Sheet columns)
    try {
      const core = formObj.meta?.coreFields || {};
      const fullnameVal = values[core.fullNameId] || values[CORE_QUESTIONS.fullName.id] || "";
      const emailVal = values[core.emailId] || values[CORE_QUESTIONS.email.id] || "";
      const phoneVal = values[core.phoneId] || values[CORE_QUESTIONS.phone.id] || "";
      const collegeVal = values[core.collegeId] || values[CORE_QUESTIONS.college.id] || "";

      if (fullnameVal) fd.append('fullName', fullnameVal);
      if (emailVal) fd.append('email', emailVal);
      if (phoneVal) fd.append('phone', phoneVal);
      if (collegeVal) fd.append('college', collegeVal);
    } catch (err) {
      // swallow errors - not critical
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

  // Build pages from schema by splitting at questions with pageBreak === true
  function buildPagesFromSchema(schema = []) {
    const pages = [];
    let current = [];
    for (let i = 0; i < schema.length; i++) {
      const q = schema[i];
      current.push(q);
      if (q.pageBreak) {
        pages.push(current);
        current = [];
      }
    }
    if (current.length) pages.push(current);
    if (pages.length === 0) pages.push([]); // ensure at least one page
    return pages;
  }

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
     Derived filter options from data
  ------------------------- */
  const openingOptions = useMemo(() => {
    const uniq = [];
    const seen = new Set();
    openings.forEach(o => {
      if (!seen.has(o.id)) { seen.add(o.id); uniq.push({ value: o.id, label: o.title || o.id }); }
    });
    return uniq;
  }, [openings]);

  const locationOptions = useMemo(() => {
    const uniq = [];
    const seen = new Set();
    openings.forEach(o => {
      const v = (o.location || 'Unknown');
      if (!seen.has(v)) { seen.add(v); uniq.push({ value: v, label: v }); }
    });
    return uniq;
  }, [openings]);

  const departmentOptions = useMemo(() => {
    const uniq = [];
    const seen = new Set();
    openings.forEach(o => {
      const v = (o.department || 'General');
      if (!seen.has(v)) { seen.add(v); uniq.push({ value: v, label: v }); }
    });
    return uniq;
  }, [openings]);

  const sourceOptions = useMemo(() => {
    const uniq = [];
    const seen = new Set();
    responses.forEach(r => {
      const v = (r.source || 'unknown');
      if (!seen.has(v)) { seen.add(v); uniq.push({ value: v, label: v }); }
    });
    return uniq;
  }, [responses]);

  const statusOptions = useMemo(() => {
    const uniq = [];
    const seen = new Set();
    responses.forEach(r => {
      const v = (r.status || 'Applied');
      if (!seen.has(v)) { seen.add(v); uniq.push({ value: v, label: v }); }
    });
    return uniq;
  }, [responses]);

  /* -------------------------
     Utilities for extracting fields from a response
  ------------------------- */
  function extractCandidateName(r) {
    return (r.fullName || (r.answers && (r.answers.fullname || r.answers.name)) || "").trim();
  }
  function extractCandidateEmail(r) {
    return ((r.email || (r.answers && r.answers.email)) || "").trim();
  }
  function extractCandidateCollege(r) {
    // prefer top-level college if present, then fallback to answers
    const top = (r.college || r.collegeName || r.college_name || "").trim();
    if (top) return top;
    const candidates = [
      r.answers && (r.answers[CORE_QUESTIONS.college.id] || r.answers.college || r.answers.collegeName || r.answers.institute || r.answers.institution)
    ];
    for (const c of candidates) {
      if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return "";
  }

  /* -------------------------
     Apply filters to responses (includes searchQuery)
  ------------------------- */
  const filteredResponses = useMemo(() => {
    const q = (searchQuery || "").toLowerCase().trim();
    return responses.filter(r => {
      // Opening filter
      if (filterOpenings.length > 0 && !filterOpenings.includes(r.openingId)) return false;
      // Location filter -> find opening location
      const op = openings.find(o => o.id === r.openingId) || {};
      if (filterLocations.length > 0 && !filterLocations.includes((op.location || ''))) return false;
      // Department
      if (filterDepartments.length > 0 && !filterDepartments.includes((op.department || ''))) return false;
      // Source
      if (filterSources.length > 0 && !filterSources.includes((r.source || 'unknown'))) return false;
      // Status
      const status = (r.status || 'Applied');
      if (filterStatus.length > 0 && !filterStatus.includes(status)) return false;

      if (q) {
        const name = (extractCandidateName(r) || "").toLowerCase();
        const email = (extractCandidateEmail(r) || "").toLowerCase();
        const college = (extractCandidateCollege(r) || "").toLowerCase();
        const openingTitle = (op.title || "").toLowerCase();
        const source = (r.source || "unknown").toLowerCase();
        const id = (r.id || "").toLowerCase();

        const match = name.includes(q) || email.includes(q) || college.includes(q) || openingTitle.includes(q) || source.includes(q) || id.includes(q);
        if (!match) return false;
      }

      return true;
    });
  }, [responses, openings, filterOpenings, filterLocations, filterDepartments, filterSources, filterStatus, searchQuery]);

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
              {/* Main candidates column */}
              <div className="col-span-2 bg-white rounded-lg p-6 shadow-sm">
                {/* Search box */}
                <div className="mb-4">
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search candidates by name, email, college, opening, source or id..."
                    className="w-full border p-3 rounded"
                  />
                  <div className="text-xs text-gray-400 mt-2">Search searches name, email, college, opening title, source and response id.</div>
                </div>

                <h2 className="font-semibold mb-4">Candidates</h2>

                <div className="space-y-4">
                  {filteredResponses.length === 0 && <div className="text-sm text-gray-500">No candidates match the selected filters or search.</div>}

                  {filteredResponses.map(resp => {
                    const opening = openings.find(o => o.id === resp.openingId) || {};
                    const candidateName = resp.fullName || (resp.answers && (resp.answers.fullname || resp.answers.name)) || 'Candidate';
                    const candidateEmail = (resp.email || (resp.answers && resp.answers.email) || '').trim();
                    const candidateCollege = extractCandidateCollege(resp);
                    return (
                      <div key={resp.id} className="p-6 border rounded relative bg-white min-h-[130px]">
                        <div className="flex justify-between items-start">
                          {/* Left column: name/email + opening */}
                          <div style={{ minWidth: 0, maxWidth: 'calc(100% - 220px)' }}>
                            <div className="font-semibold text-xl leading-tight break-words">{candidateName}</div>
                            {candidateEmail ? (
                              <div className="text-sm text-gray-600 mt-1" style={{ textTransform: 'uppercase' }}>{candidateEmail}</div>
                            ) : null}
                            <div className="text-sm text-gray-500 mt-3 break-words">
                              {opening.title || '—'} &nbsp;•&nbsp; {opening.location || ''}
                            </div>
                            <div className="text-sm text-gray-500 mt-2">Source: <span className="break-words inline-block max-w-[60%]">{resp.source || 'unknown'}</span></div>

                            {/* College display */}
                            {candidateCollege ? (
                              <div className="text-sm text-gray-600 mt-2">College: <span className="font-medium">{candidateCollege}</span></div>
                            ) : null}

                            {/* Bottom-left row: Resume and response id */}
                            <div className="mt-4 text-sm flex flex-wrap items-center gap-2">
                              {resp.resumeLink ? (
                                <a href={resp.resumeLink} target="_blank" rel="noreferrer" className="text-blue-600 underline mr-3">Resume</a>
                              ) : null}
                              <span className="text-gray-500 break-all text-xs">{resp.id}</span>
                            </div>
                          </div>

                          {/* Right column: status selector */}
                          <div className="w-[200px] flex flex-col items-end">
                            <div className="text-xs text-gray-500 mb-1">Status</div>
                            <select
                              value={resp.status || 'Applied'}
                              onChange={(e) => updateCandidateStatus(resp.id, e.target.value)}
                              className="border p-2 rounded"
                            >
                              <option>Applied</option>
                              <option>Screening</option>
                              <option>Interview</option>
                              <option>Offer</option>
                              <option>Hired</option>
                              <option>Rejected</option>
                            </select>
                          </div>
                        </div>

                        {/* Applied-at: anchored bottom-right */}
                        <div className="absolute right-6 bottom-4 text-sm text-gray-500">
                          Applied at: {resp.createdAt ? new Date(resp.createdAt).toLocaleString() : ''}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* RIGHT SIDE: Filters aside */}
              <aside className="bg-white rounded-lg p-6 shadow-sm">
                <h3 className="font-semibold mb-4">Filters</h3>

                <div className="space-y-4">
                  <MultiSelectDropdown
                    label="Opening"
                    options={openingOptions}
                    selected={filterOpenings}
                    onChange={setFilterOpenings}
                    placeholder="All Opening"
                    searchEnabled={true}
                  />

                  <MultiSelectDropdown
                    label="Location"
                    options={locationOptions}
                    selected={filterLocations}
                    onChange={setFilterLocations}
                    placeholder="All Location"
                    searchEnabled={true}
                  />

                  <MultiSelectDropdown
                    label="Department"
                    options={departmentOptions}
                    selected={filterDepartments}
                    onChange={setFilterDepartments}
                    placeholder="All Department"
                    searchEnabled={true}
                  />

                  <MultiSelectDropdown
                    label="Source"
                    options={sourceOptions}
                    selected={filterSources}
                    onChange={setFilterSources}
                    placeholder="All Source"
                    searchEnabled={true}
                  />

                  <MultiSelectDropdown
                    label="Status"
                    options={statusOptions}
                    selected={filterStatus}
                    onChange={setFilterStatus}
                    placeholder="All Status"
                    searchEnabled={false}
                  />
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
        const formObj = forms[formModalOpeningId] || ensureCoreFieldsInForm({ questions: templateQuestions.map(q => ({ ...q })), meta: { coreFields: { fullNameId: CORE_QUESTIONS.fullName.id, emailId: CORE_QUESTIONS.email.id, phoneId: CORE_QUESTIONS.phone.id, resumeId: CORE_QUESTIONS.resume.id, collegeId: CORE_QUESTIONS.college.id } } });

        // header height (used for sticky offsets). Match with classes below if you change sizes.
        const headerHeight = 74; // px

        return (
          <div key={"formmodal_" + formModalOpeningId} className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 pt-6">
            <div className="bg-white rounded-lg shadow-xl w-[920px] max-h-[86vh] overflow-hidden">
              {/* Sticky Header - removed border line, subtle shadow */}
              <div className="w-full sticky top-0 z-30 bg-white" style={{ height: headerHeight, boxShadow: '0 1px 0 rgba(0,0,0,0.04)' }}>
                <div className="flex items-center justify-between p-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-1">Form Editor — {op.title}</h3>
                    <div className="text-xs text-gray-500">Edit questions, save, publish, or share links. Core fields are mandatory and cannot be removed.</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => openCustomModalFor(op.id)} className="px-3 py-2 border rounded bg-white hover:shadow">+ Add</button>
                    <button onClick={() => handleSaveForm(op.id)} className="px-3 py-2 border rounded bg-white hover:shadow">Save</button>
                    <button onClick={() => handlePublishForm(op.id)} className="px-3 py-2 bg-green-600 text-white rounded">Publish</button>
                    <button onClick={() => deleteFormByOpening(op.id)} className="px-3 py-2 border rounded text-red-600 bg-white hover:shadow">Delete</button>
                    <button onClick={() => closeFormModal()} className="px-3 py-2 border rounded bg-white hover:shadow">Close</button>
                  </div>
                </div>
              </div>

              {/* Content area: 3 columns, each with its own vertical scrolling */}
              <div className="grid grid-cols-3 gap-6 p-4" style={{ height: `calc(86vh - ${headerHeight}px)` }}>
                {/* Column 1: Question Bank */}
                <div className="flex flex-col">
                  <div className="sticky" style={{ top: headerHeight - 6, zIndex: 20, background: 'white' }}>
                    <h3 className="font-semibold mb-2">Question Bank</h3>
                  </div>
                  <div className="overflow-auto pr-2" style={{ maxHeight: `calc(86vh - ${headerHeight + 48}px)` }}>
                    <div className="space-y-3 pb-6">
                      {questionBank.length === 0 ? (
                        <div className="text-xs text-gray-400">No questions in bank yet. Create one using "+ Add".</div>
                      ) : (
                        questionBank.map(q => (
                          <div key={q.id} className="p-3 border rounded bg-white hover:bg-gray-50 cursor-pointer" onClick={() => addQuestion(op.id, q)}>
                            <div className="font-medium text-sm">{q.label}</div>
                            <div className="text-xs text-gray-500 mt-1">{q.type}{q.required ? ' • required' : ''}</div>
                          </div>
                        ))
                      )}

                      <div className="mt-6">
                        <div className="text-xs text-gray-500 mb-2">Or use template items</div>
                        {templateQuestions.map(t => (
                          <div key={t.id} className="p-3 border rounded mb-2 cursor-pointer hover:bg-gray-50" onClick={() => addQuestion(op.id, t)}>{t.label}</div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Column 2: Form Questions */}
                <div className="flex flex-col">
                  <div className="sticky" style={{ top: headerHeight - 6, zIndex: 20, background: 'white' }}>
                    <h3 className="font-semibold mb-2">Form Questions</h3>
                  </div>

                  <div className="overflow-auto" style={{ maxHeight: `calc(86vh - ${headerHeight + 48}px)` }}>
                    <ul className="space-y-3 pb-6">
                      {(formObj.questions || []).map((q, idx) => (
                        <li
                          key={q.id}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('from', idx)}
                          onDrop={(e) => { const from = parseInt(e.dataTransfer.getData('from')); onDrag(op.id, from, idx); }}
                          onDragOver={(e) => e.preventDefault()}
                          className="p-3 border rounded bg-white flex flex-col gap-2"
                        >
                          {/* Top row: Label + (type for non-protected at top-right) */}
                          <div className="flex items-start justify-between">
                            <div className="text-sm font-medium leading-tight">
                              {q.required ? <span className="text-red-500 mr-2">*</span> : null}
                              <span className="whitespace-normal">{q.label}</span>
                            </div>

                            {!PROTECTED_IDS.has(q.id) ? (
                              <div className="text-xs text-gray-400 ml-4">{q.type}</div>
                            ) : (
                              <div /> /* empty placeholder so layout stays consistent */
                            )}
                          </div>

                          {/* Middle row: optional validation summary */}
                          <div className="text-xs text-gray-500">
                            {q.required ? 'Required' : 'Optional'}
                            {q.validation && Object.keys(q.validation).length ? (
                              <span className="ml-3 text-gray-400">• {Object.entries(q.validation).map(([k,v]) => `${k}=${v}`).join(', ')}</span>
                            ) : null}
                          </div>

                          {/* Bottom row: left = protected lock + type (if protected), right = controls */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              {PROTECTED_IDS.has(q.id) ? (
                                <>
                                  <LockIcon className="w-4 h-4 text-gray-400" />
                                  <div className="text-xs text-gray-400">{q.type}</div>
                                </>
                              ) : (
                                <div /> /* nothing to show in bottom-left for non-protected */
                              )}
                            </div>

                            <div className="flex items-center gap-3">
                              {!PROTECTED_IDS.has(q.id) ? <button onClick={() => removeQuestion(op.id, q.id)} className="text-red-500 text-sm">Remove</button> : <div className="text-xs text-gray-400">Protected</div>}
                              <label className="flex items-center gap-2 text-xs text-gray-500">
                                <input type="checkbox" checked={!!q.pageBreak} onChange={() => togglePageBreak(op.id, q.id)} />
                                Page break after
                              </label>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Column 3: Preview & Share */}
                <div className="flex flex-col">
                  <div className="sticky" style={{ top: headerHeight - 6, zIndex: 20, background: 'white' }}>
                    <h3 className="font-semibold mb-2">Preview & Share</h3>
                  </div>

                  <div className="overflow-auto pl-2" style={{ maxHeight: `calc(86vh - ${headerHeight + 48}px)` }}>
                    {formObj.meta?.isPublished ? (
                      <div className="pb-6">
                        <div className="text-sm text-gray-600 mb-2">Form published on {formObj.meta.publishedAt ? new Date(formObj.meta.publishedAt).toLocaleString() : ''}</div>

                        <div className="mb-2">
                          <div className="text-xs font-semibold">Shareable links (by source)</div>
                          <ul className="mt-2 space-y-2">
                            {Object.entries(formObj.meta.shareLinks || {}).map(([src, link]) => (
                              <li key={src} className="flex items-center justify-between">
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
                          <div className="flex items-start gap-2 mt-2">
                            <div className="text-sm break-all">{formObj.meta.genericLink}</div>
                            <div className="flex flex-col gap-2">
                              <button onClick={() => handleCopy(formObj.meta.genericLink)} className="px-2 py-1 border rounded text-xs">Copy</button>
                              <button onClick={() => openPublicFormByLink(op.id, undefined)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">Open</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500 pb-6">Form not yet published. Click Publish to generate shareable links per source.</div>
                    )}

                    <div className="mt-4">
                      <div className="text-xs font-semibold">Live response count</div>
                      <div className="text-lg font-medium mt-1">{responses.filter(r => r.openingId === op.id).length}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Custom Question Modal */}
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
                <select value={customQ.type} onChange={(e) => setCustomQ({ ...customQ, type: e.target.value, validation: {} })} className="w-full mt-1 p-2 border rounded">
                  {QUESTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              {(customQ.type === 'dropdown' || customQ.type === 'checkboxes' || customQ.type === 'radio') && (
                <div>
                  <label className="text-xs text-gray-600">Options (one per line)</label>
                  <textarea value={customQ.optionsText} onChange={(e) => setCustomQ({ ...customQ, optionsText: e.target.value })} className="w-full mt-1 p-2 border rounded" rows={4} />
                </div>
              )}

              {/* Validation panel (type-specific) */}
              <div className="pt-2 border-t">
                <div className="text-sm font-medium mb-2">Validation (optional)</div>

                {(customQ.type === 'short_text' || customQ.type === 'long_text' || customQ.type === 'email' || customQ.type === 'url') && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-gray-600">Min length</label>
                        <input type="number" value={customQ.validation?.minLength || ""} onChange={(e) => setCustomQ(s => ({ ...s, validation: { ...s.validation, minLength: e.target.value } }))} className="w-full mt-1 p-2 border rounded" />
                      </div>
                      <div>
                        <label className="text-xs text-gray-600">Max length</label>
                        <input type="number" value={customQ.validation?.maxLength || ""} onChange={(e) => setCustomQ(s => ({ ...s, validation: { ...s.validation, maxLength: e.target.value } }))} className="w-full mt-1 p-2 border rounded" />
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="text-xs text-gray-600">Pattern (regex)</label>
                      <input value={customQ.validation?.pattern || ""} onChange={(e) => setCustomQ(s => ({ ...s, validation: { ...s.validation, pattern: e.target.value } }))} className="w-full mt-1 p-2 border rounded" placeholder="e.g. ^[A-Za-z ]+$" />
                    </div>
                  </>
                )}

                {customQ.type === 'number' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-600">Min value</label>
                      <input type="number" value={customQ.validation?.min || ""} onChange={(e) => setCustomQ(s => ({ ...s, validation: { ...s.validation, min: e.target.value } }))} className="w-full mt-1 p-2 border rounded" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">Max value</label>
                      <input type="number" value={customQ.validation?.max || ""} onChange={(e) => setCustomQ(s => ({ ...s, validation: { ...s.validation, max: e.target.value } }))} className="w-full mt-1 p-2 border rounded" />
                    </div>
                  </div>
                )}

                {customQ.type === 'file' && (
                  <>
                    <div>
                      <label className="text-xs text-gray-600">Accepted file types (comma-separated, e.g. .pdf,.docx,image/png)</label>
                      <input value={customQ.validation?.accept || ""} onChange={(e) => setCustomQ(s => ({ ...s, validation: { ...s.validation, accept: e.target.value } }))} className="w-full mt-1 p-2 border rounded" />
                    </div>
                    <div className="mt-3">
                      <label className="text-xs text-gray-600">Max file size (bytes)</label>
                      <input type="number" value={customQ.validation?.maxFileSize || ""} onChange={(e) => setCustomQ(s => ({ ...s, validation: { ...s.validation, maxFileSize: e.target.value } }))} className="w-full mt-1 p-2 border rounded" />
                    </div>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 mt-3">
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

      {/* Public apply modal */}
      {publicView && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-[760px] max-h-[90vh] overflow-auto shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-2xl font-semibold mb-1">Personal data</h3>
                <div className="text-sm text-gray-500 mb-1">Fields with <span className="text-red-500">*</span> are mandatory.</div>
              </div>
              <div>
                <button onClick={() => setPublicView(null)} className="px-3 py-1 border rounded">Close</button>
              </div>
            </div>

            {!publicView.submitted ? (
              <>
                <form onSubmit={handlePublicSubmit} className="space-y-6">
                  {/* build pages from schema */}
                  {(() => {
                    const schema = forms[publicView.openingId]?.questions || [];
                    const pages = buildPagesFromSchema(schema);
                    const pageIndex = (publicView.page || 0);
                    const currentPage = pages[pageIndex] || [];
                    // render all fields in currentPage
                    return (
                      <PageRenderer
                        pageQuestions={currentPage}
                        allSchema={schema}
                        pageIndex={pageIndex}
                        totalPages={pages.length}
                        onBack={() => setPublicView(prev => ({ ...prev, page: Math.max(0, (prev.page || 0) - 1) }))}
                        onNext={() => setPublicView(prev => ({ ...prev, page: Math.min(((pages.length - 1) || 0), (prev.page || 0) + 1) }))}
                        isLastPage={pageIndex === pages.length - 1}
                      />
                    );
                  })()}

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

/* -------------------------
   PageRenderer component for public form pagination
   - receives pageQuestions: array of questions for current page
   - allSchema: entire schema (used for validation on submit)
   - pageIndex, totalPages, onBack, onNext
   - this renders inputs and the appropriate buttons (Back/Next/Submit Form)
  ------------------------- */
function PageRenderer({ pageQuestions = [], allSchema = [], pageIndex = 0, totalPages = 1, onBack = () => {}, onNext = () => {}, isLastPage = true }) {
  // We purposely don't manage component-level form state here -- the parent form submission
  // gathers inputs by name; we must ensure each input's name equals question.id so handlePublicSubmit can read.
  return (
    <>
      {pageQuestions.map(q => (
        <div key={q.id}>
          <label className="block text-sm font-medium mb-2">{q.label}{q.required ? " *" : ""}</label>

          {q.type === "long_text" ? (
            <textarea name={q.id} required={q.required} minLength={q.validation?.minLength} maxLength={q.validation?.maxLength} pattern={q.validation?.pattern} className="w-full border p-2 rounded-md" />
          ) : q.type === "dropdown" || q.type === "radio" ? (
            <select name={q.id} required={q.required} className="w-full border p-2 rounded-md">{(q.options || []).map(opt => <option key={opt}>{opt}</option>)}</select>
          ) : q.type === "checkboxes" ? (
            (q.options || []).map(opt => <div key={opt}><label className="inline-flex items-center"><input name={q.id} value={opt} type="checkbox" className="mr-2" /> {opt}</label></div>)
          ) : q.type === "file" ? (
            <input name={q.id} type="file" accept={q.validation?.accept || undefined} />
          ) : q.type === "number" ? (
            <input name={q.id} type="number" required={q.required} min={q.validation?.min} max={q.validation?.max} className="w-full border p-2 rounded-md" />
          ) : q.type === "email" ? (
            <input name={q.id} type="email" required={q.required} minLength={q.validation?.minLength} maxLength={q.validation?.maxLength} pattern={q.validation?.pattern} className="w-full border p-2 rounded-md" />
          ) : q.id === CORE_QUESTIONS.phone.id || q.label.toLowerCase().includes("phone") ? (
            // stronger input constraints for phone field in UI (also validated server-side in handlePublicSubmit)
            <input name={q.id} type="tel" required={q.required} pattern="^\d{7,15}$" inputMode="numeric" title="Enter 7 to 15 digits" className="w-full border p-2 rounded-md" />
          ) : (
            <input name={q.id} required={q.required} minLength={q.validation?.minLength} maxLength={q.validation?.maxLength} pattern={q.validation?.pattern} className="w-full border p-2 rounded-md" />
          )}
        </div>
      ))}

      <div className="flex items-center justify-between mt-4">
        <div>
          {pageIndex > 0 ? <button type="button" onClick={onBack} className="px-4 py-2 border rounded-md text-sm">← BACK</button> : <div />}
        </div>

        <div>
          {totalPages <= 1 ? (
            <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm">Submit Form</button>
          ) : isLastPage ? (
            <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm">Submit Form</button>
          ) : (
            <button type="button" onClick={onNext} className="px-6 py-2 bg-blue-600 text-white rounded-md text-sm">NEXT →</button>
          )}
        </div>
      </div>
    </>
  );
}
