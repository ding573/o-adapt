// Small curated corpus: explicit policy retrieval is auditable and needs no vector service.
export function retrieveDocuments(documents, request) {
  const ids = new Set(['KB-02', 'KB-05', 'KB-06', 'KB-07', 'KB-08']);
  if (request.difficulty === 'beginner') ids.add('KB-03');
  if (request.focus === 'route-choice') ids.add('KB-04');
  const selected = documents.filter(document => ids.has(document.id));
  if (selected.length !== ids.size) throw new Error('The knowledge base is missing required rules; generation stopped.');
  return selected;
}
