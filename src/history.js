// Undo/redo as a stack of project snapshots (JSON strings).
// Text typing is coalesced so one word is one undo step, not one letter.

const LIMIT = 150;
let stack = [];
let idx = -1;
let timer = 0;
let pendingProject = null;
let listener = () => {};

export const onHistoryChange = (fn) => { listener = fn; };

export function resetHistory(project) {
  clearTimeout(timer); pendingProject = null;
  stack = [JSON.stringify(project)];
  idx = 0;
  listener();
}

function commit(project) {
  const snap = JSON.stringify(project);
  if (snap === stack[idx]) return;
  stack = stack.slice(0, idx + 1);
  stack.push(snap);
  if (stack.length > LIMIT) stack.shift();
  idx = stack.length - 1;
  listener();
}

export function record(project, coalesce = false) {
  clearTimeout(timer);
  if (coalesce) {
    pendingProject = project;
    timer = setTimeout(() => { pendingProject = null; commit(project); }, 600);
  } else {
    pendingProject = null;
    commit(project);
  }
}

function flush() {
  if (pendingProject) { clearTimeout(timer); const p = pendingProject; pendingProject = null; commit(p); }
}

export function undo() {
  flush();
  if (idx <= 0) return null;
  idx--; listener();
  return JSON.parse(stack[idx]);
}

export function redo() {
  flush();
  if (idx >= stack.length - 1) return null;
  idx++; listener();
  return JSON.parse(stack[idx]);
}

export const canUndo = () => idx > 0 || !!pendingProject;
export const canRedo = () => idx < stack.length - 1;
