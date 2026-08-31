export function getPersistentClientId(storage, createId) {
  try {
    const stored = storage.getItem("comfydeck.clientId");
    if (stored) return stored;
    const created = createId();
    storage.setItem("comfydeck.clientId", created);
    return created;
  } catch {
    return createId();
  }
}

export function activeQueueState(activePromptId, jobs) {
  if (!activePromptId) return "none";
  const activeJob = jobs.find((job) => job.promptId === activePromptId);
  if (!activeJob) return "missing";
  return activeJob.running ? "running" : "pending";
}
