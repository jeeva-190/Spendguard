const uuid = () => (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
function createHash() {
  let data = '';
  return { update(s) { data += s; return this; }, digest() { let h = 5381; for (let i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) | 0; return (h >>> 0).toString(16); } };
}
module.exports = { randomUUID: uuid, createHash, randomBytes: () => ({ toString: () => uuid() }) };
