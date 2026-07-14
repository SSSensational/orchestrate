export function parseTasks(md) {
  const tasks = [];
  let current = null;
  for (const line of md.split(/\r?\n/)) {
    const top = line.match(/^##\s+\d+\.\s+(.+?)\s*$/);
    const criterion = line.match(/^\s+- \[[ xX]\]\s+(.+?)\s*$/);
    if (top) {
      current = { title: top[1], subs: [] };
      tasks.push(current);
    } else if (criterion && current) {
      current.subs.push(criterion[1]);
    } else if (/^#{1,6}\s+/.test(line)) {
      current = null;
    }
  }
  return tasks;
}
