// Apply a saved manual theme before first paint (per-viewer convenience).
  try { var t = localStorage.getItem("apex-theme"); if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t); } catch (e) {}
