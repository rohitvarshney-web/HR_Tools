// scripts/migrate-questions.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const DATA_DIR = path.resolve(__dirname, '..', 'server_data');
const FORMS_FILE = path.join(DATA_DIR, 'forms.json');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
function readJson(fp){ if (!fs.existsSync(fp)) return []; return JSON.parse(fs.readFileSync(fp,'utf8')||'[]'); }
function writeJson(fp, d){ fs.writeFileSync(fp, JSON.stringify(d, null, 2), 'utf8'); }
function signature(q){ return `${q.type}||${(q.label||'').trim()}||${(q.options||[]).join('|')}||${q.required?1:0}`; }
const forms = readJson(FORMS_FILE);
const questions = readJson(QUESTIONS_FILE) || [];
const map = {};
questions.forEach(q => map[signature(q)] = q.id);
let added = 0;
for (const f of forms) {
  f.data = f.data || {}; f.data.questions = f.data.questions || [];
  const newQList = [];
  for (const q of f.data.questions) {
    if (q.questionId) { newQList.push(q); continue; }
    const sig = signature(q);
    let qid = map[sig];
    if (!qid) {
      qid = `q_${Date.now()}_${Math.floor(Math.random()*10000)}`;
      const qdoc = { id: qid, type: q.type, label: q.label, required: !!q.required, options: q.options || [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), meta: {} };
      questions.unshift(qdoc);
      map[sig] = qid;
      added++;
    }
    newQList.push({ questionId: qid, localLabel: null, localRequired: null });
  }
  f.data.questions = newQList;
}
writeJson(QUESTIONS_FILE, questions);
writeJson(FORMS_FILE, forms);
console.log('Migration complete. Questions added:', added);
