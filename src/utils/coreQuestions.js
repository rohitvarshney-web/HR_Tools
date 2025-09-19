// stable core questions + protected ids
export const CORE_QUESTIONS = {
  fullName: { id: "q_fullname", type: "short_text", label: "Full name", required: true },
  email: { id: "q_email", type: "email", label: "Email address", required: true },
  phone: { id: "q_phone", type: "short_text", label: "Phone number", required: true },
  resume: { id: "q_resume", type: "file", label: "Upload resume / CV", required: true },
  college: { id: "q_college", type: "short_text", label: "College / Organization", required: true },
};
export const PROTECTED_IDS = new Set(Object.values(CORE_QUESTIONS).map(q => q.id));
